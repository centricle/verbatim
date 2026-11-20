#!/usr/bin/env node
// Federal Register executive orders and proclamations: fetch FR's metadata,
// join it to the corpus release, load, check.
//
//   npm run executive -- fetch      FR's listing pages into tmp/executive/raw/
//   npm run executive -- parse      join and parse notes, print counts and anything unplaced
//   npm run executive -- schema     apply db/executive.sql (table and functions)
//   npm run executive -- load       replace every row of fr_presidential_documents in one transaction
//   npm run executive -- check      compare raw, parsed and loaded rows field by field
//   npm run executive -- sample N   N stratified random rows to tmp/executive/sample.json
//   npm run executive -- archive [--dry-run]
//                                   copy tmp/executive/raw/ to the private R2 bucket under its
//                                   fetch date, verify every file by MD5 (scripts/lib/archive.mjs)
//   npm run executive -- refresh    fetch, load, check, archive
//
// FR's listing pages move with every new document, so each fetch is archived
// as its own vintage: verbatim/executive/<fetch date>/<file>. The documents'
// text is archived with the corpus build (`npm run corpus -- archive build`).
//
// The documents' text comes from data/corpus/release.jsonl, so a refresh that
// should pick up new documents starts on the corpus side: rerun
// scripts/corpus/import_federal_register.py, build_release.py and
// check_release.py, then refresh here.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/executive/raw/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES, pageUrl, pageFile } from './sources.mjs';
import { LOAD_COLUMNS, COLUMNS, buildRows, frDocuments, irregularities } from './parse.mjs';
import { compare, notesFailures, rawScan } from './check.mjs';
import { parseRelease } from '../corpus/parse.mjs';
import { withClient, inTransaction, insertBatches } from '../lib/db.mjs';
import { archiveCommand, dirFiles, latestDate } from '../lib/archive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'tmp/executive/raw');
const RELEASE = resolve(process.env.CORPUS_DIR ?? resolve(ROOT, 'data/corpus'), 'release.jsonl');
const TABLE = 'fr_presidential_documents';
const PACE_MS = 2000;
// Some proclamations carry long annexes, so a batch is counted in records.
const BATCH = 50;
const USER_AGENT = 'verbatim.fyi data loader (+https://github.com/centricle/verbatim)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One listing per type, page by page, two seconds apart. Any status but 200
// stops the run: a 403, 429 or 503 means the publisher said no, and a retry
// would be arguing. A listing whose pages add up to less than its own count
// stops it too.
async function fetchCmd() {
  await mkdir(RAW, { recursive: true });
  const manifest = { fetchedAt: new Date().toISOString(), pages: [] };
  let first = true;
  for (const type of TYPES) {
    let seen = 0;
    let count = null;
    for (let page = 1; ; page++) {
      if (!first) await sleep(PACE_MS);
      first = false;
      const url = pageUrl(type, page);
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}. Stopping; no retry.`);
      const buf = Buffer.from(await res.arrayBuffer());
      const json = JSON.parse(buf.toString('utf8'));
      const results = json.results ?? [];
      count ??= json.count;
      if (!results.length) break;
      const file = pageFile(type, page);
      await writeFile(resolve(RAW, file), buf);
      seen += results.length;
      manifest.pages.push({ type, page, file, results: results.length, count: json.count,
        sha256: createHash('sha256').update(buf).digest('hex') });
      console.log(`${file}  ${results.length} documents`);
      if (page >= (json.total_pages ?? page)) break;
    }
    if (seen !== count) throw new Error(`${type}: pages hold ${seen} documents, the listing says ${count}`);
    console.log(`${type}: ${seen.toLocaleString()} documents`);
  }
  await writeFile(resolve(RAW, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function readRaw() {
  const manifest = JSON.parse(await readFile(resolve(RAW, 'manifest.json'), 'utf8'));
  const pages = await Promise.all(manifest.pages.map(async (p) => ({
    type: p.type,
    json: JSON.parse(await readFile(resolve(RAW, p.file), 'utf8')),
  })));
  return { manifest, docs: frDocuments(pages) };
}

async function build() {
  const text = await readFile(RELEASE, 'utf8');
  const records = parseRelease(text);
  const { manifest, docs } = await readRaw();
  const parsedCount = records.filter((r) => r.collection === 'executive').length;
  return { text, manifest, docs, parsedCount, ...buildRows(records, docs) };
}

function report(b) {
  console.log(`FR metadata fetched ${b.manifest.fetchedAt}: ${b.docs.length.toLocaleString()} documents`);
  console.log(`release: ${b.parsedCount.toLocaleString()} executive records; joined ${b.rows.length.toLocaleString()}, unjoined ${b.unjoined.length}`);
  for (const u of b.unjoined) console.log(`  UNJOINED ${u.id} ${u.title} ${u.source_url}`);
  for (const d of b.frDocDiffers) console.log(`  footer number ${d.fr_doc} differs from URL ${d.document_number} (${d.id})`);
  console.log(`FR documents not in the release: ${b.frOnly.length}`);
  for (const d of b.frOnly) console.log(`  ${d.document_number}  ${d.listing}  ${d.signing_date ?? 'no signing date'}  ${d.title}`);
  for (const c of b.conflicts) console.log(`  CONFLICT ${c}`);
  const withNotes = b.rows.filter((r) => r.notes !== null);
  const odd = withNotes.flatMap((r) => irregularities(r.notes_parsed).map((x) => `${r.document_number}: ${x}`));
  const oddDocs = new Set(odd.map((x) => x.split(':')[0]));
  console.log(`notes: ${withNotes.length.toLocaleString()} documents; ${oddDocs.size} with something the parser kept but could not place:`);
  for (const x of odd) console.log(`  ${x}`);
}

async function parseCmd() {
  const b = await build();
  report(b);
  for (const f of notesFailures(b.rows)) console.log(`FAIL ${f}`);
  return b;
}

async function schemaCmd() {
  const ddl = await readFile(resolve(ROOT, 'db/executive.sql'), 'utf8');
  await withClient((client) => client.query(ddl));
  console.log('applied db/executive.sql');
}

async function loadCmd() {
  const b = await parseCmd();
  const notes = notesFailures(b.rows);
  if (b.conflicts.length || notes.length) throw new Error('Not loading: conflicts or notes failures above.');
  const rows = b.rows.map((r) => ({ ...r, notes_parsed: r.notes_parsed && JSON.stringify(r.notes_parsed) }));
  const chars = rows.reduce((n, r) => n + r.text.length, 0);
  console.log(`${rows.length.toLocaleString()} rows, ${chars.toLocaleString()} characters of text to load`);
  await withClient(async (client) => {
    const size = async () => (await client.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS s')).rows[0].s;
    console.log(`database before: ${await size()}`);
    await inTransaction(client, async () => {
      await client.query(`DELETE FROM ${TABLE}`);
      await insertBatches(client, TABLE, LOAD_COLUMNS, rows, BATCH);
    });
    console.log(`loaded ${rows.length.toLocaleString()} rows into ${TABLE}; database after: ${await size()}`);
  });
}

// `--table <name>` checks a copy instead, for planting defects in a scratch
// table without touching the live one.
async function checkCmd(rest) {
  const i = rest.indexOf('--table');
  const table = i >= 0 ? rest[i + 1] : TABLE;
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Bad table name "${table}"`);

  const b = await build();
  const raw = rawScan(b.text);
  const { loaded, emptyTsv } = await withClient(async (client) => {
    const { rows } = await client.query(`SELECT ${COLUMNS.join(', ')} FROM ${table}`);
    const { rows: [e] } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE tsv = ''::tsvector`);
    return { loaded: rows, emptyTsv: e.n };
  });

  const failures = compare({ raw, parsedCount: b.parsedCount, expected: b.rows, unjoined: b.unjoined, conflicts: b.conflicts, loaded });
  if (emptyTsv) failures.push(`${emptyTsv} rows have an empty search vector`);
  console.log(`raw ${raw.length.toLocaleString()} executive records, parsed ${b.parsedCount.toLocaleString()}, joined ${b.rows.length.toLocaleString()}, unjoined ${b.unjoined.length}, loaded ${loaded.length.toLocaleString()} rows (${table})`);
  for (const u of b.unjoined) console.log(`  UNJOINED ${u.id} ${u.title}`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: every loaded row matches its release record and FR's metadata, all ${COLUMNS.length} columns; every note reads as FR's`);
  }
}

// Random rows, an even share from each type and president, for a reviewer to
// hold against FR at html_url. Text is cut to its first and last 300 characters.
async function sampleCmd(rest) {
  const n = Math.max(1, parseInt(rest[0], 10) || 20);
  const cols = COLUMNS.filter((c) => c !== 'text');
  const rows = await withClient(async (client) => {
    const { rows: strata } = await client.query(`SELECT type, president FROM ${TABLE} GROUP BY 1, 2 ORDER BY 1, 2`);
    const per = Math.ceil(n / strata.length);
    const out = [];
    for (const s of strata) {
      const { rows: picked } = await client.query(
        `SELECT ${cols.join(', ')}, length(text) AS chars, left(text, 300) AS text_start, right(text, 300) AS text_end
         FROM ${TABLE} WHERE type = $1 AND president = $2 ORDER BY random() LIMIT $3`,
        [s.type, s.president, per],
      );
      out.push(...picked);
    }
    return out.slice(0, n);
  });
  await mkdir(resolve(ROOT, 'tmp/executive'), { recursive: true });
  const out = resolve(ROOT, 'tmp/executive/sample.json');
  await writeFile(out, JSON.stringify(rows, null, 2));
  console.log(`${rows.length} rows to ${out}`);
}

export const ARCHIVE = {
  executive: {
    prefix: 'verbatim/executive/',
    files: async () => {
      const { fetchedAt } = JSON.parse(await readFile(resolve(RAW, 'manifest.json'), 'utf8'));
      return dirFiles(RAW, `verbatim/executive/${latestDate([fetchedAt])}/`, { keep: (rel) => !rel.includes('/') && rel.endsWith('.json') });
    },
  },
};

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'fetch': await fetchCmd(); break;
    case 'parse': await parseCmd(); break;
    case 'schema': await schemaCmd(); break;
    case 'load': await loadCmd(); break;
    case 'check': await checkCmd(rest); break;
    case 'sample': await sampleCmd(rest); break;
    case 'archive': await archiveCommand(ARCHIVE, rest); break;
    // Archive runs last and even after a failed check: the raw copies are
    // worth keeping whatever the parse made of them.
    case 'refresh': await fetchCmd(); await loadCmd(); await checkCmd([]); await archiveCommand(ARCHIVE); break;
    default:
      console.error('usage: cli.mjs fetch|parse|schema|load|check [--table t]|sample N|archive [--dry-run]|refresh');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
