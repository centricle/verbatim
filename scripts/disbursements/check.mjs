// The comparison behind `cli.mjs check`, kept pure so planted defects can be
// tested without a database (check.test.mjs).
//
// Three views of each quarter have to agree:
//
// 1. Raw: a line scan of the downloaded file that does not use the CSV
//    parser. The CAO's files hold no line breaks inside fields, so each line
//    after the header is one record; its kind is the first
//    `,DETAIL,` / `,SUBTOTAL,` / `,GRAND TOTAL FOR ORGANIZATION,` field
//    (SORT SEQUENCE precedes every free-text column, so a payee or
//    description cannot shadow it) and its amount is the last field. A line
//    the scan cannot read, such as half of a field that spans a line break,
//    is counted and fails the check.
// 2. Parsed: parse.mjs over the same file.
// 3. Loaded: every row of the table for that unit, every column.
//
// The invariants, per quarter:
// - raw and parsed agree on the count and the sum of each kind of row, and
//   on the detail rows of the COLLAPSED categories;
// - detail rows sum to their category subtotals for every (organization,
//   funding year, program, category), to their program totals for every
//   (organization, funding year, program), and to OFFICE TOTALS for every
//   organization;
// - the loaded rows are exactly the parsed rows to keep, column for column,
//   no COLLAPSED detail row is loaded, and the loaded rows of each
//   organization still sum to its OFFICE TOTALS.
import { COLLAPSED } from './parse.mjs';

export const COLUMNS = [
  'chamber', 'unit', 'row_number', 'period_start', 'period_end', 'organization', 'office',
  'org_year', 'funding_year', 'program', 'category', 'row_kind', 'transaction_date', 'start_date',
  'end_date', 'document', 'payee', 'description', 'amount', 'extras', 'source_ref',
];

const KIND = /,(DETAIL|SUBTOTAL|GRAND TOTAL FOR ORGANIZATION),/;
const AMOUNT = /,\s*(-?\d*\.?\d+)\s*(?:,\s*)*$/;
const COLLAPSED_FIELD = new RegExp(`,(${[...COLLAPSED].join('|')}),`);

const cents = (s) => {
  const [i, f = ''] = s.replace('-', '').split('.');
  const c = Number(i || 0) * 100 + Number(f.padEnd(2, '0'));
  return s.startsWith('-') ? -c : c;
};

export function rawScan(text) {
  const tally = () => ({ n: 0, cents: 0 });
  const out = { detail: tally(), subtotal: tally(), office: tally(), collapsedDetail: tally(), unread: 0 };
  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const k = KIND.exec(line);
    const a = AMOUNT.exec(line);
    if (!k || !a) { out.unread++; continue; }
    const c = cents(a[1]);
    const bucket = k[1] === 'DETAIL' ? out.detail : k[1] === 'SUBTOTAL' ? out.subtotal : out.office;
    bucket.n++; bucket.cents += c;
    if (k[1] === 'DETAIL' && COLLAPSED_FIELD.test(line.slice(0, k.index + 1))) {
      out.collapsedDetail.n++; out.collapsedDetail.cents += c;
    }
  }
  return out;
}

// Parsed tallies in the same shape as rawScan.
export function parsedTally(classified) {
  const tally = () => ({ n: 0, cents: 0 });
  const out = { detail: tally(), subtotal: tally(), office: tally(), collapsedDetail: tally(), unread: 0 };
  for (const c of classified) {
    const b = c.kind === 'detail' ? out.detail : c.kind === 'office' ? out.office : out.subtotal;
    b.n++; b.cents += c.cents;
    if (c.kind === 'detail' && COLLAPSED.has(c.category)) { out.collapsedDetail.n++; out.collapsedDetail.cents += c.cents; }
  }
  return out;
}

const fy = (c) => (c.rec['FISCAL YEAR OR LEGISLATIVE YEAR'] ?? '').trim();
const org = (c) => (c.rec.ORGANIZATION ?? '').trim();

// Detail sums against the file's own subtotals and totals.
export function reconcile(classified) {
  const failures = [];
  const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
  const level = {
    category: { key: (c) => [org(c), fy(c), c.program, c.category].join(' | '), det: new Map(), sub: new Map() },
    program: { key: (c) => [org(c), fy(c), c.program].join(' | '), det: new Map(), sub: new Map() },
    office: { key: (c) => org(c), det: new Map(), sub: new Map() },
  };
  for (const c of classified) {
    for (const [name, l] of Object.entries(level)) {
      if (c.kind === 'detail') add(l.det, l.key(c), c.cents);
      else if (c.kind === name) add(l.sub, l.key(c), c.cents);
    }
  }
  for (const [name, l] of Object.entries(level)) {
    for (const [k, v] of l.det) {
      if (!l.sub.has(k)) failures.push(`${name} "${k}": detail rows with no subtotal`);
      else if (l.sub.get(k) !== v) failures.push(`${name} "${k}": detail sums to ${v} cents, subtotal says ${l.sub.get(k)}`);
    }
    for (const k of l.sub.keys()) if (!l.det.has(k)) failures.push(`${name} "${k}": subtotal with no detail rows`);
  }
  return failures;
}

// Postgres returns dates as Date (local midnight), numeric as text, jsonb as
// an object, integers as numbers. Compare on one footing.
export function norm(col, v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (col === 'amount') return cents(String(v));
  if (col === 'extras') {
    // jsonb keeps keys in its own order, nested objects too (the Senate's
    // dates_as_filed comes back end_date first), so keys are sorted all the
    // way down.
    const sorted = (x) => (x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, sorted(y)]))
      : x);
    return JSON.stringify(sorted(typeof v === 'string' ? JSON.parse(v) : v));
  }
  return v;
}

/**
 * @param {object} q one quarter
 * @param {string} q.unit
 * @param {ReturnType<rawScan>} q.raw
 * @param {object[]} q.classified  parse.classify output
 * @param {object[]} q.expected    parse.parseQuarter(...).rows
 * @param {object[]|null} q.loaded rows of the table for this unit, or null to skip
 * @returns {string[]} failures; empty means the quarter passed
 */
export function compare({ unit, raw, classified, expected, loaded }) {
  const failures = [];
  const fail = (m) => failures.push(`${unit}: ${m}`);

  if (raw.unread) fail(`raw scan could not read ${raw.unread} lines`);
  const parsed = parsedTally(classified);
  for (const k of ['detail', 'subtotal', 'office', 'collapsedDetail']) {
    if (raw[k].n !== parsed[k].n) fail(`${k} rows: raw ${raw[k].n}, parsed ${parsed[k].n}`);
    if (raw[k].cents !== parsed[k].cents) fail(`${k} sum: raw ${raw[k].cents} cents, parsed ${parsed[k].cents}`);
  }
  for (const f of reconcile(classified)) fail(f);

  if (loaded == null) return failures;

  const key = (r) => r.row_number;
  const want = new Map(expected.map((r) => [key(r), r]));
  if (want.size !== expected.length) fail('two expected rows share a row_number');
  if (loaded.length !== expected.length) fail(`loaded ${loaded.length} rows, expected ${expected.length}`);
  const seen = new Set();
  let mismatched = 0;
  for (const row of loaded) {
    const k = key(row);
    if (seen.has(k)) { fail(`row ${k} loaded twice`); continue; }
    seen.add(k);
    if (row.row_kind === 'detail' && COLLAPSED.has(row.category)) fail(`row ${k}: ${row.category} detail row loaded`);
    const exp = want.get(k);
    if (!exp) { fail(`row ${k} loaded but not expected`); continue; }
    for (const col of COLUMNS) {
      if (norm(col, row[col]) !== norm(col, exp[col])) {
        if (++mismatched <= 20) fail(`row ${k} ${col}: loaded ${JSON.stringify(row[col])}, expected ${JSON.stringify(exp[col])}`);
      }
    }
  }
  if (mismatched > 20) fail(`${mismatched - 20} more field mismatches not shown`);
  for (const k of want.keys()) if (!seen.has(k)) fail(`row ${k} expected but not loaded`);

  // Loaded rows per organization against the file's OFFICE TOTALS.
  const office = new Map();
  for (const c of classified) if (c.kind === 'office') office.set(org(c), (office.get(org(c)) ?? 0) + c.cents);
  const got = new Map();
  for (const r of loaded) got.set(r.organization, (got.get(r.organization) ?? 0) + norm('amount', r.amount));
  for (const [o, v] of office) {
    if ((got.get(o) ?? 0) !== v) fail(`loaded rows of "${o}" sum to ${got.get(o) ?? 0} cents, OFFICE TOTALS says ${v}`);
  }
  for (const o of got.keys()) if (!office.has(o)) fail(`loaded organization "${o}" has no OFFICE TOTALS`);
  return failures;
}
