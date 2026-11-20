// Report of the Secretary of the Senate: fetch, parse, load, check.
//
//   npm run disbursements -- senate links                  list the volumes the Senate page links
//   npm run disbursements -- senate fetch [U...]           download volumes not yet in tmp/disbursements/raw/senate/
//   npm run disbursements -- senate fetch --again U...     download those volumes again (re-issued in place)
//   npm run disbursements -- senate parse [U...]           parse, reconcile, raw scan; discrepancies to tmp/disbursements/senate-discrepancies.json
//   npm run disbursements -- senate load --target E [U...] replace each volume's rows, one transaction per volume, then refresh stats
//   npm run disbursements -- senate check [U...]           raw vs parsed vs loaded, every column
//
// U is a unit like senate-fy2026h1 (October 2025 to March 2026); none means
// every volume downloaded. E is the Neon endpoint DATABASE_URL points at, as
// in cli.mjs. The schema is cli.mjs's: `npm run disbursements -- schema`.
//
// Needs poppler's pdftotext (Homebrew `poppler`). The PDFs are untrusted
// data: pdftotext reads them, nothing runs from tmp/disbursements/raw/.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SENATE_PAGE, senateVolumes } from './senate-sources.mjs';
import { parseVolume } from './senate-parse.mjs';
import { loadOcr, ocrPage, ocrFile } from './senate-ocr.mjs';
import { rawScan, compare } from './senate-check.mjs';
import { COLUMNS } from './check.mjs';
import { LOAD_COLUMNS, requireTarget, refreshStats, checkStats } from './cli.mjs';
import { withClient, inTransaction, insertBatches } from '../lib/db.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = resolve(ROOT, 'tmp/disbursements/raw/senate');
const MANIFEST = resolve(RAW, 'manifest.json');
const TABLE = 'disbursements';
const PACE_MS = 5000;
const UA = { 'User-Agent': 'verbatim.fyi data loader (https://github.com/centricle/verbatim)' };
const run = promisify(execFile);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const units = (rest) => rest.filter((a) => /^senate-fy\d{4}h[12]$/.test(a));
const fileFor = (v) => `${v.id}.pdf`;

// One GET, no retry, as in cli.mjs.
async function get(url) {
  const res = await fetch(url, { headers: UA });
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}. Stopping; no retry.`);
  return res;
}

async function readManifest() {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')); } catch { return {}; }
}

async function links() {
  const html = await (await get(SENATE_PAGE)).text();
  const all = senateVolumes(html);
  await mkdir(RAW, { recursive: true });
  await writeFile(resolve(RAW, 'links.json'), JSON.stringify(all, null, 2));
  return all;
}

async function linksCmd() {
  const all = await links();
  for (const v of all) console.log(`${v.unit}  ${v.id}  ${v.label}`);
  console.log(`${all.length} volumes, ${all[0]?.label} to ${all.at(-1)?.label}`);
}

async function fetchCmd(rest) {
  const again = rest.includes('--again');
  const wanted = new Set(units(rest));
  if (again && !wanted.size) throw new Error('--again needs the units to download again');
  const manifest = await readManifest();
  const present = new Set(await readdir(RAW).catch(() => []));
  const all = await links();
  for (const u of wanted) if (!all.some((v) => v.unit === u)) throw new Error(`${u} is not linked from the Senate page`);
  const todo = all.filter((v) => (wanted.size ? wanted.has(v.unit) : true) && (again || !present.has(fileFor(v))));
  console.log(`${todo.length} to download`);
  for (const v of todo) {
    await sleep(PACE_MS);
    const res = await get(v.url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${v.url} is not a PDF`);
    await writeFile(resolve(RAW, fileFor(v)), buf);
    manifest[v.unit] = {
      ...v,
      file: fileFor(v),
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      lastModified: res.headers.get('last-modified'),
      fetchedAt: new Date().toISOString(),
    };
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`${v.unit}  ${buf.length.toLocaleString()} bytes  ${manifest[v.unit].lastModified}`);
  }
}

// Volumes on disk with a manifest entry, filtered to `rest` if given.
async function local(rest) {
  const manifest = await readManifest();
  const wanted = units(rest);
  const us = wanted.length ? wanted : Object.keys(manifest).sort();
  if (!us.length) throw new Error('No volumes downloaded; run senate fetch first');
  return us.map((u) => {
    const m = manifest[u];
    if (!m) throw new Error(`${u} is not in ${MANIFEST}; run senate fetch ${u}`);
    return m;
  });
}

// One volume, read and parsed. Large: the bbox XHTML runs to about 120 MB.
async function parseOne(m) {
  const file = resolve(RAW, m.file);
  const buf = await readFile(file);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== m.sha256) throw new Error(`${m.file} does not match its manifest sha256`);
  const opts = { maxBuffer: 1 << 30, encoding: 'utf8' };
  const [{ stdout: bbox }, { stdout: layout }] = await Promise.all([
    run('pdftotext', ['-bbox-layout', file, '-'], opts),
    run('pdftotext', ['-layout', file, '-'], opts),
  ]);
  const source = { unit: m.unit, url: m.url, start: m.start, end: m.end, file: m.file };
  return { source, parsed: parseVolume(bbox, source, loadOcr(source.unit)), raw: rawScan(layout) };
}

const dollars = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

async function parseCmd(rest) {
  let total = 0;
  let failed = 0;
  const report = {};
  for (const m of await local(rest)) {
    const t0 = Date.now();
    const { parsed, raw } = await parseOne(m);
    const failures = compare({ unit: m.unit, raw, parsed, loaded: null });
    const t = parsed.tally;
    total += parsed.rows.length;
    failed += failures.length;
    report[m.unit] = { id: m.id, tally: t, discrepancies: parsed.discrepancies };
    const disc = parsed.discrepancies.length ? `  ${parsed.discrepancies.length} discrepancies (${dollars(t.discrepancyCents)} vs summary)` : '';
    console.log(`${m.unit}  ${t.blocks.toString().padStart(5)} blocks  ${parsed.rows.length.toLocaleString().padStart(7)} rows  ${dollars(t.keptCents).padStart(16)}  ${failures.length ? `${failures.length} FAIL` : 'reconciles'}${disc}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const f of failures.slice(0, 10)) console.log(`  FAIL ${f}`);
  }
  await mkdir(resolve(ROOT, 'tmp/disbursements'), { recursive: true });
  await writeFile(resolve(ROOT, 'tmp/disbursements/senate-discrepancies.json'), JSON.stringify(report, null, 2));
  console.log(`${total.toLocaleString()} rows to load`);
  if (failed) process.exitCode = 1;
}

// One transaction per volume: delete the unit, insert its rows. A volume
// that fails any check is never loaded.
async function loadCmd(rest) {
  requireTarget(rest);
  const ms = await local(rest);
  await withClient(async (client) => {
    for (const m of ms) {
      const { parsed, raw } = await parseOne(m);
      const failures = compare({ unit: m.unit, raw, parsed, loaded: null });
      if (failures.length) throw new Error(`${m.unit} does not reconcile (${failures[0]}); nothing loaded for it`);
      const t0 = Date.now();
      await inTransaction(client, async () => {
        await client.query(`DELETE FROM ${TABLE} WHERE unit = $1`, [m.unit]);
        await insertBatches(client, TABLE, LOAD_COLUMNS, parsed.rows, 2000);
      });
      console.log(`${m.unit}  ${parsed.rows.length.toLocaleString()} rows  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    await refreshStats(client);
  });
}

async function checkCmd(rest) {
  const ms = await local(rest);
  let failed = 0;
  let total = 0;
  await withClient(async (client) => {
    for (const m of ms) {
      const { parsed, raw } = await parseOne(m);
      const { rows: loaded } = await client.query(`SELECT ${COLUMNS.join(', ')} FROM ${TABLE} WHERE unit = $1`, [m.unit]);
      const failures = compare({ unit: m.unit, raw, parsed, loaded });
      total += loaded.length;
      failed += failures.length;
      console.log(`${m.unit}  ${loaded.length.toLocaleString().padStart(8)} loaded  ${failures.length ? `${failures.length} FAIL` : 'PASS'}`);
      for (const f of failures.slice(0, 10)) console.log(`  FAIL ${f}`);
    }
    if (!units(rest).length) {
      const known = new Set(ms.map((m) => m.unit));
      const { rows: present } = await client.query(`SELECT DISTINCT unit FROM ${TABLE} WHERE chamber = 'senate'`);
      for (const { unit } of present) {
        if (!known.has(unit)) { failed++; console.log(`FAIL ${unit} is in ${TABLE} but not downloaded`); }
      }
    }
    failed += await checkStats(client);
  });
  if (failed) process.exitCode = 1;
  else console.log(`PASS: ${total.toLocaleString()} rows in ${ms.length} volumes match their sources, all ${COLUMNS.length} columns`);
}

// Raw OCR of one page, for building its transcription (senate-ocr.mjs).
// Written under tmp/, never to senate-ocr/: what is committed there is the
// reviewed transcription, not tesseract's first reading.
async function ocrCmd([unit, page]) {
  const manifest = await readManifest();
  const m = manifest[unit];
  if (!m || !/^\d+$/.test(page ?? '')) throw new Error('usage: senate ocr <unit> <page>');
  const out = resolve(ROOT, `tmp/disbursements/ocr/${unit}-p${page}.raw.json`);
  mkdirSync(dirname(out), { recursive: true });
  const r = ocrPage(resolve(RAW, m.file), Number(page));
  writeFileSync(out, `${JSON.stringify(r, null, 1)}\n`);
  console.log(`${r.lines.length} lines -> ${out}${existsSync(ocrFile(unit, page)) ? ' (a transcription is already committed)' : ''}`);
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'links': await linksCmd(); break;
    case 'fetch': await fetchCmd(rest); break;
    case 'parse': await parseCmd(rest); break;
    case 'load': await loadCmd(rest); break;
    case 'check': await checkCmd(rest); break;
    case 'ocr': await ocrCmd(rest); break;
    default:
      console.error('usage: cli.mjs senate links|fetch [--again] [U...]|parse [U...]|load --target E [U...]|check [U...]|ocr <unit> <page>');
      process.exitCode = 2;
  }
}
