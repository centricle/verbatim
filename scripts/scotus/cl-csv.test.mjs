import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RowSplitter, fieldValue, predicate, slice } from './cl-csv.mjs';
import { CL_SLICED } from './sources.mjs';

// PostgreSQL COPY CSV with ESCAPE '\': quoted text with a newline, an
// escaped quote, an escaped backslash, a comma, and a NULL (empty, unquoted).
const OPINIONS = [
  'id,cluster_id,type,plain_text\n',
  '"1","10","020lead","He said, \\"no.\\"\nNew line."\n',
  '"2","99","040dissent","path C:\\\\x\\\\"\n',
  '"3","10","030concurrence",\n',
  '"4","11","010combined","ends with a quote \\""\n',
].join('');

const rows = (text, chunkSize, wanted = null) => {
  const out = [];
  const s = new RowSplitter((row, bounds) => out.push(bounds.map((b) => (b ? fieldValue(row, b) : undefined))), wanted);
  const buf = Buffer.from(text);
  for (let i = 0; i < buf.length; i += chunkSize) s.push(buf.subarray(i, i + chunkSize));
  s.end();
  return out;
};

test('rows split on unquoted newlines only, at any chunk boundary', () => {
  const whole = rows(OPINIONS, 1 << 20);
  assert.equal(whole.length, 5);
  assert.deepEqual(whole[1], ['1', '10', '020lead', 'He said, "no."\nNew line.']);
  assert.deepEqual(whole[2], ['2', '99', '040dissent', 'path C:\\x\\']);
  assert.deepEqual(whole[3], ['3', '10', '030concurrence', null]);
  assert.deepEqual(whole[4], ['4', '11', '010combined', 'ends with a quote "']);
  for (const size of [1, 2, 3, 5, 7, 13]) assert.deepEqual(rows(OPINIONS, size), whole, `chunk size ${size}`);
});

test('wanted limits which bounds are reported', () => {
  const r = rows(OPINIONS, 4, [1]);
  assert.equal(r[1].length, 2);
  assert.ok(!(0 in r[1]));
  assert.equal(r[1][1], '10');
});

test('a last row without a newline is still a row', () => {
  assert.equal(rows('id,court_id\n"1","scotus"', 3).length, 2);
});

test('a CRLF row end leaves no carriage return in the last field', () => {
  assert.deepEqual(rows('a,b\r\n"1","x"\r\n', 2)[1], ['1', 'x']);
});

test('predicate: court match, id-set lookup, and a missing set', () => {
  const [dockets, clusters] = CL_SLICED;
  assert.ok(predicate(dockets, {})('scotus'));
  assert.ok(!predicate(dockets, {})('ca9'));
  const inCluster = predicate(CL_SLICED[2], { cluster: new Set([10]) });
  assert.ok(inCluster('10'));
  assert.ok(!inCluster('11'));
  assert.ok(!inCluster(null));
  assert.throws(() => predicate(clusters, {}), /docket ids/);
});

async function* chunks(text, size) {
  const buf = Buffer.from(text);
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

test('slice chains dockets -> clusters -> opinions and writes kept rows byte for byte', async () => {
  const [dockets, clusters, opinions] = CL_SLICED;
  const sets = {};
  let out = [];
  const write = (b) => { out.push(Buffer.from(b)); };

  const d = await slice(chunks('id,court_id,case_name\n"7","scotus","A v. B"\n"8","ca9","C v. D"\n"9","scotus","E, F v. G"\n', 5), dockets, sets, write);
  assert.equal(d.kept, 2);
  assert.deepEqual([...d.ids], [7, 9]);
  assert.equal(Buffer.concat(out).toString(), 'id,court_id,case_name\n"7","scotus","A v. B"\n"9","scotus","E, F v. G"\n');
  sets.docket = d.ids;

  out = [];
  const c = await slice(chunks('id,docket_id\n"10","7"\n"11","9"\n"99","8"\n', 4), clusters, sets, write);
  sets.cluster = c.ids;
  assert.deepEqual([...c.ids], [10, 11]);

  out = [];
  const o = await slice(chunks(OPINIONS, 6), opinions, sets, write);
  assert.equal(o.rows, 4);
  assert.equal(o.kept, 3);
  const expected = OPINIONS.split('"2","99"')[0] + OPINIONS.slice(OPINIONS.indexOf('"3","10"'));
  assert.equal(Buffer.concat(out).toString(), expected);
});

test('slice refuses a table without its key column', async () => {
  await assert.rejects(slice(chunks('id,court\n"1","scotus"\n', 64), CL_SLICED[0], {}, () => {}), /no court_id column/);
});
