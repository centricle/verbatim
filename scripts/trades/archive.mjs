// Raw sources to a private R2 bucket, one source at a time:
// - house: every PTR PDF and every yearly index ZIP in tmp/trades/house/.
//   The Clerk destroys a Member's reports six years after they leave office
//   (5 U.S.C. § 13107(d)(3)).
// - senate: every eFD report page in tmp/trades/senate/ptr/, the list pages
//   and the ledger. eFD says it keeps reports six years after a senator
//   leaves, and has already stopped serving Jeff Sessions' pages while still
//   listing them.
// Past that point the local cache would be the only copy, and a parser fix
// would have nothing to re-parse. The bucket is private; serving these copies
// is a separate question and is not decided.
//
// Keys: verbatim/house-ptr/<Year>/<DocID>.pdf and
// verbatim/house-ptr/index/<Year>FD.zip (Year is the index's Year column, the
// folder the Clerk serves the PDF from, same as the local layout);
// verbatim/senate-ptr/<uuid>.html, lowercase, and
// verbatim/senate-ptr/index/{p<NN>,filings}.json.
//
// A filing (a PDF, a report page) is uploaded only when the bucket lacks it
// and is never replaced: a DocID or a UUID names one filing, so an archived
// copy that differs from the local one is reported as a conflict and kept.
// (eFD serves a page byte for byte the same on every fetch, so a refetch is
// never one.) Index files are replaced when they change: the Clerk rebuilds
// every index nightly, eFD's list moves with every filing, and the ledger
// keeps its own history.
//
// Credentials: an env file (R2_ENV_FILE, default
// ~/.config/centricle/r2-verbatim-sources.env, mode 600) holding
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT and R2_BUCKET, with a
// token scoped to that one bucket. It is parsed here and handed only to the
// aws CLI's environment, never exported or printed.
//
// Transfers use the aws CLI with its own config file and multipart uploads
// off, so every object's ETag is the MD5 of its bytes and the verify pass
// compares content, not just sizes.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { RAW, efd } from './sources.mjs';

const run = promisify(execFile);

export const PREFIX = 'verbatim/house-ptr/';
export const SENATE_PREFIX = 'verbatim/senate-ptr/';
const HOUSE = resolve(RAW, 'house');
const AWS_CONFIG = resolve(RAW, 'archive-aws.config');
const REQUIRED = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'];
// A single PUT up to 4 GB, well past any PTR, so no object is multipart.
const CONFIG = '[default]\nregion = auto\noutput = json\ns3 =\n  multipart_threshold = 4GB\n';

export const pdfKey = (year, docId) => `${PREFIX}${year}/${docId}.pdf`;
export const indexKey = (year) => `${PREFIX}index/${year}FD.zip`;
export const isIndexKey = (key) => key.startsWith(`${PREFIX}index/`);
export const senatePageKey = (uuid) => `${SENATE_PREFIX}${uuid}.html`;
export const senateIndexKey = (name) => `${SENATE_PREFIX}index/${name}`;
export const isSenateIndexKey = (key) => key.startsWith(`${SENATE_PREFIX}index/`);

// KEY=value lines. Blank lines, comments and anything else are skipped; one
// layer of matching quotes is removed. Values are never echoed.
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export async function credentials(path = process.env.R2_ENV_FILE || resolve(homedir(), '.config/centricle/r2-verbatim-sources.env')) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`archive: no credentials file at ${path}`);
  }
  if (info.mode & 0o077) throw new Error(`archive: ${path} is readable by other users; chmod 600 it`);
  const env = parseEnv(await readFile(path, 'utf8'));
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`archive: ${path} lacks ${missing.join(', ')}`);
  return env;
}

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

// Every index ZIP and PDF in the cache, with its key. The extracted x<Year>/
// folders are derived from the ZIPs and are not archived.
export async function localFiles(house = HOUSE) {
  const out = [];
  const add = async (key, path) => {
    const buf = await readFile(path);
    out.push({ key, path, size: buf.length, md5: md5(buf) });
  };
  for (const name of (await readdir(join(house, 'index'))).sort()) {
    const m = name.match(/^(\d{4})FD\.zip$/);
    if (m) await add(indexKey(m[1]), join(house, 'index', name));
  }
  const years = (await readdir(join(house, 'pdf'))).filter((y) => /^\d{4}$/.test(y)).sort();
  for (const year of years) {
    for (const name of (await readdir(join(house, 'pdf', year))).sort()) {
      const m = name.match(/^([0-9A-Za-z_-]+)\.pdf$/);
      if (m) await add(pdfKey(year, m[1]), join(house, 'pdf', year, name));
    }
  }
  return out;
}

// eFD's report pages, list pages and ledger. requests.log and blocked-until
// are this machine's, not the source's, and stay local.
export async function senateFiles(dir = efd.dir) {
  const out = [];
  const add = async (key, path) => {
    const buf = await readFile(path);
    out.push({ key, path, size: buf.length, md5: md5(buf) });
  };
  const list = async (sub) => {
    try { return (await readdir(join(dir, sub))).sort(); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  };
  for (const name of await list('index')) if (/^p\d+\.json$/.test(name)) await add(senateIndexKey(name), join(dir, 'index', name));
  try {
    await stat(join(dir, 'filings.json'));
    await add(senateIndexKey('filings.json'), join(dir, 'filings.json'));
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  for (const name of await list('ptr')) {
    const m = name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.html$/);
    if (m) await add(senatePageKey(m[1]), join(dir, 'ptr', name));
  }
  return out;
}

export const SOURCES = {
  house: { prefix: PREFIX, stage: resolve(RAW, 'archive-stage'), files: () => localFiles(), replaceable: isIndexKey },
  senate: { prefix: SENATE_PREFIX, stage: resolve(RAW, 'archive-stage-senate'), files: () => senateFiles(), replaceable: isSenateIndexKey },
};

// An ETag is the object's MD5 unless the object was a multipart upload
// ("<hash>-<parts>"); then only the size can be compared.
function compare(local, remote) {
  if (local.size !== remote.size) return 'differs';
  const etag = remote.etag.replace(/"/g, '');
  if (!/^[0-9a-f]{32}$/.test(etag)) return 'size-only';
  return etag === local.md5 ? 'same' : 'differs';
}

// What the bucket lacks (upload), index files that changed (replace),
// filings whose archived copy differs (conflicts, never overwritten), and
// archived keys with no local file (extra: what the archive is for, once a
// cache is lost).
export function plan(local, remote, replaceable = isIndexKey) {
  const byKey = new Map(remote.map((r) => [r.key, r]));
  const p = { upload: [], replace: [], conflicts: [], same: 0, sizeOnly: 0, extra: [] };
  for (const f of local) {
    const r = byKey.get(f.key);
    if (!r) {
      p.upload.push(f);
      continue;
    }
    const c = compare(f, r);
    if (c === 'differs') (replaceable(f.key) ? p.replace : p.conflicts).push(f);
    else {
      p.same++;
      if (c === 'size-only') p.sizeOnly++;
    }
  }
  const keys = new Set(local.map((f) => f.key));
  p.extra = remote.filter((r) => !keys.has(r.key)).map((r) => r.key);
  return p;
}

// Only what the aws CLI needs: no DATABASE_URL, no ~/.aws profile.
function awsEnv(cred) {
  return {
    PATH: process.env.PATH,
    HOME: homedir(),
    AWS_ACCESS_KEY_ID: cred.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: cred.R2_SECRET_ACCESS_KEY,
    AWS_CONFIG_FILE: AWS_CONFIG,
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '',
  };
}

async function aws(cred, args) {
  const { stdout } = await run('aws', [...args, '--endpoint-url', cred.R2_ENDPOINT], {
    env: awsEnv(cred),
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

async function listRemote(cred, prefix) {
  const out = await aws(cred, ['s3api', 'list-objects-v2', '--bucket', cred.R2_BUCKET, '--prefix', prefix]);
  const json = out.trim() ? JSON.parse(out) : {};
  return (json.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size, etag: o.ETag }));
}

// One `aws s3 cp --recursive` over a tree of symlinks laid out by key, so the
// CLI runs its parallel transfers once instead of a process per file.
async function upload(cred, files, stage) {
  await rm(stage, { recursive: true, force: true });
  for (const f of files) {
    const at = join(stage, f.key);
    await mkdir(dirname(at), { recursive: true });
    await symlink(f.path, at);
  }
  await aws(cred, ['s3', 'cp', stage, `s3://${cred.R2_BUCKET}/`, '--recursive', '--follow-symlinks', '--no-progress', '--only-show-errors']);
  await rm(stage, { recursive: true, force: true });
}

const mb = (files) => (files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1);

// Returns the failures; an empty list means every local file of every source
// named is in the bucket byte for byte.
export async function archive({ dryRun = false, sources = Object.keys(SOURCES) } = {}) {
  const cred = await credentials();
  await writeFile(AWS_CONFIG, CONFIG);
  const failures = [];
  for (const name of sources) {
    const source = SOURCES[name];
    if (!source) throw new Error(`archive: no source "${name}" (${Object.keys(SOURCES).join(', ')})`);
    failures.push(...await archiveSource(cred, name, source, dryRun));
  }
  return failures;
}

async function archiveSource(cred, name, { prefix, stage, files, replaceable }, dryRun) {
  const local = await files();
  const before = plan(local, await listRemote(cred, prefix), replaceable);
  const todo = [...before.upload, ...before.replace];
  console.log(`archive ${name}: ${local.length.toLocaleString()} local files (${mb(local)} MB); bucket ${cred.R2_BUCKET} already has ${before.same.toLocaleString()}, lacks ${before.upload.length.toLocaleString()}; ${before.replace.length} index files changed; ${before.extra.length.toLocaleString()} archived with no local copy`);
  for (const f of before.conflicts) console.log(`CONFLICT ${f.key}: archived copy differs from ${f.path}; kept the archived one`);
  if (dryRun) {
    console.log(`dry run: would upload ${todo.length.toLocaleString()} files, ${mb(todo)} MB`);
    return before.conflicts.map((f) => `conflict ${f.key}`);
  }
  if (todo.length) {
    console.log(`uploading ${todo.length.toLocaleString()} files, ${mb(todo)} MB`);
    await upload(cred, todo, stage);
  }
  const after = plan(local, await listRemote(cred, prefix), replaceable);
  const failures = [
    ...after.upload.map((f) => `missing ${f.key}`),
    ...after.replace.map((f) => `index differs ${f.key}`),
    ...after.conflicts.map((f) => `conflict ${f.key}`),
  ];
  if (!failures.length) {
    const how = after.sizeOnly ? `, ${after.sizeOnly} by size only (multipart ETag)` : '';
    console.log(`PASS ${name}: all ${local.length.toLocaleString()} local files are in ${cred.R2_BUCKET}, MD5 matching ETag${how}`);
  }
  return failures;
}
