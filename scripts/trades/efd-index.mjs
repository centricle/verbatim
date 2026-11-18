// eFD's Periodic Transaction Report list, read in full on every run, and
// the cumulative ledger it feeds (tmp/trades/senate/filings.json).
//
// The list is cheap (25 pages of 100 in November 2026; eFD caps a page at
// 100 whatever `length` asks for), and a full read is the only way to see a
// filing leave it. The ledger keeps every filing ever listed, keyed by its
// UUID in lowercase (eFD prints some links uppercase), with the fields as
// last listed plus `first_seen` and `last_seen`. No entry is ever removed: a
// filing eFD stops listing keeps its entry and, if its page was fetched, its
// rows. `goneFromEfd` names them.
//
// A filing can also stay listed after its page is gone: eFD answers its link
// with 302 to /search/ (Jeff Sessions' four 2014-2016 PTRs, past his six
// years). The fetch stamps such an entry `page_gone` with the first time it
// saw that, and the stamp survives every later merge.
//
// Each list row is [first name, last name, office, link, received date]. The
// office column is not a name: it is "Senator", "Former Senator", or
// "Last, First (Senator)", and it changes as a senator leaves office.
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { usDate } from './house.mjs';
import { htmlText } from './senate.mjs';

export const PTR_REPORT_TYPE = '[11]';
const LINK = /^<a href="\/search\/view\/(ptr|paper)\/([0-9a-fA-F-]{36})\/"[^>]*>([^<]*)<\/a>$/;

// The search form for one page, oldest received first.
export function indexForm(start, { pageSize, since }) {
  return {
    draw: String(Math.floor(start / pageSize) + 1),
    'order[0][column]': '4',
    'order[0][dir]': 'asc',
    start: String(start),
    length: String(pageSize),
    report_types: PTR_REPORT_TYPE,
    filer_types: '[]',
    submitted_start_date: since,
    submitted_end_date: '',
    candidate_state: '',
    senator_state: '',
    office_id: '',
    first_name: '',
    last_name: '',
  };
}

export function parseIndexRow(row) {
  if (!Array.isArray(row) || row.length !== 5) throw new Error(`eFD list row is not five cells: ${JSON.stringify(row)}`);
  const [first, last, office, link, received] = row;
  const m = LINK.exec(String(link).trim());
  if (!m) throw new Error(`eFD list link: ${link}`);
  const date = usDate(htmlText(String(received)));
  if (!date) throw new Error(`eFD list received date: ${received}`);
  return {
    uuid: m[2].toLowerCase(),
    link_uuid: m[2],
    kind: m[1] === 'paper' ? 'paper' : 'electronic',
    title: htmlText(m[3]),
    first: htmlText(String(first)),
    last: htmlText(String(last)),
    office: htmlText(String(office)),
    date_received: date,
  };
}

// Every page of the list. The pages are saved as received; the entries come
// back only if the list held together: one recordsTotal on every page, and
// that many distinct UUIDs, so a list that shifted mid-read (or paged
// unstably on a tie) fails instead of dropping a filing.
export async function readIndex(session, { pageSize, since }) {
  const pages = [];
  const entries = new Map();
  let total = null;
  for (let start = 0; total === null || start < total; start += pageSize) {
    const json = await session.search(indexForm(start, { pageSize, since }));
    if (!Number.isInteger(json.recordsTotal) || !Array.isArray(json.data)) throw new Error(`eFD list page at ${start}: no recordsTotal or data`);
    if (total !== null && json.recordsTotal !== total) throw new Error(`eFD list changed while being read: ${total} then ${json.recordsTotal} filings`);
    total = json.recordsTotal;
    if (!json.data.length && start < total) throw new Error(`eFD list page at ${start} is empty, ${total} filings listed`);
    pages.push(json);
    for (const row of json.data) {
      const e = parseIndexRow(row);
      if (entries.has(e.uuid)) throw new Error(`eFD list names ${e.uuid} twice`);
      entries.set(e.uuid, e);
    }
  }
  if (entries.size !== total) throw new Error(`eFD list: ${total} filings listed, ${entries.size} distinct read`);
  return { total, pages, entries: [...entries.values()] };
}

export async function savePages(pages, { indexDir, indexPage }) {
  await mkdir(indexDir, { recursive: true });
  const keep = new Set();
  for (const [i, p] of pages.entries()) {
    const path = indexPage(i);
    keep.add(path.split('/').pop());
    await writeFile(path, JSON.stringify(p) + '\n');
  }
  // A shorter list than last time leaves no stale page behind.
  for (const f of await readdir(indexDir)) if (/^p\d+\.json$/.test(f) && !keep.has(f)) await unlink(`${indexDir}/${f}`);
}

export async function readLedger(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// The ledger after one full read at `seenAt`: listed entries refreshed, new
// ones added, the rest kept as they were.
export function mergeLedger(ledger, entries, seenAt) {
  const by = new Map(ledger.map((e) => [e.uuid, e]));
  let added = 0;
  for (const e of entries) {
    const old = by.get(e.uuid);
    if (!old) added++;
    const next = { ...e, first_seen: old?.first_seen ?? seenAt, last_seen: seenAt };
    if (old?.page_gone) next.page_gone = old.page_gone;
    by.set(e.uuid, next);
  }
  const out = [...by.values()].sort((a, b) => a.date_received.localeCompare(b.date_received) || a.uuid.localeCompare(b.uuid));
  return { ledger: out, added };
}

export async function writeLedger(path, ledger) {
  await writeFile(path, JSON.stringify(ledger, null, 1) + '\n');
}

// Filings the ledger holds that the latest read did not list.
export function goneFromEfd(ledger) {
  const latest = ledger.reduce((m, e) => (e.last_seen > m ? e.last_seen : m), '');
  return ledger.filter((e) => e.last_seen < latest);
}
