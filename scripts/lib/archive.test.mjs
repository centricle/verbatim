import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, credentials, dirFiles, entry, latestDate, localDate, newestMtime, plan } from './archive.mjs';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const file = (key, body) => ({ key, path: `/cache/${key}`, size: Buffer.byteLength(body), md5: md5(body) });
const object = (key, body, etag = `"${md5(body)}"`) => ({ key, size: Buffer.byteLength(body), etag });
const tmp = () => mkdtemp(join(tmpdir(), 'archive-test-'));

test('parseEnv reads KEY=value, strips one layer of quotes, skips comments', () => {
  const env = parseEnv('# ACME token\nR2_BUCKET=acme-sources\nexport R2_ENDPOINT="https://acme.example"\n\nR2_ACCESS_KEY_ID=\'abc\'\nnot a line\n');
  assert.deepEqual(env, { R2_BUCKET: 'acme-sources', R2_ENDPOINT: 'https://acme.example', R2_ACCESS_KEY_ID: 'abc' });
});

test('credentials refuse a readable file and name missing keys, never values', async () => {
  const dir = await tmp();
  try {
    const path = join(dir, 'r2.env');
    await writeFile(path, 'R2_ACCESS_KEY_ID=coyote-secret\nR2_BUCKET=acme-sources\n');
    await chmod(path, 0o644);
    await assert.rejects(credentials(path), /readable by other users/);
    await chmod(path, 0o600);
    await assert.rejects(credentials(path), (e) => /lacks R2_SECRET_ACCESS_KEY, R2_ENDPOINT$/.test(e.message) && !e.message.includes('coyote-secret'));
    await assert.rejects(credentials(join(dir, 'absent.env')), /no credentials file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('entry hashes a file by MD5, and by sha256 when asked', async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, 'a.csv'), 'anvil,1\n');
    assert.deepEqual(await entry('k/a.csv', join(dir, 'a.csv')), { key: 'k/a.csv', path: join(dir, 'a.csv'), size: 8, md5: md5('anvil,1\n') });
    assert.equal((await entry('k/a.csv', join(dir, 'a.csv'), { sha256: true })).sha256, sha256('anvil,1\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dirFiles keys every file under a directory by its relative path, filtered and sorted', async () => {
  const dir = await tmp();
  try {
    await mkdir(join(dir, 'senate'), { recursive: true });
    await writeFile(join(dir, 'senate/MA.html'), 'ma');
    await writeFile(join(dir, 'senate/AL.html'), 'al');
    await writeFile(join(dir, 'manifest.json'), '[]');
    await writeFile(join(dir, 'probe.mjs'), 'x');
    const files = await dirFiles(dir, 'verbatim/x/2026-11-18/', { keep: (rel) => !rel.endsWith('.mjs') });
    assert.deepEqual(files.map((f) => f.key), ['verbatim/x/2026-11-18/manifest.json', 'verbatim/x/2026-11-18/senate/AL.html', 'verbatim/x/2026-11-18/senate/MA.html']);
    assert.equal(files[1].md5, md5('al'));
    assert.deepEqual(await dirFiles(join(dir, 'absent'), 'p/'), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a vintage is the latest timestamp as a local calendar date', async () => {
  const noon = (d) => new Date(`${d}T12:00:00`);
  assert.equal(localDate(noon('2026-11-18')), '2026-11-18');
  assert.equal(latestDate([noon('2026-11-15'), noon('2026-11-18').toISOString(), noon('2026-11-17').getTime()]), '2026-11-18');
  assert.throws(() => latestDate(['not a date']), /no timestamp/);
  const dir = await tmp();
  try {
    await writeFile(join(dir, 'old.html'), 'a');
    await writeFile(join(dir, 'new.html'), 'b');
    await utimes(join(dir, 'old.html'), noon('2026-11-01'), noon('2026-11-01'));
    await utimes(join(dir, 'new.html'), noon('2026-11-18'), noon('2026-11-18'));
    assert.equal(await newestMtime(dir), '2026-11-18');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plan uploads what the bucket lacks and leaves matching objects alone', () => {
  const local = [file('verbatim/x/a.csv', 'a'), file('verbatim/x/b.csv', 'b')];
  const p = plan(local, [object('verbatim/x/a.csv', 'a')]);
  assert.deepEqual(p.upload.map((f) => f.key), ['verbatim/x/b.csv']);
  assert.equal(p.same, 1);
  assert.deepEqual([p.replace, p.conflicts, p.extra], [[], [], []]);
});

test('a changed replaceable file is replaced; any other changed file is a conflict, never overwritten', () => {
  const local = [file('verbatim/x/manifest.json', 'new'), file('verbatim/x/a.csv', 'local')];
  const remote = [object('verbatim/x/manifest.json', 'old'), object('verbatim/x/a.csv', 'archived!')];
  const p = plan(local, remote, (k) => k.endsWith('manifest.json'));
  assert.deepEqual(p.replace.map((f) => f.key), ['verbatim/x/manifest.json']);
  assert.deepEqual(p.conflicts.map((f) => f.key), ['verbatim/x/a.csv']);
  assert.deepEqual(p.upload, []);
  assert.deepEqual(plan(local, remote).replace, [], 'nothing is replaceable by default');
});

test('archived objects with no local copy (an earlier vintage) are counted, not failures', () => {
  const p = plan([file('verbatim/x/2026-11-20/a.html', 'new')], [object('verbatim/x/2026-11-18/a.html', 'kept')]);
  assert.deepEqual(p.extra, ['verbatim/x/2026-11-18/a.html']);
  assert.deepEqual(p.upload.map((f) => f.key), ['verbatim/x/2026-11-20/a.html']);
  assert.deepEqual([p.replace, p.conflicts], [[], []]);
});

test('a multipart ETag compares by size only', () => {
  const local = [file('verbatim/x/big.pdf', 'big')];
  const same = plan(local, [object('verbatim/x/big.pdf', 'big', '"0123456789abcdef0123456789abcdef-2"')]);
  assert.deepEqual([same.same, same.sizeOnly, same.conflicts.length], [1, 1, 0]);
  const shorter = plan(local, [object('verbatim/x/big.pdf', 'bi', '"0123456789abcdef0123456789abcdef-2"')]);
  assert.equal(shorter.conflicts.length, 1);
});
