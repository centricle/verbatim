import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.mjs';
import { build, decode, monthDate, parseFile, latestVersions } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function fixtures() {
  return Promise.all(SOURCES.map(async (source) => ({
    source,
    text: decode(await readFile(resolve(HERE, 'fixtures', source.file))),
  })));
}

test('reads every fixture record, quirks included', async () => {
  const { all } = build(await fixtures());
  assert.equal(all.length, 16);
});

test('latest version wins across files and systems', async () => {
  const { reports } = build(await fixtures());
  const byId = Object.fromEntries(reports.map((r) => [r.report_id, r]));

  assert.equal(byId['13781-16256'].report_version, 2);

  assert.equal(byId['540-10173'].report_version, 2);
  assert.equal(byId['540-10173'].period, 'current');

  // Filed as ADAS in the archive, as OTHER in the current files.
  assert.equal(byId['13781-11042'].report_version, 2);
  assert.equal(byId['13781-11042'].system, 'OTHER');
  assert.equal(byId['13781-11042'].period, 'current');
});

test('placeholder filings are set aside only when they are the latest version', async () => {
  const { reports, placeholders } = build(await fixtures());
  const ids = reports.map((r) => r.report_id);
  assert.deepEqual(placeholders.map((r) => r.report_id), ['30510-3']);
  assert.ok(!ids.includes('30510-3'));
  // v1 was a placeholder, v2 an Update: the report stays.
  assert.ok(ids.includes('502-2973'));
  assert.equal(reports.find((r) => r.report_id === '502-2973').report_type, 'Update');
  assert.equal(reports.length, 10);
});

test('text survives as filed', async () => {
  const { reports } = build(await fixtures());
  const byId = Object.fromEntries(reports.map((r) => [r.report_id, r]));

  assert.match(byId['30610-5716'].narrative, /reported "sore neck and back"\.$/);
  assert.match(byId['30270-16454'].narrative, /\S\n\n\S/);
  assert.equal(byId['13781-10804'].city, 'Coeur d\uFFFD??Alene');
  assert.equal(byId['13781-11113'].state, 'SC');
  assert.match(byId['13781-11113'].narrative, /^\[REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION\]$/);
});

test('dates: text as filed, month for sorting', async () => {
  const { reports } = build(await fixtures());
  const gm = reports.find((r) => r.report_id === '540-20');
  assert.equal(gm.incident_date, 'JAN-1900');
  assert.equal(gm.incident_month, '1900-01-01');
  assert.equal(gm.incident_year, 1900);

  assert.equal(monthDate('AUG-2026'), '2026-08-01');
  assert.equal(monthDate(' '), null);
  assert.throws(() => monthDate('Aug-2026'), /Unrecognized month/);
  assert.throws(() => monthDate('2026-08'), /Unrecognized month/);
});

test('every row carries its source reference', async () => {
  const { reports } = build(await fixtures());
  for (const r of reports) {
    assert.match(r.source_ref, /^https:\/\/static\.nhtsa\.gov\/odi\/ffdd\/sgo-2021-01\/.+\.csv#\d+-\d+-v\d+$/);
  }
});

test('a duplicated Report ID and version stops the run', () => {
  const row = { report_id: '1-1', report_version: 1, source_ref: 'a' };
  assert.throws(() => latestVersions([row, { ...row, source_ref: 'b' }]), /appears twice/);
});

test('a missing column stops the run', () => {
  const source = SOURCES[0];
  assert.throws(() => parseFile('Report ID,Report Version\r\n1-1,1\r\n', source), /lacks columns/);
});
