// The office filter's matching rules (public/js/combobox.js): every word typed
// appears somewhere in the name, any case and spacing; Enter takes the exact
// name or the only match, never a guess among several.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchOptions, resolveTyped } from '../../public/js/combobox.js';

const names = [
  'HON. NANCY PELOSI',
  'HON. JOHN C. CARNEY  JR.',
  'HON. JOHN CARTER',
  'OFFICE OF THE SPEAKER',
  "FORMER SPEAKER'S STAFF",
];
const options = names.map((n) => ({ value: n, label: n, key: fold(n) }));
const values = (list) => list.map((o) => o.value);

test('an empty query matches everything', () => {
  assert.equal(matchOptions('  ', options), options);
});

test('a word matches anywhere in the name, in any case', () => {
  assert.deepEqual(values(matchOptions('pelosi', options)), ['HON. NANCY PELOSI']);
});

test('every word must match, in any order, spacing collapsed', () => {
  assert.deepEqual(values(matchOptions('carney john', options)), ['HON. JOHN C. CARNEY  JR.']);
  assert.deepEqual(values(matchOptions('john c. carney jr.', options)), ['HON. JOHN C. CARNEY  JR.']);
  assert.deepEqual(values(matchOptions('john', options)), ['HON. JOHN C. CARNEY  JR.', 'HON. JOHN CARTER']);
});

test('Enter takes the exact name even when it is part of another', () => {
  assert.equal(resolveTyped('office of the speaker', options).value, 'OFFICE OF THE SPEAKER');
});

test('Enter takes the only match', () => {
  assert.equal(resolveTyped('pelosi', options).value, 'HON. NANCY PELOSI');
});

test('Enter picks nothing among several matches or none', () => {
  assert.equal(resolveTyped('speaker', options), null);
  assert.equal(resolveTyped('hon', options), null);
  assert.equal(resolveTyped('zzz', options), null);
});
