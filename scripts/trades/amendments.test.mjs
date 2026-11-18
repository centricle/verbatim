import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkAmendments } from './amendments.mjs';

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
