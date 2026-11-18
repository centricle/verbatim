// A check that has never failed is not known to work. Each test plants one
// defect in an otherwise perfect load of the fixtures and expects check to
// name it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures.mjs';
import { build } from './parse.mjs';
import { compare, rawCount, slugOf } from './check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRUMP = 'clemency-grants-president-donald-j-trump-2025-present';

// The fixture's stand-ins for the three real pairs: two title-only grants as
// DOJ titles them, and the cast member in the Buyer row's place.
const FR_LINKS = [
  {
    entry: { page: TRUMP, grant_date: '2025-01-20', name: 'Granting Pardons and Commutations of Sentences for Certain Offenses Relating to the Events at or near the United States Capitol on January 6, 2021' },
    fr: { document_number: '2025-01950', title: 'Granting Pardons and Commutation of Sentences for Certain Offenses Relating to the Events at or Near the United States Capitol on January 6, 2021' },
    basis: 'slug',
  },
  {
    entry: { page: TRUMP, grant_date: '2025-11-07', name: 'Granting Pardons for Certain Offenses Related to the 2020 Presidential Election' },
    fr: { document_number: '2025-19928', title: 'Granting Pardons for Certain Offenses Related to the 2020 Presidential Election' },
    basis: 'title',
  },
  {
    entry: { page: TRUMP, grant_date: '2026-06-04', name: 'Road Runner' },
    fr: { document_number: 'fixture-1', title: 'Granting Pardon to Road Runner' },
    basis: 'slug',
  },
];

async function setup() {
  const files = await Promise.all(FIXTURES.map(async ({ file, source }) => ({
    source,
    html: await readFile(resolve(HERE, 'fixtures', file), 'utf8'),
  })));
  const { rows, pages, groups } = build(files, FR_LINKS);
  const raw = files.map(({ source, html }) => ({ page: source.slug, count: rawCount(html) }));
  // A perfect load, as Postgres returns it: dates as Date objects.
  const loaded = rows.map((r) => ({ ...r, grant_date: new Date(`${r.grant_date}T00:00:00Z`) }));
  const frDocs = FR_LINKS.map((l) => ({ ...l.fr }));
  return { raw, pages, groups, expected: rows, loaded, frLinks: FR_LINKS, frDocs };
}

const fails = (input, re) => {
  const failures = compare(input);
  assert.ok(failures.some((f) => re.test(f)), `expected ${re}, got:\n${failures.join('\n') || '(nothing)'}`);
};

test('a perfect load passes', async () => {
  assert.deepEqual(compare(await setup()), []);
});

test('the raw scan counts entries without the HTML parser', async () => {
  const { raw } = await setup();
  assert.deepEqual(raw.map((r) => r.count), [5, 7, 9, 18, 7, 13, 2, 3]);
});

test('the White House slug rule', () => {
  assert.equal(slugOf('Granting Pardon to Stephen E. Buyer'), 'granting-pardon-to-stephen-e-buyer');
});

test('a dropped row fails', async () => {
  const input = await setup();
  input.loaded = input.loaded.slice(1);
  fails(input, /^loaded 63 rows; parsed 64/);
  fails(input, /^not loaded \(1\)/);
});

test('a row loaded twice fails', async () => {
  const input = await setup();
  input.loaded.push({ ...input.loaded[0] });
  fails(input, /^loaded twice: /);
});

test('a corrupted field fails and names the column', async () => {
  const input = await setup();
  input.loaded[9] = { ...input.loaded[9], offense: `${input.loaded[9].offense}x` };
  fails(input, /^offense differs in 1 rows/);
});

test('a shifted grant date fails', async () => {
  const input = await setup();
  input.loaded[2] = { ...input.loaded[2], grant_date: new Date('1999-12-01T00:00:00Z') };
  fails(input, /^grant_date differs in 1 rows/);
});

test('an entry the parser missed fails against the raw scan', async () => {
  const input = await setup();
  const p = input.pages.find((x) => x.source.slug.startsWith('pardons-granted-president-jimmy-carter'));
  p.entries = p.entries.slice(1);
  fails(input, /jimmy-carter-1977-1981: raw scan counts 5 entries, parser 4/);
});

test('a type that disagrees with its heading fails', async () => {
  const input = await setup();
  const h = input.pages.find((x) => x.source.slug === TRUMP).headings.find((x) => x.date === '2025-05-28');
  h.entries[0].type = 'commutation';
  fails(input, /"May 28, 2025 - 2 Pardons and 2 Commutations": states 2 pardons and 2 commutations, parsed 1 and 3/);
});

test('a group detail page short of its stated count fails', async () => {
  const input = await setup();
  input.groups[1] = { ...input.groups[1], description: 'Commutation granted to 4 individuals' };
  fails(input, /^group "Commutation granted to 4 individuals": 3 rows/);
});

test('an FR document missing from the table fails', async () => {
  const input = await setup();
  input.frDocs = input.frDocs.slice(1);
  fails(input, /^fr-links 2025-01950: not in fr_presidential_documents/);
});

test('an FR pair whose basis does not hold fails', async () => {
  const input = await setup();
  input.frLinks = input.frLinks.map((l, i) => (i === 0 ? { ...l, basis: 'title' } : l));
  fails(input, /^fr-links 2025-01950: basis "title" does not hold/);
});

test('an FR title that changed under the map fails', async () => {
  const input = await setup();
  input.frDocs[1] = { ...input.frDocs[1], title: 'Something else' };
  fails(input, /^fr-links 2025-19928: FR title is "Something else"/);
});

test('an FR number on a row the map does not name fails', async () => {
  const input = await setup();
  input.expected[0] = { ...input.expected[0], fr_document_number: 'stray' };
  fails(input, /^4 rows carry an FR document number; fr-links.json has 3/);
});
