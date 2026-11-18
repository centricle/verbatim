import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlText, filingId, senateFilings, resolveSenate } from './senate.mjs';

const MEMBERS = new Map([['C000001', { bioguide: 'C000001', member: 'Wile E. Coyote' }]]);
const uuid = '32550a8f-923e-416f-84f3-e19ab4f148b1';
const rec = (o = {}) => ({
  first_name: 'Wile E ', last_name: 'Coyote', office: 'Coyote, Wile E. (Senator)', bioguide: 'C000001',
  ptr_link: `https://efdsearch.senate.gov/search/view/ptr/${uuid}/`, date_recieved: '03/10/2021',
  transactions: [{
    transaction_date: '02/11/2021', owner: 'Spouse', ticker: '--', asset_type: '', type: 'Purchase', amount: '$50,001 - $100,000', comment: '--',
    asset_description: 'ACME - ACME Corporation 526107AF4 <div class="text-muted"><em>Rate/Coupon:</em> 1.700%<br> <em>Matures:</em> 08/01/27</div>',
  }],
  ...o,
});

test('eFD markup reduces to its text', () => {
  assert.equal(htmlText('Wells Fargo &amp; Company'), 'Wells Fargo & Company');
  assert.equal(htmlText('A&nbsp;B <br>C'), 'A B C');
  assert.equal(htmlText('<div class="text-muted"><em>Rate:</em> 1%</div>'), 'Rate: 1%');
});

test('filing links: ptr and paper, either case', () => {
  assert.deepEqual(filingId(`https://efdsearch.senate.gov/search/view/ptr/${uuid}/`), { kind: 'electronic', id: uuid });
  assert.deepEqual(filingId('https://efdsearch.senate.gov/search/view/paper/BAB946BE-A931-4A1D-ACE4-6DBEA29A445C/'), { kind: 'paper', id: 'BAB946BE-A931-4A1D-ACE4-6DBEA29A445C' });
  assert.throws(() => filingId('https://efdsearch.senate.gov/search/'), /not an eFD filing link/);
});

test('a filing and its rows, "--" and empty cells as NULL', () => {
  const [{ filing, rows }] = senateFilings([rec()], MEMBERS);
  assert.equal(filing.filing_id, uuid);
  assert.equal(filing.filed_date, '2021-03-10');
  assert.equal(filing.filer_first, 'Wile E');
  assert.equal(filing.row_count, 1);
  assert.equal(rows[0].row_num, 1);
  assert.equal(rows[0].ticker, null);
  assert.equal(rows[0].comment, null);
  assert.equal(rows[0].asset_type, null);
  assert.equal(rows[0].owner, 'Spouse');
  assert.equal(rows[0].owner_code, null);
  assert.equal(rows[0].type_code, 'Purchase');
  assert.equal(rows[0].asset_description, 'ACME - ACME Corporation 526107AF4 Rate/Coupon: 1.700% Matures: 08/01/27');
});

test('a paper filing is recorded with no rows', () => {
  const [{ filing, rows }] = senateFilings([rec({ ptr_link: `https://efdsearch.senate.gov/search/view/paper/${uuid}/`, transactions: undefined })], MEMBERS);
  assert.equal(filing.kind, 'paper');
  assert.equal(filing.parse_status, 'paper');
  assert.equal(rows.length, 0);
});

test('an unknown type or member stops the load', () => {
  const bad = rec();
  bad.transactions[0].type = 'Gift';
  assert.throws(() => senateFilings([bad], MEMBERS), /type "Gift"/);
  assert.throws(() => senateFilings([rec({ bioguide: 'R000001' })], MEMBERS), /no member row/);
});

// The Coyote's real ID is C000001; Senate Stock Watcher filed him under
// C000099, a namesake who never sat in the Senate.
const SENATORS = new Set(['C000001', 'W000001']);
const hasTerm = (bioguide) => SENATORS.has(bioguide);
const PINS = { C000099: { bioguide: 'C000001', last: 'Coyote', why: 'test' } };

test('a pin corrects the wrong bioguide when the last name is the pin\'s', () => {
  const { records, fixed, failures } = resolveSenate(
    [rec({ bioguide: 'C000099' }), rec({ bioguide: 'C000099', last_name: 'COYOTE, Jr.' }), rec()], hasTerm, PINS);
  assert.deepEqual(records.map((r) => r.bioguide), ['C000001', 'C000001', 'C000001']);
  assert.equal(fixed.length, 2);
  assert.deepEqual(failures, []);
});

test('a pin never moves another filer carrying the same wrong ID', () => {
  const wolf = rec({ bioguide: 'C000099', first_name: 'Ralph', last_name: 'Wolf', office: 'Wolf, Ralph (Senator)' });
  const { records, fixed, failures } = resolveSenate([wolf], hasTerm, PINS);
  assert.equal(records[0].bioguide, 'C000099');
  assert.equal(fixed.length, 0);
  assert.match(failures[0], /Ralph Wolf .* C000099: no Senate term/);
});

test('a bioguide with no Senate term at the received date fails', () => {
  const { failures } = resolveSenate([rec({ bioguide: 'R000001' })], hasTerm, PINS);
  assert.equal(failures.length, 1);
});
