// The check has to fail on every defect it exists to catch. Each test plants
// one in an otherwise faithful copy of the loaded rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, frDocuments } from './parse.mjs';
import { compare, rawScan } from './check.mjs';
import { parseRelease } from '../corpus/parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function setup() {
  const text = await readFile(resolve(HERE, '../corpus/fixtures/release.jsonl'), 'utf8');
  const records = parseRelease(text);
  const page = JSON.parse(await readFile(resolve(HERE, 'fixtures/fr-page.json'), 'utf8'));
  const docs = frDocuments([{ type: 'executive_order', json: page.executive_order }, { type: 'proclamation', json: page.proclamation }]);
  const built = buildRows(records, docs);
  const input = {
    raw: rawScan(text),
    parsedCount: records.filter((r) => r.collection === 'executive').length,
    expected: built.rows,
    unjoined: built.unjoined,
    conflicts: built.conflicts,
  };
  // What Postgres hands back: dates as Date objects, jsonb with keys reordered.
  const loaded = built.rows.map((r) => ({
    ...structuredClone(r),
    signing_date: r.signing_date && new Date(`${r.signing_date}T00:00:00Z`),
    publication_date: new Date(`${r.publication_date}T00:00:00Z`),
    notes_parsed: r.notes_parsed && r.notes_parsed.map((rel) => ({ refs: rel.refs.map((x) => ({ text: x.text, date: x.date, number: x.number, kind: x.kind })), relation: rel.relation })),
  }));
  return { input, loaded, records, docs };
}

test('a faithful load passes', async () => {
  const { input, loaded } = await setup();
  assert.equal(input.raw.length, 2);
  assert.deepEqual(compare({ ...input, loaded }), []);
});

test('a dropped row fails', async () => {
  const { input, loaded } = await setup();
  assert.match(compare({ ...input, loaded: loaded.slice(1) }).join('\n'), /loaded 1 rows; the join made 2[\s\S]*not loaded/);
});

test('a changed number fails', async () => {
  const { input, loaded } = await setup();
  loaded[0].number = '99999';
  assert.match(compare({ ...input, loaded }).join('\n'), /number differs in 1 rows/);
});

test('a duplicated id fails', async () => {
  const { input, loaded } = await setup();
  assert.match(compare({ ...input, loaded: [...loaded, loaded[0]] }).join('\n'), /loaded twice/);
});

test('a mangled note fails, in the string or in its parse', async () => {
  const { input, loaded } = await setup();
  const i = loaded.findIndex((r) => r.notes);
  const string = structuredClone(loaded);
  string[i].notes = string[i].notes.replace('Revoke', 'Revoe');
  assert.match(compare({ ...input, loaded: string }).join('\n'), /notes differs[\s\S]*loaded: .* does not read as FR's note/);
  const parse = structuredClone(loaded);
  parse[i].notes_parsed[0].refs.pop();
  assert.match(compare({ ...input, loaded: parse }).join('\n'), /notes_parsed differs[\s\S]*loaded: .* does not read as FR's note/);
});

test('a changed date or title fails', async () => {
  const { input, loaded } = await setup();
  loaded[0].signing_date = new Date('1990-01-01T00:00:00Z');
  loaded[1].title = `${loaded[1].title}.`;
  const out = compare({ ...input, loaded }).join('\n');
  assert.match(out, /signing_date differs/);
  assert.match(out, /title differs/);
});

test('a record the raw scan sees but the join lost fails', async () => {
  const { input, loaded } = await setup();
  const out = compare({ ...input, expected: input.expected.slice(1), loaded: loaded.slice(1) }).join('\n');
  assert.match(out, /neither a row nor unjoined/);
});

test('an unjoined record passes only while it is named', async () => {
  const { records, docs } = await setup();
  const text = await readFile(resolve(HERE, '../corpus/fixtures/release.jsonl'), 'utf8');
  const built = buildRows(records, docs.filter((d) => d.document_number !== '94-290'));
  const input = { raw: rawScan(text), parsedCount: 2, expected: built.rows, unjoined: built.unjoined, conflicts: [] };
  assert.deepEqual(compare({ ...input, loaded: structuredClone(built.rows) }), []);
  assert.match(compare({ ...input, unjoined: [], loaded: structuredClone(built.rows) }).join('\n'), /neither a row nor unjoined/);
});

test('a join conflict fails', async () => {
  const { input, loaded } = await setup();
  assert.match(compare({ ...input, conflicts: ['x: executive_order_notes and disposition_notes differ'], loaded }).join('\n'), /differ/);
});
