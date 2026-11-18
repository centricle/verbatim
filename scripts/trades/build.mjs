// Everything the three tables should hold, built from the raw copies alone:
// load writes it, check holds the database to it. Nothing here fetches.
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { house, senate, efd, legislators, FIRST_INDEX_YEAR, lastIndexYear } from './sources.mjs';
import { readIndexZip, extract, houseFiling } from './house.mjs';
import { houseMatcher, memberRows, senateTerm, senateMatcher, senateDeparture } from './members.mjs';
import { resolveSenate, senateFilings, efdFilings, filingId } from './senate.mjs';
import { parsePtr } from './parse-senate.mjs';
import { readLedger, goneFromEfd } from './efd-index.mjs';
import { linkAmendments, supersedeFilings } from './amendments.mjs';

const { house: OVERRIDES, carambat: SENATE_PINS, efd: EFD_PINS } = JSON.parse(readFileSync(new URL('./overrides.json', import.meta.url), 'utf8'));

// An eFD ledger entry to a bioguide: a pin in overrides.json's `efd` first,
// then senateMatcher.
export function efdMatch(people, pins = EFD_PINS) {
  const match = senateMatcher(people);
  return (e) => {
    const pin = pins[`${e.first}|${e.last}`];
    return pin ? { bioguide: pin.bioguide, how: 'override' } : match({ first: e.first, last: e.last, date: e.date_received });
  };
}

// When eFD may destroy an entry's reports: six years after the filer's last
// Senate term ended. { left, purge } for a senator out of office, else null.
export function purgeClock(people, today) {
  const match = efdMatch(people);
  const departed = senateDeparture(people, today);
  return (e) => {
    const b = match(e).bioguide;
    const left = b && departed(b);
    return left ? { left, purge: `${Number(left.slice(0, 4)) + 6}${left.slice(4)}` } : null;
  };
}

// Every filing eFD may destroy that we hold no page of: paper always (its
// scan is never fetched), electronic when its page is not cached. Sorted by
// purge date. `ssw` marks the ones Senate Stock Watcher transcribed, which
// keeps the rows but not the report.
export function purgeTargets(ledger, clock, hasPage, sswIds, today = new Date().toISOString().slice(0, 10)) {
  const unlisted = new Set(goneFromEfd(ledger).map((e) => e.uuid));
  const out = [];
  for (const e of ledger) {
    if (e.kind === 'electronic' && hasPage(e.uuid)) continue;
    const c = clock(e);
    if (!c) continue;
    const state = e.page_gone ? 'page gone' : unlisted.has(e.uuid) ? 'unlisted' : c.purge <= today ? 'listed, past purge date' : 'listed';
    out.push({
      uuid: e.uuid, kind: e.kind, url: efd.viewUrl(e.kind, e.link_uuid), filer: `${e.first} ${e.last}`.trim(),
      filed: e.date_received, title: e.title, left: c.left, purge: c.purge, state, ssw: sswIds.has(e.uuid),
    });
  }
  return out.sort((a, b) => a.purge.localeCompare(b.purge) || a.filed.localeCompare(b.filed) || a.uuid.localeCompare(b.uuid));
}

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

// The eFD ledger, and every cached electronic page parsed: uuid -> { page,
// fetched_at }, or { error, fetched_at } for a page parsePtr refused.
export async function readEfd() {
  const ledger = await readLedger(efd.ledger);
  if (!ledger.length) throw new Error(`no eFD ledger at ${efd.ledger} (run: npm run trades -- fetch senate)`);
  const pages = new Map();
  await pool(ledger.filter((e) => e.kind === 'electronic' && existsSync(efd.ptrPath(e.uuid))), availableParallelism(), async (e) => {
    const path = efd.ptrPath(e.uuid);
    const [html, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const fetched_at = st.mtime.toISOString();
    try { pages.set(e.uuid, { page: parsePtr(html), fetched_at }); } catch (err) { pages.set(e.uuid, { error: err.message, fetched_at }); }
  });
  return { ledger, pages };
}

// Which copy each Senate filing comes from. eFD for every ledger entry, with
// one exception: an electronic entry whose page is not held, when Senate
// Stock Watcher has the filing, comes from SSW, whose copy is then the only
// one with rows. SSW for every record no eFD entry took, matched on the UUID
// in lowercase (eFD prints some links uppercase). A filing eFD stopped
// listing is still in the ledger, so it stays loaded from our copy.
export function splitSenate(ledger, pages, records) {
  const held = new Set(records.map((r) => filingId(r.ptr_link).id.toLowerCase()));
  const entries = ledger.filter((e) => !(e.kind === 'electronic' && !pages.has(e.uuid) && held.has(e.uuid)));
  const fromEfd = new Set(entries.map((e) => e.uuid));
  return { entries, records: records.filter((r) => !fromEfd.has(filingId(r.ptr_link).id.toLowerCase())) };
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

// `efd: false` builds the Senate from Senate Stock Watcher alone, as before
// eFD was read: the rollback (`--no-efd`).
export async function build({ onProgress, efd: useEfd = true } = {}) {
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

  // Every Senate Stock Watcher record is resolved, used or not, so check can
  // hold a filing both copies hold to one senator.
  const senateResolved = resolveSenate(await readSenate(), senateTerm(people), SENATE_PINS);
  if (senateResolved.failures.length) {
    throw new Error(`${senateResolved.failures.length} Senate records name no senator; pin each in overrides.json:\n  ${senateResolved.failures.join('\n  ')}`);
  }
  const carambatBioguide = new Map(senateResolved.records.map((r) => [filingId(r.ptr_link).id.toLowerCase(), r.bioguide]));
  const { ledger, pages } = useEfd ? await readEfd() : { ledger: [], pages: new Map() };
  const split = splitSenate(ledger, pages, senateResolved.records);
  const match = efdMatch(people);
  const efdBioguide = new Map();
  const efdUnmatched = [];
  for (const e of split.entries) {
    const m = match(e);
    if (m.bioguide) efdBioguide.set(e.uuid, m.bioguide);
    else efdUnmatched.push(`${e.first} ${e.last} (${e.office}) ${e.date_received} ${e.uuid} ${m.how ?? ''}`);
  }
  if (efdUnmatched.length) {
    throw new Error(`${efdUnmatched.length} eFD filings name no senator; pin each in overrides.json's efd:\n  ${efdUnmatched.join('\n  ')}`);
  }

  const records = split.records;
  const members = memberRows(people, new Set([...resolved.map((r) => r.bioguide), ...records.map((r) => r.bioguide), ...efdBioguide.values()]));
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
  const senateOut = [
    ...efdFilings(split.entries, pages, (e) => efdBioguide.get(e.uuid), byBioguide),
    ...senateFilings(records, byBioguide),
  ];
  const senateAmendments = supersedeFilings(senateOut);

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
  const efdSummary = {
    ledger: ledger.length,
    pages: pages.size,
    filings: split.entries.length,
    to_carambat: ledger.length - split.entries.length,
    // Pages whose printed # column was renumbered from the bottom (parse-senate.mjs).
    renumbered: [...pages].filter(([, p]) => p.page?.renumbered).map(([u]) => u).sort(),
  };
  return {
    members, filings, rows, index, excluded, how, amendments, records, senateFixed: senateResolved.fixed,
    efd: useEfd ? efdSummary : null, ledger, carambatBioguide, senateAmendments,
  };
}
