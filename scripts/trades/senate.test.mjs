import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlText, filingId, senateFilings, resolveSenate, efdFilings, sameTitle } from './senate.mjs';
import { parsePtr } from './parse-senate.mjs';

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
  assert.equal(htmlText('Aaron&#x27;s, Inc. &#35;1 L&#X27;Or&#233;al'), "Aaron's, Inc. #1 L'Oréal");
  assert.equal(htmlText('Merck &amp;amp; Co. McDonald&amp;apos;s S&amp;P'), "Merck & Co. McDonald's S&P");
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

// eFD: ledger entries as efd-index.mjs writes them, pages from the fixtures.
const ORIG = '691f9cb6-84a2-41c3-b270-63e606869a0d';
const page = (u) => parsePtr(readFileSync(new URL(`./fixtures/efd/${u}.html`, import.meta.url), 'utf8'));
const entry = (o = {}) => ({
  uuid: ORIG, link_uuid: ORIG.toUpperCase(), kind: 'electronic', title: 'Periodic Transaction Report for 10/04/2017',
  first: 'Wile E', last: 'Coyote', office: 'Former Senator', date_received: '2017-10-04',
  first_seen: '2026-11-18T21:54:00.000Z', last_seen: '2026-11-18T21:54:00.000Z', ...o,
});
const coyote = () => 'C000001';
const pages = (u = ORIG) => new Map([[u, { page: page(u), fetched_at: '2026-11-18T22:00:00.000Z' }]]);

test('efdFilings: the page is the rows, the list is the filing', () => {
  const [{ filing, rows }] = efdFilings([entry()], pages(), coyote, MEMBERS);
  assert.equal(filing.source, 'efd');
  assert.equal(filing.filing_id, ORIG);
  assert.equal(filing.url, `https://efdsearch.senate.gov/search/view/ptr/${ORIG.toUpperCase()}/`);
  assert.equal(filing.filed_date, '2017-10-04');
  assert.equal(filing.office, 'Former Senator');
  assert.equal(filing.filer_name, null);
  assert.equal(filing.parse_status, 'parsed');
  assert.equal(filing.row_count, 18);
  assert.equal(filing.fetched_at, '2026-11-18T22:00:00.000Z');
  assert.deepEqual(rows.map((r) => r.row_num), Array.from({ length: 18 }, (_, i) => 18 - i));
  const nine = rows.find((r) => r.row_num === 9);
  assert.equal(nine.transaction_date, '2017-09-29');
  assert.equal(nine.type_code, nine.type);
  assert.ok(rows.every((r) => r.source === 'efd' && r.member === 'Wile E. Coyote' && r.owner_code === null));
});

test('efdFilings: title is the page h1, even where the list shifted it a day', () => {
  const listed = entry({ title: 'Periodic Transaction Report for 10/05/2017' });
  const [{ filing }] = efdFilings([listed], pages(), coyote, MEMBERS);
  assert.equal(filing.parse_status, 'parsed');
  assert.equal(filing.title, 'Periodic Transaction Report for 10/04/2017');
});

test('efdFilings: a page disagreeing with its listing fails, with no rows', () => {
  let [{ filing, rows }] = efdFilings([entry({ date_received: '2017-10-05' })], pages(), coyote, MEMBERS);
  assert.equal(filing.parse_status, 'failed');
  assert.match(filing.parse_error, /page filed 10\/04\/2017, listed 2017-10-05/);
  assert.equal(rows.length, 0);
  [{ filing }] = efdFilings([entry({ title: 'Periodic Transaction Report for 10/04/2017 (Amendment 1)' })], pages(), coyote, MEMBERS);
  assert.match(filing.parse_error, /page title/);
});

test('efdFilings: paper, a gone page, an unfetched page, an unparsed page', () => {
  const paper = entry({ uuid: 'p', link_uuid: 'P', kind: 'paper', title: 'Periodic Transaction Report for 05/01/2014' });
  const gone = entry({ uuid: 'g', link_uuid: 'g', page_gone: '2026-11-18T21:55:00.000Z' });
  const unfetched = entry({ uuid: 'u', link_uuid: 'u' });
  const broken = entry({ uuid: 'b', link_uuid: 'b' });
  const got = new Map([['b', { error: '0 h1 elements', fetched_at: '2026-11-18T22:00:00.000Z' }]]);
  const [p, g, u, b] = efdFilings([paper, gone, unfetched, broken], got, coyote, MEMBERS).map((x) => x.filing);
  assert.deepEqual([p.parse_status, p.title, p.url], ['paper', 'Periodic Transaction Report for 05/01/2014', 'https://efdsearch.senate.gov/search/view/paper/P/']);
  assert.equal(g.parse_status, 'failed');
  assert.match(g.parse_error, /302 to \/search\/ \(first seen 2026-11-18\); no copy is held/);
  assert.equal(g.title, 'Periodic Transaction Report for 10/04/2017');
  assert.equal(u.parse_error, 'page not fetched');
  assert.equal(b.parse_error, 'parse: 0 h1 elements');
  assert.equal(b.fetched_at, '2026-11-18T22:00:00.000Z');
});

test('efdFilings: an unknown member stops the load', () => {
  assert.throws(() => efdFilings([entry()], pages(), () => 'R000001', MEMBERS), /no member row/);
});

test('sameTitle: equal, or the list one day after the page, and nothing else', () => {
  const t = (d, a = '') => `Periodic Transaction Report for ${d}${a}`;
  assert.ok(sameTitle(t('09/29/2017'), t('09/29/2017')));
  assert.ok(sameTitle(t('09/30/2017'), t('09/29/2017')));
  assert.ok(sameTitle(t('01/01/2018'), t('12/31/2017')));
  assert.ok(sameTitle(t('04/01/2020', ' (Amendment 1)'), t('03/31/2020', ' (Amendment 1)')));
  assert.ok(!sameTitle(t('09/28/2017'), t('09/29/2017')));
  assert.ok(!sameTitle(t('10/01/2017'), t('09/29/2017')));
  assert.ok(!sameTitle(t('09/29/2017', ' (Amendment 1)'), t('09/29/2017')));
});
