import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawScan, compare } from './senate-check.mjs';

const pageB = `   DOCUMENT NO.   DATE   PAYEE NAME   DESCRIPTION   AMOUNT ($)
 VSA2607203   02/24/2026   ACME CORPORATION   01/01/2026   01/31/2026   MANAGEMENT CONSULTANTS   $588.48
 VSA2607204   03/02/2026   ACME CORPORATION   01/01/2026   01/31/2026   MANAGEMENT CONSULTANTS   -$8,484.00    B-334
                                       OTHER CONTRACTUAL SERVICES   $.00
`;
const pageA = `SUMMARY OF TRANSACTIONS   1,000.00
                                                       A-6
`;

test('raw scan counts money on B pages only', () => {
  assert.deepEqual(rawScan(`${pageA}\f${pageB}\f`), { pages: 1, money: 3, cents: 58848 - 848400 });
});

const tally = (o = {}) => ({ bPages: 1, money: 3, moneyCents: 58848 - 848400, keptCents: 58848, ...o });
const row = { chamber: 'senate', unit: 'senate-fy2026h1', row_number: 4, period_start: '2025-10-01', period_end: '2026-03-31', organization: 'SENATOR WILE E. COYOTE', office: 'SENATOR WILE E. COYOTE', org_year: null, funding_year: '2026', program: 'P', category: 'OTHER CONTRACTUAL SERVICES', row_kind: 'detail', transaction_date: '2026-02-24', start_date: '2026-01-01', end_date: '2026-01-31', document: 'VSA2607203', payee: 'ACME CORPORATION', description: 'MANAGEMENT CONSULTANTS', amount: '588.48', extras: '{"page":3,"page_label":"B-334"}', source_ref: 'u#page=3' };
const raw = { pages: 1, money: 3, cents: 58848 - 848400 };

test('passes when raw, parsed and loaded agree', () => {
  const loaded = [{ ...row, period_start: new Date(2025, 9, 1), period_end: new Date(2026, 2, 31), transaction_date: new Date(2026, 1, 24), start_date: new Date(2026, 0, 1), end_date: new Date(2026, 0, 31), extras: { page_label: 'B-334', page: 3 } }];
  assert.deepEqual(compare({ unit: 'u', raw, parsed: { problems: [], tally: tally(), rows: [row] }, loaded }), []);
});

test('fails on a money token the parse did not read, a parse problem, or a changed column', () => {
  assert.match(compare({ unit: 'u', raw: { ...raw, money: 4 }, parsed: { problems: [], tally: tally(), rows: [row] }, loaded: null })[0], /money on B pages: raw 4, parsed 3/);
  assert.match(compare({ unit: 'u', raw, parsed: { problems: ['block at page 1: bad'], tally: tally(), rows: [row] }, loaded: null })[0], /bad/);
  const f = compare({ unit: 'u', raw, parsed: { problems: [], tally: tally(), rows: [row] }, loaded: [{ ...row, payee: 'DAFFY DUCK' }] });
  assert.ok(f.some((x) => /row 4 payee/.test(x)), f.join('\n'));
});
