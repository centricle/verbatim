// Raw sources to the private R2 bucket verbatim-sources, shared by every
// dataset's `archive` command. Moved here from scripts/trades/archive.mjs on
// its second use; each dataset names its own sources and keys.
//
// Why: a publisher can stop serving a file (the Clerk destroys a Member's
// reports six years after they leave; DOJ rewrites its clemency lists with
// each administration), and the database is rebuilt from these files, not the
// other way round. Past that point the local cache would be the only copy,
// and a parser fix would have nothing to re-parse. The bucket is private;
// serving these copies is a separate question and is not decided.
//
// Key policy. A source is one of two kinds:
// - immutable: a file's name names its bytes (a DocID, a quarter's CSV, a GPO
//   package, an upstream frozen since 2021). It is uploaded when the bucket
//   lacks it and never replaced; an archived copy that differs from the local
//   one is reported as a conflict and kept. Index files the publisher or the
//   loader rebuilds by design (the Clerk's nightly ZIPs, a manifest) are the
//   exception: the source's `replaceable` predicate names them, and they are
//   replaced when they change.
// - vintage: the publisher edits the same URL in place, or the file is a
//   build that changes with every run. Keys carry the fetch or build date,
//   <dataset>/<YYYY-MM-DD>/<name>, so the copy behind each load survives the
//   next refresh. Within one vintage, files are immutable as above.
//
// A source can ask for a `sha256` metadata field on every object (`sha256:
// true`), as the March corpus.db copy has. Those objects go up one PUT at a
// time, and the verify pass reads the field back.
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
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const run = promisify(execFile);

export const REPO = resolve(import.meta.dirname, '../..');
export const DEFAULT_CONFIG = resolve(REPO, 'tmp/archive-aws.config');
export const stageFor = (name) => resolve(REPO, 'tmp/archive-stage', name);
const REQUIRED = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'];
// A single PUT up to 4 GB, well past any source file, so no object is multipart.
const CONFIG = '[default]\nregion = auto\noutput = json\ns3 =\n  multipart_threshold = 4GB\n';

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

// Streamed, so a multi-gigabyte dump never has to fit in memory.
export async function hashFile(path, algorithms = ['md5']) {
  const hashes = algorithms.map((a) => createHash(a));
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    for (const h of hashes) h.update(chunk);
  }
  return { size, ...Object.fromEntries(algorithms.map((a, i) => [a, hashes[i].digest('hex')])) };
}

// One local file as the planner sees it.
export async function entry(key, path, { sha256 = false } = {}) {
  return { key, path, ...await hashFile(path, sha256 ? ['md5', 'sha256'] : ['md5']) };
}

// Every regular file under dir whose path relative to it (always with '/')
// passes keep, keyed prefix + that path, sorted. A missing dir has none.
export async function dirFiles(dir, prefix, { keep = () => true, sha256 = false } = {}) {
  let dirents;
  try {
    dirents = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const rels = dirents
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'))
    .filter(keep)
    .sort();
  const out = [];
  for (const rel of rels) out.push(await entry(prefix + rel, join(dir, rel), { sha256 }));
  return out;
}

// A vintage is a calendar date on this machine, YYYY-MM-DD.
export const localDate = (when) => new Date(when).toLocaleDateString('en-CA');

// The latest of several timestamps (ISO strings, Dates or ms), as a vintage.
export function latestDate(stamps) {
  const ms = stamps.map((s) => new Date(s).getTime()).filter(Number.isFinite);
  if (!ms.length) throw new Error('archive: no timestamp to date a vintage by');
  return localDate(Math.max(...ms));
}

// The files a manifest lists ({ file, fetchedAt }), each keyed under its own
// fetch date, prefix + <YYYY-MM-DD>/<file>. For a publisher that re-issues a
// file in place under the same name: the re-issue lands under its own date,
// and the issue it replaced stays.
export async function datedFiles(dir, prefix, entries) {
  const out = [];
  for (const e of [...entries].sort((a, b) => a.file.localeCompare(b.file))) {
    out.push(await entry(`${prefix}${localDate(e.fetchedAt)}/${e.file}`, join(dir, e.file)));
  }
  return out;
}

// The newest modification time of the files under dir, for a working set with
// no manifest.
export async function newestMtime(dir) {
  const dirents = await readdir(dir, { recursive: true, withFileTypes: true });
  const times = [];
  for (const d of dirents) if (d.isFile()) times.push((await stat(join(d.parentPath, d.name))).mtimeMs);
  return latestDate(times);
}

// An ETag is the object's MD5 unless the object was a multipart upload
// ("<hash>-<parts>"); then only the size can be compared.
function compare(local, remote) {
  if (local.size !== remote.size) return 'differs';
  const etag = remote.etag.replace(/"/g, '');
  if (!/^[0-9a-f]{32}$/.test(etag)) return 'size-only';
  return etag === local.md5 ? 'same' : 'differs';
}

// What the bucket lacks (upload), replaceable files that changed (replace),
// immutable files whose archived copy differs (conflicts, never overwritten),
// and archived keys with no local file (extra: earlier vintages, or what the
// archive is for once a cache is lost).
export function plan(local, remote, replaceable = () => false) {
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
function awsEnv(cred, config) {
  return {
    PATH: process.env.PATH,
    HOME: homedir(),
    AWS_ACCESS_KEY_ID: cred.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: cred.R2_SECRET_ACCESS_KEY,
    AWS_CONFIG_FILE: config,
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '',
  };
}

// A session: credentials plus the CLI config they run with.
export async function connect(config = DEFAULT_CONFIG) {
  const cred = await credentials();
  await mkdir(dirname(config), { recursive: true });
  await writeFile(config, CONFIG);
  return { cred, config, bucket: cred.R2_BUCKET };
}

async function aws({ cred, config }, args) {
  const { stdout } = await run('aws', [...args, '--endpoint-url', cred.R2_ENDPOINT], {
    env: awsEnv(cred, config),
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

export async function listRemote(s, prefix) {
  const out = await aws(s, ['s3api', 'list-objects-v2', '--bucket', s.bucket, '--prefix', prefix]);
  const json = out.trim() ? JSON.parse(out) : {};
  return (json.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size, etag: o.ETag }));
}

export async function headObject(s, key) {
  return JSON.parse(await aws(s, ['s3api', 'head-object', '--bucket', s.bucket, '--key', key]));
}

// One `aws s3 cp --recursive` over a tree of symlinks laid out by key, so the
// CLI runs its parallel transfers once instead of a process per file.
async function upload(s, files, stage) {
  await rm(stage, { recursive: true, force: true });
  for (const f of files) {
    const at = join(stage, f.key);
    await mkdir(dirname(at), { recursive: true });
    await symlink(f.path, at);
  }
  await aws(s, ['s3', 'cp', stage, `s3://${s.bucket}/`, '--recursive', '--follow-symlinks', '--no-progress', '--only-show-errors']);
  await rm(stage, { recursive: true, force: true });
}

// One PUT per file, carrying its sha256 as object metadata.
export async function putWithSha256(s, files) {
  for (const f of files) {
    await aws(s, ['s3api', 'put-object', '--bucket', s.bucket, '--key', f.key, '--body', f.path, '--metadata', `sha256=${f.sha256}`]);
  }
}

const mb = (files) => (files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1);

// Returns the failures; an empty list means every local file of every source
// named is in the bucket byte for byte.
export async function archive(sources, { dryRun = false, names = Object.keys(sources), config = DEFAULT_CONFIG } = {}) {
  for (const name of names) if (!sources[name]) throw new Error(`archive: no source "${name}" (${Object.keys(sources).join(', ')})`);
  const s = await connect(config);
  const failures = [];
  for (const name of names) failures.push(...await archiveSource(s, name, sources[name], dryRun));
  return failures;
}

// A source: { prefix, files, replaceable?, stage?, sha256? }. prefix is what
// the bucket is listed under (a string, or a function for a vintage whose
// date is only known once the files are read); files() returns entries.
async function archiveSource(s, name, { prefix: p, files, replaceable = () => false, stage = stageFor(name), sha256 = false }, dryRun) {
  const local = await files();
  const prefix = typeof p === 'function' ? await p() : p;
  const before = plan(local, await listRemote(s, prefix), replaceable);
  const todo = [...before.upload, ...before.replace];
  console.log(`archive ${name}: ${local.length.toLocaleString()} local files (${mb(local)} MB); bucket ${s.bucket} already has ${before.same.toLocaleString()}, lacks ${before.upload.length.toLocaleString()}; ${before.replace.length} replaceable files changed; ${before.extra.length.toLocaleString()} archived under ${prefix} with no local copy`);
  for (const f of before.conflicts) console.log(`CONFLICT ${f.key}: archived copy differs from ${f.path}; kept the archived one`);
  if (dryRun) {
    console.log(`dry run: would upload ${todo.length.toLocaleString()} files, ${mb(todo)} MB`);
    return before.conflicts.map((f) => `conflict ${f.key}`);
  }
  if (todo.length) {
    console.log(`uploading ${todo.length.toLocaleString()} files, ${mb(todo)} MB`);
    if (sha256) await putWithSha256(s, todo);
    else await upload(s, todo, stage);
  }
  const after = plan(local, await listRemote(s, prefix), replaceable);
  const failures = [
    ...after.upload.map((f) => `missing ${f.key}`),
    ...after.replace.map((f) => `replaceable file differs ${f.key}`),
    ...after.conflicts.map((f) => `conflict ${f.key}`),
  ];
  if (sha256) {
    for (const f of local) {
      const got = (await headObject(s, f.key)).Metadata?.sha256;
      if (got !== f.sha256) failures.push(`sha256 metadata ${got ? 'differs' : 'missing'} ${f.key}`);
    }
  }
  if (!failures.length) {
    const how = after.sizeOnly ? `, ${after.sizeOnly} by size only (multipart ETag)` : '';
    const meta = sha256 ? ', sha256 metadata matching' : '';
    console.log(`PASS ${name}: all ${local.length.toLocaleString()} local files are in ${s.bucket}, MD5 matching ETag${how}${meta}`);
  }
  return failures;
}

// A dataset CLI's `archive [source...] [--dry-run]`: no names means every
// source. Prints a FAIL line per failure and sets exit code 1 on any.
export async function archiveCommand(sources, args = [], opts = {}) {
  const names = args.filter((a) => !a.startsWith('--'));
  const failures = await archive(sources, { ...opts, dryRun: args.includes('--dry-run'), ...(names.length && { names }) });
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exitCode = 1;
  return failures;
}
