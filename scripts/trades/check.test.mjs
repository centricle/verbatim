import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './check.mjs';
import { FILING_COLUMNS, ROW_COLUMNS } from './columns.mjs';

const blank = (columns, o) => ({ ...Object.fromEntries(columns.map(([c]) => [c, null])), ...o });
const filing = (o) => blank(FILING_COLUMNS, { chamber: 'house', source: 'house-clerk', kind: 'electronic', bioguide: 'C000001', parse_status: 'parsed', row_count: 1, ...o });
const row = (o) => blank(ROW_COLUMNS, { chamber: 'house', row_num: 1, source: 'house-clerk', bioguide: 'C000001', member: 'Wile E. Coyote', type_code: 'P', type: 'Purchase', amount: '$1,001 - $15,000', filing_status: 'New', superseded: false, ...o });

function fixture() {
  const build = {
    members: [{ bioguide: 'C000001', member: 'Wile E. Coyote', member_sort: 'Coyote, Wile E.' }],
    filings: [filing({ filing_id: '20000001' }), filing({ filing_id: '20000002' })],
    rows: [
      row({ filing_id: '20000001', superseded: true }),
      row({ filing_id: '20000002', filing_status: 'Amended', amends_filing_id: '20000001', amends_row_num: 1, amendment_match: 'unique' }),
    ],
    index: [{ DocID: '20000001' }, { DocID: '20000002' }, { DocID: '8200001' }],
    excluded: [{ ix: { DocID: '8200001' }, why: 'not a Member' }],
    records: [],
  };
  const loaded = structuredClone({ members: build.members, filings: build.filings, rows: build.rows });
  return { build, loaded, raw: new Map([['20000001', 1], ['20000002', 1]]), badAmounts: [] };
}

test('a faithful load passes', () => {
  assert.deepEqual(compare(fixture()), []);
});

test('a changed value in any column fails', () => {
  const f = fixture();
  f.loaded.rows[1].ticker = 'BEEP';
  assert.match(compare(f).join('\n'), /row house:20000002:1: ticker is "BEEP", expected null/);
});

test('a row missing from the load, or extra in it, fails', () => {
  const f = fixture();
  f.loaded.rows.push(row({ filing_id: '20000002', row_num: 2 }));
  assert.match(compare(f).join('\n'), /20000002:2: loaded but not in the raw copies/);
  assert.match(compare(f).join('\n'), /row_count 1, 2 rows loaded/);
});

test('the parser disagreeing with the raw text layer fails', () => {
  const f = fixture();
  f.raw.set('20000002', 2);
  assert.match(compare(f).join('\n'), /parsed 1 rows, raw text has 2/);
});

test('a failed filing fails check', () => {
  const f = fixture();
  f.build.filings.push(filing({ filing_id: '20000003', parse_status: 'failed', parse_error: 'PDF not fetched', row_count: 0 }));
  f.build.index.push({ DocID: '20000003' });
  f.loaded.filings.push(structuredClone(f.build.filings.at(-1)));
  assert.match(compare(f).join('\n'), /House 20000003 .*PDF not fetched/);
});

test('a superseded row needs exactly one link, and a linked row must be superseded', () => {
  const f = fixture();
  f.loaded.rows[0].superseded = false;
  assert.match(compare(f).join('\n'), /linked from 1 rows, not superseded/);
  const g = fixture();
  g.loaded.rows[1].amends_filing_id = null;
  g.loaded.rows[1].amends_row_num = null;
  assert.match(compare(g).join('\n'), /superseded, linked from 0 rows/);
});

test('a member name on two people, or a row with the wrong name, fails', () => {
  const f = fixture();
  f.loaded.members.push({ bioguide: 'W000001', member: 'Wile E. Coyote', member_sort: 'Wolf, Ralph' });
  assert.match(compare(f).join('\n'), /is both C000001 and W000001/);
  const g = fixture();
  g.loaded.rows[1].member = 'Ralph Wolf';
  assert.match(compare(g).join('\n'), /1 rows carry a member name/);
});

test('control characters and the unidentified-glyph mark fail; a printed U+FFFD passes', () => {
  const f = fixture();
  f.loaded.rows[1].description = 'ACME­Corp';
  f.build.rows[1].description = 'ACME­Corp';
  assert.match(compare(f).join('\n'), /description holds U\+00AD/);
  const g = fixture();
  g.loaded.rows[1].description = 'ACME  Corp';
  g.build.rows[1].description = 'ACME  Corp';
  assert.match(compare(g).join('\n'), /description holds U\+E000/);
  const h = fixture();
  h.loaded.rows[1].description = 'FUNDS �* GROWTH';
  h.build.rows[1].description = 'FUNDS �* GROWTH';
  assert.deepEqual(compare(h), []);
});

test('an amount the database cannot rank, and an unknown status, fail', () => {
  const f = fixture();
  f.badAmounts = [{ chamber: 'house', filing_id: '20000002', row_num: 1, amount: 'a lot' }];
  f.loaded.rows[1].filing_status = 'Withdrawn';
  f.build.rows[1].filing_status = 'Withdrawn';
  const out = compare(f).join('\n');
  assert.match(out, /amount "a lot"/);
  assert.match(out, /filing status "Withdrawn"/);
});

test('an index PTR with no filing fails', () => {
  const f = fixture();
  f.build.index.push({ DocID: '20000009' });
  assert.match(compare(f).join('\n'), /3 index PTRs|4 index PTRs/);
});
