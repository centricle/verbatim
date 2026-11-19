// Parse one quarter of the House Statement of Disbursements detail CSV.
//
// Pure functions only: bytes or text in, rows out. Fetching, loading and
// checking live in cli.mjs and check.mjs, so these run against the fixtures
// without a network or a database.
//
// The CSV interleaves three kinds of row, named in SORT SEQUENCE:
//
// - DETAIL: one transaction, or one person's pay for the period.
// - SUBTOTAL: either a category subtotal ("TRAVEL TOTALS:") for one
//   organization, funding year, program and category, or a program total
//   ("GENERAL EXPENDITURES TOTALS:") after a program's last category. The
//   column values on a program total repeat the last category, so only
//   DESCRIPTION tells them apart, and one program is named like a category
//   (SUPPLIES AND MATERIALS). Where the description fits both, position
//   decides: a subtotal right after detail rows closes a category, one right
//   after another subtotal closes the program. A block can be split, with
//   its subtotals filed together later; the sums still hold in aggregate,
//   and check.mjs proves they do for every key.
// - GRAND TOTAL FOR ORGANIZATION ("OFFICE TOTALS:"), one or more per
//   organization.
//
// What reaches the table, and nothing else:
//
// - Every DETAIL row, as filed, except in the categories in COLLAPSED.
// - For COLLAPSED categories, the source's own category subtotal rows instead
//   of the per-person lines (ksmith, 2026-11-18 and 2026-11-19): the site
//   is never a name-to-salary lookup, and a gratuity names a bereaved
//   beneficiary. The office totals still reconcile, because each subtotal is
//   the sum of the lines it replaces.
// - Blank fields (the CAO pads them with three spaces) become null.
// - Dates in the CAO's D-Mon-YY or D-MON-YYYY forms become ISO dates. Any
//   other form (two rows in Q2 2026 read 14-MAR-0026) loads as null in the
//   date column with the filed text kept under `dates_as_filed` in extras.
// - A row with an unquoted comma inside one free-text field (Q3 2020:
//   `CITI PCARD-CNDTL CR,AMZN MKTP US M79`) has one field too many, and every
//   field after the comma would shift one column right; in the 19-column
//   files that puts BUDGET OBJECT CODE, a number, into AMOUNT. The parser
//   rejoins the split field only when exactly one of VENDOR NAME or
//   DESCRIPTION, rejoined, leaves every date, id and amount readable, and
//   records which under `unquoted_comma` in extras. No fit, or two, stops
//   the run. Bare quotes inside a field (Q1 2019 files an organization as
//   2019 HON. EARL L. "BUDDY" CARTER) are read as text.
// - Two fields derived from ORGANIZATION, which files name with their
//   funding year ("2025 OFFICE OF THE SPEAKER", "FISCAL YEAR 2026
//   SERGEANT AT ARMS"): `office`, the name without that prefix, and
//   `org_year`, the prefix's year. The filed name is kept as `organization`.
import { parse } from 'csv-parse/sync';

export const COLLAPSED = new Set(['PERSONNEL COMPENSATION', 'BENEFITS TO FORMER PERSONNEL']);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Every column a file can have. The first twelve are in every file since
// Q1 2016; the six marked `added` arrived together in Q4 2022.
const REQUIRED = [
  'ORGANIZATION', 'PROGRAM', 'SORT SUBTOTAL DESCRIPTION', 'SORT SEQUENCE', 'TRANSACTION DATE',
  'DATA SOURCE', 'DOCUMENT', 'VENDOR NAME', 'PERFORM START DT', 'PERFORM END DT', 'DESCRIPTION', 'AMOUNT',
];
const ADDED = {
  'FISCAL YEAR OR LEGISLATIVE YEAR': 'funding_year',
  'ORGANIZATION CODE': 'org_code',
  'PROGRAM CODE': 'program_code',
  'BUDGET OBJECT CLASS': 'object_class',
  'VENDOR ID': 'vendor_id',
  'BUDGET OBJECT CODE': 'object_code',
};

// Q1 2016 carries one Windows-1252 byte (an E with an acute accent in a
// merchant name). Strict UTF-8 first; on failure the whole file is read as
// Windows-1252, and the caller records which.
export function decode(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'windows-1252' };
  }
}

const clean = (v) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

// '18-Mar-16' or '31-JAN-2019' -> ISO. Null for blank; undefined for a form
// the CAO does not normally use, which the caller keeps as filed.
export function isoDate(text) {
  const t = clean(text);
  if (t == null) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|20\d{2})$/.exec(t);
  const mi = m ? MONTHS.indexOf(m[2].toUpperCase()) : -1;
  if (mi < 0) return undefined;
  const d = Number(m[1]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const last = new Date(Date.UTC(y, mi + 1, 0)).getUTCDate();
  if (d < 1 || d > last) return undefined;
  return `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// '-8484' -> -848400, '11516.7' -> 1151670. Integer cents, so sums are exact.
export function toCents(text) {
  const t = clean(text);
  const m = t == null ? null : /^(-?)(\d*)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m || (m[2] === '' && m[3] == null)) throw new Error(`Bad AMOUNT "${text}"`);
  const cents = Number(m[2] || 0) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}

export const centsText = (c) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;

const PREFIX = /^(?:FISCAL YEAR )?(\d{4}) (.+)$/;

// Does a subtotal's description close this category or program? Compared
// without case and with runs of spaces collapsed: Q1 2018 files a program as
// "Enterprise Licenses" and its total as "ENTERPRISE LICENSES TOTALS:".
const fold = (s) => (s ?? '').toUpperCase().replace(/\s+/g, ' ');
const totalOf = (desc, name) => name != null && fold(desc) === `${fold(name)} TOTALS:`;

const DATE_COLS = ['TRANSACTION DATE', 'PERFORM START DT', 'PERFORM END DT'];
const readable = (rec) => {
  const blankOr = (v, re) => clean(v) == null || re.test(clean(v));
  return DATE_COLS.every((c) => blankOr(rec[c], /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/))
    && /^-?\d*\.?\d+$/.test(clean(rec.AMOUNT) ?? '')
    && (!('VENDOR ID' in rec) || blankOr(rec['VENDOR ID'], /^\d+$/))
    && (!('BUDGET OBJECT CODE' in rec) || blankOr(rec['BUDGET OBJECT CODE'], /^\d+$/))
    && (!('BUDGET OBJECT CLASS' in rec) || blankOr(rec['BUDGET OBJECT CLASS'], /^\d+$/));
};
const REJOIN = { 'VENDOR NAME': 'payee', DESCRIPTION: 'description' };

// One CSV row's fields -> { column: value }, rejoining a field an unquoted
// comma split (see the header comment). `unquoted_comma` names the field.
export function toRecord(fields, names, where) {
  const f = [...fields];
  while (f.length > names.length && f.at(-1) === '') f.pop();
  const zip = (arr) => Object.fromEntries(names.map((n, i) => [n, arr[i]]));
  if (f.length === names.length) return zip(f);
  if (f.length < names.length) throw new Error(`${where}: ${f.length} fields, header has ${names.length}`);
  const extra = f.length - names.length;
  const fits = [];
  for (const col of Object.keys(REJOIN)) {
    const i = names.indexOf(col);
    const joined = [...f.slice(0, i), f.slice(i, i + extra + 1).join(','), ...f.slice(i + extra + 1)];
    const rec = zip(joined);
    if (readable(rec)) fits.push({ ...rec, unquoted_comma: REJOIN[col] });
  }
  if (fits.length !== 1) throw new Error(`${where}: ${extra} field(s) too many, and ${fits.length} ways to rejoin them`);
  return fits[0];
}

// Classify every record in one file. `row` is the record's 1-based position
// after the header, which is what source_ref points at.
export function classify(text, file = 'input') {
  const arrays = parse(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
  if (arrays.length < 2) throw new Error(`${file} has no rows`);
  // Some files end the header and every row with a comma: an empty column.
  const names = arrays[0].map((c) => c.trim());
  while (names.length && names.at(-1) === '') names.pop();
  const missing = REQUIRED.filter((k) => !names.includes(k));
  if (missing.length) throw new Error(`${file} lacks columns: ${missing.join(', ')}`);
  const added = Object.keys(ADDED).filter((k) => names.includes(k));
  if (added.length && added.length !== Object.keys(ADDED).length) {
    throw new Error(`${file} has some of the Q4 2022 columns but not all: ${added.join(', ')}`);
  }
  const records = arrays.slice(1).map((fields, i) => toRecord(fields, names, `${file} row ${i + 1}`));

  let prev = null;
  return records.map((rec, i) => {
    const seq = clean(rec['SORT SEQUENCE']);
    const category = clean(rec['SORT SUBTOTAL DESCRIPTION']);
    const program = clean(rec.PROGRAM);
    const desc = clean(rec.DESCRIPTION);
    let kind;
    if (seq === 'DETAIL') kind = 'detail';
    else if (seq === 'SUBTOTAL') {
      const isCat = totalOf(desc, category);
      const isProg = totalOf(desc, program);
      if (isCat && isProg) kind = prev === 'detail' ? 'category' : 'program';
      else if (isCat) kind = 'category';
      else if (isProg) kind = 'program';
      else throw new Error(`${file} row ${i + 1}: SUBTOTAL "${desc}" names neither "${category}" nor "${program}"`);
    } else if (seq === 'GRAND TOTAL FOR ORGANIZATION' && desc === 'OFFICE TOTALS:') kind = 'office';
    else throw new Error(`${file} row ${i + 1}: unknown SORT SEQUENCE "${seq}" / "${desc}"`);
    prev = kind;
    return { row: i + 1, kind, rec, category, program, desc, cents: toCents(rec.AMOUNT) };
  });
}

// One classified record -> one table row.
export function toRow(c, source) {
  const r = c.rec;
  const organization = clean(r.ORGANIZATION);
  const m = PREFIX.exec(organization ?? '');
  const extras = {};
  for (const [col, key] of Object.entries(ADDED)) {
    if (key !== 'funding_year' && col in r) extras[key] = clean(r[col]);
  }
  extras.data_source = clean(r['DATA SOURCE']);
  if (r.unquoted_comma) extras.unquoted_comma = r.unquoted_comma;
  const dates = {};
  for (const [col, key] of [['TRANSACTION DATE', 'transaction_date'], ['PERFORM START DT', 'start_date'], ['PERFORM END DT', 'end_date']]) {
    const iso = isoDate(r[col]);
    if (iso === undefined) {
      (extras.dates_as_filed ??= {})[key] = clean(r[col]);
      dates[key] = null;
    } else dates[key] = iso;
  }
  for (const k of Object.keys(extras)) if (extras[k] == null) delete extras[k];
  return {
    chamber: 'house',
    unit: source.unit,
    row_number: c.row,
    period_start: source.start,
    period_end: source.end,
    organization,
    office: m ? m[2] : organization,
    org_year: m ? Number(m[1]) : null,
    funding_year: clean(r['FISCAL YEAR OR LEGISLATIVE YEAR']),
    program: c.program,
    category: c.category,
    row_kind: c.kind === 'detail' ? 'detail' : 'subtotal',
    ...dates,
    document: clean(r.DOCUMENT),
    payee: clean(r['VENDOR NAME']),
    description: c.desc,
    amount: centsText(c.cents),
    extras: JSON.stringify(extras),
    source_ref: `${source.url}#row=${c.row}`,
  };
}

// The rows a quarter loads: detail outside COLLAPSED, and COLLAPSED
// categories' own subtotal rows.
export const keep = (c) => (c.kind === 'detail' && !COLLAPSED.has(c.category))
  || (c.kind === 'category' && COLLAPSED.has(c.category));

// source: { unit: 'house-2026q2', url, start, end, file }
export function parseQuarter(text, source) {
  const classified = classify(text, source.file);
  return { classified, rows: classified.filter(keep).map((c) => toRow(c, source)) };
}
