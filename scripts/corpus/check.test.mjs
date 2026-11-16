// A check that has never failed is not known to work. Each test plants one
// defect in an otherwise perfect load of the fixtures and expects check to
// name it. Fixtures: make-fixtures.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, parseRelease, siteRows } from './parse.mjs';
import { compare, rawScan } from './check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATE_COLUMNS = ['date', 'proposed', 'certified'];

async function setup() {
  const text = await readFile(resolve(HERE, 'fixtures/release.jsonl'), 'utf8');
  const expected = siteRows(parseRelease(text));
  // A perfect load, as Postgres returns it: dates as Date objects.
  const loaded = expected.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [
    k, DATE_COLUMNS.includes(k) && v ? new Date(`${v}T00:00:00Z`) : v,
  ])));
  return { text, raw: rawScan(text), expected, loaded };
}

test('a perfect load passes', async () => {
  assert.deepEqual(compare(await setup()), []);
});

test('raw scan finds the site records without the JSON parser', async () => {
  const { raw } = await setup();
  assert.equal(raw.length, 8);
});

test('parser keeps core and voices and drops executive', async () => {
  const { expected } = await setup();
  assert.deepEqual([...new Set(expected.map((r) => r.collection))].sort(), ['core', 'voices']);
  assert.equal(expected.length, 8);
});

test('every row carries every column, absent fields as null', async () => {
  const { expected } = await setup();
  for (const row of expected) assert.deepEqual(Object.keys(row), COLUMNS);
  const undated = expected.find((r) => r.date_precision === 'unknown');
  assert.equal(undated.date, null);
  assert.ok(expected.some((r) => r.attribution), 'a fixture has an attribution');
  assert.ok(expected.some((r) => r.attribution === null));
});

test('a malformed line names its line number', () => {
  assert.throws(() => parseRelease('{"id": "a"}\n{"id": \n'), /line 2/);
});

test('a dropped row fails', async () => {
  const input = await setup();
  input.loaded = input.loaded.slice(1);
  const failures = compare(input);
  assert.ok(failures.some((f) => /^loaded 7 rows; the release has 8/.test(f)), failures.join('\n'));
  assert.ok(failures.some((f) => /^not loaded \(1\)/.test(f)), failures.join('\n'));
});

test('a corrupted text fails and names the column', async () => {
  const input = await setup();
  input.loaded[2] = { ...input.loaded[2], text: `${input.loaded[2].text} ` };
  assert.ok(compare(input).some((f) => /^text differs in 1 rows/.test(f)));
});

test('a shifted date fails', async () => {
  const input = await setup();
  input.loaded[0] = { ...input.loaded[0], date: new Date('1789-04-29T00:00:00Z') };
  assert.ok(compare(input).some((f) => /^date differs in 1 rows/.test(f)));
});

test('a lost attribution fails', async () => {
  const input = await setup();
  const i = input.loaded.findIndex((r) => r.attribution);
  input.loaded[i] = { ...input.loaded[i], attribution: null };
  assert.ok(compare(input).some((f) => /^attribution differs in 1 rows/.test(f)));
});

test('a lost certification date fails', async () => {
  const input = await setup();
  const i = input.loaded.findIndex((r) => r.certified);
  input.loaded[i] = { ...input.loaded[i], certified: null };
  assert.ok(compare(input).some((f) => /^certified differs in 1 rows/.test(f)));
});

test('a duplicated key fails', async () => {
  const input = await setup();
  input.loaded = [...input.loaded, input.loaded[0]];
  assert.ok(compare(input).some((f) => /^loaded twice/.test(f)));
});

test('an executive record that slips into the load fails', async () => {
  const input = await setup();
  const exec = parseRelease(input.text).find((r) => r.collection === 'executive');
  input.loaded = [...input.loaded, { ...input.loaded[0], id: exec.id, collection: 'executive' }];
  assert.ok(compare(input).some((f) => /^loaded but not in the release \(1\)/.test(f)));
});

test('a parser that drops a record fails against the raw scan', async () => {
  const input = await setup();
  input.expected = input.expected.slice(1);
  input.loaded = input.loaded.slice(1);
  const failures = compare(input);
  assert.ok(failures.some((f) => /^raw scan found 8 site records, parser 7/.test(f)), failures.join('\n'));
  assert.ok(failures.some((f) => /^in raw scan, not parsed/.test(f)), failures.join('\n'));
});
