#!/usr/bin/env node
// Writes fixtures/fr-page.json for the tests: real FR listing entries, one of
// each shape the loader has to handle, trimmed to a few documents.
//
//   node scripts/executive/make-fixtures.mjs   (after `npm run executive -- fetch`)
//
// Shapes: the two executive orders in scripts/corpus/fixtures/release.jsonl
// (EO 12890 and EO 13992, both with notes), a correction (no number, no
// signing date), and the one proclamation that carries notes. The last two
// are not in the fixture release, so they also stand for FR documents the
// release does not hold.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, '../../tmp/executive/raw');
const PICKS = {
  executive_order: ['94-290', '2021-01767', 'C1-2010-27674'],
  proclamation: ['94-26517'],
};

const manifest = JSON.parse(await readFile(resolve(RAW, 'manifest.json'), 'utf8'));
const out = {};
for (const [type, numbers] of Object.entries(PICKS)) {
  const docs = [];
  for (const p of manifest.pages.filter((x) => x.type === type)) {
    const { results } = JSON.parse(await readFile(resolve(RAW, p.file), 'utf8'));
    docs.push(...results.filter((d) => numbers.includes(d.document_number)));
  }
  const missing = numbers.filter((n) => !docs.some((d) => d.document_number === n));
  if (missing.length) throw new Error(`not in the raw pages: ${missing.join(', ')}`);
  out[type] = { results: numbers.map((n) => docs.find((d) => d.document_number === n)) };
}
await writeFile(resolve(HERE, 'fixtures/fr-page.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote fixtures/fr-page.json: ${Object.values(PICKS).flat().join(', ')}`);
