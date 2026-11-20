// Formats shared by the /disbursements/ table and figures.
//
// Amounts: the exact form, to the cent as filed, goes in every table cell and
// tooltip; the short form ("$8.96B") only labels bars and axes.
//
// Periods: the URL and API take `2026q2`, which the function turns into the
// quarter's first day (netlify/functions/disbursements.js). A Senate half
// year starts on a quarter's first day too (October 1 is `2025q4`), so the
// same key selects it. Labels name the months, as the House titles each
// quarter's files ("APRIL-JUNE 2026") and the Senate each volume ("October 1,
// 2025 to March 31, 2026").

const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const short = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumSignificantDigits: 3,
});

export const moneyExact = (n) => exact.format(Number(n));
export const moneyShort = (n) => short.format(Number(n));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// '2026-04-01' -> '2026q2'
export function quarterKey(iso) {
  const month = Number(String(iso).slice(5, 7));
  return `${String(iso).slice(0, 4)}q${Math.floor((month - 1) / 3) + 1}`;
}

// '2026-04-01' -> 'April–June 2026'
export function quarterLabel(iso) {
  const month = Number(String(iso).slice(5, 7));
  return `${MONTHS[month - 1]}–${MONTHS[month + 1]} ${String(iso).slice(0, 4)}`;
}

// Any reporting period by its first and last day: a House quarter
// ('2026-04-01', '2026-06-30' -> 'April–June 2026') or a Senate half year,
// which can span two years ('2025-10-01', '2026-03-31' -> 'October
// 2025–March 2026'). `short` uses three-letter months.
const MON = MONTHS.map((m) => m.slice(0, 3));
export function periodLabel(start, end, { short = false } = {}) {
  const names = short ? MON : MONTHS;
  const [sy, sm] = [String(start).slice(0, 4), Number(String(start).slice(5, 7))];
  const [ey, em] = [String(end).slice(0, 4), Number(String(end).slice(5, 7))];
  return sy === ey
    ? `${names[sm - 1]}–${names[em - 1]} ${ey}`
    : `${names[sm - 1]} ${sy}–${names[em - 1]} ${ey}`;
}

// Months a period spans, start to end inclusive: 3 for a House quarter, 6
// for a Senate half year.
export function periodMonths(start, end) {
  const months = (iso) => Number(String(iso).slice(0, 4)) * 12 + Number(String(iso).slice(5, 7));
  return months(end) - months(start) + 1;
}
