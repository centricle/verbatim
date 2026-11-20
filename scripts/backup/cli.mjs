// Backups that sit outside the fleet's daily rotation.
//
//   npm run backup -- milestone [--dry-run]
//       pg_dump -Fc of the production database (DATABASE_URL's endpoint, on
//       its direct host, never the pooler) to tmp/db/<date>-<HEAD>.dump,
//       checked with pg_restore --list, then to the private R2 bucket at
//       verbatim/db/<date>-<HEAD>.dump with sha256 metadata and verified.
//       Take one after each dataset ships: the daily dumps
//       (rig/scripts/neon-backup.sh) keep 30 days, and these are kept.
//   npm run backup -- mirror <dir> [--prefix P] [--dry-run]
//       the bucket (or prefix P of it) into <dir>, laid out by key: downloads
//       what <dir> lacks and checks every file against its object's MD5. For
//       the HDD copy (rig/runbooks/ARCHIVE_SYNC.md).
//
// The database is the reproducible part of this project: raw sources plus
// loaders plus each dataset's `check` rebuild it. The raw sources are not
// reproducible, which is why every dataset CLI has an `archive` command. Why
// both, and the restore drill: brain/decisions/2026-11-20-verbatim-backups.md.
//
// pg_dump and pg_restore come from Homebrew's libpq, which is not on PATH;
// PG_BIN overrides the directory.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REPO, connect, entry, headObject, listRemote, localDate, mirror, putWithSha256 } from '../lib/archive.mjs';

const run = promisify(execFile);
const PG_BIN = process.env.PG_BIN ?? '/opt/homebrew/opt/libpq/bin';
const PREFIX = 'verbatim/db/';

// DATABASE_URL on the endpoint's direct host: Neon's pooler runs PgBouncer in
// transaction mode, which pg_dump should not go through.
export function directUrl(url) {
  const u = new URL(url);
  u.hostname = u.hostname.replace(/^(ep-[a-z0-9-]+?)-pooler\./, '$1.');
  return u.toString();
}

async function milestone(args) {
  const dryRun = args.includes('--dry-run');
  if (!process.env.DATABASE_URL) throw new Error('backup: DATABASE_URL is not set (.env)');
  const url = directUrl(process.env.DATABASE_URL);
  const { stdout: head } = await run('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']);
  const name = `${localDate(Date.now())}-${head.trim()}.dump`;
  const key = PREFIX + name;
  const s = await connect();
  if ((await listRemote(s, key)).some((r) => r.key === key)) throw new Error(`backup: ${key} is already archived; a milestone is never overwritten`);
  console.log(`milestone: ${new URL(url).hostname.split('.')[0]} to ${key}${dryRun ? ' (dry run)' : ''}`);
  if (dryRun) return;
  const dir = resolve(REPO, 'tmp/db');
  const path = resolve(dir, name);
  await mkdir(dir, { recursive: true });
  const t0 = Date.now();
  await run(`${PG_BIN}/pg_dump`, ['--format=custom', '--no-owner', '--no-privileges', '--file', path, '--dbname', url], { maxBuffer: 64 * 1024 * 1024 });
  const { stdout: list } = await run(`${PG_BIN}/pg_restore`, ['--list', path], { maxBuffer: 64 * 1024 * 1024 });
  const tables = list.split('\n').filter((l) => / TABLE DATA public /.test(l)).length;
  const f = await entry(key, path, { sha256: true });
  console.log(`dumped in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${(f.size / 1e6).toFixed(1)} MB, ${tables} tables with data per pg_restore --list`);
  if (!tables) throw new Error('backup: pg_restore --list shows no table data; not uploading');
  await putWithSha256(s, [f]);
  const [r] = await listRemote(s, key);
  const meta = (await headObject(s, key)).Metadata?.sha256;
  const ok = r && r.size === f.size && r.etag.replace(/"/g, '') === f.md5 && meta === f.sha256;
  if (!ok) {
    process.exitCode = 1;
    console.log(`FAIL ${key}: the archived object does not match ${path}; local copy kept`);
    return;
  }
  console.log(`PASS ${key}: ${f.size.toLocaleString()} bytes, MD5 matching ETag, sha256 ${f.sha256} in metadata`);
  await rm(path);
}

async function mirrorCmd(args) {
  const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--prefix');
  if (!dir) throw new Error('usage: backup mirror <dir> [--prefix P] [--dry-run]');
  const i = args.indexOf('--prefix');
  const failures = await mirror(resolve(dir), { prefix: i >= 0 ? args[i + 1] : '', dryRun: args.includes('--dry-run') });
  for (const f of failures) console.log(`FAIL ${f}`);
  if (failures.length) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'milestone': await milestone(rest); break;
  case 'mirror': await mirrorCmd(rest); break;
  default:
    console.error('usage: cli.mjs milestone [--dry-run] | mirror <dir> [--prefix P] [--dry-run]');
    process.exitCode = 2;
}
