import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseMatcher, memberRows, displayName, sortName } from './members.mjs';

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
