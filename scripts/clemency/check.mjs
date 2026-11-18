// The comparison behind `cli.mjs check`, kept pure so planted defects can be
// tested without a database (check.test.mjs).
//
// Three views of the same data have to agree:
//
// 1. Raw: a count of each page's entries that does not use the HTML parser.
//    Regular expressions split the page into tables and rows and classify
//    each table by its first row: a header naming a column counts its
//    non-empty rows, less the continuation rows a rowspan implies; a
//    two-column label table counts its `Offense:` labels, which every block
//    entry has; a DESCRIPTION table counts nothing (its recipients are on
//    the detail page); a one-row `*` table is a footnote. A Trump 2025
//    heading that is a bare date counts one entry, the linked title under
//    it.
// 2. Parsed: parse.mjs over the same pages.
// 3. Loaded: every row of the table, every column the loader writes.
//
// The invariants, besides raw = parsed = loaded per page:
// - every Trump 2025 heading's stated counts ("16 Pardons and 6
//   Commutations") equal the parsed rows under it, by type;
// - each group detail page has as many rows as its group row states
//   ("granted to 1,499 individuals");
// - every fr-links.json pair holds on its stated basis, names exactly one
//   entry, and names a document present in fr_presidential_documents.

export const COLUMNS = [
  'id', 'page', 'position', 'president', 'president_name', 'term', 'type', 'kind',
  'grant_date', 'grant_year', 'heading', 'name', 'district', 'sentence', 'offense',
  'terms', 'sentence_began', 'commuted_to', 'warrant_url', 'warrant_label',
  'group_description', 'note', 'fr_document_number', 'source_ref',
];

const strip = (s) => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;| /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const BARE_DATE = /^[A-Za-z]+ \d{1,2}, \d{4}$/;
const DATE_START = /^[A-Za-z]+\.? \d{1,2}, \d{4}/;
const BLOCK_LABEL = /^(offenses?|district\/date|district|sentence|terms of grant)\s*:$/i;
const HEADER_WORDS = '(date|name|name and warrant|district|sentenced|sentence|offense\\*?|offense as listed on the warrant|public disclosure|date sentence began|sentence commuted to|warrant)';
const HEADER_ROW = new RegExp(`^${HEADER_WORDS}( ${HEADER_WORDS})+$`);

/** Entries on one page, counted without the HTML parser. */
export function rawCount(html) {
  const start = html.indexOf('field_body');
  if (start < 0) throw new Error('no field_body');
  const body = html.slice(start);
  let count = 0;
  for (const [table] of body.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    if (!rows.length) continue;
    const head = strip(rows[0]).toLowerCase();
    if (/^description\b/.test(head)) continue;
    if (rows.length === 1 && strip(rows[0]).startsWith('*')) continue;
    // A header row is the column names alone: `<th>` cells, or `<td><h2>`
    // on the Word-pasted Carter page.
    if (HEADER_ROW.test(head)) {
      const data = rows.slice(1).filter((r) => strip(r));
      // A row whose cells span N rows has N - 1 continuation rows below it,
      // however many of its cells carry the rowspan.
      const continued = data.reduce((n, r) => {
        const spans = [...r.matchAll(/rowspan\s*=\s*"?(\d+)/gi)].map((m) => Number(m[1]));
        return n + (spans.length ? Math.max(...spans) - 1 : 0);
      }, 0);
      count += data.length - continued;
      continue;
    }
    // Label blocks: count name rows. A name is a one-cell row that is not a
    // date, or a two-cell row with an empty first cell whose second is
    // neither a numbered part ("2. ...") nor a label. Counting labels would
    // overcount: some entries carry two Offense rows.
    for (const r of rows) {
      const cells = [...r.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => strip(m[1]));
      if (cells.length === 1 && cells[0] && !DATE_START.test(cells[0])) count += 1;
      if (cells.length === 2 && !cells[0] && cells[1] && !/^\d+\.\s*\S/.test(cells[1]) && !BLOCK_LABEL.test(cells[1])) count += 1;
    }
  }
  for (const [, h3] of body.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    if (BARE_DATE.test(strip(h3))) count += 1;
  }
  return count;
}

/** The URL slug of a title, as the White House builds them. */
export const slugOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function norm(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? null;
}

/**
 * @param {object} input
 * @param {{ page: string, count: number }[]} input.raw          rawCount per page
 * @param {{ source: object, entries: object[], headings: object[] }[]} input.pages  build().pages
 * @param {object[]} input.groups     build().groups
 * @param {object[]} input.expected   build().rows
 * @param {object[]} input.loaded     every row of the table
 * @param {object[]} input.frLinks    fr-links.json `links`
 * @param {{ document_number: string, title: string }[]} input.frDocs  fr_presidential_documents rows named by frLinks
 * @returns {string[]} failures; empty means the check passed
 */
export function compare({ raw, pages, groups, expected, loaded, frLinks, frDocs }) {
  const failures = [];
  const fail = (msg) => failures.push(msg);

  // 1 vs 2, per page.
  for (const { page, count } of raw) {
    const p = pages.find((x) => x.source.slug === page);
    if (!p) { fail(`${page}: in raw scan, not parsed`); continue; }
    if (p.entries.length !== count) fail(`${page}: raw scan counts ${count} entries, parser ${p.entries.length}`);
  }
  for (const p of pages) {
    if (!raw.some((r) => r.page === p.source.slug)) fail(`${p.source.slug}: parsed, not in raw scan`);
  }

  // Trump 2025 headings state their own counts.
  for (const p of pages) {
    for (const h of p.headings) {
      const got = { pardon: 0, commutation: 0 };
      for (const e of h.entries) got[e.type] = (got[e.type] ?? 0) + 1;
      if (got.pardon !== h.counts.pardon || got.commutation !== h.counts.commutation) {
        fail(`"${h.heading}": states ${h.counts.pardon} pardons and ${h.counts.commutation} commutations, parsed ${got.pardon} and ${got.commutation}`);
      }
    }
  }

  // Group detail pages hold the number their group row states.
  for (const g of groups) {
    const stated = /granted to ([\d,]+) individuals/i.exec(g.description);
    if (!stated) { fail(`group "${g.description}": no stated count`); continue; }
    const detail = g.links.find((l) => /recipient details/i.test(l.text));
    const slug = detail && new URL(detail.href).pathname.split('/').pop();
    const n = expected.filter((r) => r.page === slug).length;
    if (n !== Number(stated[1].replace(/,/g, ''))) fail(`group "${g.description}": ${n} rows`);
  }

  // Federal Register links.
  for (const link of frLinks) {
    const hits = expected.filter((r) => r.page === link.entry.page && r.grant_date === link.entry.grant_date && r.name === link.entry.name);
    if (hits.length !== 1) { fail(`fr-links ${link.fr.document_number}: names ${hits.length} entries`); continue; }
    const doc = frDocs.find((d) => d.document_number === link.fr.document_number);
    if (!doc) { fail(`fr-links ${link.fr.document_number}: not in fr_presidential_documents`); continue; }
    if (doc.title !== link.fr.title) fail(`fr-links ${link.fr.document_number}: FR title is "${doc.title}", map says "${link.fr.title}"`);
    const entry = hits[0];
    const holds = link.basis === 'title'
      ? entry.name.toLowerCase() === doc.title.toLowerCase()
      : link.basis === 'slug'
        ? /^https:\/\/www\.whitehouse\.gov\/presidential-actions\/\d{4}\/\d{2}\/([^/]+)\/?$/.exec(entry.warrant_url ?? '')?.[1] === slugOf(doc.title)
        : false;
    if (!holds) fail(`fr-links ${link.fr.document_number}: basis "${link.basis}" does not hold for "${entry.name}"`);
    if (entry.fr_document_number !== link.fr.document_number) fail(`fr-links ${link.fr.document_number}: not on its entry`);
  }
  const linked = expected.filter((r) => r.fr_document_number).length;
  if (linked !== frLinks.length) fail(`${linked} rows carry an FR document number; fr-links.json has ${frLinks.length}`);

  // Rows every column needs.
  for (const r of expected) {
    if (!r.grant_date) fail(`${r.id}: no grant date`);
    if (r.kind === 'entry' && !['pardon', 'commutation'].includes(r.type)) fail(`${r.id}: type "${r.type}"`);
    if (!r.name) fail(`${r.id}: no name`);
  }

  // 2 vs 3: same ids, no duplicates, every column equal.
  const loadedById = new Map();
  for (const row of loaded) {
    if (loadedById.has(row.id)) fail(`loaded twice: ${row.id}`);
    loadedById.set(row.id, row);
  }
  if (loaded.length !== expected.length) fail(`loaded ${loaded.length} rows; parsed ${expected.length}`);
  const expectedIds = new Set(expected.map((r) => r.id));
  const missing = expected.filter((r) => !loadedById.has(r.id)).map((r) => r.id);
  const extra = [...loadedById.keys()].filter((id) => !expectedIds.has(id));
  if (missing.length) fail(`not loaded (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) fail(`loaded but not in source (${extra.length}): ${extra.slice(0, 5).join(', ')}`);

  const diffs = new Map();
  for (const want of expected) {
    const got = loadedById.get(want.id);
    if (!got) continue;
    for (const col of COLUMNS) {
      if (norm(got[col]) !== norm(want[col])) {
        if (!diffs.has(col)) diffs.set(col, []);
        diffs.get(col).push(want.id);
      }
    }
  }
  for (const [col, ids] of diffs) fail(`${col} differs in ${ids.length} rows: ${ids.slice(0, 5).join(', ')}`);

  return failures;
}
