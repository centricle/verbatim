#!/usr/bin/env node
// Rebuild fixtures/ from the raw downloads in tmp/crashes/raw/.
//
//   node scripts/crashes/make-fixtures.mjs
//
// Each fixture is a handful of real rows, chosen for the case they exercise,
// cut down to the columns parse.mjs reads. The cut is what keeps the archive's
// investigating officer name, phone and email columns out of the repo.
//
// The source's byte-level quirks are reproduced, not normalized: row ends as
// each generation writes them (CRLF in the archive, LF in the current files),
// line breaks inside narratives as filed, a bare quote inside an unquoted
// narrative, and the archive's one invalid UTF-8 byte.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { SOURCES } from './sources.mjs';
import { decode } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, '../../tmp/crashes/raw');

const COLUMNS = [
  'Report ID', 'Report Version', 'Reporting Entity', 'Report Type', 'Report Submission Date',
  'Make', 'Model', 'Model Year', 'Incident Date', 'Same Incident ID', 'City', 'State',
  'Crash With', 'Highest Injury Severity Alleged', 'Narrative',
];

// [report id, version] per file, with the reason each is here.
const PICKS = {
  'current-ads.csv': [
    ['13781-16256', 1], ['13781-16256', 2], // two versions in one file: v2 wins
    ['30270-16454', 1], // narrative with quotes, commas and line breaks
  ],
  'current-adas.csv': [
    ['540-10173', 2], // also in the archive at v1: current v2 wins
    ['753-15357', 2],
  ],
  'current-other.csv': [
    ['13781-11042', 2], // was ADAS v1 in the archive, OTHER v2 now
  ],
  'archive-ads.csv': [
    ['30610-5716', 1], // bare quotes inside an unquoted narrative
    ['502-2973', 1], ['502-2973', 2], // placeholder v1 superseded by an Update
  ],
  'archive-adas.csv': [
    ['540-10173', 1],
    ['13781-11042', 1],
    ['13781-10804', 1], // invalid UTF-8 byte in City
    ['13781-11113', 2], // State with trailing space
  ],
  'archive-other.csv': [
    ['30510-3', 1], // "No New or Updated Incident Reports" placeholder
    ['540-20', 1], ['540-20', 2], // incident date filed as JAN-1900
  ],
};

function field(value) {
  if (/[,\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value; // as in the source, a quote alone does not trigger quoting
}

for (const src of SOURCES) {
  const records = parse(decode(await readFile(resolve(RAW, src.file))), { columns: true, relax_quotes: true });
  const lines = [COLUMNS.map(field).join(',')];
  for (const [id, version] of PICKS[src.file]) {
    const rec = records.find((r) => r['Report ID'] === id && Number(r['Report Version']) === version);
    if (!rec) throw new Error(`${src.file}: ${id} v${version} not found`);
    lines.push(COLUMNS.map((c) => field(rec[c])).join(','));
  }
  // U+FFFD is where the source had a lone 0xE2; write the byte back.
  const eol = src.generation === 'archive' ? '\r\n' : '\n';
  const parts = (lines.join(eol) + eol).split('\uFFFD');
  const bufs = parts.flatMap((p, i) => (i ? [Buffer.from([0xe2]), Buffer.from(p)] : [Buffer.from(p)]));
  await writeFile(resolve(HERE, 'fixtures', src.file), Buffer.concat(bufs));
  console.log(`fixtures/${src.file}: ${PICKS[src.file].length} rows`);
}
