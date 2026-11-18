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
  return { build, loaded, raw: new Map([['20000001', 1], ['20000002', 1]]), badAmounts: [], legacy: [] };
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

test('an old ?senator= value must name a loaded senator with Senate rows', () => {
  const f = fixture();
  f.legacy = [['Wile E Coyote', 'C000001', 'Wile E. Coyote']];
  assert.match(compare(f).join('\n'), /legacy senator "Wile E Coyote": C000001 has no Senate rows/);
  f.loaded.rows.push(row({ chamber: 'senate', filing_id: 'x', source: 'carambat' }));
  assert.doesNotMatch(compare(f).join('\n'), /legacy senator/);
  f.legacy = [['Wile E Coyote', 'C000001', 'Wile Coyote']];
  assert.match(compare(f).join('\n'), /C000001 is "Wile E. Coyote", legacy-senators.js says "Wile Coyote"/);
  f.legacy = [['Road Runner', 'R000001', 'Road Runner']];
  assert.match(compare(f).join('\n'), /R000001 is not loaded/);
});

// eFD: two Senate filings of the Coyote's, the second amending the first.
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const sFiling = (o) => filing({ chamber: 'senate', source: 'efd', ...o });
const sRow = (o) => row({ chamber: 'senate', source: 'efd', type_code: 'Purchase', filing_status: null, ...o });
function efdFixture() {
  const build = {
    members: [{ bioguide: 'C000001', member: 'Wile E. Coyote', member_sort: 'Coyote, Wile E.' }],
    filings: [sFiling({ filing_id: A }), sFiling({ filing_id: B, amends_filing_id: A })],
    rows: [sRow({ filing_id: A, superseded: true }), sRow({ filing_id: B })],
    index: [], excluded: [], records: [],
    efd: { ledger: 2, pages: 2, filings: 2, to_carambat: 0 },
    ledger: [{ uuid: A }, { uuid: B }],
    carambatBioguide: new Map([[A, 'C000001']]),
  };
  const loaded = structuredClone({ members: build.members, filings: build.filings, rows: build.rows });
  return { build, loaded, raw: new Map(), rawEfd: new Map([[A, 1], [B, 1]]), badAmounts: [], legacy: [] };
}

test('eFD: a faithful load passes; an amended filing\'s rows are superseded', () => {
  assert.deepEqual(compare(efdFixture()), []);
  const f = efdFixture();
  f.build.rows[0].superseded = false;
  f.loaded.rows[0].superseded = false;
  assert.match(compare(f).join('\n'), /senate:aaaaaaaa-0000-0000-0000-000000000001:1: its filing is amended by bbbbbbbb/);
});

test('eFD: a filing amended twice, or amending one not loaded, fails', () => {
  const f = efdFixture();
  const c = 'cccccccc-0000-0000-0000-000000000003';
  for (const x of [f.build, f.loaded]) x.filings.push(sFiling({ filing_id: c, amends_filing_id: A, row_count: 0 }));
  f.build.ledger.push({ uuid: c });
  f.build.efd.to_carambat = 0;
  assert.match(compare(f).join('\n'), /amended by both bbbbbbbb.* and cccccccc/);
  const g = efdFixture();
  g.loaded.filings[1].amends_filing_id = 'dddddddd-0000-0000-0000-000000000004';
  g.build.filings[1].amends_filing_id = 'dddddddd-0000-0000-0000-000000000004';
  assert.match(compare(g).join('\n'), /amends dddddddd-0000-0000-0000-000000000004, which is not loaded/);
});

test('eFD: a ledger entry with no filing fails coverage', () => {
  const f = efdFixture();
  f.build.ledger.push({ uuid: 'eeeeeeee-0000-0000-0000-000000000005' });
  assert.match(compare(f).join('\n'), /eFD: 3 ledger entries, 2 eFD filings \+ 0 from Senate Stock Watcher/);
});

test('eFD: a failed page fails check, unless eFD no longer serves it', () => {
  const f = efdFixture();
  for (const x of [f.build, f.loaded]) Object.assign(x.filings[1], { parse_status: 'failed', parse_error: 'page not fetched', row_count: 0 });
  for (const x of [f.build, f.loaded]) x.rows.pop();
  f.rawEfd.delete(B);
  assert.match(compare(f).join('\n'), /eFD bbbbbbbb-0000-0000-0000-000000000002 \(null\): page not fetched/);
  f.build.ledger[1].page_gone = '2026-11-18T21:55:00.000Z';
  assert.deepEqual(compare(f), []);
});

test('eFD: parsed rows against the raw page; one senator per shared UUID; ids by case', () => {
  let f = efdFixture();
  f.rawEfd.set(A, 2);
  assert.match(compare(f).join('\n'), /eFD aaaaaaaa.*: parsed 1 rows, raw page has 2/);
  f = efdFixture();
  f.build.carambatBioguide.set(A, 'R000001');
  assert.match(compare(f).join('\n'), /bioguide C000001, Senate Stock Watcher's R000001/);
  f = efdFixture();
  const upper = sFiling({ filing_id: A.toUpperCase(), source: 'carambat', row_count: 0 });
  f.build.filings.push(upper);
  f.loaded.filings.push(structuredClone(upper));
  f.build.records = [{ ptr_link: `https://efdsearch.senate.gov/search/view/ptr/${A.toUpperCase()}/`, transactions: [] }];
  assert.match(compare(f).join('\n'), /Senate filings aaaaaaaa.* and AAAAAAAA.* are one UUID/);
});

test('efdRawRows counts every <tr> but the header', async () => {
  const { efdRawRows } = await import('./check.mjs');
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('./fixtures/efd/691f9cb6-84a2-41c3-b270-63e606869a0d.html', import.meta.url), 'utf8');
  assert.equal(efdRawRows(html), 18);
});

test('a House filing never names an amended filing', () => {
  const f = fixture();
  f.build.filings[1].amends_filing_id = '20000001';
  f.loaded.filings[1].amends_filing_id = '20000001';
  assert.match(compare(f).join('\n'), /filing house:20000002: amends filing 20000001/);
});
