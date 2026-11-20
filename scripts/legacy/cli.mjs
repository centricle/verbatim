// The four datasets loaded once in May 2026, before the loaders had a home:
// COMPAS, Fatal Force, FEC candidates and qualified immunity. Their loaders
// were never kept, so until 2026-11-20 Neon and its dumps held the only copy
// of what was loaded. This fetches each source as it stands today and
// archives it; today's file may not match what was loaded in May, which is
// why every copy is dated.
//
//   npm run legacy -- fetch [compas|fatal-force|fec]   download into tmp/legacy/<dataset>/raw/
//   npm run legacy -- archive [<dataset>...] [--dry-run]
//                                     copy each tmp/legacy/<dataset>/raw/ to the private R2
//                                     bucket at verbatim/legacy/<dataset>/<fetch date>/ and
//                                     verify every file by MD5 (scripts/lib/archive.mjs)
//
// qi has no fetch: the Institute for Justice's site answers scripts with a
// Cloudflare challenge, so its data downloads
// (https://ij.org/report/unaccountable/data-downloads/) are saved by hand into
// tmp/legacy/qi/raw/, and dated by the newest file there.
//
// The GitHub sources record the commit that last touched each file, so a
// copy can be matched to the repository's history later.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/legacy/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { REPO, archiveCommand, dirFiles, latestDate, newestMtime } from '../lib/archive.mjs';

const UA = 'verbatim.fyi data loader (+https://github.com/centricle/verbatim)';
const PACE_MS = 2000;
const raw = (dataset) => resolve(REPO, 'tmp/legacy', dataset, 'raw');
const github = (repo, path) => ({ url: `https://raw.githubusercontent.com/${repo}/master/${path}`, repo, path });

export const SOURCES = {
  compas: [github('propublica/compas-analysis', 'compas-scores-two-years.csv')],
  'fatal-force': [
    github('washingtonpost/data-police-shootings', 'v2/fatal-police-shootings-data.csv'),
    github('washingtonpost/data-police-shootings', 'v2/fatal-police-shootings-agencies.csv'),
  ],
  // fec.gov answers with a redirect to the FEC's GovCloud S3 bucket, the one
  // redirect any source here may follow.
  fec: [{ url: 'https://www.fec.gov/files/bulk-downloads/2024/weball24.zip', redirectTo: /^https:\/\/cg-[0-9a-f-]+\.s3-us-gov-west-1\.amazonaws\.com\/bulk-downloads\// }],
  qi: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The commit that last changed path, from GitHub's API.
async function lastCommit(repo, path) {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
  });
  if (res.status !== 200) throw new Error(`GitHub commits for ${repo}/${path}: HTTP ${res.status}`);
  const [c] = await res.json();
  return c && { sha: c.sha, date: c.commit.committer.date };
}

// Any status but 200 stops the run. A redirect is followed only when the
// source names where it may lead, and only once.
async function get(src) {
  let res = await fetch(src.url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  let from = null;
  const to = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && src.redirectTo?.test(to ?? '')) {
    from = to;
    res = await fetch(to, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  }
  if (res.status !== 200) throw new Error(`${src.url}: HTTP ${res.status}. Stopping; no retry.`);
  return { res, from };
}

async function fetchDataset(dataset) {
  const dir = raw(dataset);
  await mkdir(dir, { recursive: true });
  const manifest = [];
  for (const [i, src] of SOURCES[dataset].entries()) {
    if (i > 0) await sleep(PACE_MS);
    const { res, from } = await get(src);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = src.url.split('/').at(-1);
    await writeFile(resolve(dir, file), buf);
    manifest.push({
      file,
      url: src.url,
      ...(from && { servedFrom: from }),
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      lastModified: res.headers.get('last-modified'),
      fetchedAt: new Date().toISOString(),
      ...(src.repo && { commit: await lastCommit(src.repo, src.path) }),
    });
    console.log(`${dataset}/${file}  ${buf.length.toLocaleString()} bytes`);
  }
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function fetchCmd(names) {
  const wanted = names.length ? names : Object.keys(SOURCES).filter((d) => SOURCES[d].length);
  for (const d of wanted) {
    if (!SOURCES[d]?.length) throw new Error(`legacy: no fetch for "${d}" (qi is saved by hand)`);
    await fetchDataset(d);
  }
}

// The vintage is the manifest's latest fetch, or for a hand-saved source the
// newest file; null when nothing has been saved yet.
async function vintage(dataset) {
  try {
    const manifest = JSON.parse(await readFile(resolve(raw(dataset), 'manifest.json'), 'utf8'));
    return latestDate(manifest.map((m) => m.fetchedAt));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  try {
    return await newestMtime(raw(dataset));
  } catch (err) {
    if (err.code === 'ENOENT' || /no timestamp/.test(err.message)) return null;
    throw err;
  }
}

export const ARCHIVE = Object.fromEntries(Object.keys(SOURCES).map((d) => {
  const prefix = async () => `verbatim/legacy/${d}/${(await vintage(d)) ?? ''}${(await vintage(d)) ? '/' : ''}`;
  return [d, { prefix, files: async () => dirFiles(raw(d), await prefix(), { keep: (rel) => !rel.startsWith('.') }) }];
}));

async function main([cmd, ...rest]) {
  switch (cmd) {
    case 'fetch': await fetchCmd(rest); break;
    case 'archive': await archiveCommand(ARCHIVE, rest); break;
    default:
      console.error('usage: cli.mjs fetch [compas|fatal-force|fec]|archive [<dataset>...] [--dry-run]');
      process.exitCode = 2;
  }
}

await main(process.argv.slice(2));
