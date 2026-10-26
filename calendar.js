import { addDays } from './course.js';

export function monthGrid(iso) {
  const first = iso.slice(0, 7) + '-01';
  const weekday = new Date(first + 'T00:00:00Z').getUTCDay();
  const start = addDays(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return { date, day: Number(date.slice(8)), current: date.slice(0, 7) === first.slice(0, 7) };
  });
}

export function shiftMonth(iso, delta) {
  const date = new Date(iso.slice(0, 7) + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}
