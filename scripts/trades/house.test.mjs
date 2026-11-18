import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndex, usDate, houseFiling } from './house.mjs';

const MEMBER = { bioguide: 'C000001', member: 'Wile E. Coyote' };

test('index: BOM, CRLF, PTRs only, dates to ISO', () => {
  const text = '﻿Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID\r\n'
    + 'Hon.\tCoyote\tWile E.\t\tP\tAZ01\t2018\t3/2/2018\t20009063\r\n'
    + '\tRunner\tRoad\t\tO\tAZ02\t2018\t5/15/2018\t10021234\r\n';
  const rows = parseIndex(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Prefix, 'Hon.');
  assert.equal(rows[0].Year, 2018);
  assert.equal(rows[0].filed, '2018-03-02');
});

test('index: a missing column fails', () => {
  assert.throws(() => parseIndex('Last\tFirst\r\n'), /lacks/);
});

test('usDate: one-digit parts, and no impossible dates', () => {
  assert.equal(usDate('09/8/2017'), '2017-09-08');
  assert.equal(usDate('2/29/2020'), '2020-02-29');
  assert.equal(usDate('2/29/2019'), null);
  assert.equal(usDate('13/1/2019'), null);
  assert.equal(usDate(null), null);
});

const ix = (DocID) => ({ Prefix: 'Hon.', Last: 'Coyote', First: 'Wile E.', Suffix: '', StateDst: 'AZ01', Year: 2018, filed: '2018-03-02', DocID });
const parsed = (rows, o = {}) => ({ filingId: '20009063', filer: { name: 'Hon. Wile E. Coyote' }, errors: [], rows, ...o });
const prow = (o = {}) => ({
  row_num: 1, transaction_id: null, owner_code: 'SP', asset_description: 'ACME Corporation (ACME)', asset_type_code: 'ST',
  ticker: 'ACME', type_code: 'S (partial)', transaction_date: '02/26/2018', notification_date: '02/27/2018',
  amount: '$1,001 - $15,000', filing_status: 'New', ...o,
});

test('a parsed row gets its labels in the House words and ISO dates', () => {
  const { filing, rows } = houseFiling(ix('20009063'), MEMBER, parsed([prow()]), '2026-11-18T00:00:00.000Z');
  assert.equal(filing.parse_status, 'parsed');
  assert.equal(filing.row_count, 1);
  assert.equal(filing.url, 'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2018/20009063.pdf');
  assert.equal(rows[0].owner, 'Spouse');
  assert.equal(rows[0].asset_type, 'Stocks (including ADRs)');
  assert.equal(rows[0].type, 'Sale (Partial)');
  assert.equal(rows[0].transaction_date, '2018-02-26');
});

test('a blank owner stays blank, not "Self"', () => {
  const { rows } = houseFiling(ix('20009063'), MEMBER, parsed([prow({ owner_code: null })]));
  assert.equal(rows[0].owner, null);
});

test('any unknown code or bad date fails the whole filing, with no rows', () => {
  for (const bad of [{ owner_code: 'XX' }, { asset_type_code: 'ZZ' }, { type_code: 'Q' }, { transaction_date: '02/30/2018' }]) {
    const { filing, rows } = houseFiling(ix('20009063'), MEMBER, parsed([prow(), prow({ row_num: 2, ...bad })]));
    assert.equal(filing.parse_status, 'failed', JSON.stringify(bad));
    assert.equal(rows.length, 0);
    assert.match(filing.parse_error, /row 2/);
  }
});

test('a PDF whose Filing ID differs from the index fails', () => {
  const { filing } = houseFiling(ix('20009063'), MEMBER, parsed([prow()], { filingId: '20009064' }));
  assert.match(filing.parse_error, /Filing ID #20009064/);
});

test('an electronic PTR not yet fetched, and a paper one', () => {
  assert.equal(houseFiling(ix('20009063'), MEMBER, null).filing.parse_error, 'PDF not fetched');
  const paper = houseFiling(ix('8220001'), MEMBER, null);
  assert.equal(paper.filing.kind, 'paper');
  assert.equal(paper.filing.parse_status, 'paper');
  assert.equal(paper.filing.fetched_at, null);
});
