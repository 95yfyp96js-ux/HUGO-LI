/**
 * Asia/Taipei has a fixed UTC+8 offset with no daylight saving, so "today in
 * Taipei" can be computed with plain arithmetic — no Intl timezone database
 * lookup needed, and critically, no dependence on the server process's own
 * TZ setting. Every boundary in this module is computed the same way
 * regardless of where the server happens to run.
 *
 * This exists because the daily-close accounting (今日應收/實收/未收) is
 * defined against a Taipei calendar day, not a UTC one: a payment made at
 * 23:30 Taipei time is already the next UTC day, and reporting it against
 * the wrong day would misstate a real business day's numbers.
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface DayRange {
  /** The Taipei calendar date this range represents, as YYYY-MM-DD. */
  label: string;
  /** UTC instant of that day's 00:00 Asia/Taipei (inclusive). */
  start: Date;
  /** UTC instant of the next day's 00:00 Asia/Taipei (exclusive). */
  end: Date;
}

function taipeiMidnightUtcMs(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day) - TAIPEI_OFFSET_MS;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The Taipei calendar day a UTC instant falls on, as {year, monthIndex, day}
 * — shifting by the fixed offset and reading UTC fields back off the result
 * is what avoids needing a timezone-aware Date API.
 */
function taipeiCalendarDate(instant: Date): { year: number; monthIndex: number; day: number } {
  const shifted = new Date(instant.getTime() + TAIPEI_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/**
 * Resolves a day for the daily close: an explicit "YYYY-MM-DD" string is
 * read as a Taipei calendar date directly; omitted, it is "today" as seen
 * from Taipei right now (per the injected Clock, not the system clock).
 */
export function resolveTaipeiDay(dateInput: string | undefined, now: Date): DayRange {
  let year: number, monthIndex: number, day: number;

  if (dateInput) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
    if (!match) {
      throw new RangeError(`date must be YYYY-MM-DD, got: ${dateInput}`);
    }
    year = Number(match[1]);
    monthIndex = Number(match[2]) - 1;
    day = Number(match[3]);
  } else {
    ({ year, monthIndex, day } = taipeiCalendarDate(now));
  }

  const startMs = taipeiMidnightUtcMs(year, monthIndex, day);
  const start = new Date(startMs);
  if (Number.isNaN(start.getTime())) {
    throw new RangeError(`date must be a valid calendar date, got: ${dateInput}`);
  }
  const end = new Date(startMs + 24 * 60 * 60 * 1000);
  const label = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;

  return { label, start, end };
}

/** Whether `instant` falls on an earlier Taipei calendar day than `reference`. */
export function isBeforeTaipeiDay(instant: Date, reference: Date): boolean {
  const a = taipeiCalendarDate(instant);
  const b = taipeiCalendarDate(reference);
  if (a.year !== b.year) return a.year < b.year;
  if (a.monthIndex !== b.monthIndex) return a.monthIndex < b.monthIndex;
  return a.day < b.day;
}
