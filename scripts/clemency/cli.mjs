#!/usr/bin/env node
// DOJ clemency recipient lists: fetch, parse, load, check.
//
//   npm run clemency -- fetch      download every page into tmp/clemency/raw/ (10 s apart)
//   npm run clemency -- parse      parse every page, print counts
//   npm run clemency -- schema     apply db/clemency.sql (table and functions)
//   npm run clemency -- load       replace every row of clemency_grants in one transaction
//   npm run clemency -- check      compare raw, parsed and loaded rows field by field
//   npm run clemency -- sample N   N random rows, spread across pages, to tmp/clemency/sample.json
//   npm run clemency -- archive [--dry-run]
//                                  copy tmp/clemency/raw/ to the private R2 bucket under its
//                                  fetch date and verify every file by MD5 (scripts/lib/archive.mjs)
//   npm run clemency -- refresh    fetch, load, check, archive
//
// DOJ edits these pages in place with each administration, so the archive
// keeps each fetch as its own vintage: verbatim/clemency/<fetch date>/<file>.
//
// The whole table is the unit a load replaces: positions are page order, and
// the group detail pages join the list page that points at them.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/clemency/raw/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, PACE_MS } from './sources.mjs';
import { build } from './parse.mjs';
import { compare, rawCount, COLUMNS } from './check.mjs';
import { withClient, inTransaction, insertBatches } from '../lib/db.mjs';
import { archiveCommand, dirFiles, latestDate } from '../lib/archive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'tmp/clemency/raw');
const TABLE = 'clemency_grants';
const UA = 'verbatim.fyi data loader (+https://github.com/centricle/verbatim)';

const TYPES = { position: 'integer', grant_date: 'date', grant_year: 'integer' };
const LOAD_COLUMNS = COLUMNS.map((name) => [name, TYPES[name] ?? 'text']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One request per page, at the interval DOJ's robots.txt asks for. Any status
// but 200 stops the run: a 403, 429 or 503 means the publisher said no, and a
// retry would be arguing. Redirects are not followed, so a moved page stops
// the run too instead of quietly loading whatever it moved to.
async function fetchAll() {
  await mkdir(RAW, { recursive: true });
  const manifest = [];
  for (const [i, src] of PAGES.entries()) {
    if (i > 0) await sleep(PACE_MS);
    const res = await fetch(src.url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
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
      fetchedAt: new Date().toISOString(),
    };
    manifest.push(entry);
    console.log(`${src.file}  ${buf.length.toLocaleString()} bytes`);
  }
  await writeFile(resolve(RAW, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function readRaw() {
  return Promise.all(PAGES.map(async (source) => ({
    source,
    html: await readFile(resolve(RAW, source.file), 'utf8'),
  })));
}

async function frLinks() {
  return JSON.parse(await readFile(resolve(ROOT, 'scripts/clemency/fr-links.json'), 'utf8')).links;
}

async function parseCmd() {
  const files = await readRaw();
  const result = build(files, await frLinks());
  for (const p of result.pages) console.log(`${p.source.slug}  ${p.entries.length.toLocaleString()}`);
  console.log(`${result.rows.length.toLocaleString()} rows`);
  return { files, ...result };
}

async function schemaCmd() {
  const ddl = await readFile(resolve(ROOT, 'db/clemency.sql'), 'utf8');
  await withClient((client) => client.query(ddl));
  console.log('applied db/clemency.sql');
}

async function loadCmd() {
  const { rows } = await parseCmd();
  await withClient((client) => inTransaction(client, async () => {
    await client.query(`DELETE FROM ${TABLE}`);
    await insertBatches(client, TABLE, LOAD_COLUMNS, rows);
  }));
  console.log(`loaded ${rows.length.toLocaleString()} rows into ${TABLE}`);
}

// `--table <name>` checks a copy instead, for planting defects in a scratch
// table without touching the live one.
async function checkCmd(rest) {
  const i = rest.indexOf('--table');
  const table = i >= 0 ? rest[i + 1] : TABLE;
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Bad table name "${table}"`);

  const files = await readRaw();
  const links = await frLinks();
  const { rows, pages, groups } = build(files, links);
  const raw = files.map(({ source, html }) => ({ page: source.slug, count: rawCount(html) }));
  const { loaded, frDocs } = await withClient(async (client) => {
    const { rows: l } = await client.query(`SELECT ${COLUMNS.join(', ')} FROM ${table}`);
    const { rows: d } = await client.query(
      'SELECT document_number, title FROM fr_presidential_documents WHERE document_number = ANY($1)',
      [links.map((x) => x.fr.document_number)],
    );
    return { loaded: l, frDocs: d };
  });

  const failures = compare({ raw, pages, groups, expected: rows, loaded, frLinks: links, frDocs });
  const rawTotal = raw.reduce((n, r) => n + r.count, 0);
  console.log(`raw ${rawTotal.toLocaleString()} entries, parsed ${rows.length.toLocaleString()}, loaded ${loaded.length.toLocaleString()} rows (${table})`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: every page's count, heading and group totals, ${links.length} FR links, every loaded row in all ${COLUMNS.length} columns`);
  }
}

// Random rows spread evenly across DOJ's pages (each page is one era's
// layout), for a reviewer to hold against the source by source_ref.
async function sampleCmd(rest) {
  const n = Math.max(1, parseInt(rest[0], 10) || 40);
  const rows = await withClient(async (client) => {
    const { rows: strata } = await client.query(`SELECT page FROM ${TABLE} GROUP BY page ORDER BY random()`);
    const out = [];
    for (const [i, s] of strata.entries()) {
      const take = Math.floor(n / strata.length) + (i < n % strata.length ? 1 : 0);
      if (!take) continue;
      const { rows: picked } = await client.query(
        `SELECT ${COLUMNS.join(', ')} FROM ${TABLE} WHERE page = $1 ORDER BY random() LIMIT $2`,
        [s.page, take],
      );
      out.push(...picked);
    }
    return out;
  });
  await mkdir(resolve(ROOT, 'tmp/clemency'), { recursive: true });
  const out = resolve(ROOT, 'tmp/clemency/sample.json');
  await writeFile(out, JSON.stringify(rows, null, 2));
  console.log(`${rows.length} rows to ${out}`);
}

// The vintage is the latest fetch in the manifest.
export const ARCHIVE = {
  clemency: {
    prefix: 'verbatim/clemency/',
    files: async () => {
      const manifest = JSON.parse(await readFile(resolve(RAW, 'manifest.json'), 'utf8'));
      const date = latestDate(manifest.map((m) => m.fetchedAt));
      return dirFiles(RAW, `verbatim/clemency/${date}/`, { keep: (rel) => !rel.includes('/') && /\.(html|json)$/.test(rel) });
    },
  },
};

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'fetch': await fetchAll(); break;
    case 'parse': await parseCmd(); break;
    case 'schema': await schemaCmd(); break;
    case 'load': await loadCmd(); break;
    case 'check': await checkCmd(rest); break;
    case 'sample': await sampleCmd(rest); break;
    case 'archive': await archiveCommand(ARCHIVE, rest); break;
    // Archive runs last and even after a failed check: the raw copies are
    // worth keeping whatever the parse made of them.
    case 'refresh':
      await fetchAll();
      await loadCmd();
      await checkCmd([]);
      await archiveCommand(ARCHIVE);
      break;
    default:
      console.error('usage: cli.mjs fetch|parse|schema|load|check [--table t]|sample N|archive [--dry-run]|refresh');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
