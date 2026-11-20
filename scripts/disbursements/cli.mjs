#!/usr/bin/env node
// House Statement of Disbursements: fetch, parse, load, check.
//
//   npm run disbursements -- links                 list the detail CSVs the House pages link
//   npm run disbursements -- fetch [Q...]          download quarters not yet in tmp/disbursements/raw/house/
//   npm run disbursements -- fetch --again Q...    download those quarters again (re-issued in place)
//   npm run disbursements -- parse [Q...]          parse, reconcile, print counts
//   npm run disbursements -- schema --target E     apply db/disbursements.sql
//   npm run disbursements -- load --target E [Q...]  replace each quarter's rows, one transaction per quarter, then refresh stats
//   npm run disbursements -- stats --target E      refresh the stats view alone
//   npm run disbursements -- check [Q...] [--table t]  raw vs parsed vs loaded, every column
//   npm run disbursements -- sample N              N random rows, spread over quarters, to tmp/disbursements/sample.json
//   npm run disbursements -- archive [house|senate] [--dry-run]
//                                                  copy both chambers' raw volumes to the private
//                                                  R2 bucket and verify every file by MD5 (archive.mjs)
//
//   npm run disbursements -- senate ...            the Senate's volumes (senate-cli.mjs)
//
// Q is a quarter like 2026q2; none means every quarter downloaded. E is the
// Neon endpoint id DATABASE_URL points at (ep-...), named by the operator so a
// branch load cannot reach main through an environment mixup.
//
// house.gov ignores HTTP Range and sends the whole file, so nothing here ever
// probes with one: a quarter is either downloaded in full or not at all.
// Raw downloads are untrusted data. Nothing is ever run from tmp/disbursements/raw/.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_PAGES, detailLinks, mergeLinks } from './sources.mjs';
import { decode, parseQuarter } from './parse.mjs';
import { rawScan, compare, COLUMNS } from './check.mjs';
import { withClient, inTransaction, insertBatches } from '../lib/db.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'tmp/disbursements/raw/house');
const MANIFEST = resolve(RAW, 'manifest.json');
const TABLE = 'disbursements';
const PACE_MS = 5000;
const UA = { 'User-Agent': 'verbatim.fyi data loader (https://github.com/centricle/verbatim)' };

const TYPES = { row_number: 'integer', org_year: 'integer', period_start: 'date', period_end: 'date', transaction_date: 'date', start_date: 'date', end_date: 'date', amount: 'numeric', extras: 'jsonb' };
export const LOAD_COLUMNS = COLUMNS.map((name) => [name, TYPES[name] ?? 'text']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quarters = (rest) => rest.filter((a) => /^\d{4}q[1-4]$/.test(a));
const fileFor = (quarter) => `house-${quarter}.csv`;

// One GET, no retry. Any status but 200 stops the run: a 403, 429 or 503
// means the publisher said no, and a retry would be arguing.
async function get(url) {
  const res = await fetch(url, { headers: UA });
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}. Stopping; no retry.`);
  return res;
}

async function readManifest() {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { return {}; }
}

async function links() {
  const lists = [];
  for (const [i, page] of HOUSE_PAGES.entries()) {
    if (i > 0) await sleep(PACE_MS);
    lists.push(detailLinks(await (await get(page)).text(), page));
  }
  const all = mergeLinks(lists);
  await mkdir(RAW, { recursive: true });
  await writeFile(resolve(RAW, 'links.json'), JSON.stringify(all, null, 2));
  return all;
}

async function linksCmd() {
  const all = await links();
  for (const l of all) console.log(`${l.quarter}  ${l.url}`);
  console.log(`${all.length} quarters, ${all[0]?.quarter} to ${all.at(-1)?.quarter}`);
}

async function fetchCmd(rest) {
  const again = rest.includes('--again');
  const wanted = new Set(quarters(rest));
  if (again && !wanted.size) throw new Error('--again needs the quarters to download again');
  const manifest = await readManifest();
  const present = new Set(await readdir(RAW).catch(() => []));
  const all = await links();
  const todo = all.filter((l) => (wanted.size ? wanted.has(l.quarter) : true)
    && (again || !present.has(fileFor(l.quarter))));
  for (const q of wanted) if (!all.some((l) => l.quarter === q)) throw new Error(`${q} is not linked from the House pages`);
  console.log(`${todo.length} to download`);
  for (const l of todo) {
    await sleep(PACE_MS);
    const res = await get(l.url);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(resolve(RAW, fileFor(l.quarter)), buf);
    manifest[l.quarter] = {
      ...l,
      file: fileFor(l.quarter),
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      lastModified: res.headers.get('last-modified'),
      fetchedAt: new Date().toISOString(),
    };
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`${l.quarter}  ${buf.length.toLocaleString()} bytes  ${manifest[l.quarter].lastModified}`);
  }
}

// Quarters on disk with a manifest entry, filtered to `rest` if given.
async function local(rest) {
  const manifest = await readManifest();
  const wanted = quarters(rest);
  const qs = wanted.length ? wanted : Object.keys(manifest).sort();
  if (!qs.length) throw new Error('No quarters downloaded; run fetch first');
  return Promise.all(qs.map(async (q) => {
    const m = manifest[q];
    if (!m) throw new Error(`${q} is not in ${MANIFEST}; run fetch ${q}`);
    const buf = await readFile(resolve(RAW, m.file));
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== m.sha256) throw new Error(`${m.file} does not match its manifest sha256`);
    const { text, encoding } = decode(buf);
    const source = { unit: `house-${q}`, url: m.url, start: m.start, end: m.end, file: m.file };
    return { quarter: q, text, encoding, source };
  }));
}

function parseOne({ text, source }) {
  const { classified, rows } = parseQuarter(text, source);
  return { classified, rows, raw: rawScan(text) };
}

async function parseCmd(rest) {
  let total = 0;
  let failed = 0;
  for (const q of await local(rest)) {
    const { classified, rows, raw } = parseOne(q);
    const failures = compare({ unit: q.source.unit, raw, classified, expected: rows, loaded: null });
    total += rows.length;
    failed += failures.length;
    console.log(`${q.quarter}  ${q.encoding.padEnd(12)} ${classified.length.toLocaleString().padStart(8)} records  ${rows.length.toLocaleString().padStart(8)} rows  ${failures.length ? `${failures.length} FAIL` : 'reconciles'}`);
    for (const f of failures.slice(0, 10)) console.log(`  FAIL ${f}`);
  }
  console.log(`${total.toLocaleString()} rows to load`);
  if (failed) process.exitCode = 1;
}

// The endpoint a write is about to reach, named by the operator.
function endpoint() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return new URL(process.env.DATABASE_URL).hostname.split('.')[0].replace(/-pooler$/, '');
}
export function requireTarget(rest) {
  const i = rest.indexOf('--target');
  const named = i >= 0 ? rest[i + 1] : null;
  const actual = endpoint();
  if (named !== actual) throw new Error(`refusing to write: DATABASE_URL is endpoint ${actual}; pass --target ${actual} if that is the one meant`);
  console.log(`writing to ${actual}`);
}

async function schemaCmd(rest) {
  requireTarget(rest);
  const ddl = await readFile(resolve(ROOT, 'db/disbursements.sql'), 'utf8');
  await withClient((client) => client.query(ddl));
  console.log('applied db/disbursements.sql');
}

// The stats view (db/disbursements.sql) holds what /disbursements/ charts;
// CONCURRENTLY keeps it readable while it rebuilds (33 s to 3 minutes at 0.25 CU).
export async function refreshStats(client) {
  const t0 = Date.now();
  await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY disbursements_chamber_stats_mv');
  console.log(`stats refreshed  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function statsCmd(rest) {
  requireTarget(rest);
  await withClient(refreshStats);
}

// One transaction per quarter: delete the unit, insert its rows. A quarter
// that fails to reconcile is never loaded. The stats view is refreshed last,
// so it is stale only while a load runs.
async function loadCmd(rest) {
  requireTarget(rest);
  const qs = await local(rest);
  await withClient(async (client) => {
    for (const q of qs) {
      const { classified, rows, raw } = parseOne(q);
      const failures = compare({ unit: q.source.unit, raw, classified, expected: rows, loaded: null });
      if (failures.length) throw new Error(`${q.quarter} does not reconcile (${failures[0]}); nothing loaded for it`);
      const t0 = Date.now();
      await inTransaction(client, async () => {
        await client.query(`DELETE FROM ${TABLE} WHERE unit = $1`, [q.source.unit]);
        await insertBatches(client, TABLE, LOAD_COLUMNS, rows, 2000);
      });
      console.log(`${q.quarter}  ${rows.length.toLocaleString()} rows  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    await refreshStats(client);
  });
}

// `--table <name>` checks a copy instead, for planting defects in a scratch
// table without touching the live one.
async function checkCmd(rest) {
  const i = rest.indexOf('--table');
  const table = i >= 0 ? rest[i + 1] : TABLE;
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Bad table name "${table}"`);
  const qs = await local(rest);
  let failed = 0;
  let total = 0;
  await withClient(async (client) => {
    for (const q of qs) {
      const { classified, rows, raw } = parseOne(q);
      const { rows: loaded } = await client.query(`SELECT ${COLUMNS.join(', ')} FROM ${table} WHERE unit = $1`, [q.source.unit]);
      const failures = compare({ unit: q.source.unit, raw, classified, expected: rows, loaded });
      total += loaded.length;
      failed += failures.length;
      console.log(`${q.quarter}  ${loaded.length.toLocaleString().padStart(8)} loaded  ${failures.length ? `${failures.length} FAIL` : 'PASS'}`);
      for (const f of failures.slice(0, 10)) console.log(`  FAIL ${f}`);
    }
    if (!quarters(rest).length) {
      const units = new Set(qs.map((q) => q.source.unit));
      const { rows: present } = await client.query(`SELECT DISTINCT unit FROM ${table} WHERE chamber = 'house'`);
      for (const { unit } of present) {
        if (!units.has(unit)) { failed++; console.log(`FAIL ${unit} is in ${table} but not downloaded`); }
      }
    }
    if (table === TABLE) failed += await checkStats(client);
  });
  if (failed) process.exitCode = 1;
  else console.log(`PASS: ${total.toLocaleString()} rows in ${qs.length} quarters match their sources, all ${COLUMNS.length} columns`);
}

// The stats view against the table, by row count per chamber and period (an
// index-only scan, about a second). A period reissued in place with the same
// count would pass; `load` always refreshes, so this catches a load that died
// before its refresh, or a hand edit.
export async function checkStats(client) {
  const { rows: views } = await client.query('SELECT chamber, data FROM disbursements_chamber_stats_mv');
  const { rows } = await client.query(`SELECT chamber, period_start::text AS p, count(*)::int AS n FROM ${TABLE} GROUP BY 1, 2`);
  const want = new Map(rows.map((r) => [`${r.chamber} ${r.p}`, r.n]));
  const have = new Map(views.flatMap(({ data }) => (data.by_period ?? []).map((r) => [`${r.chamber} ${r.period_start}`, Number(r.count)])));
  const bad = [...new Set([...want.keys(), ...have.keys()])].filter((k) => want.get(k) !== have.get(k));
  for (const chamber of new Set([...rows.map((r) => r.chamber), ...views.map((v) => v.chamber)])) {
    const total = rows.filter((r) => r.chamber === chamber).reduce((a, r) => a + r.n, 0);
    const shown = Number(views.find((v) => v.chamber === chamber)?.data.total ?? 0);
    if (shown !== total) bad.unshift(`${chamber} total ${shown} vs ${total}`);
  }
  if (bad.length) console.log(`FAIL stats view is stale (${bad.slice(0, 3).join('; ')}); run stats --target E`);
  else console.log('stats view matches the table');
  return bad.length ? 1 : 0;
}

// Random rows, an even share from each quarter, for a reviewer to hold
// against the source by source_ref.
async function sampleCmd(rest) {
  const n = Math.max(1, parseInt(rest[0], 10) || 20);
  // Spread over quarters, and every eighth quarter's rows are subtotal rows:
  // they are about 1% of the table, so a plain draw of 40 seldom holds one,
  // and the pay collapse is the change a refute pass most needs to see.
  const rows = await withClient(async (client) => {
    const { rows: units } = await client.query(
      `SELECT unit FROM (SELECT DISTINCT unit FROM ${TABLE}) u ORDER BY random() LIMIT $1`, [n],
    );
    const per = Math.ceil(n / units.length);
    const out = [];
    for (const [i, { unit }] of units.entries()) {
      const kind = i % 8 === 7 ? 'subtotal' : 'detail';
      const { rows: picked } = await client.query(
        `SELECT ${COLUMNS.join(', ')} FROM ${TABLE} WHERE unit = $1 AND row_kind = $2 ORDER BY random() LIMIT $3`,
        [unit, kind, per],
      );
      out.push(...picked);
    }
    return out.slice(0, n);
  });
  await mkdir(resolve(ROOT, 'tmp/disbursements'), { recursive: true });
  const out = resolve(ROOT, 'tmp/disbursements/sample.json');
  await writeFile(out, JSON.stringify(rows, null, 2));
  console.log(`${rows.length} rows to ${out}`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'links': await linksCmd(); break;
    case 'fetch': await fetchCmd(rest); break;
    case 'parse': await parseCmd(rest); break;
    case 'schema': await schemaCmd(rest); break;
    case 'load': await loadCmd(rest); break;
    case 'stats': await statsCmd(rest); break;
    case 'check': await checkCmd(rest); break;
    case 'sample': await sampleCmd(rest); break;
    case 'senate': await (await import('./senate-cli.mjs')).main(rest); break;
    case 'archive': await (await import('./archive.mjs')).archiveCmd(rest); break;
    default:
      console.error('usage: cli.mjs links|fetch [--again] [Q...]|parse [Q...]|schema --target E|load --target E [Q...]|stats --target E|check [Q...] [--table t]|sample N|archive [house|senate] [--dry-run]|senate ...');
      process.exitCode = 2;
  }
}

// senate-cli.mjs imports the shared write guards from here, so the command
// line runs only when this file is the one node was given, and without a
// top-level await: `senate` imports senate-cli.mjs, which imports this
// module, and an await here would leave that import waiting on itself.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exitCode = 1; });
}
