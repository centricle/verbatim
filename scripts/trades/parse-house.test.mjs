import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseHouse, bboxWords } from './parse-house.mjs';

const dir = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

for (const fx of fixtures) {
  test(`${fx.docId}: ${fx.why}`, () => {
    assert.deepEqual(parseHouse(fx.words), fx.expect);
  });
}

const fx = (id) => fixtures.find((f) => f.docId === id);

test('2014: rows keep owner blank, no asset code, M/D dates as printed', () => {
  const [r] = parseHouse(fx('20001930').words).rows;
  assert.equal(r.owner_code, null);
  assert.equal(r.asset_type_code, null);
  assert.equal(r.transaction_date, '09/22/2014');
  assert.equal(r.notification_date, '09/22/2014');
});

test('2021: the [XX] code comes off the asset; the Marlett box is not data', () => {
  const rows = parseHouse(fx('20018758').words).rows;
  assert.equal(rows[0].asset_description, 'Antero Midstream Corporation (AM)');
  assert.equal(rows[0].asset_type_code, 'ST');
  assert.equal(rows[0].ticker, 'AM');
  assert.ok(rows.every((r) => !('capgains' in r)));
});

test('2025: synthesized small-caps labels still find their fields', () => {
  const [r] = parseHouse(fx('20030441').words).rows;
  assert.equal(r.filing_status, 'New');
  assert.equal(r.location, 'Clarksville, TN, US');
  assert.equal(r.description, 'sale of ETF OUNZ');
});

test('a wrapped "NYSE: MDT)" line continues the comment, not a new label', () => {
  const { rows, errors } = parseHouse(fx('20002620').words);
  assert.deepEqual(errors, []);
  assert.match(rows[0].comment, /\(which now uses NYSE: MDT\)\. Shares of Covidien/);
});

test('an unknown label with nothing above it is an error', () => {
  const words = structuredClone(fx('20008062').words);
  const label = words.find((w) => /^(FILING|F)$/.test(w.t) && w.y1 - w.y0 < 9.95);
  const line = words.filter((w) => w.p === label.p && Math.abs(w.y1 - label.y1) < 1.2);
  line[0].t = 'BOGUS';
  for (const w of line.slice(1)) w.t = w === line.at(-1) ? 'LABEL: x' : 'X';
  const { errors } = parseHouse(words);
  assert.ok(errors.length > 0);
});

test('bboxWords decodes the entities poppler writes', () => {
  const xml = '<page width="612"><word xMin="1" yMin="2" xMax="3" yMax="4">spouse&apos;s &amp; &lt;x&gt;</word></page>';
  assert.deepEqual(bboxWords(xml), [{ p: 1, x0: 1, y0: 2, x1: 3, y1: 4, t: "spouse's & <x>" }]);
});
