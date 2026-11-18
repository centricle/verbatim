#!/usr/bin/env node
// Congressional stock trades: House PTRs from the Clerk; Senate PTRs from
// eFD, plus Senate Stock Watcher for what eFD's copy lacks. Fetch, parse,
// load, check.
//
//   npm run trades -- index               the House index ZIPs, every year (2 s apart)
//   npm run trades -- fetch [house|senate]  index, members, Senate file, and every
//                                         electronic PTR not yet in tmp/trades/ (2 s apart);
//                                         the Senate part reads eFD's whole list, then
//                                         the pages not yet cached, nearest purge first
//   npm run trades -- parse               build every table from the raw copies, print counts
//                                         (parse, load and check take --no-efd: the Senate
//                                         from Senate Stock Watcher alone, the rollback)
//   npm run trades -- schema --target E   apply db/trades.sql
//   npm run trades -- load --target E     replace all three tables in one transaction
//   npm run trades -- check               raw vs parsed vs loaded, every column
//   npm run trades -- sample N            N counted House rows spread across years,
//                                         to tmp/trades/sample.json
//   npm run trades -- archive [house|senate] [--dry-run]
//                                         copy tmp/trades/house/ and the eFD pages,
//                                         list and ledger to the private R2 bucket:
//                                         upload what it lacks, then verify every
//                                         file by MD5 (archive.mjs)
//   npm run trades -- senate-targets [--md P]  every filing eFD may destroy that we hold
//                                         no page of, by purge date, to
//                                         tmp/trades/senate/purge-targets.{json,md}
//                                         (--md writes the Markdown to P instead)
//   npm run trades -- refresh --target E  fetch, load, check, senate-targets, archive
//
// Writes name their endpoint: E must be the first label of DATABASE_URL's
// host (without "-pooler"), so a load meant for a Neon branch cannot reach
// main through an environment mixup. To write to a branch, set DATABASE_URL
// in the environment; it wins over .env.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/trades/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { ROOT, RAW, UA, PACE_MS, FIRST_INDEX_YEAR, lastIndexYear, house, senate, efd, legislators } from './sources.mjs';
import { build, pool, readHouseIndex, readPeople, readSenate, purgeClock, purgeTargets } from './build.mjs';
import { createSession, blockedUntil } from './efd.mjs';
import { readIndex, savePages, readLedger, mergeLedger, writeLedger, goneFromEfd } from './efd-index.mjs';
import { rawRowCount } from './house.mjs';
import { filingId } from './senate.mjs';
import { compare, efdRawRows } from './check.mjs';
import { MEMBER_COLUMNS, FILING_COLUMNS, ROW_COLUMNS, selectList } from './columns.mjs';
import { withClient, inTransaction, insertBatches } from '../lib/db.mjs';
import { archive } from './archive.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

// One request per PACE_MS. 403, 429 and 503 stop the run with no retry;
// `missing` lists the statuses that are only logged (a PTR the index names
// before its PDF is posted).
async function get(url, { missing = [] } = {}) {
  const wait = lastRequest + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  if (res.status === 200) return Buffer.from(await res.arrayBuffer());
  if (missing.includes(res.status)) return null;
  throw new Error(`${url}: HTTP ${res.status}. Stopping; no retry.`);
}

async function save(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
}

async function indexCmd() {
  for (let y = FIRST_INDEX_YEAR; y <= lastIndexYear(); y++) {
    const buf = await get(house.indexUrl(y));
    await save(house.indexZip(y), buf);
    console.log(`${y}FD.zip  ${buf.length.toLocaleString()} bytes`);
  }
}

async function fetchMembers() {
  for (const l of legislators) {
    const buf = await get(l.url);
    await save(l.path, buf);
    console.log(`${l.path.split('/').pop()}  ${buf.length.toLocaleString()} bytes`);
  }
}

// eFD: the whole PTR list into the ledger, then every listed electronic
// page not yet cached. Pages go in order of purge date (six years after the
// filer's last Senate term ended), serving senators last, so a run stopped
// partway has already saved the filings on a clock.
async function fetchSenate() {
  const blocked = await blockedUntil(efd.blockedUntil);
  if (blocked) throw new Error(`eFD blocked until ${blocked.until} (${blocked.why}); check eFD by hand first`);
  const session = createSession({ base: efd.base, ua: UA, paceMs: PACE_MS, logPath: efd.log, blockedPath: efd.blockedUntil });
  const seenAt = new Date().toISOString();
  const { total, pages, entries } = await readIndex(session, efd);
  await savePages(pages, efd);
  const { ledger, added } = mergeLedger(await readLedger(efd.ledger), entries, seenAt);
  await writeLedger(efd.ledger, ledger);
  const gone = goneFromEfd(ledger);
  console.log(`eFD list: ${total.toLocaleString()} PTRs (${pages.length} pages), ${added} new; ledger ${ledger.length.toLocaleString()}, ${gone.length} no longer listed`);

  const clock = purgeClock(await readPeople());
  const purge = (e) => clock(e)?.purge ?? '9999';
  const todo = entries.filter((e) => e.kind === 'electronic' && !existsSync(efd.ptrPath(e.uuid)))
    .map((e) => ({ e, purge: purge(e) }))
    .sort((a, b) => a.purge.localeCompare(b.purge) || a.e.date_received.localeCompare(b.e.date_received));
  console.log(`${todo.length} eFD pages to fetch, about ${Math.ceil((todo.length * PACE_MS) / 60e3)} min`);
  let n = 0, missing = 0;
  const inLedger = new Map(ledger.map((x) => [x.uuid, x]));
  try {
    for (const { e, purge: p } of todo) {
      const r = await session.view(new URL(efd.viewUrl(e.kind, e.link_uuid)).pathname);
      if (r.gone) {
        missing++;
        inLedger.get(e.uuid).page_gone ??= new Date().toISOString();
        console.log(`GONE ${e.uuid} ${e.last} ${e.date_received} (listed this run)`);
        continue;
      }
      await save(efd.ptrPath(e.uuid), r.html);
      if (++n % 100 === 0) console.log(`${n}/${todo.length} (purge ${p === '9999' ? 'none' : p})`);
    }
  } finally {
    // A hard stop mid-run still keeps the gone pages it saw.
    if (missing) await writeLedger(efd.ledger, ledger);
  }
  console.log(`eFD: fetched ${n}, gone ${missing}; ${session.stats().requests} requests`);
}

async function fetchCmd(rest = []) {
  const only = rest.find((x) => x === 'house' || x === 'senate');
  await fetchMembers();
  if (only !== 'senate') await fetchHouse();
  if (only !== 'house') await fetchSenate();
}

async function fetchHouse() {
  await indexCmd();
  if (!existsSync(senate.path)) {
    const buf = await get(senate.url);
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== senate.sha256) throw new Error(`${senate.url}: sha256 ${sha}, expected ${senate.sha256}`);
    await save(senate.path, buf);
  }
  const todo = readHouseIndex().filter((ix) => house.isElectronic(ix.DocID) && !existsSync(house.pdfPath(ix.Year, ix.DocID)));
  console.log(`${todo.length} electronic PTRs to fetch`);
  let missing = 0;
  for (const [i, ix] of todo.entries()) {
    const buf = await get(house.pdfUrl(ix.Year, ix.DocID), { missing: [404] });
    if (!buf) { missing++; console.log(`MISS ${ix.Year} ${ix.DocID}`); continue; }
    await save(house.pdfPath(ix.Year, ix.DocID), buf);
    if ((i + 1) % 100 === 0) console.log(`${i + 1}/${todo.length}`);
  }
  console.log(`fetched ${todo.length - missing}, missing ${missing}`);
}

function summarize(b) {
  const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  console.log(`${b.members.length} members, ${b.filings.length.toLocaleString()} filings, ${b.rows.length.toLocaleString()} rows`);
  console.log('filings', by(b.filings, (f) => `${f.chamber} ${f.parse_status}`));
  console.log('House member match', b.how, `excluded ${b.excluded.length}`);
  console.log('Senate bioguides corrected', by(b.senateFixed, (x) => `${x.from} -> ${x.to}`));
  console.log('House notices', b.amendments);
  if (b.efd) {
    const { renumbered, ...counts } = b.efd;
    console.log('eFD', counts);
    for (const u of renumbered) console.log(`RENUMBERED ${u}: # column printed a number twice; rows numbered from the bottom`);
  }
  console.log('Senate filings by source', by(b.filings.filter((f) => f.chamber === 'senate'), (f) => `${f.source} ${f.kind}`));
  const sa = b.senateAmendments;
  console.log(`Senate amendments: ${sa.amendments} electronic, ${sa.linked} linked, ${sa.superseded_rows.toLocaleString()} rows superseded; no original ${sa.none.length}, ambiguous ${sa.ambiguous.length}, not parsed ${sa.unparsed.length}`);
  for (const id of sa.none) console.log(`UNLINKED ${id}: no original`);
  for (const id of sa.ambiguous) console.log(`UNLINKED ${id}: ambiguous`);
  for (const f of b.filings.filter((x) => x.parse_status === 'failed').slice(0, 20)) console.log(`FAILED ${f.chamber} ${f.report_year ?? f.filed_date} ${f.filing_id}: ${f.parse_error}`);
}

const buildOpts = (rest) => ({ efd: !rest.includes('--no-efd') });

async function parseCmd(rest = []) {
  const b = await build({ ...buildOpts(rest), onProgress: (d, n) => process.stderr.write(`${d}/${n}\r`) });
  summarize(b);
  return b;
}

// The endpoint a write is about to reach, named by the operator.
function endpoint() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return new URL(process.env.DATABASE_URL).hostname.split('.')[0].replace(/-pooler$/, '');
}
function requireTarget(rest) {
  const i = rest.indexOf('--target');
  const named = i >= 0 ? rest[i + 1] : null;
  const actual = endpoint();
  if (named !== actual) throw new Error(`refusing to write: DATABASE_URL is endpoint ${actual}; pass --target ${actual} if that is the one meant`);
  console.log(`writing to ${actual}`);
}

async function schemaCmd(rest) {
  requireTarget(rest);
  const ddl = await readFile(resolve(ROOT, 'db/trades.sql'), 'utf8');
  await withClient((client) => client.query(ddl));
  console.log('applied db/trades.sql');
}

async function loadCmd(rest) {
  requireTarget(rest);
  const b = await parseCmd(rest);
  const keys = new Set(b.rows.map((r) => `${r.chamber}:${r.filing_id}:${r.row_num}`));
  await withClient((client) => inTransaction(client, async () => {
    const { rows: before } = await client.query('SELECT chamber, filing_id, row_num FROM stock_trades');
    const old = new Set(before.map((r) => `${r.chamber}:${r.filing_id}:${r.row_num}`));
    const added = [...keys].filter((k) => !old.has(k)).length;
    const removed = [...old].filter((k) => !keys.has(k)).length;
    await client.query('DELETE FROM stock_trades');
    await client.query('DELETE FROM trade_filings');
    await client.query('DELETE FROM trade_members');
    await insertBatches(client, 'trade_members', MEMBER_COLUMNS, b.members);
    await insertBatches(client, 'trade_filings', FILING_COLUMNS, b.filings);
    await insertBatches(client, 'stock_trades', ROW_COLUMNS, b.rows);
    console.log(`loaded ${b.members.length} members, ${b.filings.length.toLocaleString()} filings, ${b.rows.length.toLocaleString()} rows (${added.toLocaleString()} new, ${removed.toLocaleString()} gone)`);
  }));
}

async function checkCmd(rest = []) {
  console.log(`reading ${endpoint()}`);
  const b = await build(buildOpts(rest));
  const parsed = b.filings.filter((f) => f.chamber === 'house' && f.parse_status === 'parsed');
  const ix = new Map(b.index.map((x) => [x.DocID, x]));
  const counts = await pool(parsed, availableParallelism(), async (f) => {
    const x = ix.get(f.filing_id);
    return [f.filing_id, await rawRowCount(await readFile(house.pdfPath(x.Year, x.DocID)))];
  });
  const loaded = await withClient(async (client) => ({
    members: (await client.query(`SELECT ${selectList(MEMBER_COLUMNS)} FROM trade_members`)).rows,
    filings: (await client.query(`SELECT ${selectList(FILING_COLUMNS)} FROM trade_filings`)).rows,
    rows: (await client.query(`SELECT ${selectList(ROW_COLUMNS)} FROM stock_trades`)).rows,
    badAmounts: (await client.query(String.raw`SELECT chamber, filing_id, row_num, amount FROM stock_trades
      WHERE amount IS NOT NULL AND trade_amount_rank(amount) = 0 AND amount !~ '^\$[0-9,]*\.?[0-9]+$'`)).rows,
  }));
  const efdParsed = b.filings.filter((f) => f.source === 'efd' && f.parse_status === 'parsed');
  const efdCounts = await pool(efdParsed, availableParallelism(), async (f) => [f.filing_id, efdRawRows(await readFile(efd.ptrPath(f.filing_id), 'utf8'))]);
  const failures = compare({ build: b, loaded, raw: new Map(counts), rawEfd: new Map(efdCounts), badAmounts: loaded.badAmounts });
  const sources = b.efd
    ? `${b.ledger.length.toLocaleString()} eFD ledger entries (${efdParsed.length.toLocaleString()} pages parsed) plus ${b.records.length.toLocaleString()} Senate Stock Watcher filings`
    : `${b.records.length.toLocaleString()} Senate Stock Watcher filings (--no-efd)`;
  console.log(`raw: ${b.index.length.toLocaleString()} House index PTRs, ${sources}; loaded ${loaded.filings.length.toLocaleString()} filings, ${loaded.rows.length.toLocaleString()} rows`);
  if (b.efd) {
    const pageGone = b.ledger.filter((e) => e.page_gone);
    const unlisted = goneFromEfd(b.ledger);
    console.log(`eFD: ${pageGone.length} listed with the page gone, ${unlisted.length} no longer listed (gone_from_efd), ${b.efd.renumbered.length} pages renumbered (${b.efd.renumbered.map((u) => u.slice(0, 8)).join(', ')}); reported, not failed`);
    for (const e of unlisted) console.log(`  gone_from_efd ${e.uuid} ${e.last} ${e.date_received} last listed ${e.last_seen.slice(0, 10)}`);
  }
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    process.exitCode = 1;
  } else {
    const senate = b.efd ? `eFD and Senate Stock Watcher coverage, ${efdParsed.length.toLocaleString()} eFD pages against their raw rows` : 'Senate Stock Watcher coverage';
    console.log(`PASS: index and ${senate}, ${parsed.length.toLocaleString()} PDFs against their raw text, every column of every member, filing and row, row counts, names, amendment links, amounts, characters`);
  }
}

// Counted House rows spread evenly across filing years, for a reviewer to
// hold against the PDF (the Phase 3 refute pass).
async function sampleCmd(rest) {
  const n = Math.max(1, parseInt(rest[0], 10) || 40);
  const rows = await withClient(async (client) => {
    const { rows: years } = await client.query(`SELECT DISTINCT extract(year FROM f.filed_date)::int AS y
      FROM stock_trades t JOIN trade_filings f USING (chamber, filing_id) WHERE t.chamber = 'house' AND t.counted ORDER BY 1`);
    const out = [];
    for (const [i, { y }] of years.entries()) {
      const take = Math.floor(n / years.length) + (i < n % years.length ? 1 : 0);
      if (!take) continue;
      const { rows: picked } = await client.query(`SELECT t.chamber, t.filing_id, t.row_num,
          to_char(t.transaction_date, 'MM/DD/YYYY') AS transaction_date, t.owner_code, t.ticker,
          t.asset_description, t.asset_type_code, t.type_code, t.amount, t.filing_status, f.url
        FROM stock_trades t JOIN trade_filings f USING (chamber, filing_id)
        WHERE t.chamber = 'house' AND t.counted AND extract(year FROM f.filed_date) = $1
        ORDER BY random() LIMIT $2`, [y, take]);
      out.push(...picked);
    }
    return out;
  });
  const out = resolve(RAW, 'sample.json');
  await save(out, JSON.stringify(rows, null, 2));
  console.log(`${rows.length} rows to ${out}`);
}

async function senateTargetsCmd(rest) {
  const ledger = await readLedger(efd.ledger);
  const ssw = new Set((await readSenate()).map((r) => filingId(r.ptr_link).id.toLowerCase()));
  const targets = purgeTargets(ledger, purgeClock(await readPeople()), (u) => existsSync(efd.ptrPath(u)), ssw);
  await save(efd.targets, JSON.stringify(targets, null, 1) + '\n');
  const i = rest.indexOf('--md');
  const mdPath = i >= 0 ? resolve(rest[i + 1]) : efd.targets.replace(/\.json$/, '.md');
  const by = (f) => targets.reduce((m, t) => ((m[f(t)] = (m[f(t)] ?? 0) + 1), m), {});
  const lines = [
    '# Senate PTRs eFD may destroy, with no page held',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} by \`npm run trades -- senate-targets\` from the eFD ledger (${ledger.length.toLocaleString()} entries). Purge date: six years after the filer's last Senate term ended. "SSW" marks a filing Senate Stock Watcher transcribed: its rows survive, the report does not. Paper reports are scans; nothing here fetches them.`,
    '',
    `${targets.length.toLocaleString()} filings: ${Object.entries(by((t) => t.kind)).map(([k, n]) => `${n} ${k}`).join(', ')}; ${Object.entries(by((t) => t.state)).map(([k, n]) => `${n} ${k}`).join(', ')}.`,
    '',
    '| Purge | Filer | Filed | Kind | State | SSW | Report |',
    '|---|---|---|---|---|---|---|',
    ...targets.map((t) => `| ${t.purge} | ${t.filer} | ${t.filed} | ${t.kind} | ${t.state} | ${t.ssw ? 'yes' : ''} | [${t.title}](${t.url}) |`),
    '',
  ];
  await save(mdPath, lines.join('\n'));
  console.log(`senate-targets: ${targets.length} filings, ${Object.entries(by((t) => t.state)).map(([k, n]) => `${n} ${k}`).join(', ')}; ${efd.targets}, ${mdPath}`);
}

async function archiveCmd(rest) {
  const named = rest.filter((a) => a === 'house' || a === 'senate');
  const failures = await archive({ dryRun: rest.includes('--dry-run'), ...(named.length && { sources: named }) });
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exitCode = 1;
}

async function main([cmd, ...rest]) {
  switch (cmd) {
    case 'index': await indexCmd(); break;
    case 'fetch': await fetchCmd(rest); break;
    case 'parse': await parseCmd(rest); break;
    case 'schema': await schemaCmd(rest); break;
    case 'load': await loadCmd(rest); break;
    case 'check': await checkCmd(rest); break;
    case 'sample': await sampleCmd(rest); break;
    case 'archive': await archiveCmd(rest); break;
    case 'senate-targets': await senateTargetsCmd(rest); break;
    // Archive runs last and even after a failed check: the raw copies are
    // worth keeping whatever the parse made of them.
    case 'refresh':
      requireTarget(rest);
      await fetchCmd();
      await loadCmd(rest);
      await checkCmd(rest);
      await senateTargetsCmd([]);
      await archiveCmd([]);
      break;
    default:
      console.error('usage: cli.mjs index|fetch|parse [--no-efd]|schema --target E|load --target E [--no-efd]|check [--no-efd]|sample N|archive [house|senate] [--dry-run]|senate-targets [--md P]|refresh --target E');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
