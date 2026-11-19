// Formats shared by the /disbursements/ table and figures.
//
// Amounts: the exact form, to the cent as filed, goes in every table cell and
// tooltip; the short form ("$8.96B") only labels bars and axes.
//
// Quarters: the URL and API take `2026q2`, which the function turns into the
// quarter's first day (netlify/functions/disbursements.js). Labels name the
// months, as the House titles each quarter's files ("APRIL-JUNE 2026").

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
