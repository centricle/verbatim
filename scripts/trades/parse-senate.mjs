// eFD PTR pages (efdsearch.senate.gov/search/view/ptr/<uuid>/) to the
// report's title, its filed date and its transaction rows. Pure: takes the
// page's HTML, returns data, throws on anything it does not recognize.
//
// Every value is the printed text, reduced by senate.mjs's `cell` (tags and
// <br> to a space, entities decoded, "--" or empty to NULL), so an eFD page
// and Senate Stock Watcher's copy of the same filing reduce to the same
// strings. Nothing is mapped or held to a vocabulary here: the type and date
// rules are senate.mjs's, applied to both sources alike.
//
// Layout facts it relies on, from the 2026-11-18 spike (ten pages, 2014 to
// 2026):
// - The h1 is the report title, "Periodic Transaction Report for MM/DD/YYYY",
//   with " (Amendment N)" on an amendment.
// - A p.muted holds "Filed MM/DD/YYYY @ h:mm AM", or "@ 12 PM" on the hour
//   (36377144, 2016).
// - "(N transactions total)" heads the table, and the rows number N.
// - One table, whose header row is the nine columns in COLUMNS. A header not
//   there throws: a new column is a format change to read, not to guess at.
// - `#` is row_num, and the rows carry each of 1 to N once. Most pages print
//   them N down to 1, so row 1 is the bottom row, but not every page:
//   b9b478b7 (2017) prints #5 first, e30d1fb6 (2018) prints it between #13
//   and #12. Rows come back in page order, which is also Senate Stock
//   Watcher's order on both of those.
// - Five pages from January to July 2015 (Carper 6bd46141, Collins d221805d
//   and its three amendments) repeat the top row's number on the bottom row,
//   "7,6,5,4,3,2,7", so no row is #1. When every `#` is a whole number from
//   1 to N but not each appears once, the page is `renumbered`: each row's
//   row_num is its position counted up from the bottom, the order eFD prints
//   in. On those five that is the printed `#` on every row but the bottom
//   one, which becomes 1 (ksmith, 2026-11-18). Anything else in the column
//   throws.
// - h2.filedReport prints the filer's status today ("(Former Senator)" on a
//   2019 report), not at filing, so it is not read.
import { parse } from 'node-html-parser';
import { htmlText, cell } from './senate.mjs';

export const COLUMNS = {
  '#': 'row_num',
  'Transaction Date': 'transaction_date',
  Owner: 'owner',
  Ticker: 'ticker',
  'Asset Name': 'asset_description',
  'Asset Type': 'asset_type',
  Type: 'type',
  Amount: 'amount',
  Comment: 'comment',
};

const text = (el) => htmlText(el.innerHTML);

export function parsePtr(html) {
  const root = parse(html);

  const h1 = root.querySelectorAll('h1');
  if (h1.length !== 1) throw new Error(`${h1.length} h1 elements`);
  const title = text(h1[0]);
  if (!/^Periodic Transaction Report\b/.test(title)) throw new Error(`title "${title}"`);

  const filedLines = root.querySelectorAll('p.muted').map(text).filter((t) => t.startsWith('Filed '));
  if (filedLines.length !== 1) throw new Error(`${filedLines.length} "Filed" lines`);
  const filed = /^Filed (\d\d\/\d\d\/\d{4}) @ \d{1,2}(?::\d\d)? [AP]M$/.exec(filedLines[0])?.[1];
  if (!filed) throw new Error(`filed line "${filedLines[0]}"`);

  const totals = root.querySelectorAll('li').map((li) => /^\((\d+) transactions? total\)$/.exec(text(li))).filter(Boolean);
  if (totals.length !== 1) throw new Error(`${totals.length} "transactions total" lines`);
  const total = Number(totals[0][1]);

  const tables = root.querySelectorAll('table');
  if (tables.length > 1) throw new Error(`${tables.length} tables`);
  if (!tables.length) {
    if (total) throw new Error(`no table for ${total} transactions`);
    return { title, filed, total, renumbered: false, rows: [] };
  }

  const headers = tables[0].querySelectorAll('thead th').map(text);
  const fields = headers.map((h) => {
    if (!(h in COLUMNS)) throw new Error(`unknown column "${h}"`);
    return COLUMNS[h];
  });
  const missing = Object.keys(COLUMNS).filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`missing columns ${missing.join(', ')}`);

  const rows = tables[0].querySelectorAll('tbody tr').map((tr, i) => {
    const tds = tr.querySelectorAll('td');
    if (tds.length !== fields.length) throw new Error(`row ${i + 1} of the page: ${tds.length} cells for ${fields.length} columns`);
    return Object.fromEntries(fields.map((f, j) => [f, cell(tds[j].innerHTML)]));
  });

  if (rows.length !== total) throw new Error(`${rows.length} rows, ${total} transactions total`);
  const printed = rows.map((r) => r.row_num).join(',');
  const nums = rows.map((r) => (/^[1-9]\d*$/.test(r.row_num ?? '') ? Number(r.row_num) : NaN));
  if (nums.some((n) => !(n <= rows.length))) throw new Error(`# column ${printed}: not each a whole number from 1 to ${rows.length}`);
  const sorted = [...nums].sort((a, b) => a - b);
  const renumbered = sorted.some((n, i) => n !== i + 1);
  rows.forEach((r, i) => { r.row_num = renumbered ? rows.length - i : nums[i]; });

  return { title, filed, total, renumbered, rows };
}
