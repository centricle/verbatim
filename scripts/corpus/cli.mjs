#!/usr/bin/env node
// The speech corpus's Postgres side: load the built release and check it.
//
//   npm run corpus -- schema     apply db/corpus.sql (table and functions)
//   npm run corpus -- load       replace every row of corpus_statements in one transaction
//   npm run corpus -- check      compare raw, parsed and loaded records field by field
//   npm run corpus -- sample N   N stratified random rows to tmp/corpus/sample.json
//
// The input is data/corpus/release.jsonl, written by build_release.py (Python,
// same directory; check_release.py must pass first). This side never reads
// corpus.db and never changes a value: what the release holds is decided
// there, and this loads it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, LOAD_COLUMNS, parseRelease, siteRows } from './parse.mjs';
import { compare, rawScan } from './check.mjs';
import { withClient, inTransaction, insertBatches } from '../lib/db.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASE = resolve(process.env.CORPUS_DIR ?? resolve(ROOT, 'data/corpus'), 'release.jsonl');
const TABLE = 'corpus_statements';
// Records run to 400,000 characters, so a batch is counted in records, kept
// small enough that one INSERT stays a few megabytes.
const BATCH = 50;

async function readRelease() {
  const text = await readFile(RELEASE, 'utf8');
  const rows = siteRows(parseRelease(text));
  return { text, rows };
}

async function schemaCmd() {
  const ddl = await readFile(resolve(ROOT, 'db/corpus.sql'), 'utf8');
  await withClient((client) => client.query(ddl));
  console.log('applied db/corpus.sql');
}

async function loadCmd() {
  const { rows } = await readRelease();
  const chars = rows.reduce((n, r) => n + r.text.length, 0);
  console.log(`${rows.length.toLocaleString()} records, ${chars.toLocaleString()} characters to load`);
  await withClient((client) => inTransaction(client, async () => {
    await client.query(`DELETE FROM ${TABLE}`);
    await insertBatches(client, TABLE, LOAD_COLUMNS, rows, BATCH);
  }));
  console.log(`loaded ${rows.length.toLocaleString()} rows into ${TABLE}`);
}

// `--table <name>` checks a copy instead, for planting defects in a scratch
// table without touching the live one.
async function checkCmd(rest) {
  const i = rest.indexOf('--table');
  const table = i >= 0 ? rest[i + 1] : TABLE;
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Bad table name "${table}"`);

  const { text, rows: expected } = await readRelease();
  const raw = rawScan(text);
  const { loaded, emptyTsv } = await withClient(async (client) => {
    const { rows } = await client.query(`SELECT ${COLUMNS.join(', ')} FROM ${table}`);
    const { rows: [e] } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE tsv = ''::tsvector`);
    return { loaded: rows, emptyTsv: e.n };
  });

  const failures = compare({ raw, expected, loaded });
  if (emptyTsv) failures.push(`${emptyTsv} rows have an empty search vector`);
  console.log(`raw ${raw.length.toLocaleString()} site records, parsed ${expected.length.toLocaleString()}, loaded ${loaded.length.toLocaleString()} rows (${table})`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: every loaded row matches its release record, all ${COLUMNS.length} columns`);
  }
}

// Random rows, an even share from each collection and genre, for a reviewer
// to hold against the source by source_url. Text is cut to its first and last
// 300 characters.
async function sampleCmd(rest) {
  const n = Math.max(1, parseInt(rest[0], 10) || 20);
  const cols = COLUMNS.filter((c) => c !== 'text');
  const rows = await withClient(async (client) => {
    const { rows: strata } = await client.query(`SELECT collection, genre FROM ${TABLE} GROUP BY 1, 2 ORDER BY 1, 2`);
    const per = Math.ceil(n / strata.length);
    const out = [];
    for (const s of strata) {
      const { rows: picked } = await client.query(
        `SELECT ${cols.join(', ')}, length(text) AS chars, left(text, 300) AS text_start, right(text, 300) AS text_end
         FROM ${TABLE} WHERE collection = $1 AND genre = $2 ORDER BY random() LIMIT $3`,
        [s.collection, s.genre, per],
      );
      out.push(...picked);
    }
    return out.slice(0, n);
  });
  await mkdir(resolve(ROOT, 'tmp/corpus'), { recursive: true });
  const out = resolve(ROOT, 'tmp/corpus/sample.json');
  await writeFile(out, JSON.stringify(rows, null, 2));
  console.log(`${rows.length} rows to ${out}`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'schema': await schemaCmd(); break;
    case 'load': await loadCmd(); break;
    case 'check': await checkCmd(rest); break;
    case 'sample': await sampleCmd(rest); break;
    default:
      console.error('usage: cli.mjs schema|load|check [--table t]|sample N');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
