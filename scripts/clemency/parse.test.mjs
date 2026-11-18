// The parser against fixtures trimmed from each DOJ layout (make-fixtures.mjs),
// names replaced by the fake cast. Each test names the quirk it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures.mjs';
import { build, parsePage, parseDate, headingCounts, textOf, bodyOf } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function files() {
  return Promise.all(FIXTURES.map(async ({ file, source }) => ({
    source,
    html: await readFile(resolve(HERE, 'fixtures', file), 'utf8'),
  })));
}
const rowsOf = (rows, prefix) => rows.filter((r) => r.page.startsWith(prefix));
const page = (inner) => `<html><body><div class="field_body">${inner}</div></body></html>`;
const SOURCE = { slug: 'test', url: 'https://www.justice.gov/pardon/test', president: 'gerald-ford', type: 'pardon', layout: 'dated-rows', term: '1974-1977' };

test('dates in every form DOJ prints', () => {
  assert.equal(parseDate('August 14, 1989'), '1989-08-14');
  assert.equal(parseDate('JUNE 3, 2016'), '2016-06-03');
  assert.equal(parseDate('Dec 22, 2000'), '2000-12-22');
  assert.equal(parseDate('4/17/1970'), '1970-04-17');
  assert.equal(parseDate('12/3/1981'), '1981-12-03');
  assert.equal(parseDate('Download PDF Clemency Warrant'), null);
});

test('Trump 2025 headings state their counts, with either dash', () => {
  assert.deepEqual(headingCounts('May 28, 2025 - 16 Pardons and 6 Commutations'), { date: '2025-05-28', counts: { pardon: 16, commutation: 6 } });
  assert.deepEqual(headingCounts('February 12, 2026 – 7 Pardons'), { date: '2026-02-12', counts: { pardon: 7, commutation: 0 } });
  assert.deepEqual(headingCounts('October 1, 2025 - 1 Commutation (Amended)'), { date: '2025-10-01', counts: { pardon: 0, commutation: 1 } });
  assert.equal(headingCounts('January 20, 2025'), null);
});

test('a multi-part cell keeps its parts on separate lines', () => {
  const cell = bodyOf(page('<p>1.&nbsp;Eastern District of Texas</p><p>2.&nbsp; Middle District</p>'));
  assert.equal(textOf(cell), '1. Eastern District of Texas\n2. Middle District');
});

test('every fixture parses to its entries', async () => {
  const { rows } = build(await files());
  assert.deepEqual(
    FIXTURES.map(({ source }) => rows.filter((r) => r.page === source.slug).length),
    [5, 7, 9, 18, 7, 13, 2, 3],
  );
  for (const r of rows) assert.ok(r.grant_date && r.name && r.president_name && r.grant_year, r.id);
});

test('dated rows: a <td><h2> header, and two identical rows both kept', async () => {
  const rows = rowsOf(build(await files()).rows, 'pardons-granted-president-jimmy-carter');
  assert.equal(rows[0].name, 'Coyote, Wile E.');
  assert.equal(rows[0].grant_date, '1977-11-01');
  const [a, b] = rows.slice(3);
  assert.deepEqual({ ...a, id: 0, position: 0, source_ref: 0 }, { ...b, id: 0, position: 0, source_ref: 0 });
  assert.notEqual(a.id, b.id);
});

test('dated rows: a colspan name cell leaves district empty', () => {
  const html = page('<table><tr><th>Date</th><th>Name</th><th>District</th></tr><tr><td>9/8/1974</td><td colspan="2">Coyote, Wile E.</td></tr><tr><td>10/9/1974</td><td>Runner, Road</td><td>D.C.</td></tr></table>');
  const { entries } = parsePage(html, SOURCE);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'Coyote, Wile E.');
  assert.equal(entries[0].district, null);
  assert.equal(entries[1].district, 'D.C.');
});

test('headed tables: rowspan continuation rows join their entry', async () => {
  const rows = rowsOf(build(await files()).rows, 'pardons-granted-president-william-j-clinton');
  const e = rows[6];
  assert.equal(e.district, '1. U. S. Air Force summary court-martial\n2. U. S. Air Force general court-martial');
  assert.equal(e.sentence, '1. 1951\n2. 1959');
  assert.match(e.offense, /^1\. Absent without leave\n2\. Larceny/);
});

test('headed tables: no per-row warrant falls back to the heading\'s download link', async () => {
  const rows = rowsOf(build(await files()).rows, 'commutations-granted-president-joseph-biden');
  const dec23 = rows.filter((r) => r.grant_date === '2024-12-23');
  assert.equal(dec23.length, 2);
  for (const r of dec23) assert.equal(r.warrant_label, 'Download Clemency Warrant (PDF)');
});

test('a * footnote marks only the starred entry', async () => {
  const rows = rowsOf(build(await files()).rows, 'commutations-granted-president-joseph-biden');
  const starred = rows.filter((r) => r.note);
  assert.equal(starred.length, 1);
  assert.equal(starred[0].name, 'Daffy Duck*');
  assert.match(starred[0].note, /^\* This clemency grant supersedes/);
});

test('group rows are not entries; their links keep a * that sits outside the anchor', async () => {
  const { rows, groups } = build(await files());
  assert.equal(rows.filter((r) => /individuals/.test(r.name)).length, 0);
  assert.equal(groups.length, 2);
  const w2 = groups[1].links.find((l) => l.text === 'Warrant 2*');
  assert.match(w2.note, /^\*Explanatory note: Warrant 2/);
});

test('label blocks: unbolded names, aliases, a starred name suffix', async () => {
  const rows = rowsOf(build(await files()).rows, 'commutations-granted-president-barack');
  assert.equal(rows[4].name, 'Marvin Q. Acme, aka Ralph Wolf');
  assert.equal(rows[11].name, 'Sam Sheepdog *(condition declined, commutation not effectuated)');
  assert.match(rows[0].terms, /^Prison sentence commuted/);
});

test('label blocks: a label printed in the value column still takes the rows below it', async () => {
  const rows = rowsOf(build(await files()).rows, 'commutations-granted-president-barack');
  assert.equal(rows[7].district, '2. Eastern District of Louisiana; April 28, 2010');
  assert.match(rows[7].offense, /\n2\. Wire fraud$/);
  assert.equal(rows[8].district, '2. District of New Mexico; August 7, 2006');
});

test('label blocks: a date row inside a table opens a section with its own warrant', async () => {
  const rows = rowsOf(build(await files()).rows, 'commutations-granted-president-barack');
  const dec2014 = rows.filter((r) => r.grant_date === '2014-12-17');
  assert.equal(dec2014.length, 2);
  for (const r of dec2014) assert.equal(r.warrant_url, 'https://www.justice.gov/pardon/file/993756');
});

test('label blocks: one table per entry, counted per section', async () => {
  const rows = rowsOf(build(await files()).rows, 'commutations-granted-president-barack');
  assert.equal(rows.filter((r) => r.grant_date === '2015-07-13').length, 3);
});

test('mixed page: th-colspan names, a second Offense row, a heading inside a div', async () => {
  const rows = rowsOf(build(await files()).rows, 'pardons-granted-president-barack');
  assert.equal(rows[2].offense.split('\n').length, 2);
  assert.deepEqual(rows.filter((r) => r.grant_date === '2016-01-16').map((r) => r.district), ['Southern District of Texas', 'Southern District of Texas']);
  assert.equal(rows.filter((r) => r.grant_date === '2015-12-18').length, 2);
});

test('Trump 2025: title-only grants, and types read off each warrant', async () => {
  const rows = rowsOf(build(await files()).rows, 'clemency-grants');
  const titles = rows.filter((r) => r.kind === 'title');
  assert.deepEqual(titles.map((r) => [r.grant_date, r.type]), [['2025-01-20', null], ['2025-11-07', null]]);
  assert.match(titles[0].warrant_url, /^https:\/\/www\.whitehouse\.gov\//);
  const may28 = rows.filter((r) => r.grant_date === '2025-05-28').map((r) => r.type);
  assert.deepEqual(may28, ['pardon', 'pardon', 'commutation', 'commutation']);
  const sep3 = rows.filter((r) => r.grant_date === '2026-09-03').map((r) => r.type);
  assert.deepEqual(sep3, ['pardon', 'pardon', 'commutation']);
});

test('group detail pages join their group row: date, description, warrant by label', async () => {
  const rows = build(await files()).rows;
  const dec = rowsOf(rows, 'december-12');
  for (const r of dec) {
    assert.equal(r.grant_date, '2024-12-12');
    assert.equal(r.group_description, 'Commutation granted to 2 individuals');
    assert.equal(r.warrant_url, 'https://www.justice.gov/pardon/media/1380216/dl?inline');
  }
  const jan = rowsOf(rows, 'january-17');
  const byLabel = Object.fromEntries(jan.map((r) => [r.warrant_label, r]));
  assert.equal(byLabel['Warrant 1'].warrant_url, 'https://www.justice.gov/pardon/media/1385596/dl?inline');
  assert.equal(byLabel['Warrant 3'].warrant_url, 'https://www.justice.gov/pardon/media/1385601/dl?inline');
  assert.match(byLabel['Warrant 2'].note, /^\*The offenses listed are for informational purposes only.*\n\*Explanatory note: Warrant 2/s);
  assert.doesNotMatch(byLabel['Warrant 1'].note, /Explanatory/);
});

test('an fr-links pair lands on its one entry, and a pair that names none throws', async () => {
  const link = { entry: { page: 'clemency-grants-president-donald-j-trump-2025-present', grant_date: '2025-11-07', name: 'Granting Pardons for Certain Offenses Related to the 2020 Presidential Election' }, fr: { document_number: '2025-19928' } };
  const { rows } = build(await files(), [link]);
  assert.deepEqual(rows.filter((r) => r.fr_document_number).map((r) => r.grant_date), ['2025-11-07']);
  const bad = { ...link, entry: { ...link.entry, name: 'Nobody' } };
  await assert.rejects(async () => build(await files(), [bad]), /matches 0 entries/);
});

test('an unknown table or block label stops the parse', () => {
  assert.throws(() => parsePage(page('<h2>May 1, 2001</h2><table><tr><th>COLOR</th><th>NAME</th></tr></table>'), SOURCE), /unrecognized table/);
  const blocks = page('<h2>May 1, 2001</h2><table><tr><td>&nbsp;</td><td>Wile E. Coyote</td></tr><tr><td>Offense:</td><td>x</td></tr><tr><td>Mood:</td><td>y</td></tr></table>');
  assert.throws(() => parsePage(blocks, { ...SOURCE, layout: 'blocks' }), /unrecognized table|unknown block label/);
});
