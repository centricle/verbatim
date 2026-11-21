#!/usr/bin/env node
// Supreme Court sources for the G1 survey: fetch, slice, archive. Nothing here
// touches Neon or the site; the loader, table and page are a later plan.
//
//   npm run scotus -- fetch [source...] [--dry-run]
//       Discover each source's files (list pages are saved as they are read),
//       HEAD every file not yet complete, print the totals, then download.
//       --dry-run stops after the totals; the HEAD answers are kept in
//       plan.json, so the real run that day does not ask again. Sources:
//       cl, fjc, court-pdf, transcripts, cap-us, cap-sct, and scdb, which is
//       saved by hand (the command lists what is missing). --max-gb=N
//       refuses to download when a source's total is over N GB.
//   npm run scotus -- filter-cl
//       Cut the Supreme Court's rows out of CourtListener's all-court tables
//       (dockets -> clusters -> opinions, citations, panels, joins) into
//       tmp/scotus/raw/cl/slices/*.scotus.csv.zst, byte for byte.
//   npm run scotus -- archive [source...] [--dry-run]
//       Copy each source to the private R2 bucket under verbatim/scotus/ and
//       verify every file by MD5 (scripts/lib/archive.mjs). Bound volumes and
//       the scanned transcripts stay off R2 (the archive section says why).
//
// Every file lands in tmp/scotus/raw/<source>/ with a manifest.json entry:
// url, bytes, sha256, fetchedAt, Last-Modified, ETag. A rerun skips a file
// whose manifest entry matches its size on disk. A file found on disk with
// no entry (the CourtListener files were started by hand before this
// existed) is adopted when its size matches the server's.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/scotus/raw/.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveCommand, entry, hashFile, localDate } from '../lib/archive.mjs';
import {
  BOUND_NEW, BOUND_SAMPLE, CAP, CAP_BASE, CL_BASE, CL_SLICED, CL_SNAPSHOT, CL_WHOLE, COURT,
  FIRST_PRELIM, FIRST_SLIP_TERM, FIRST_TRANSCRIPT_TERM, FJC_PAGE, LAST_ARCHIVED_TERM, SCDB_FILES, SCDB_PAGE,
  TRANSCRIPT_SCAN_SAMPLE, US_REPORTS_PAGE,
  currentTerm, ordersPage, range, rawDir, sliceName, slipPage, transcriptPage,
} from './sources.mjs';
import { collisions, links, localName, pdfLinks, usReportsVolumes } from './links.mjs';
import { isComplete, manifestEntry, merge, readManifest, sizeOf, writeManifest } from './manifest.mjs';
import { Blocked, client } from './fetch.mjs';
import { slice } from './cl-csv.mjs';

const today = () => localDate(Date.now());
const gb = (n) => `${(n / 1e9).toFixed(2)} GB`;

// One source's working state: its directory, manifest and HEAD plan.
async function open(name) {
  const dir = rawDir(name);
  await mkdir(dir, { recursive: true });
  let manifest = await readManifest(dir);
  const add = async (e) => {
    manifest = merge(manifest, [e]);
    await writeManifest(dir, manifest);
  };
  const find = (file) => manifest.find((e) => e.file === file);
  return { name, dir, add, find, get manifest() { return manifest; } };
}

// A list page, read from disk when today's copy is complete, else fetched and
// saved. 404 is null (a term with no page); any other failure throws.
async function page(src, p, opts = {}) {
  const path = join(src.dir, p.file);
  const e = src.find(p.file);
  if (e && localDate(e.fetchedAt) === today() && isComplete(e, await sizeOf(path))) return readFile(path, 'utf8');
  const r = await client(p.url).get(p.url, opts);
  if (r.status === 404) {
    console.log(`404 ${p.url} (no page)`);
    return null;
  }
  if (r.status !== 200) throw new Error(`${p.url}: HTTP ${r.status}${r.note ? ` (${r.note})` : ''}`);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, r.buf);
  await src.add(manifestEntry({
    file: p.file, url: p.url, bytes: r.buf.length, sha256: createHash('sha256').update(r.buf).digest('hex'),
    fetchedAt: new Date().toISOString(), headers: r.headers, servedFrom: r.servedFrom,
  }));
  return r.buf.toString('utf8');
}

// --- discovery: each returns [{ file, url, group }] ------------------------

const DISCOVER = {
  async cl() {
    return [
      ...CL_WHOLE.map((f) => ({ file: f, url: `${CL_BASE}/${f}`, group: 'whole tables' })),
      ...CL_SLICED.map((s) => ({ file: s.file, url: `${CL_BASE}/${s.file}`, group: 'all-court tables (sliced locally)' })),
    ];
  },

  async fjc(src) {
    const html = await page(src, { file: 'export.html', url: FJC_PAGE });
    return links(html, FJC_PAGE, (u) => u.host === 'www.fjc.gov' && /^\/sites\/default\/files\/history\/[^/]+\.(csv|xlsx)$/i.test(u.pathname))
      .map((url) => ({ file: localName(url), url, group: 'export' }));
  },

  async 'court-pdf'(src) {
    const out = [];
    const vols = usReportsVolumes(await page(src, { file: 'pages/USReports.html', url: US_REPORTS_PAGE }), US_REPORTS_PAGE);
    for (const v of [...BOUND_SAMPLE, ...BOUND_NEW]) {
      const urls = vols.get(v);
      if (!urls?.length) throw new Error(`court-pdf: the U.S. Reports page lists no PDF for volume ${v}`);
      for (const url of urls) out.push({ file: `bound/${localName(url)}`, url, group: v >= BOUND_NEW[0] ? 'bound 573-587' : 'bound OCR sample' });
    }
    for (const v of [...vols.keys()].filter((v) => v >= FIRST_PRELIM).sort((a, b) => a - b)) {
      for (const url of vols.get(v)) out.push({ file: `prelim/${localName(url)}`, url, group: 'preliminary prints' });
    }
    const have = new Set(out.map((t) => t.url));
    const opinionsPdf = (u) => u.host === new URL(COURT).host && u.pathname.startsWith('/opinions/');
    for (const term of range(FIRST_SLIP_TERM, currentTerm())) {
      for (const [p, dir, group] of [[slipPage(term), 'slip', 'slip opinions'], [ordersPage(term), 'orders', 'opinions relating to orders']]) {
        const html = await page(src, p);
        if (!html) continue;
        for (const url of pdfLinks(html, p.url, opinionsPdf)) {
          if (have.has(url)) continue;
          have.add(url);
          out.push({ file: `${dir}/${term}/${localName(url)}`, url, group });
        }
      }
    }
    return out;
  },

  async transcripts(src) {
    const out = [];
    for (const term of range(FIRST_TRANSCRIPT_TERM, currentTerm())) {
      if (term <= LAST_ARCHIVED_TERM && !TRANSCRIPT_SCAN_SAMPLE.includes(term)) continue;
      const p = transcriptPage(term);
      const html = await page(src, p);
      if (!html) continue;
      const found = pdfLinks(html, p.url, (u) => u.host === new URL(COURT).host && /transcripts\//i.test(u.pathname));
      for (const url of found) out.push({ file: `${term}/${localName(url)}`, url, group: term < 2000 ? 'scanned (before OT2000)' : 'OT2000 on' });
    }
    return out;
  },

  ...Object.fromEntries(Object.entries(CAP).map(([name, cap]) => [name, async (src) => {
    const index = `${CAP_BASE}/${cap.reporter}/`;
    const opts = { exception: cap.robotsException };
    const html = await page(src, { file: 'pages/index.html', url: index }, opts);
    const wanted = (u) => {
      if (u.host !== 'static.case.law') return false;
      const m = new RegExp(`^/${cap.reporter}/(\\d+)\\.zip$`).exec(u.pathname);
      if (m) return !cap.volumes || cap.volumes.includes(Number(m[1]));
      return new RegExp(`^/${cap.reporter}/[^/]+\\.json$`).test(u.pathname);
    };
    return links(html, index, wanted).map((url) => ({ file: localName(url), url, group: url.endsWith('.zip') ? 'volume zips' : 'metadata', opts }));
  }])),
};

// --- fetch -------------------------------------------------------------------

// SCDB is saved by hand, so "fetch scdb" writes the manifest for whatever is
// in the directory (bytes, sha256, the file's mtime as savedAt) and lists the
// expected files still missing.
async function scdbCheck() {
  const src = await open('scdb');
  const files = (await readdir(src.dir)).filter((f) => !f.startsWith('.') && f !== 'manifest.json').sort();
  for (const f of files) {
    const path = join(src.dir, f);
    const size = await sizeOf(path);
    if (isComplete(src.find(f), size)) continue;
    const { sha256 } = await hashFile(path, ['sha256']);
    const { mtime } = await stat(path);
    await src.add({ file: f, url: SCDB_FILES[f] ?? SCDB_PAGE, bytes: size, sha256, fetchedAt: mtime.toISOString(), savedByHand: true });
  }
  const missing = Object.keys(SCDB_FILES).filter((f) => !files.includes(f));
  console.log(`scdb: ${files.length} files saved by hand in ${src.dir}${files.length ? `: ${files.join(', ')}` : ''}`);
  if (missing.length) {
    console.log('scdb.la.psu.edu answers scripts with a Cloudflare challenge. In a browser, save:');
    for (const f of missing) console.log(`  ${f}  (${SCDB_FILES[f]})`);
  }
}

async function fetchSource(name, dryRun, maxBytes = Infinity) {
  if (name === 'scdb') return scdbCheck();
  if (!DISCOVER[name]) throw new Error(`no source "${name}" (${[...Object.keys(DISCOVER), 'scdb'].join(', ')})`);
  const src = await open(name);
  const targets = await DISCOVER[name](src);
  const clash = collisions(targets);
  if (clash.length) throw new Error(`${name}: ${clash.length} local names collide, first ${JSON.stringify(clash[0])}`);

  const todo = [];
  for (const t of targets) {
    const size = await sizeOf(join(src.dir, t.file));
    if (!isComplete(src.find(t.file), size)) todo.push({ ...t, size });
  }

  // HEAD pass: sizes and totals before any download.
  const planPath = join(src.dir, 'plan.json');
  const plan = await readFile(planPath, 'utf8').then(JSON.parse, () => ({}));
  let asked = 0;
  for (const t of todo) {
    const rec = plan[t.url];
    if (rec && localDate(rec.at) === today()) continue;
    plan[t.url] = await client(t.url).head(t.url, t.opts);
    if (++asked % 50 === 0) {
      await writeFile(planPath, JSON.stringify(plan, null, 1));
      console.log(`${name}: HEAD ${asked} of ${todo.length}`);
    }
  }
  await writeFile(planPath, JSON.stringify(plan, null, 1));
  const pending = new Set(todo.map((t) => t.file));
  const groups = new Map();
  for (const t of targets) {
    const g = groups.get(t.group) ?? { files: 0, done: 0, todo: 0, bytes: 0, unknown: 0, failed: 0 };
    g.files++;
    if (!pending.has(t.file)) g.done++;
    else {
      const rec = plan[t.url];
      if (rec.status !== 200) g.failed++;
      else if (rec.bytes === null) g.unknown++;
      else {
        g.todo++;
        g.bytes += rec.bytes;
      }
    }
    groups.set(t.group, g);
  }
  console.log(`\n${name}: ${targets.length.toLocaleString()} files`);
  let total = 0;
  for (const [group, g] of groups) {
    total += g.bytes;
    console.log(`  ${group}: ${g.files.toLocaleString()} files; ${g.done.toLocaleString()} complete; ${g.todo.toLocaleString()} to fetch, ${gb(g.bytes)}${g.unknown ? `; ${g.unknown} of unknown size` : ''}${g.failed ? `; ${g.failed} not 200 on HEAD` : ''}`);
  }
  console.log(`  to fetch: ${gb(total)}`);
  if (dryRun) return [];
  if (total > maxBytes) throw new Error(`${name}: ${gb(total)} to fetch is over --max-gb ${gb(maxBytes)}; nothing downloaded`);

  const failures = [];
  for (const [i, t] of todo.entries()) {
    const rec = plan[t.url];
    if (rec.status !== 200) {
      failures.push(`${t.url}: HEAD ${rec.status}${rec.note ? ` (${rec.note})` : ''}`);
      continue;
    }
    const path = join(src.dir, t.file);
    if (t.size !== null && rec.bytes !== null && t.size === rec.bytes) {
      const { sha256 } = await hashFile(path, ['sha256']);
      const { mtime } = await stat(path);
      await src.add(manifestEntry({
        file: t.file, url: t.url, bytes: t.size, sha256, fetchedAt: mtime.toISOString(),
        headers: { 'last-modified': rec.lastModified, etag: rec.etag }, adopted: true,
      }));
      console.log(`adopted ${t.file} (${t.size.toLocaleString()} bytes, already on disk)`);
      continue;
    }
    const got = await client(t.url).download(t.url, path, t.opts);
    if (!got.sha256) {
      failures.push(`${t.url}: HTTP ${got.status}${got.note ? ` (${got.note})` : ''}`);
      continue;
    }
    await src.add(manifestEntry({ file: t.file, url: t.url, fetchedAt: new Date().toISOString(), ...got }));
    if (todo.length < 40 || (i + 1) % 25 === 0 || got.bytes > 1e8) console.log(`${name}: ${i + 1}/${todo.length} ${t.file} ${got.bytes.toLocaleString()} bytes`);
  }
  if (!failures.length) console.log(`${name}: every file complete`);
  return failures;
}

async function fetchCmd(args) {
  const dryRun = args.includes('--dry-run');
  const cap = args.find((a) => a.startsWith('--max-gb='));
  const maxBytes = cap ? Number(cap.split('=')[1]) * 1e9 : Infinity;
  const names = args.filter((a) => !a.startsWith('--'));
  const wanted = names.length ? names : ['cl', 'fjc', 'court-pdf', 'transcripts', 'scdb'];
  // Sources on one host share its client, which serializes their requests;
  // sources on different hosts run in parallel.
  const results = await Promise.allSettled(wanted.map((n) => fetchSource(n, dryRun, maxBytes)));
  let bad = false;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      bad = true;
      console.log(`${r.reason instanceof Blocked ? 'BLOCKED' : 'FAIL'} ${wanted[i]}: ${r.reason.message}`);
    } else for (const f of r.value ?? []) {
      bad = true;
      console.log(`FAIL ${wanted[i]}: ${f}`);
    }
  });
  if (bad) process.exitCode = 1;
}

// --- filter-cl ------------------------------------------------------------------

function proc(cmd, args, opts) {
  const p = spawn(cmd, args, opts);
  const done = once(p, 'close').then(([code]) => {
    if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${code}`);
  });
  return { p, done };
}

// 7zz decodes bzip2 on several threads (about twice bzip2's speed here);
// lbzip2 is not in Homebrew.
const decompress = (path) => proc('7zz', ['e', '-so', '-tbzip2', path], { stdio: ['ignore', 'pipe', 'ignore'] });

async function writeTo(stream, buf) {
  if (!stream.write(buf)) await once(stream, 'drain');
}

async function filterCl() {
  const src = await open('cl');
  const outDir = join(src.dir, 'slices');
  await mkdir(outDir, { recursive: true });
  const sets = {};
  const made = [];
  for (const spec of CL_SLICED) {
    const from = src.find(spec.file);
    if (!from) throw new Error(`filter-cl: ${spec.file} is not in the cl manifest; run fetch cl first`);
    const dest = join(outDir, sliceName(spec.file));
    const part = `${dest}.part`;
    const started = Date.now();
    const dec = decompress(join(src.dir, spec.file));
    const zst = proc('zstd', ['-q', '-f', '-T0', '-10', '-o', part], { stdio: ['pipe', 'ignore', 'inherit'] });
    const r = await slice(dec.p.stdout, spec, sets, (buf) => writeTo(zst.p.stdin, buf));
    zst.p.stdin.end();
    await Promise.all([dec.done, zst.done]);
    await rename(part, dest);
    if (r.ids) sets[spec.keeps] = r.ids;
    const e = await entry(sliceName(spec.file), dest, { sha256: true });
    made.push({
      file: e.key, bytes: e.size, sha256: e.sha256,
      from: spec.file, fromUrl: from.url, fromSha256: from.sha256,
      rule: spec.court ? `${spec.key} = '${spec.court}'` : `${spec.key} in kept ${spec.in} ids`,
      rows: r.rows, kept: r.kept, madeAt: new Date().toISOString(),
    });
    await writeFile(join(outDir, 'manifest.json'), JSON.stringify(made, null, 2) + '\n');
    console.log(`${spec.table}: kept ${r.kept.toLocaleString()} of ${r.rows.toLocaleString()} rows, ${gb(e.size)} zstd, ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

// --- archive --------------------------------------------------------------------
//
// Keys under verbatim/scotus/<source>/ (key policy: scripts/lib/archive.mjs):
// - immutable, by name: CAP zips and metadata, bound volumes, preliminary
//   prints, SCDB files (the release is in the name).
// - under the fetch date: list pages, slip opinions and opinions relating to
//   orders (the Court revises them in place), born-digital transcripts (527
//   of 1,818 are headed "Official - Subject to Final Review" and can be
//   replaced the same way), every FJC file (updated nightly).
// - CourtListener under its snapshot date: the whole tables and the slices,
//   never the all-court originals (the manifest keeps their URLs and sha256).
// - manifest.json files are replaceable: they grow as files are added.
//
// R2 holds only what a publisher may stop serving or edit in place (ksmith,
// 2026-11-20; the free tier is 10 GB for the whole account). So:
// - bound volumes stay off R2: the Court serves them unchanged and they are
//   2.1 GB. The copies uploaded before the rule are removed from R2 once the
//   HDD mirror (npm run backup -- mirror) holds them verified; until then
//   archive lists them as extra.
// - the scanned transcripts (OT1968 to LAST_ARCHIVED_TERM) stay off R2: the
//   Court serves them unchanged, at about 9.6 MB each. Oral arguments are a
//   later phase that starts with the born-digital transcripts, which go to R2
//   now; the scans go to the HDD if they are ever used (design session,
//   brain/decisions/2026-11-20-verbatim-supreme-court-design.md).

const DATED = { 'court-pdf': /^(pages|slip|orders)\//, transcripts: /./, 'cap-us': /^pages\//, 'cap-sct': /^pages\//, fjc: /./ };
const isManifest = (key) => key.endsWith('/manifest.json');

const OFF_R2 = {
  'court-pdf': /^bound\//,
  transcripts: { test: (file) => Number(file.split('/')[0]) <= LAST_ARCHIVED_TERM },
};

function manifestKeys(name, prefix) {
  return async () => {
    const src = await open(name);
    const dated = DATED[name];
    const out = [];
    for (const e of src.manifest) {
      if (OFF_R2[name]?.test(e.file)) continue;
      const key = dated?.test(e.file) ? `${prefix}${localDate(e.fetchedAt)}/${e.file}` : `${prefix}${e.file}`;
      out.push(await entry(key, join(src.dir, e.file)));
    }
    if (src.manifest.length) {
      const stamp = dated ? `${localDate(Math.max(...src.manifest.map((e) => new Date(e.fetchedAt))))}/` : '';
      out.push(await entry(`${prefix}${stamp}manifest.json`, join(src.dir, 'manifest.json')));
    }
    return out;
  };
}

const ARCHIVE = {
  cl: {
    prefix: `verbatim/scotus/cl/${CL_SNAPSHOT}/`,
    replaceable: isManifest,
    files: async () => {
      const src = await open('cl');
      const prefix = `verbatim/scotus/cl/${CL_SNAPSHOT}/`;
      const out = [];
      if (!src.manifest.length) return out;
      for (const f of CL_WHOLE) if (src.find(f)) out.push(await entry(prefix + f, join(src.dir, f)));
      out.push(await entry(`${prefix}manifest.json`, join(src.dir, 'manifest.json')));
      const sliceDir = join(src.dir, 'slices');
      const slices = await readFile(join(sliceDir, 'manifest.json'), 'utf8').then(JSON.parse, () => []);
      for (const s of slices) out.push(await entry(`${prefix}slices/${s.file}`, join(sliceDir, s.file)));
      if (slices.length) out.push(await entry(`${prefix}slices/manifest.json`, join(sliceDir, 'manifest.json')));
      return out;
    },
  },
  ...Object.fromEntries(['scdb', 'fjc', 'court-pdf', 'transcripts', 'cap-us', 'cap-sct'].map((name) => {
    const prefix = `verbatim/scotus/${name}/`;
    return [name, { prefix, replaceable: isManifest, files: manifestKeys(name, prefix) }];
  })),
};

async function main([cmd, ...rest]) {
  switch (cmd) {
    case 'fetch': await fetchCmd(rest); break;
    case 'filter-cl': await filterCl(); break;
    case 'archive':
      await archiveCommand(ARCHIVE, rest);
      break;
    default:
      console.error('usage: cli.mjs fetch [source...] [--dry-run] | filter-cl | archive [source...] [--dry-run]');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
