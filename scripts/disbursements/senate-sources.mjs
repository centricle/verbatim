// Where the Senate publishes the Report of the Secretary of the Senate.
//
// One page lists every volume since April 2011, semiannual, each as a link
// titled with its period ("October 1, 2025 to March 31, 2026") to the
// GovInfo package, followed by "Full Report", "Part I" and "Part II" PDFs.
// The loader takes the Full Report only: the parts split the same pages, and
// both would count every line twice. The period comes from the link text,
// and must be one of the two halves the page describes ("October 1st to
// March 31st and April 1st to September 30th of each year").
import { parse as parseHtml } from 'node-html-parser';

export const SENATE_PAGE = 'https://www.senate.gov/legislative/common/generic/report_secsen.htm';

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const PERIOD = /^([A-Za-z]+) (\d{1,2}), (\d{4}) to ([A-Za-z]+) (\d{1,2}), (\d{4})$/;
const PACKAGE = /^https:\/\/www\.govinfo\.gov\/app\/details\/(GPO-CDOC-\d+sdoc\d+)\//;

const iso = (month, day, year) => {
  const m = MONTHS.indexOf(month.toUpperCase());
  if (m < 0) return null;
  return `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// '2025-10-01', '2026-03-31' -> 'senate-fy2026h1' (October to March is the
// first half of the fiscal year that ends the next September);
// '2025-04-01', '2025-09-30' -> 'senate-fy2025h2'. Anything else is null.
export function unitFor(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (sm === 10 && sd === 1 && em === 3 && ed === 31 && ey === sy + 1) return `senate-fy${ey}h1`;
  if (sm === 4 && sd === 1 && em === 9 && ed === 30 && ey === sy) return `senate-fy${ey}h2`;
  return null;
}

/**
 * Every volume the listing page links, oldest first.
 * @returns {{ id: string, label: string, start: string, end: string, unit: string, url: string }[]}
 */
export function senateVolumes(html) {
  const root = parseHtml(html);
  const hrefs = new Set(root.querySelectorAll('a').map((a) => a.getAttribute('href')));
  const out = [];
  for (const a of root.querySelectorAll('a')) {
    const m = PACKAGE.exec(a.getAttribute('href') ?? '');
    if (!m) continue;
    const label = a.text.replace(/\s+/g, ' ').trim();
    const p = PERIOD.exec(label);
    if (!p) throw new Error(`Volume ${m[1]} is titled "${label}", not a period`);
    const start = iso(p[1], p[2], p[3]);
    const end = iso(p[4], p[5], p[6]);
    const unit = start && end ? unitFor(start, end) : null;
    if (!unit) throw new Error(`Volume ${m[1]} covers "${label}", which is not a half of a fiscal year`);
    const url = `https://www.govinfo.gov/content/pkg/${m[1]}/pdf/${m[1]}.pdf`;
    if (!hrefs.has(url)) throw new Error(`Volume ${m[1]} has no Full Report link (${url})`);
    out.push({ id: m[1], label, start, end, unit, url });
  }
  const units = new Set(out.map((v) => v.unit));
  if (units.size !== out.length) throw new Error('Two volumes cover the same period');
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
