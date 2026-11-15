#!/usr/bin/env node
// NHTSA Standing General Order crash reports: fetch, parse, load, check.
//
//   npm run crashes -- fetch      download the six CSVs into tmp/crashes/raw/
//   npm run crashes -- parse      parse and dedupe, print counts
//   npm run crashes -- schema     apply db/crashes.sql (table and functions)
//   npm run crashes -- load       replace every row of sgo_crashes in one transaction
//   npm run crashes -- check      compare raw, parsed and loaded rows field by field
//   npm run crashes -- sample N   N stratified random rows to tmp/crashes/sample.json
//   npm run crashes -- refresh    fetch, load, check
//
// NHTSA republishes all six files around the 15th of each month. The whole
// table is the unit a load replaces, because a report's latest version is
// chosen across all six files at once.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/crashes/raw/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, DICTIONARY } from './sources.mjs';
import { build, decode, parseFile } from './parse.mjs';
import { compare, rawScan, COLUMNS } from './check.mjs';
import { withClient, inTransaction, insertBatches } from './db.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'tmp/crashes/raw');
const TABLE = 'sgo_crashes';
const PACE_MS = 2000;

const TYPES = {
  report_version: 'integer', model_year: 'integer', incident_year: 'integer',
  submission_month: 'date', incident_month: 'date',
};
const LOAD_COLUMNS = COLUMNS.map((name) => [name, TYPES[name] ?? 'text']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One request per file, two seconds apart. Any status but 200 stops the run:
// a 403, 429 or 503 means the publisher said no, and a retry would be arguing.
async function fetchAll({ withDictionary = false } = {}) {
  await mkdir(RAW, { recursive: true });
  const targets = withDictionary ? [...SOURCES, DICTIONARY] : SOURCES;
  const manifest = [];
  for (const [i, src] of targets.entries()) {
    if (i > 0) await sleep(PACE_MS);
    const res = await fetch(src.url, { headers: { 'User-Agent': 'verbatim.fyi data loader' } });
    if (res.status !== 200) {
      throw new Error(`${src.url}: HTTP ${res.status}. Stopping; no retry.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(resolve(RAW, src.file), buf);
    const entry = {
      file: src.file,
      url: src.url,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      lastModified: res.headers.get('last-modified'),
      fetchedAt: new Date().toISOString(),
    };
    manifest.push(entry);
    console.log(`${src.file}  ${buf.length.toLocaleString()} bytes  ${entry.lastModified}`);
  }
  await writeFile(resolve(RAW, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function readRaw() {
  return Promise.all(SOURCES.map(async (source) => ({
    source,
    text: decode(await readFile(resolve(RAW, source.file))),
  })));
}

async function parseCmd() {
  const files = await readRaw();
  for (const { source, text } of files) {
    console.log(`${source.file}  ${parseFile(text, source).length.toLocaleString()} records`);
  }
  const { all, latest, placeholders, reports } = build(files);
  console.log(`${all.length.toLocaleString()} records, ${latest.length.toLocaleString()} distinct reports`);
  console.log(`${placeholders.length.toLocaleString()} set aside: latest version is "No New or Updated Incident Reports"`);
  console.log(`${reports.length.toLocaleString()} reports to load`);
  return { files, reports, placeholders };
}

async function schemaCmd() {
  const ddl = await readFile(resolve(ROOT, 'db/crashes.sql'), 'utf8');
  await withClient((client) => client.query(ddl));
  console.log('applied db/crashes.sql');
}

async function loadCmd() {
  const { reports } = await parseCmd();
  await withClient((client) => inTransaction(client, async () => {
    await client.query(`DELETE FROM ${TABLE}`);
    await insertBatches(client, TABLE, LOAD_COLUMNS, reports);
  }));
  console.log(`loaded ${reports.length.toLocaleString()} rows into ${TABLE}`);
}

// `--table <name>` checks a copy instead, for planting defects in a scratch
// table without touching the live one.
async function checkCmd(rest) {
  const i = rest.indexOf('--table');
  const table = i >= 0 ? rest[i + 1] : TABLE;
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Bad table name "${table}"`);

  const files = await readRaw();
  const raw = files.map(({ source, text }) => ({ file: source.file, pairs: rawScan(text) }));
  const parsed = files.map(({ source, text }) => ({ file: source.file, rows: parseFile(text, source) }));
  const { reports, placeholders } = build(files);
  const loaded = await withClient(async (client) => {
    const { rows } = await client.query(`SELECT ${COLUMNS.join(', ')} FROM ${table}`);
    return rows;
  });

  const failures = compare({ raw, parsed, expected: reports, placeholders: placeholders.length, loaded });
  const rawCount = raw.reduce((n, f) => n + f.pairs.length, 0);
  console.log(`raw ${rawCount.toLocaleString()} records, parsed ${reports.length.toLocaleString()} reports, loaded ${loaded.length.toLocaleString()} rows (${table})`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: every loaded row matches its parsed source, all ${COLUMNS.length} columns`);
  }
}

// Random rows, an even share from each system and period present, for a
// reviewer to hold against the source by source_ref.
async function sampleCmd(rest) {
  const n = Math.max(1, parseInt(rest[0], 10) || 20);
  const rows = await withClient(async (client) => {
    const { rows: strata } = await client.query(`SELECT system, period, count(*)::int AS n FROM ${TABLE} GROUP BY 1, 2 ORDER BY 1, 2`);
    const per = Math.ceil(n / strata.length);
    const out = [];
    for (const s of strata) {
      const { rows: picked } = await client.query(
        `SELECT ${COLUMNS.join(', ')} FROM ${TABLE} WHERE system = $1 AND period = $2 ORDER BY random() LIMIT $3`,
        [s.system, s.period, per],
      );
      out.push(...picked);
    }
    return out.slice(0, n);
  });
  await mkdir(resolve(ROOT, 'tmp/crashes'), { recursive: true });
  const out = resolve(ROOT, 'tmp/crashes/sample.json');
  await writeFile(out, JSON.stringify(rows, null, 2));
  console.log(`${rows.length} rows to ${out}`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'fetch': await fetchAll({ withDictionary: rest.includes('--dictionary') }); break;
    case 'parse': await parseCmd(); break;
    case 'schema': await schemaCmd(); break;
    case 'load': await loadCmd(); break;
    case 'check': await checkCmd(rest); break;
    case 'sample': await sampleCmd(rest); break;
    case 'refresh':
      await fetchAll();
      await loadCmd();
      await checkCmd([]);
      break;
    default:
      console.error('usage: cli.mjs fetch|parse|schema|load|check [--table t]|sample N|refresh');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
