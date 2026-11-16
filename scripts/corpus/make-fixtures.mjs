#!/usr/bin/env node
// Writes fixtures/release.jsonl for the tests: real release records, one of
// each shape the loader has to handle, with text cut to 400 characters.
//
//   node scripts/corpus/make-fixtures.mjs [path/to/release.jsonl]
//
// Shapes: a core record at day, month and year precision; an amendment
// (proposed, and certified where it has one); a voices record with an
// attribution; an undated voices record; and two executive records, which
// the loader must leave out.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? resolve(HERE, '../../data/corpus/release.jsonl');
const records = (await readFile(src, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

const picks = [
  (r) => r.collection === 'core' && r.date_precision === 'day' && r.genre === 'speech',
  (r) => r.collection === 'core' && r.date_precision === 'month',
  (r) => r.collection === 'core' && r.date_precision === 'year',
  (r) => r.collection === 'core' && r.proposed && r.certified,
  (r) => r.collection === 'core' && r.proposed && !r.certified,
  (r) => r.collection === 'voices' && r.attribution,
  (r) => r.collection === 'voices' && r.date === null,
  (r) => r.collection === 'voices' && r.date !== null && !r.attribution,
  (r) => r.collection === 'executive',
  (r) => r.collection === 'executive' && r.speaker === 'joe-biden',
];

// Python's json.dumps puts a space after each colon and comma, and the raw
// scan relies on that layout, so each line is built the same way. Every value
// in a record is a string, a boolean or null.
const pyLine = (r) => `{${Object.entries(r).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;

const out = picks.map((pick, i) => {
  const r = records.find(pick);
  if (!r) throw new Error(`no record for pick ${i}`);
  return pyLine({ ...r, text: r.text.slice(0, 400) });
});
await writeFile(resolve(HERE, 'fixtures/release.jsonl'), `${out.join('\n')}\n`);
console.log(`${out.length} records to fixtures/release.jsonl`);
