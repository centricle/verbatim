// Where the House publishes its Statement of Disbursements detail CSVs.
//
// The URLs follow no pattern (at least six directory and file name schemes
// since 2016), so the loader reads the two pages that list them and takes
// every link whose text is "SOD Detail Transactions". The quarter comes from
// the file name's opening month and year; on the archive page each link also
// sits under its volume's title ("Statement of Disbursements of the House,
// July 1, 2021 to September 30, 2021"), and the two must agree.
import { parse as parseHtml } from 'node-html-parser';

export const HOUSE_PAGES = [
  'https://www.house.gov/the-house-explained/open-government/statement-of-disbursements',
  'https://www.house.gov/the-house-explained/open-government/statement-of-disbursements/archive',
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const QUARTER_START = { JAN: 1, APR: 2, JUL: 3, OCT: 4 };

// 2021, 3 -> { quarter: '2021q3', start: '2021-07-01', end: '2021-09-30' }
export function quarterSpan(year, q) {
  const m0 = (q - 1) * 3 + 1;
  const last = new Date(Date.UTC(year, m0 + 2, 0)).getUTCDate();
  const mm = (m) => String(m).padStart(2, '0');
  return { quarter: `${year}q${q}`, start: `${year}-${mm(m0)}-01`, end: `${year}-${mm(m0 + 2)}-${last}` };
}

// '.../JULY-SEPT-2022-SOD-DETAIL-GRID-FINAL.csv' -> quarterSpan(2022, 3).
// Anything that does not open with a quarter's first month and carry one
// four-digit year stops the run rather than guessing.
export function quarterFromUrl(url) {
  const file = decodeURIComponent(new URL(url).pathname.split('/').pop()).toUpperCase();
  const m = /^(JAN|APR|JUL|OCT)[A-Z]*[-_ ]/.exec(file);
  const years = file.match(/20\d\d/g) ?? [];
  if (!m || years.length !== 1) throw new Error(`Cannot read a quarter from ${url}`);
  return quarterSpan(Number(years[0]), QUARTER_START[m[1]]);
}

// 'July 1, 2021 to September 30, 2021' -> { start: '2021-07-01', end: '2021-09-30' }
function statedPeriod(text) {
  const m = /([A-Z][a-z]+) (\d{1,2}), (\d{4}) to ([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(text ?? '');
  if (!m) return null;
  const iso = (mon, d, y) => {
    const i = MONTHS.indexOf(mon.slice(0, 3).toUpperCase());
    if (i < 0) return null;
    return `${y}-${String(i + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  return { start: iso(m[1], m[2], m[3]), end: iso(m[4], m[5], m[6]) };
}

// Page HTML -> [{ url, quarter, start, end }], one per detail CSV link.
export function detailLinks(html, pageUrl) {
  const root = parseHtml(html);
  const out = [];
  for (const a of root.querySelectorAll('a')) {
    if (!/^\s*SOD Detail Transactions\s*$/i.test(a.text)) continue;
    const url = new URL(a.getAttribute('href'), pageUrl).href;
    const span = quarterFromUrl(url);
    const volume = a.closest('li')?.parentNode?.closest('li');
    const stated = statedPeriod(volume?.querySelector('strong')?.text);
    if (stated && (stated.start !== span.start || stated.end !== span.end)) {
      throw new Error(`${url}: file name says ${span.start} to ${span.end}, page says ${stated.start} to ${stated.end}`);
    }
    out.push({ url, ...span });
  }
  return out;
}

// Every page's links, one per quarter. A quarter listed twice with two
// different files is a re-issue the loader has not seen before: stop.
export function mergeLinks(lists) {
  const byQuarter = new Map();
  for (const link of lists.flat()) {
    const prev = byQuarter.get(link.quarter);
    if (prev && prev.url !== link.url) throw new Error(`${link.quarter} is listed as both ${prev.url} and ${link.url}`);
    byQuarter.set(link.quarter, link);
  }
  return [...byQuarter.values()].sort((a, b) => a.quarter.localeCompare(b.quarter));
}
