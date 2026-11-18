import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseMatcher, memberRows, displayName, sortName, senateTerm, senateMatcher, senateDeparture } from './members.mjs';

// congress-legislators-shaped records for the cast. Ralph Wolf shares the
// Coyote's state and must never be folded into him.
const person = (bioguide, name, terms, other_names) => ({ id: { bioguide }, name, terms, other_names });
const rep = (state, district, start, end) => ({ type: 'rep', state, district, start, end });
const PEOPLE = [
  person('C000001', { first: 'Wile', middle: 'E.', last: 'Coyote', official_full: 'Wile E. Coyote' }, [rep('AZ', 1, '2013-01-03', '2015-01-03'), rep('AZ', 1, '2015-01-03', '2017-01-03')]),
  person('W000001', { first: 'Ralph', last: 'Wolf', official_full: 'Ralph Wolf' }, [rep('AZ', 2, '2013-01-03', '2017-01-03')]),
  person('B000001', { first: 'Bugs', last: 'Bunny', official_full: 'Bugs Bunny' }, [rep('NY', 3, '2013-01-03', '2015-01-03')]),
  person('B000002', { first: 'Babs', last: 'Bunny', official_full: 'Babs Bunny' }, [rep('NY', 3, '2013-01-03', '2015-01-03')]),
  person('D000001', { first: 'Daffy', last: 'Duck', official_full: 'Daffy Duck' }, [rep('CA', 4, '2013-01-03', '2015-01-03')], [{ last: 'Mallard' }]),
  person('S000001', { first: 'Sam', last: 'Sheepdog' }, [{ type: 'sen', state: 'AZ', start: '2013-01-03', end: '2019-01-03' }]),
  person('S000002', { first: 'Sam', last: 'Sheepdog', suffix: 'Jr.' }, [rep('AZ', 3, '2023-01-03', '2025-01-03')]),
];
const ix = (Last, StateDst, filed, First = '') => ({ Last, First, StateDst, filed });
const match = houseMatcher(PEOPLE);

test('surname, seat and a term covering the filing date', () => {
  assert.deepEqual(match(ix('Coyote', 'AZ01', '2014-05-01')), { bioguide: 'C000001', how: 'term' });
});

test('the index Last may carry credentials or a second surname', () => {
  assert.equal(match(ix('Coyote MD, FACS', 'AZ01', '2014-05-01')).bioguide, 'C000001');
});

test('a former surname matches', () => {
  assert.equal(match(ix('Mallard', 'CA04', '2014-05-01')).bioguide, 'D000001');
});

test('a report filed after the term ended, within the grace period', () => {
  assert.deepEqual(match(ix('Coyote', 'AZ01', '2017-06-01')), { bioguide: 'C000001', how: 'after-term' });
  assert.equal(match(ix('Coyote', 'AZ01', '2019-01-01')).bioguide, null);
});

test('a stale district on the filing falls back to the state', () => {
  assert.deepEqual(match(ix('Coyote', 'AZ09', '2014-05-01')), { bioguide: 'C000001', how: 'state' });
});

test('the neighbor is never the Coyote, even filing under his seat', () => {
  assert.deepEqual(match(ix('Wolf', 'AZ01', '2014-05-01')), { bioguide: 'W000001', how: 'state' });
  assert.deepEqual(match(ix('Wolf', 'AZ02', '2014-05-01')), { bioguide: 'W000001', how: 'term' });
  assert.equal(match(ix('Coyote', 'AZ02', '2014-05-01')).how, 'state');
});

test('first name breaks a tie, and no first name leaves it ambiguous', () => {
  assert.deepEqual(match(ix('Bunny', 'NY03', '2014-05-01', 'Bugs')), { bioguide: 'B000001', how: 'term+first' });
  const m = match(ix('Bunny', 'NY03', '2014-05-01'));
  assert.equal(m.how, 'ambiguous');
  assert.deepEqual(m.candidates.sort(), ['B000001', 'B000002']);
});

test('display name: official_full, else first last suffix; sort is surname first', () => {
  assert.equal(displayName(PEOPLE[0]), 'Wile E. Coyote');
  assert.equal(displayName(PEOPLE[6]), 'Sam Sheepdog Jr.');
  assert.equal(sortName(PEOPLE[6]), 'Sheepdog, Sam Jr.');
});

test('two people with one display name each get their last seat', () => {
  const twin = person('S000003', { first: 'Sam', last: 'Sheepdog' }, [rep('MT', 0, '2013-01-03', '2015-01-03')]);
  const rows = memberRows([...PEOPLE, twin], ['S000001', 'S000003', 'C000001']);
  assert.deepEqual(rows.map((r) => r.member), ['Wile E. Coyote', 'Sam Sheepdog (AZ)', 'Sam Sheepdog (MT-00)']);
});

test('a bioguide missing from congress-legislators fails', () => {
  assert.throws(() => memberRows(PEOPLE, ['X999999']), /not in congress-legislators/);
});

test('a Senate term covers the date, or ended within the grace period', () => {
  const has = senateTerm(PEOPLE);
  assert.equal(has('S000001', '2015-06-01'), true);
  assert.equal(has('S000001', '2019-06-01'), true);
  assert.equal(has('S000001', '2021-01-01'), false);
  assert.equal(has('S000001', '2012-12-01'), false);
  assert.equal(has('C000001', '2015-06-01'), false, 'a House term is not a Senate term');
  assert.equal(has('X000001', '2015-06-01'), false);
});

// senateMatcher on the three senators Senate Stock Watcher filed under a
// namesake's ID, with each namesake present. Real records, trimmed from
// congress-legislators (CC0): these names are the trap, so the cast cannot
// stand in. Mark Udall shared the Senate with Tom Udall from 2009 to 2015.
const sen = (start, end) => ({ type: 'sen', state: 'XX', start, end });
const SENATE = [
  person('M000355', { first: 'Mitch', last: 'McConnell', official_full: 'Mitch McConnell' }, [sen('2015-01-06', '2021-01-03'), sen('2021-01-03', '2027-01-03')]),
  person('M000357', { first: 'William', middle: 'John', last: 'McConnell' }, [sen('1890-01-01', '1891-03-03')]),
  person('R000122', { first: 'John', middle: 'F.', nickname: 'Jack', last: 'Reed', official_full: 'Jack Reed' }, [sen('2009-01-06', '2015-01-03'), sen('2015-01-06', '2021-01-03'), sen('2021-01-03', '2027-01-03')]),
  person('R000120', { first: 'John', last: 'Reed' }, [rep('MA', 1, '1795-12-07', '1801-03-03')]),
  person('U000039', { first: 'Tom', middle: 'S.', last: 'Udall', official_full: 'Tom Udall' }, [sen('2009-01-06', '2015-01-03'), sen('2015-01-06', '2021-01-03')]),
  person('U000002', { first: 'Stewart', middle: 'Lee', last: 'Udall' }, [rep('AZ', 2, '1955-01-05', '1963-01-03')]),
  person('U000038', { first: 'Mark', middle: 'E.', last: 'Udall', official_full: 'Mark Udall' }, [sen('2009-01-06', '2015-01-03')]),
];
const smatch = senateMatcher(SENATE);

test('senateMatcher: the namesakes Senate Stock Watcher chose never match', () => {
  assert.deepEqual(smatch({ first: 'A. Mitchell', last: 'McConnell, Jr.', date: '2020-06-23' }), { bioguide: 'M000355', how: 'term' });
  assert.deepEqual(smatch({ first: 'John F', last: 'Reed', date: '2014-01-29' }), { bioguide: 'R000122', how: 'term' });
  assert.deepEqual(smatch({ first: 'Tom', last: 'Udall', date: '2019-04-18' }), { bioguide: 'U000039', how: 'term' });
});

test('senateMatcher: two Udalls in the Senate at once are told apart by first name', () => {
  assert.deepEqual(smatch({ first: 'TOM', last: 'UDALL', date: '2012-10-01' }), { bioguide: 'U000039', how: 'term+first' });
  assert.deepEqual(smatch({ first: 'Mark', last: 'Udall', date: '2012-10-01' }), { bioguide: 'U000038', how: 'term+first' });
  assert.equal(smatch({ first: 'Stewart', last: 'Udall', date: '2012-10-01' }).how, 'ambiguous');
});

test('senateMatcher: a report filed within the grace after leaving, and not after it', () => {
  assert.equal(smatch({ first: 'Tom', last: 'Udall', date: '2021-05-01' }).bioguide, 'U000039');
  assert.deepEqual(smatch({ first: 'Tom', last: 'Udall', date: '2023-01-01' }), { bioguide: null, how: 'none', candidates: [] });
  assert.equal(smatch({ first: 'Wile', last: 'Coyote', date: '2014-01-01' }).how, 'none');
});

test('senateDeparture: last Senate term end, null while serving', () => {
  const left = senateDeparture(SENATE, '2026-11-18');
  assert.equal(left('U000039'), '2021-01-03');
  assert.equal(left('M000355'), null);
  assert.equal(left('C000001'), null);
});
