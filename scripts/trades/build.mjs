// Everything the three tables should hold, built from the raw copies alone:
// load writes it, check holds the database to it. Nothing here fetches.
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { house, senate, legislators, FIRST_INDEX_YEAR, lastIndexYear } from './sources.mjs';
import { readIndexZip, extract, houseFiling } from './house.mjs';
import { houseMatcher, memberRows, senateTerm } from './members.mjs';
import { resolveSenate, senateFilings } from './senate.mjs';
import { linkAmendments } from './amendments.mjs';

const { house: OVERRIDES, senate: SENATE_PINS } = JSON.parse(readFileSync(new URL('./overrides.json', import.meta.url), 'utf8'));

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function readPeople() {
  const lists = await Promise.all(legislators.map(async (l) => JSON.parse(await readFile(l.path, 'utf8'))));
  return lists.flat();
}

export function readHouseIndex(years = range(FIRST_INDEX_YEAR, lastIndexYear())) {
  const rows = [];
  for (const y of years) {
    const zip = house.indexZip(y);
    if (!existsSync(zip)) throw new Error(`missing ${zip} (run: npm run trades -- index)`);
    rows.push(...readIndexZip(zip, house.indexEntry(y)));
  }
  return rows;
}

export async function readSenate() {
  const buf = await readFile(senate.path);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== senate.sha256) throw new Error(`${senate.path}: sha256 ${sha}, expected ${senate.sha256}`);
  return JSON.parse(buf.toString('utf8'));
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Each House index row to a bioguide: overrides first, then the rule.
export function resolveHouse(index, people) {
  const match = houseMatcher(people);
  const resolved = [], excluded = [], unmatched = [];
  const how = {};
  for (const ix of index) {
    const o = OVERRIDES[ix.DocID];
    if (o?.exclude) { excluded.push({ ix, why: o.exclude }); continue; }
    const m = o?.bioguide ? { bioguide: o.bioguide, how: 'override' } : match(ix);
    if (!m.bioguide) { unmatched.push({ ix, ...m }); continue; }
    how[m.how] = (how[m.how] ?? 0) + 1;
    resolved.push({ ix, bioguide: m.bioguide });
  }
  return { resolved, excluded, unmatched, how };
}

export async function build({ onProgress } = {}) {
  const people = await readPeople();
  const index = readHouseIndex();
  const docIds = new Map();
  for (const ix of index) {
    if (docIds.has(ix.DocID)) throw new Error(`DocID ${ix.DocID} is in the ${docIds.get(ix.DocID)} and ${ix.Year} indexes`);
    docIds.set(ix.DocID, ix.Year);
  }
  const { resolved, excluded, unmatched, how } = resolveHouse(index, people);
  if (unmatched.length) {
    const list = unmatched.map(({ ix, how: h, candidates }) => `${ix.Year} ${ix.DocID} ${ix.Last} ${ix.StateDst} ${ix.filed} ${h}${candidates ? ` ${candidates}` : ''}`);
    throw new Error(`${unmatched.length} House filings match no Member; pin or exclude each in overrides.json:\n  ${list.join('\n  ')}`);
  }

  const senateResolved = resolveSenate(await readSenate(), senateTerm(people), SENATE_PINS);
  if (senateResolved.failures.length) {
    throw new Error(`${senateResolved.failures.length} Senate records name no senator; pin each in overrides.json:\n  ${senateResolved.failures.join('\n  ')}`);
  }
  const records = senateResolved.records;
  const members = memberRows(people, new Set([...resolved.map((r) => r.bioguide), ...records.map((r) => r.bioguide)]));
  const byBioguide = new Map(members.map((m) => [m.bioguide, m]));

  let done = 0;
  const houseOut = await pool(resolved, availableParallelism(), async ({ ix, bioguide }) => {
    const member = byBioguide.get(bioguide);
    let parsed = null, fetchedAt = null;
    const path = house.pdfPath(ix.Year, ix.DocID);
    if (house.isElectronic(ix.DocID) && existsSync(path)) {
      const [bytes, st] = await Promise.all([readFile(path), stat(path)]);
      try { parsed = await extract(bytes); } catch (err) { parsed = { filingId: null, filer: {}, rows: [], errors: [`extract: ${err.message}`] }; }
      fetchedAt = st.mtime.toISOString();
    }
    if (onProgress && ++done % 500 === 0) onProgress(done, resolved.length);
    return houseFiling(ix, member, parsed, fetchedAt);
  });
  const senateOut = senateFilings(records, byBioguide);

  const filings = [...houseOut, ...senateOut].map((x) => x.filing);
  const houseRows = houseOut.flatMap((x) => x.rows);
  const filed = new Map(houseOut.map((x) => [x.filing.filing_id, x.filing.filed_date]));
  const amendments = linkAmendments(houseRows, filed);
  // Earlier filings first, so every row an amendment points at is inserted
  // before the amendment (the link is a foreign key).
  const rowOrder = (a, b) => (filed.get(a.filing_id) ?? '').localeCompare(filed.get(b.filing_id) ?? '') || a.filing_id.localeCompare(b.filing_id) || a.row_num - b.row_num;
  houseRows.sort(rowOrder);
  const rows = [...houseRows, ...senateOut.flatMap((x) => x.rows)];
  for (const r of rows) {
    r.amends_filing_id ??= null;
    r.amends_row_num ??= null;
    r.amendment_match ??= null;
    r.superseded ??= false;
  }
  return { members, filings, rows, index, excluded, how, amendments, records, senateFixed: senateResolved.fixed };
}
