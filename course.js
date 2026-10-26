export const MAX_BYTES = 4096;
export const MAX_STAGES = 10;
export const MAX_DOSES = 12;

export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Krasnoyarsk', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (key) => parts.find((part) => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function newStage() { return { days: 7, doses: [{ time: '', dose: '' }] }; }
export function emptyCourse() { return { name: '', start: today(), stages: [newStage()] }; }
export function exampleCourse() {
  return { name: 'Пример лекарства', start: today(), stages: [
    { days: 2, doses: [{ time: '08:00', dose: '1 таблетка' }, { time: '14:00', dose: '1 таблетка' }, { time: '20:00', dose: '½ таблетки после еды' }] },
    { days: 3, doses: [{ time: '08:00', dose: '1 таблетка' }, { time: '12:00', dose: '1 таблетка' }, { time: '16:00', dose: '1 таблетка' }, { time: '20:00', dose: '½ таблетки после еды' }] },
  ] };
}

export function ranges(course) {
  let start = course.start;
  return course.stages.map((stage) => {
    const end = stage.days === null ? null : addDays(start, Number(stage.days) - 1);
    const range = { start, end };
    if (end) start = addDays(end, 1);
    return range;
  });
}

export function validateCourse(course) {
  const errors = [];
  if (!course || typeof course !== 'object') return ['Некорректный формат курса.'];
  if (typeof course.name !== 'string' || !course.name.trim() || course.name.length > 128) errors.push('Название: от 1 до 128 символов.');
  if (typeof course.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(course.start) || addDays(course.start, 0) !== course.start) errors.push('Выберите корректную дату начала.');
  if (!Array.isArray(course.stages) || !course.stages.length || course.stages.length > MAX_STAGES) return [...errors, `Нужно от 1 до ${MAX_STAGES} этапов.`];
  course.stages.forEach((stage, i) => {
    const prefix = `Этап ${i + 1}: `;
    if (!stage || typeof stage !== 'object') { errors.push(prefix + 'некорректный формат.'); return; }
    if (stage.days === null) {
      if (i !== course.stages.length - 1) errors.push(prefix + 'постоянным может быть только последний этап.');
    } else if (!Number.isInteger(stage.days) || stage.days < 1 || stage.days > 3650) errors.push(prefix + 'укажите длительность от 1 до 3650 дней.');
    if (!Array.isArray(stage.doses) || !stage.doses.length || stage.doses.length > MAX_DOSES) { errors.push(prefix + `нужно от 1 до ${MAX_DOSES} приёмов.`); return; }
    const times = new Set();
    stage.doses.forEach((row, j) => {
      if (!row || typeof row !== 'object') { errors.push(prefix + 'некорректный приём.'); return; }
      if (typeof row.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) errors.push(prefix + `задайте время приёма ${j + 1}.`);
      else if (times.has(row.time)) errors.push(prefix + `время ${row.time} повторяется.`);
      times.add(row.time);
      if (typeof row.dose !== 'string' || !row.dose.trim() || row.dose.length > 160) errors.push(prefix + `доза приёма ${j + 1}: от 1 до 160 символов.`);
    });
  });
  if (!errors.length && ranges(course).some((range) => !range.start || (range.end && !/^\d{4}-/.test(range.end)))) errors.push('Конечная дата курса слишком далеко.');
  return errors;
}

export function makeEnvelope(course, edit = null) {
  const normalized = {
    name: course.name.trim(), start: course.start,
    stages: course.stages.map((stage) => ({ days: stage.days, doses: stage.doses.map((row) => ({ time: row.time, dose: row.dose.trim() })).sort((a, b) => a.time.localeCompare(b.time)) })),
  };
  const payload = { v: 1, action: edit ? 'update' : 'create', course: normalized };
  if (edit) payload.edit = { course_id: edit.course_id, revision: edit.revision, token: edit.token };
  return payload;
}

export function byteLength(value) { return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length; }

export function encodePrefill(envelope) {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodePrefill(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 12000 || !/^[\w-]+$/.test(encoded)) throw new Error('Некорректная ссылка редактирования.');
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const raw = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!envelope || typeof envelope !== 'object' || envelope.v !== 1 || envelope.action !== 'update') throw new Error('Эта версия записи не поддерживается. Удалите курс и добавьте заново.');
  const edit = envelope.edit;
  if (!edit || !Number.isSafeInteger(edit.course_id) || edit.course_id < 1 || !Number.isSafeInteger(edit.revision) || edit.revision < 1 || typeof edit.token !== 'string' || !edit.token || edit.token.length > 512) throw new Error('В ссылке отсутствуют данные для редактирования. Откройте курс заново из бота.');
  const errors = validateCourse(envelope.course);
  if (errors.length) throw new Error(errors.join(' '));
  return makeEnvelope(envelope.course, edit);
}
