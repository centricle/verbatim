// Fixtures are hand-built in the shape of real rows from Q1 2016 (12 columns)
// and Q2 2026 (18 columns), with every person's name from the fake cast.
// What each one exercises is listed beside its assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, classify, parseQuarter, isoDate, toCents, centsText } from './parse.mjs';

const read = (f) => decode(readFileSync(new URL(`fixtures/${f}`, import.meta.url)));
const SOURCE = { unit: 'house-2026q2', url: 'https://house.example/q.csv', start: '2026-04-01', end: '2026-06-30', file: 'q.csv' };

test('decode falls back to Windows-1252 and says so', () => {
  const { text, encoding } = read('house-12col.csv');
  assert.equal(encoding, 'windows-1252');
  assert.ok(text.includes('ACME CAFÉ'));
  assert.equal(read('house-18col.csv').encoding, 'utf-8');
});

test('isoDate reads D-Mon-YY and nothing else', () => {
  assert.equal(isoDate('18-Mar-16'), '2016-03-18');
  assert.equal(isoDate('1-Jan-26'), '2026-01-01');
  assert.equal(isoDate('29-Feb-16'), '2016-02-29');
  assert.equal(isoDate('   '), null);
  assert.equal(isoDate('14-MAR-0026'), undefined);
  assert.equal(isoDate('30-Feb-26'), undefined);
  assert.equal(isoDate('2026-03-14'), undefined);
});

test('toCents is exact and refuses what is not an amount', () => {
  assert.equal(toCents('11516.7'), 1151670);
  assert.equal(toCents('-8484'), -848400);
  assert.equal(toCents('.5'), 50);
  assert.equal(toCents('0'), 0);
  assert.equal(centsText(-848400), '-8484.00');
  assert.equal(centsText(5), '0.05');
  for (const bad of ['', '   ', '$12.00', '1,000', '1.234', '-']) assert.throws(() => toCents(bad));
});

test('subtotals: position decides only where the description fits both', () => {
  // Program "SUPPLIES AND MATERIALS" holds category "SUPPLIES AND MATERIALS":
  // rows 3 and 4 carry the same description. Rows 6 and 7 are a split TRAVEL
  // block, two category subtotals in a row. Row 14 is a program total right
  // after a detail row, told by its description.
  const kinds = classify(read('house-18col.csv').text).map((c) => c.kind);
  assert.deepEqual(kinds.slice(0, 7), ['detail', 'detail', 'category', 'program', 'detail', 'category', 'category']);
  assert.equal(kinds[13], 'program');
  assert.equal(kinds.filter((k) => k === 'office').length, 3);
});

test('a subtotal naming neither its category nor its program stops the run', () => {
  const { text } = read('house-12col.csv');
  assert.throws(() => classify(text.replace('TRAVEL TOTALS:', 'TRAVLE TOTALS:')), /names neither/);
  assert.throws(() => classify(text.replace(',DETAIL,', ',DETIAL,')), /unknown SORT SEQUENCE/);
});

test('a file with some but not all of the Q4 2022 columns stops the run', () => {
  const { text } = read('house-18col.csv');
  assert.throws(() => classify(text.replace('VENDOR ID,', 'VENDOR_ID,')), /some of the Q4 2022 columns/);
});

test('pay and gratuities load as the source\'s subtotal rows; everything else as filed', () => {
  const { rows } = parseQuarter(read('house-12col.csv').text, SOURCE);
  assert.deepEqual(rows.map((r) => r.row_number), [1, 2, 4, 8, 12]);
  assert.ok(!rows.some((r) => ['RUNNER ROAD', 'BUNNY BUGS', 'DUCK DAFFY'].includes(r.payee)));
  const pay = rows.find((r) => r.row_number === 8);
  assert.equal(pay.row_kind, 'subtotal');
  assert.equal(pay.category, 'PERSONNEL COMPENSATION');
  assert.equal(pay.description, 'PERSONNEL COMPENSATION TOTALS:');
  assert.equal(pay.amount, '42500.01');
  assert.equal(pay.payee, null);
  // A staffer's own reimbursement stays: reimbursements are kept as filed (ksmith, 2026-11-19).
  assert.equal(rows.find((r) => r.row_number === 2).payee, 'COYOTE WILE E.');
});

test('12-column row: fields, blanks, derived office and year', () => {
  const r = parseQuarter(read('house-12col.csv').text, SOURCE).rows[0];
  assert.deepEqual(r, {
    chamber: 'house', unit: 'house-2026q2', row_number: 1, period_start: '2026-04-01', period_end: '2026-06-30',
    organization: '2016 HON. WILE E. COYOTE', office: 'HON. WILE E. COYOTE', org_year: 2016, funding_year: null,
    program: 'OFFICIAL EXPENSES OF MEMBERS', category: 'TRAVEL', row_kind: 'detail',
    transaction_date: '2016-03-18', start_date: '2016-03-01', end_date: '2016-03-03',
    document: 'X1000001', payee: 'ACME CORPORATION, INC.', description: 'AIRFARE', amount: '412.30',
    extras: '{"data_source":"AP"}', source_ref: 'https://house.example/q.csv#row=1',
  });
  const g = parseQuarter(read('house-12col.csv').text, SOURCE).rows.at(-1);
  assert.equal(g.office, 'MISC - GRATUITIES');
  assert.equal(g.org_year, 2016);
});

test('18-column row: added columns go to extras; an odd date is kept as filed', () => {
  const rows = parseQuarter(read('house-18col.csv').text, SOURCE).rows;
  assert.deepEqual(rows.map((r) => r.row_number), [1, 2, 5, 10, 13, 17]);
  const r = rows[0];
  assert.equal(r.funding_year, 'LY2026');
  assert.equal(r.start_date, null);
  assert.equal(r.end_date, '2026-03-19');
  assert.deepEqual(JSON.parse(r.extras), {
    org_code: 'CT05WOL', program_code: 'SUPPL', object_class: '26', vendor_id: '33707', object_code: '2604',
    data_source: 'AP', dates_as_filed: { start_date: '14-MAR-0026' },
  });
  // Exact duplicates both load: no natural key, row_number tells them apart.
  assert.deepEqual(rows[1], { ...r, row_number: 2, source_ref: 'https://house.example/q.csv#row=2' });
  assert.equal(rows.find((x) => x.row_number === 13).amount, '-8484.00');
  assert.equal(JSON.parse(rows.find((x) => x.row_number === 10).extras).org_code, 'CT05WOL');
});
