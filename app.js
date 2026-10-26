import { MAX_BYTES, MAX_STAGES, MAX_DOSES, today, addDays, newStage, emptyCourse, exampleCourse, ranges, validateCourse, makeEnvelope, byteLength, encodePrefill, decodePrefill } from './course.js';
import { monthGrid, shiftMonth } from './calendar.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const tg = window.Telegram?.WebApp;
const params = new URLSearchParams(location.search);
// Explicit opt-in for the isolated Telegram probe. A normal browser preview never sends data.
const telegramMode = params.get('transport') === 'telegram' && tg && tg.platform && tg.platform !== 'unknown';
const draftPrefix = 'medbot-miniapp-v1:';
let course = emptyCourse();
let edit = null;
let invalidLink = false;
let submitted = false;
let lastPayload = null;
let storageKey = draftPrefix + 'create';
let savedDraft = null;
let calendarMonth = today().slice(0, 7) + '-01';

function updateDateDisplay() {
  $('#start').value = course.start;
  $('#start-display').textContent = dateLabel(course.start);
}

function chooseDate(iso) {
  course.start = iso;
  updateDateDisplay();
  changed();
  if ($('#calendar').open) $('#calendar').close();
}

function renderCalendar() {
  const year = Number(calendarMonth.slice(0, 4));
  const month = Number(calendarMonth.slice(5, 7));
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  $('#calendar-month').innerHTML = monthNames.map((name, i) => `<option value="${i + 1}" ${i + 1 === month ? 'selected' : ''}>${name}</option>`).join('');
  const years = Array.from({ length: Math.max(2100, year) - Math.min(2000, year) + 1 }, (_, i) => Math.min(2000, year) + i);
  $('#calendar-year').innerHTML = years.map((value) => `<option ${value === year ? 'selected' : ''}>${value}</option>`).join('');
  $('#calendar-days').innerHTML = monthGrid(calendarMonth).map(({ date, day, current }) => `<button type="button" data-date="${date}" class="calendar-day ${current ? '' : 'outside'} ${date === course.start ? 'selected' : ''} ${date === today() ? 'is-today' : ''}" aria-label="${esc(dateLabel(date))}" aria-pressed="${date === course.start}" ${date === today() ? 'aria-current="date"' : ''}>${day}</button>`).join('');
}

$('#open-calendar').addEventListener('click', () => {
  calendarMonth = (course.start || today()).slice(0, 7) + '-01';
  renderCalendar();
  $('#calendar').showModal();
  $('#calendar-days .selected')?.focus();
});
$('#calendar-close').addEventListener('click', () => $('#calendar').close());
$('#calendar-prev').addEventListener('click', () => { calendarMonth = shiftMonth(calendarMonth, -1); renderCalendar(); });
$('#calendar-next').addEventListener('click', () => { calendarMonth = shiftMonth(calendarMonth, 1); renderCalendar(); });
for (const selector of ['#calendar-month', '#calendar-year']) {
  $(selector).addEventListener('change', () => { calendarMonth = `${$('#calendar-year').value}-${$('#calendar-month').value.padStart(2, '0')}-01`; renderCalendar(); });
}
$('#calendar-days').addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (button) chooseDate(button.dataset.date);
});
$('#calendar-days').addEventListener('keydown', (event) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  const button = event.target.closest('[data-date]');
  if (!step || !button) return;
  event.preventDefault();
  const next = addDays(button.dataset.date, step);
  if (next.slice(0, 7) !== calendarMonth.slice(0, 7)) { calendarMonth = next.slice(0, 7) + '-01'; renderCalendar(); }
  $(`#calendar-days [data-date="${next}"]`)?.focus();
});
$('#calendar-today').addEventListener('click', () => chooseDate(today()));
$('#calendar-tomorrow').addEventListener('click', () => chooseDate(addDays(today(), 1)));

function message(text, target = '#notice') {
  const node = $(target);
  node.textContent = text;
  node.hidden = !text;
}

function readLink() {
  try {
    const encoded = new URLSearchParams(location.hash.slice(1)).get('course');
    if (!encoded) return;
    const envelope = decodePrefill(encoded);
    course = envelope.course;
    edit = envelope.edit;
    storageKey = `${draftPrefix}edit:${edit.course_id}:${edit.revision}`;
  } catch (error) {
    invalidLink = true;
    message(`${error.message} Ничего не отправлено. Откройте новую форму из бота.`);
  }
}

function storeDraft() {
  try { localStorage.setItem(storageKey, JSON.stringify({ course, savedAt: Date.now() })); }
  catch { /* Storage can be unavailable in a WebView; submission still works. */ }
}

function clearDraft() {
  try { localStorage.removeItem(storageKey); } catch { /* Optional local cache. */ }
}

function dateLabel(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Выберите дату';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

function stageDates(index) {
  if (!course.start || course.stages.some((stage) => stage.days !== null && (!Number.isInteger(stage.days) || stage.days < 1 || stage.days > 3650))) return 'Укажите начало и длительность';
  const range = ranges(course)[index];
  return range.end ? `${dateLabel(range.start)} — ${dateLabel(range.end)}` : `С ${dateLabel(range.start)} · постоянно`;
}

function updateSummary() {
  const count = course.stages.length;
  const continuous = course.stages.some((stage) => stage.days === null);
  const days = course.stages.reduce((n, stage) => n + (Number(stage.days) || 0), 0);
  $('#summary').textContent = `${count} ${count === 1 ? 'этап' : count < 5 ? 'этапа' : 'этапов'} · ${continuous ? 'постоянно' : days + ' дн.'}`;
  document.querySelectorAll('[data-stage-dates]').forEach((node) => { node.textContent = stageDates(Number(node.dataset.stageDates)); });
  $('#add-stage').disabled = count >= MAX_STAGES || continuous || invalidLink;
}

function changed() {
  storeDraft();
  updateSummary();
  message('', '#errors');
}

function renderStages() {
  $('#stages').innerHTML = course.stages.map((stage, i) => `
    <section class="panel stage" data-stage="${i}">
      <div class="stage-head"><span class="stage-number">${i + 1}</span><div class="stage-heading"><h2>Этап ${i + 1}</h2><small data-stage-dates="${i}">${esc(stageDates(i))}</small></div>
      ${course.stages.length > 1 ? `<button type="button" class="icon-button" data-action="remove-stage" aria-label="Удалить этап ${i + 1}">×</button>` : ''}</div>
      <div class="duration"><label>Длительность <input type="number" min="1" max="3650" step="1" value="${stage.days ?? ''}" data-field="days" aria-label="Длительность этапа ${i + 1}, дней" ${stage.days === null ? 'disabled' : 'required'}></label><span>дней</span>
      ${i === course.stages.length - 1 ? `<button type="button" class="toggle ${stage.days === null ? 'active' : ''}" data-action="continuous" aria-pressed="${stage.days === null}">Постоянно</button>` : ''}</div>
      <div class="dose-head" aria-hidden="true"><span>ВРЕМЯ</span><span>ДОЗА И КОММЕНТАРИЙ</span></div>
      ${stage.doses.map((row, j) => `<div class="dose-row" data-row="${j}"><input type="time" value="${esc(row.time)}" data-field="time" aria-label="Этап ${i + 1}, приём ${j + 1}, время" required><input type="text" value="${esc(row.dose)}" data-field="dose" maxlength="160" placeholder="½ таблетки после еды" aria-label="Этап ${i + 1}, приём ${j + 1}, доза" required><button type="button" class="icon-button" data-action="remove-dose" aria-label="Удалить приём ${j + 1} этапа ${i + 1}" ${stage.doses.length === 1 ? 'disabled' : ''}>×</button></div>`).join('')}
      <div class="stage-bottom"><button type="button" class="add-dose" data-action="add-dose" ${stage.doses.length >= MAX_DOSES ? 'disabled' : ''}>＋ Добавить приём</button><button type="button" class="copy-stage" data-action="copy-stage" ${course.stages.length >= MAX_STAGES || course.stages.some((item) => item.days === null) ? 'disabled' : ''}>Скопировать этап ↗</button></div>
    </section>`).join('');
  updateSummary();
}

function renderEditor() {
  $('#medicine').value = course.name;
  updateDateDisplay();
  $('#mode-label').textContent = edit ? 'РЕДАКТИРОВАНИЕ КУРСА' : 'НОВОЕ ЛЕКАРСТВО';
  renderStages();
  $('#review-button').disabled = invalidLink;
}

function showScreen(id) {
  for (const name of ['editor', 'review', 'result']) $('#' + name).hidden = name !== id;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

$('#medicine').addEventListener('input', (event) => { course.name = event.target.value; changed(); });
$('#start').addEventListener('input', (event) => { course.start = event.target.value; changed(); });
for (const [selector, days] of [['#today', 0], ['#tomorrow', 1]]) {
  $(selector).addEventListener('click', () => chooseDate(addDays(today(), days)));
}

$('#stages').addEventListener('input', (event) => {
  const input = event.target;
  const field = input.dataset.field;
  if (!field) return;
  const stage = course.stages[Number(input.closest('[data-stage]').dataset.stage)];
  if (field === 'days') stage.days = input.value === '' ? '' : Number(input.value);
  else stage.doses[Number(input.closest('[data-row]').dataset.row)][field] = input.value;
  changed();
});

$('#stages').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const i = Number(button.closest('[data-stage]').dataset.stage);
  const stage = course.stages[i];
  switch (button.dataset.action) {
    case 'remove-stage':
      if (!window.confirm(`Удалить этап ${i + 1} вместе с его приёмами?`)) return;
      course.stages.splice(i, 1); break;
    case 'continuous': stage.days = stage.days === null ? 7 : null; break;
    case 'add-dose': stage.doses.push({ time: '', dose: stage.doses.at(-1)?.dose || '' }); break;
    case 'remove-dose': stage.doses.splice(Number(button.closest('[data-row]').dataset.row), 1); break;
    case 'copy-stage': course.stages.splice(i + 1, 0, clone(stage)); break;
    default: return;
  }
  changed(); renderStages();
});

$('#add-stage').addEventListener('click', () => { course.stages.push(newStage()); changed(); renderStages(); });
$('#example').addEventListener('click', () => {
  if ((course.name || course.stages.some((stage) => stage.doses.some((dose) => dose.time || dose.dose))) && !window.confirm('Заменить заполненную форму примером?')) return;
  course = exampleCourse(); changed(); renderEditor();
});
$('#reset').addEventListener('click', () => {
  if (!window.confirm('Очистить название, время и дозы в форме? Сохранённый курс в боте не изменится.')) return;
  course = emptyCourse(); changed(); renderEditor();
});

$('#course-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (invalidLink) return;
  const errors = validateCourse(course);
  if (errors.length) { message(errors.join('\n'), '#errors'); return; }
  lastPayload = makeEnvelope(course, edit);
  const size = byteLength(lastPayload);
  if (size > MAX_BYTES) { message(`Курс занимает ${size} байт, Telegram принимает до ${MAX_BYTES}. Сократите комментарии или разделите курс на несколько. Черновик сохранён.`, '#errors'); return; }
  const normalized = lastPayload.course;
  const periods = ranges(normalized);
  const total = normalized.stages.reduce((n, stage) => n + (stage.days || 0) * stage.doses.length, 0);
  $('#review-content').innerHTML = `<h2 class="review-name">${esc(normalized.name)}</h2><div class="review-meta">С ${esc(dateLabel(normalized.start))} · ${normalized.stages.some((stage) => stage.days === null) ? 'есть постоянный этап' : `${total} приёмов за курс`}</div>` + normalized.stages.map((stage, i) => `<section class="panel review-stage"><h2>Этап ${i + 1} · ${stage.days === null ? 'постоянно' : stage.days + ' дн.'}</h2><p>${esc(dateLabel(periods[i].start))}${periods[i].end ? ' — ' + esc(dateLabel(periods[i].end)) : ' и далее'}</p>${stage.doses.map((row) => `<div class="review-dose"><time>${esc(row.time)}</time><span>${esc(row.dose)}</span></div>`).join('')}</section>`).join('');
  $('#save').textContent = edit ? 'Сохранить изменения' : 'Сохранить курс';
  message('', '#review-errors');
  showScreen('review');
});

$('#back').addEventListener('click', () => showScreen('editor'));
$('#save').addEventListener('click', () => {
  if (!lastPayload || submitted) return;
  if (telegramMode) {
    try {
      submitted = true;
      $('#save').disabled = true;
      tg.sendData(JSON.stringify(lastPayload));
      // No optimistic DB success: only the bot's chat response confirms acceptance.
      message('Данные переданы Telegram. Подтверждение сохранения придёт сообщением от бота.', '#review-errors');
    } catch {
      submitted = false;
      $('#save').disabled = false;
      message('Не удалось передать курс. Черновик сохранён. Откройте форму кнопкой клавиатуры тестового бота.', '#review-errors');
    }
    return;
  }
  $('#payload').textContent = JSON.stringify(lastPayload, null, 2);
  $('#byte-count').textContent = `· ${byteLength(lastPayload)} / ${MAX_BYTES} байт`;
  showScreen('result');
});

$('#return-editor').addEventListener('click', () => showScreen('editor'));
$('#edit-demo').addEventListener('click', () => {
  const payload = makeEnvelope(lastPayload.course, { course_id: edit?.course_id || 42, revision: edit?.revision || 1, token: 'local-demo-only' });
  const url = new URL(location.href);
  url.searchParams.delete('transport');
  url.searchParams.set('demo', '1');
  url.hash = 'course=' + encodePrefill(payload);
  location.assign(url.href);
  // A fragment-only navigation does not reload a page; force reload for deterministic prefill.
  if (url.search === location.search) location.reload();
});

readLink();
if (!invalidLink) {
  try {
    const draft = JSON.parse(localStorage.getItem(storageKey));
    if (draft && Date.now() - draft.savedAt < 7 * 24 * 60 * 60 * 1000 && draft.course && Array.isArray(draft.course.stages) && draft.course.stages.length >= 1 && draft.course.stages.length <= MAX_STAGES && draft.course.stages.every((stage) => stage && Array.isArray(stage.doses) && stage.doses.length >= 1 && stage.doses.length <= MAX_DOSES && stage.doses.every((dose) => dose && typeof dose.time === 'string' && typeof dose.dose === 'string'))) savedDraft = draft.course;
  } catch { clearDraft(); }
  message(edit ? 'Курс предзаполнен. Изменения применятся только после сохранения и проверки ботом.' : telegramMode ? 'Тестовая форма: результат получит тестовый бот.' : 'Можно попробовать форму в браузере. Напоминания не создаются.');
  if (savedDraft) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-button'; button.textContent = 'Восстановить черновик';
    button.addEventListener('click', () => { course = savedDraft; savedDraft = null; renderEditor(); message('Черновик восстановлен.'); });
    $('#notice').append(button);
  }
}
if (tg) { tg.ready(); tg.expand(); }
renderEditor();
