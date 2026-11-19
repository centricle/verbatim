// The check must fail on every defect it exists to catch. Each test plants
// one in a copy of the fixture data and expects a named failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, parseQuarter } from './parse.mjs';
import { rawScan, compare } from './check.mjs';

const SOURCE = { unit: 'house-2026q2', url: 'https://house.example/q.csv', start: '2026-04-01', end: '2026-06-30', file: 'q.csv' };
const text18 = decode(readFileSync(new URL('fixtures/house-18col.csv', import.meta.url))).text;
const text12 = decode(readFileSync(new URL('fixtures/house-12col.csv', import.meta.url))).text;

function run(text, { loaded: edit = (rows) => rows, classified: editC = (c) => c } = {}) {
  const { classified, rows } = parseQuarter(text, SOURCE);
  const asLoaded = rows.map((r) => ({ ...r, extras: JSON.parse(r.extras) }));
  return compare({ unit: 'q', raw: rawScan(text), classified: editC(classified), expected: rows, loaded: edit(asLoaded) });
}
const fails = (failures, re) => assert.ok(failures.some((f) => re.test(f)), `expected a failure matching ${re}, got ${JSON.stringify(failures)}`);

test('clean fixtures pass', () => {
  assert.deepEqual(run(text12), []);
  assert.deepEqual(run(text18), []);
});

test('a dropped loaded row fails', () => {
  const f = run(text18, { loaded: (r) => r.slice(1) });
  fails(f, /loaded 5 rows, expected 6/);
  fails(f, /row 1 expected but not loaded/);
});

test('a duplicated loaded row fails', () => fails(run(text18, { loaded: (r) => [...r, r[0]] }), /row 1 loaded twice/));

test('a corrupted amount fails, field and office sum both', () => {
  const f = run(text18, { loaded: (r) => r.map((x, i) => (i === 4 ? { ...x, amount: '-8448.00' } : x)) });
  fails(f, /row 13 amount/);
  fails(f, /OFFICE TOTALS says/);
});

test('a changed text field fails', () => fails(run(text12, { loaded: (r) => r.map((x, i) => (i === 0 ? { ...x, payee: 'ACME CORPORATION INC.' } : x)) }), /row 1 payee/));

test('a changed extras value fails', () => fails(run(text18, { loaded: (r) => r.map((x, i) => (i === 0 ? { ...x, extras: { ...x.extras, vendor_id: '33708' } } : x)) }), /row 1 extras/));

test('a pay line that reaches the table fails', () => {
  const f = run(text12, {
    loaded: (r) => [...r, { ...r[0], row_number: 6, category: 'PERSONNEL COMPENSATION', payee: 'RUNNER ROAD', amount: '12500.00' }],
  });
  fails(f, /PERSONNEL COMPENSATION detail row loaded/);
});

test('a subtotal that disagrees with its detail rows fails', () => {
  const f = run(text12.replace('TRAVEL TOTALS:,393.55', 'TRAVEL TOTALS:,393.56'));
  fails(f, /category ".*TRAVEL": detail sums to 39355 cents, subtotal says 39356/);
});

test('a row the parser drops but the raw scan sees fails', () => {
  const f = run(text18, { classified: (c) => c.filter((x) => x.row !== 5) });
  fails(f, /detail rows: raw 7, parsed 6/);
});

test('a field spanning a line break, which the CSV parser accepts, fails the raw scan', () => {
  fails(run(text12.replace('"ACME CORPORATION, INC."', '"ACME CORPORATION,\r\n INC."')), /raw scan could not read 2 lines/);
});

test('a payee containing a row-kind token cannot shadow SORT SEQUENCE', () => {
  assert.deepEqual(run(text12.replace('"ACME CORPORATION, INC."', '"ACME,SUBTOTAL, INC."')), []);
});

test('an office total that disagrees fails', () => {
  fails(run(text18.replace('OFFICE TOTALS:,   ,10842.81', 'OFFICE TOTALS:,   ,10842.80')), /office "2026 HON. RALPH WOLF"/);
});
