import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRows, documentNumberFromApiUrl, documentNumberFromUrl, frDocuments,
  irregularities, normalizeNotes, parseNotes, renderNotes,
} from './parse.mjs';
import { parseRelease } from '../corpus/parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Notes as FR publishes them, each a shape the survey found.
const NOTES = {
  single: 'Revoked by: EO 13062, September 29, 1997',
  oneLine: 'See: EO 13807, August 15, 2017; Revoked by: EO 13990, January 20, 2021',
  crlf: 'Amended by: EO 12973, September 27, 1995\r\nRevoked by: EO 13062, September 29, 1997',
  junk: 'Revoked by: EO 13204, February 17, 2001;;\n ;  See: Final Rule of May 16, 1997 (62 FR 28176)',
  doubleSpace: 'See:  EO 12250, November 2, 1980',
  noLabel: 'Amends: EO 12878, November 5, 1993\r\nSee EO 12974, September 29, 1995',
  noSemicolon: 'Continued by: Notice of August 14, 2002 Notice of August 7, 2003',
  twoInOne: 'See: EO 13284, January 23, 2003 EO 13372, February 16, 2005',
  inPart: 'Amended by: EO 13188, January 12, 2001; EEO 13218, June 20, 2001 \nRevoked (in part) by: EO 13316, September 17, 2003',
  ofDate: 'Supersedes: EO 12826 of December 30, 1992; EO 12886 of December 13, 1993; Superseded by: EO 12984 of December 28, 1995; Executive Order 12945;  Amendment to Executive Order No. 12640',
  noComma: 'Note: EO 12345 is nullified by virtue of the Council being abolished by EO 13138, September 30, 1999.',
  proc: 'Amends: Proc. 6867, March 1, 1996',
  typo: 'Suspersedes: EO 12345, January 1, 1996',
  bareNumber: 'Amends: 12864, September 15, 1993\r\nRevoked by: EO 13062, September 29, 1997',
  eff: 'Amends: EO 13286, February 28, 2003; Revoked by: EO 13286, February 28, 2003 eff. March 31, 2003',
  noSpace: 'Amends: EO 13038, March 11, 1997\nSee:EO 13062, September 29, 1997',
};

test('document numbers come from the URL, suffix included', () => {
  assert.equal(documentNumberFromUrl('https://www.federalregister.gov/documents/1997/10/06/97-26440-2/national-disability'), '97-26440-2');
  assert.equal(documentNumberFromUrl('https://www.federalregister.gov/documents/1994/01/05/94-290/amendment'), '94-290');
  assert.equal(documentNumberFromUrl('https://example.com/documents/1994/01/05/94-290/x'), null);
  assert.equal(documentNumberFromApiUrl('https://www.federalregister.gov/api/v1/documents/2010-27668'), '2010-27668');
  assert.equal(documentNumberFromApiUrl(null), null);
});

test('a single relation: label as printed, EO number and date marked', () => {
  assert.deepEqual(parseNotes(NOTES.single), [
    { relation: 'Revoked by', refs: [{ kind: 'eo', number: '13062', date: '1997-09-29', text: 'EO 13062, September 29, 1997' }] },
  ]);
});

test('relations split on line breaks and on a label after a semicolon', () => {
  assert.deepEqual(parseNotes(NOTES.oneLine).map((r) => r.relation), ['See', 'Revoked by']);
  assert.deepEqual(parseNotes(NOTES.crlf).map((r) => r.relation), ['Amended by', 'Revoked by']);
});

test('stray semicolons and spaces leave no empty references', () => {
  const junk = parseNotes(NOTES.junk);
  assert.deepEqual(junk.map((r) => [r.relation, r.refs.length]), [['Revoked by', 1], ['See', 1]]);
  assert.equal(junk[1].refs[0].kind, 'text');
  assert.equal(parseNotes(NOTES.doubleSpace)[0].refs[0].text, 'EO 12250, November 2, 1980');
});

test('labels keep parentheses, typos and case exactly as printed', () => {
  assert.deepEqual(parseNotes(NOTES.inPart).map((r) => r.relation), ['Amended by', 'Revoked (in part) by']);
  assert.equal(parseNotes(NOTES.typo)[0].relation, 'Suspersedes');
});

test('dates written "of" or without a comma, and proclamations', () => {
  const sup = parseNotes(NOTES.ofDate);
  assert.deepEqual(sup[0].refs.map((x) => [x.number, x.date]), [['12826', '1992-12-30'], ['12886', '1993-12-13']]);
  assert.deepEqual(sup[1].refs.map((x) => [x.kind, x.number]), [['eo', '12984'], ['eo', '12945'], ['text', null]]);
  assert.deepEqual(parseNotes('See: EO 13138 September 30, 1999')[0].refs[0].date, '1999-09-30');
  assert.deepEqual(parseNotes(NOTES.proc)[0].refs[0], { kind: 'proclamation', number: '6867', date: '1996-03-01', text: 'Proc. 6867, March 1, 1996' });
});

test('only a reference that opens with EO or Proc. is marked; the rest stay text', () => {
  const amended = parseNotes(NOTES.inPart)[0].refs;
  assert.deepEqual(amended.map((x) => x.kind), ['eo', 'text']); // "EEO 13218" is FR's typo, left alone
  assert.equal(parseNotes(NOTES.bareNumber)[0].refs[0].kind, 'text');
  assert.equal(parseNotes(NOTES.noComma)[0].relation, 'Note');
  // A free-text note that opens with an order's number is marked by it; no date follows.
  assert.deepEqual(parseNotes(NOTES.noComma)[0].refs[0].number, '12345');
  assert.equal(parseNotes(NOTES.noComma)[0].refs[0].date, null);
  assert.equal(parseNotes(NOTES.eff)[1].refs[0].date, '2003-02-28');
});

test('what the parser cannot place is kept and reported', () => {
  const noLabel = parseNotes(NOTES.noLabel);
  assert.deepEqual(noLabel.map((r) => r.relation), ['Amends', null]);
  assert.deepEqual(irregularities(noLabel), ['no label: See EO 12974, September 29, 1995']);
  assert.deepEqual(irregularities(parseNotes(NOTES.twoInOne)), []); // both orders get linked (MENTION)
  assert.deepEqual(irregularities(parseNotes(NOTES.single)), []);
  assert.deepEqual(irregularities(parseNotes(NOTES.noSemicolon)), []); // text references are not judged
});

test('every note puts back together as FR printed it', () => {
  for (const [name, note] of Object.entries(NOTES)) {
    assert.equal(normalizeNotes(renderNotes(parseNotes(note))), normalizeNotes(note), name);
  }
});

test('the comparison notices a dropped or changed reference', () => {
  const parsed = parseNotes(NOTES.oneLine);
  parsed[1].refs = [];
  assert.notEqual(normalizeNotes(renderNotes(parsed)), normalizeNotes(NOTES.oneLine));
  const changed = parseNotes(NOTES.single);
  changed[0].refs[0].text = 'EO 13063, September 29, 1997';
  assert.notEqual(normalizeNotes(renderNotes(changed)), normalizeNotes(NOTES.single));
  const relabeled = parseNotes(NOTES.single);
  relabeled[0].relation = 'Revoked';
  assert.notEqual(normalizeNotes(renderNotes(relabeled)), normalizeNotes(NOTES.single));
});

// ---- Join, on fixtures: the corpus fixture release (two executive records
// among eight others) and a trimmed FR listing.

async function fixtures() {
  const records = parseRelease(await readFile(resolve(HERE, '../corpus/fixtures/release.jsonl'), 'utf8'));
  const page = JSON.parse(await readFile(resolve(HERE, 'fixtures/fr-page.json'), 'utf8'));
  return { records, docs: frDocuments([{ type: 'executive_order', json: page.executive_order }, { type: 'proclamation', json: page.proclamation }]) };
}

test('the join: one row per executive record, FR values over the release', async () => {
  const { records, docs } = await fixtures();
  const { rows, unjoined, frOnly, conflicts } = buildRows(records, docs);
  assert.equal(rows.length, 2);
  assert.deepEqual(unjoined, []);
  assert.deepEqual(conflicts, []);
  assert.ok(frOnly.length >= 1);
  const eo = rows.find((r) => r.document_number === '2021-01767');
  assert.equal(eo.number, '13992');
  assert.equal(eo.signing_date, '2021-01-20');
  assert.equal(eo.publication_date, '2021-01-25');
  assert.equal(eo.president, 'joe-biden');
  assert.equal(eo.president_name, 'Joe Biden');
  assert.ok(eo.notes_parsed.some((r) => r.refs.some((x) => x.kind === 'eo' && x.number === '13771')));
  assert.ok(eo.text.startsWith('Executive Order 13992'));
});

test('a document FR lists twice, or a notes conflict, is refused', async () => {
  const { records, docs } = await fixtures();
  assert.throws(() => frDocuments([{ type: 'executive_order', json: { results: [docs[0], docs[0]] } }]), /twice/);
  const changed = docs.map((d) => (d.document_number === '2021-01767' ? { ...d, executive_order_notes: 'Revokes: EO 1' } : d));
  assert.match(buildRows(records, changed).conflicts.join('\n'), /differ/);
  const relisted = docs.map((d) => (d.document_number === '94-290' ? { ...d, listing: 'proclamation' } : d));
  assert.match(buildRows(records, relisted).conflicts.join('\n'), /lists it as proclamation/);
});

test('a record FR does not list is named, not dropped', async () => {
  const { records, docs } = await fixtures();
  const { rows, unjoined } = buildRows(records, docs.filter((d) => d.document_number !== '94-290'));
  assert.equal(rows.length, 1);
  assert.deepEqual(unjoined.map((u) => u.id), [records.find((r) => r.fr_doc === '94-290').id]);
});
