import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linkAmendments, supersedeFilings } from './amendments.mjs';
import { efdFilings } from './senate.mjs';
import { parsePtr } from './parse-senate.mjs';

// Wile E. Coyote's PTRs; Road Runner files too, and is never matched to him.
const row = (filing_id, row_num, o = {}) => ({
  chamber: 'house', filing_id, row_num, bioguide: 'X000001', owner_code: 'SP', type_code: 'P',
  amount: '$1,001 - $15,000', asset_description: 'ACME Corporation (ACME)', transaction_date: '2018-01-02',
  filing_status: 'New', ...o,
});
const run = (rows, dates) => {
  const counts = linkAmendments(rows, new Map(Object.entries(dates)));
  return { counts, at: (f, n) => rows.find((r) => r.filing_id === f && r.row_num === n) };
};

test('one earlier row agreeing on everything: linked, superseded', () => {
  const rows = [row('20000001', 1), row('20000002', 1, { filing_status: 'Amended', transaction_id: 'T1' })];
  const { at, counts } = run(rows, { 20000001: '2018-01-10', 20000002: '2018-02-10' });
  assert.equal(at('20000002', 1).amendment_match, 'unique');
  assert.deepEqual([at('20000002', 1).amends_filing_id, at('20000002', 1).amends_row_num], ['20000001', 1]);
  assert.equal(at('20000001', 1).superseded, true);
  assert.equal(counts.unique, 1);
});

test('tier one wins over same-day rows for other assets', () => {
  const rows = [
    row('20000001', 1, { asset_description: 'Beep Holdings (BEEP)' }),
    row('20000001', 2),
    row('20000002', 1, { filing_status: 'Amended', subholding_of: 'changed' }),
  ];
  const { at } = run(rows, { 20000001: '2018-01-10', 20000002: '2018-02-10' });
  assert.equal(at('20000002', 1).amendment_match, 'unique');
  assert.equal(at('20000002', 1).amends_row_num, 2);
  assert.equal(at('20000001', 1).superseded, false);
});

test('a changed asset falls to tier two, and two same-day rows there are ambiguous', () => {
  const rows = [
    row('20000001', 1, { asset_description: 'Beep Holdings (BEEP)' }),
    row('20000001', 2, { asset_description: 'Daffy Duck Enterprises (DAFY)' }),
    row('20000002', 1, { filing_status: 'Amended', asset_description: 'ACME Corporation (ACME)' }),
  ];
  const { at } = run(rows, { 20000001: '2018-01-10', 20000002: '2018-02-10' });
  assert.equal(at('20000002', 1).amendment_match, 'ambiguous');
  assert.equal(at('20000002', 1).amends_filing_id, null);
  assert.ok(rows.every((r) => !r.superseded));
});

test('owner, type and amount must agree; another member never matches', () => {
  const rows = [
    row('20000001', 1, { amount: '$15,001 - $50,000' }),
    row('20000003', 1, { bioguide: 'X000002' }),
    row('20000002', 1, { filing_status: 'Amended' }),
  ];
  const { at } = run(rows, { 20000001: '2018-01-10', 20000003: '2018-01-11', 20000002: '2018-02-10' });
  assert.equal(at('20000002', 1).amendment_match, 'none');
});

test('only earlier filings are candidates', () => {
  const rows = [row('20000002', 1, { filing_status: 'Amended' }), row('20000003', 1)];
  const { at } = run(rows, { 20000002: '2018-02-10', 20000003: '2018-03-10' });
  assert.equal(at('20000002', 1).amendment_match, 'none');
});

test('a Deleted notice supersedes its row and is counted as a notice', () => {
  const rows = [row('20000001', 1), row('20000002', 1, { filing_status: 'Deleted', transaction_id: 'T9' })];
  const { at, counts } = run(rows, { 20000001: '2018-01-10', 20000002: '2018-02-10' });
  assert.equal(at('20000001', 1).superseded, true);
  assert.equal(at('20000002', 1).amends_filing_id, '20000001');
  assert.equal(counts.deleted, 1);
  assert.equal(counts.amended, 0);
});

test('a second amendment links to the first, not the original', () => {
  const rows = [
    row('20000001', 1),
    row('20000002', 1, { filing_status: 'Amended' }),
    row('20000003', 1, { filing_status: 'Amended' }),
  ];
  const { at } = run(rows, { 20000001: '2018-01-10', 20000002: '2018-02-10', 20000003: '2018-03-10' });
  assert.equal(at('20000003', 1).amends_filing_id, '20000002');
  assert.equal(at('20000001', 1).superseded, true);
  assert.equal(at('20000002', 1).superseded, true);
  assert.equal(at('20000003', 1).superseded, false);
});

test('two notices in one filing claiming one row: neither links', () => {
  const rows = [
    row('20000001', 1),
    row('20000002', 1, { filing_status: 'Amended' }),
    row('20000002', 2, { filing_status: 'Amended' }),
  ];
  const { at } = run(rows, { 20000001: '2018-01-10', 20000002: '2018-02-10' });
  assert.equal(at('20000002', 1).amendment_match, 'ambiguous');
  assert.equal(at('20000002', 2).amendment_match, 'ambiguous');
  assert.equal(at('20000001', 1).superseded, false);
});

test('a rerun starts clean', () => {
  const rows = [row('20000001', 1, { superseded: true, amendment_match: 'unique' })];
  run(rows, { 20000001: '2018-01-10' });
  assert.equal(rows[0].superseded, false);
  assert.equal(rows[0].amendment_match, null);
});

test('a House notice never claims the same member\'s Senate row', () => {
  const rows = [
    row('aaaaaaaa-0000-0000-0000-000000000001', 1, { chamber: 'senate', filing_status: null }),
    row('20000002', 1, { filing_status: 'Amended' }),
  ];
  const { at } = run(rows, { 'aaaaaaaa-0000-0000-0000-000000000001': '2018-01-10', 20000002: '2018-02-10' });
  assert.equal(at('20000002', 1).amendment_match, 'none');
  assert.equal(at('aaaaaaaa-0000-0000-0000-000000000001', 1).superseded, false);
});

// eFD: the Carper pair in the fixtures, filed under the Coyote's name.
const ORIG = '691f9cb6-84a2-41c3-b270-63e606869a0d';
const AMEND = '07935a4d-85ec-406f-8c1c-bd951dfd2903';
const MEMBERS = new Map([['C000001', { member: 'Wile E. Coyote' }], ['R000001', { member: 'Road Runner' }]]);
const fx = (u) => parsePtr(readFileSync(new URL(`./fixtures/efd/${u}.html`, import.meta.url), 'utf8'));
const entry = (uuid, title, date, o = {}) => ({ uuid, link_uuid: uuid, kind: 'electronic', title, first: 'Wile E', last: 'Coyote', office: 'Senator', date_received: date, ...o });
const T = 'Periodic Transaction Report for 10/04/2017';
const efdOut = (entries, pageOf = {}, who = () => 'C000001') => {
  const pages = new Map(entries.filter((e) => pageOf[e.uuid]).map((e) => [e.uuid, { page: pageOf[e.uuid], fetched_at: null }]));
  return efdFilings(entries, pages, who, MEMBERS);
};
// A page as another filing: same rows, own title and date.
const as = (p, title, filed, edit = (r) => r) => ({ ...p, title, filed, rows: p.rows.map((r) => edit({ ...r })) });

test('an amendment supersedes every row of its original', () => {
  const out = efdOut([entry(ORIG, T, '2017-10-04'), entry(AMEND, `${T} (Amendment 1)`, '2018-03-12')], { [ORIG]: fx(ORIG), [AMEND]: fx(AMEND) });
  const done = supersedeFilings(out);
  const [orig, amend] = out;
  assert.equal(amend.filing.amends_filing_id, ORIG);
  assert.equal(orig.filing.amends_filing_id, null);
  assert.ok(orig.rows.every((r) => r.superseded === true));
  assert.ok(amend.rows.every((r) => !r.superseded));
  assert.deepEqual([done.amendments, done.linked, done.superseded_rows, done.none, done.ambiguous], [1, 1, 18, [], []]);
});

test('a chain links each amendment to the version before it', () => {
  const a2 = 'bbbbbbbb-0000-0000-0000-000000000002';
  const out = efdOut([
    entry(a2, `${T} (Amendment 2)`, '2018-05-01'), entry(ORIG, T, '2017-10-04'), entry(AMEND, `${T} (Amendment 1)`, '2018-03-12'),
  ], { [ORIG]: fx(ORIG), [AMEND]: fx(AMEND), [a2]: as(fx(AMEND), `${T} (Amendment 2)`, '05/01/2018') });
  supersedeFilings(out);
  const by = new Map(out.map((x) => [x.filing.filing_id, x]));
  assert.equal(by.get(AMEND).filing.amends_filing_id, ORIG);
  assert.equal(by.get(a2).filing.amends_filing_id, AMEND);
  assert.ok(by.get(AMEND).rows.every((r) => r.superseded));
  assert.ok(by.get(a2).rows.every((r) => !r.superseded));
});

test('same-day originals: the one sharing the most rows by # wins; a tie links nothing', () => {
  const other = 'cccccccc-0000-0000-0000-000000000003';
  const pagesOf = (edit) => ({ [ORIG]: fx(ORIG), [AMEND]: fx(AMEND), [other]: as(fx(ORIG), T, '10/04/2017', edit) });
  const entries = () => [entry(ORIG, T, '2017-10-04'), entry(other, T, '2017-10-04'), entry(AMEND, `${T} (Amendment 1)`, '2018-03-12')];
  let out = efdOut(entries(), pagesOf((r) => ({ ...r, amount: '$1,000,001 - $5,000,000' })));
  supersedeFilings(out);
  assert.equal(out[2].filing.amends_filing_id, ORIG);
  assert.ok(out[1].rows.every((r) => !r.superseded));
  out = efdOut(entries(), pagesOf((r) => r));
  const done = supersedeFilings(out);
  assert.equal(out[2].filing.amends_filing_id, null);
  assert.deepEqual(done.ambiguous, [AMEND]);
  assert.ok(out.every((x) => x.rows.every((r) => !r.superseded)));
});

test('no original, another member\'s original, or a paper one: nothing is linked', () => {
  const paper = entry(ORIG, T, '2017-10-04', { kind: 'paper' });
  for (const [entries, who] of [
    [[entry(AMEND, `${T} (Amendment 1)`, '2018-03-12')], () => 'C000001'],
    [[entry(ORIG, T, '2017-10-04', { last: 'Runner' }), entry(AMEND, `${T} (Amendment 1)`, '2018-03-12')], (e) => (e.last === 'Runner' ? 'R000001' : 'C000001')],
    [[paper, entry(AMEND, `${T} (Amendment 1)`, '2018-03-12')], () => 'C000001'],
  ]) {
    const out = efdOut(entries, { [ORIG]: fx(ORIG), [AMEND]: fx(AMEND) }, who);
    const done = supersedeFilings(out);
    assert.deepEqual(done.none, [AMEND]);
    assert.ok(out.every((x) => x.filing.amends_filing_id === null && x.rows.every((r) => !r.superseded)));
  }
});

test('an amendment with no rows supersedes nothing; the next parsed one skips it', () => {
  const a2 = 'bbbbbbbb-0000-0000-0000-000000000002';
  let out = efdOut([entry(ORIG, T, '2017-10-04'), entry(AMEND, `${T} (Amendment 1)`, '2018-03-12')], { [ORIG]: fx(ORIG) });
  let done = supersedeFilings(out);
  assert.equal(out[1].filing.parse_status, 'failed');
  assert.deepEqual([done.linked, done.unparsed, out[1].filing.amends_filing_id], [0, [AMEND], null]);
  assert.ok(out[0].rows.every((r) => !r.superseded));
  out = efdOut([entry(ORIG, T, '2017-10-04'), entry(AMEND, `${T} (Amendment 1)`, '2018-03-12'), entry(a2, `${T} (Amendment 2)`, '2018-05-01')],
    { [ORIG]: fx(ORIG), [a2]: as(fx(AMEND), `${T} (Amendment 2)`, '05/01/2018') });
  done = supersedeFilings(out);
  assert.equal(out[2].filing.amends_filing_id, ORIG);
  assert.equal(out[1].filing.amends_filing_id, null);
  assert.ok(out[0].rows.every((r) => r.superseded));
  assert.deepEqual(done.unparsed, [AMEND]);
});
