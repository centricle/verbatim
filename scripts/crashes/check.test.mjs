// A check that has never failed is not known to work. Each test plants one
// defect in an otherwise perfect load of the fixtures and expects check to
// name it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.mjs';
import { build, decode, parseFile } from './parse.mjs';
import { compare, rawScan } from './check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function setup() {
  const files = await Promise.all(SOURCES.map(async (source) => ({
    source,
    text: decode(await readFile(resolve(HERE, 'fixtures', source.file))),
  })));
  const raw = files.map(({ source, text }) => ({ file: source.file, pairs: rawScan(text) }));
  const parsed = files.map(({ source, text }) => ({ file: source.file, rows: parseFile(text, source) }));
  const { reports, placeholders } = build(files);
  // A perfect load, as Postgres returns it: dates as Date objects.
  const loaded = reports.map((r) => ({
    ...r,
    submission_month: r.submission_month && new Date(`${r.submission_month}T00:00:00Z`),
    incident_month: r.incident_month && new Date(`${r.incident_month}T00:00:00Z`),
  }));
  return { raw, parsed, expected: reports, placeholders: placeholders.length, loaded };
}

test('a perfect load passes', async () => {
  assert.deepEqual(compare(await setup()), []);
});

test('raw scan counts records without the CSV parser', async () => {
  const { raw } = await setup();
  assert.equal(raw.reduce((n, f) => n + f.pairs.length, 0), 16);
});

test('a dropped row fails', async () => {
  const input = await setup();
  input.loaded = input.loaded.slice(1);
  const failures = compare(input);
  assert.ok(failures.some((f) => /^loaded 9 rows/.test(f)), failures.join('\n'));
  assert.ok(failures.some((f) => /^not loaded \(1\)/.test(f)), failures.join('\n'));
});

test('a corrupted field fails and names the column', async () => {
  const input = await setup();
  input.loaded[3] = { ...input.loaded[3], narrative: `${input.loaded[3].narrative}x` };
  assert.ok(compare(input).some((f) => /^narrative differs in 1 rows/.test(f)));
});

test('a shifted date fails', async () => {
  const input = await setup();
  const i = input.loaded.findIndex((r) => r.incident_month);
  input.loaded[i] = { ...input.loaded[i], incident_month: new Date('1999-12-01T00:00:00Z') };
  assert.ok(compare(input).some((f) => /^incident_month differs/.test(f)));
});

test('a duplicated key fails', async () => {
  const input = await setup();
  input.loaded = [...input.loaded, input.loaded[0]];
  const failures = compare(input);
  assert.ok(failures.some((f) => /^loaded twice/.test(f)), failures.join('\n'));
});

test('a stale version fails', async () => {
  const input = await setup();
  const i = input.loaded.findIndex((r) => r.report_id === '540-10173');
  input.loaded[i] = { ...input.loaded[i], report_version: 1 };
  assert.ok(compare(input).some((f) => /^not the latest version in 1 rows: 540-10173: loaded v1, raw latest v2/.test(f)));
});

test('a row the source does not have fails', async () => {
  const input = await setup();
  input.loaded = [...input.loaded.slice(1), { ...input.loaded[0], report_id: '99999-1' }];
  assert.ok(compare(input).some((f) => /^loaded but not in source/.test(f)));
});

test('a parser that drops a record fails against the raw scan', async () => {
  const input = await setup();
  input.parsed[0] = { ...input.parsed[0], rows: input.parsed[0].rows.slice(1) };
  assert.ok(compare(input).some((f) => /current-ads\.csv: raw scan found 3 records, parser 2/.test(f)));
});

test('a placeholder that slips into the load fails', async () => {
  const input = await setup();
  input.placeholders = 0;
  assert.ok(compare(input).some((f) => /^loaded 10 rows; raw distinct IDs 11 less 0/.test(f)));
});
