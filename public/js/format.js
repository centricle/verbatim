// Formatting shared by the corpus pages (/corpus/, /amendments/).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// As exact as the record's date: "March 1, 1722", "December 1787" or "1758".
export function formatDate(iso, precision) {
  if (!iso) return 'Undated';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (precision === 'year') return String(y);
  if (precision === 'month') return `${MONTHS[m - 1]} ${y}`;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
