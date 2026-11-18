import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, credentials, localFiles, senateFiles, plan, pdfKey, indexKey, senatePageKey, senateIndexKey, isSenateIndexKey } from './archive.mjs';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const file = (key, body) => ({ key, path: `/cache/${key}`, size: Buffer.byteLength(body), md5: md5(body) });
const object = (key, body, etag = `"${md5(body)}"`) => ({ key, size: Buffer.byteLength(body), etag });

test('keys follow the Clerk folder layout', () => {
  assert.equal(pdfKey('2014', '20001568'), 'verbatim/house-ptr/2014/20001568.pdf');
  assert.equal(indexKey('2026'), 'verbatim/house-ptr/index/2026FD.zip');
});

test('parseEnv reads KEY=value, strips one layer of quotes, skips comments', () => {
  const env = parseEnv('# ACME token\nR2_BUCKET=acme-sources\nexport R2_ENDPOINT="https://acme.example"\n\nR2_ACCESS_KEY_ID=\'abc\'\nnot a line\n');
  assert.deepEqual(env, { R2_BUCKET: 'acme-sources', R2_ENDPOINT: 'https://acme.example', R2_ACCESS_KEY_ID: 'abc' });
});

test('credentials refuse a readable file and name missing keys, never values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'archive-test-'));
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

test('localFiles takes index ZIPs and PDFs, not the extracted index folders', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'archive-test-'));
  try {
    await mkdir(join(dir, 'index/x2014'), { recursive: true });
    await mkdir(join(dir, 'pdf/2014'), { recursive: true });
    await writeFile(join(dir, 'index/2014FD.zip'), 'zip');
    await writeFile(join(dir, 'index/x2014/2014FD.txt'), 'txt');
    await writeFile(join(dir, 'pdf/2014/20001568.pdf'), 'pdf');
    await writeFile(join(dir, 'pdf/2014/notes.txt'), 'stray');
    const files = await localFiles(dir);
    assert.deepEqual(files.map((f) => f.key), [indexKey('2014'), pdfKey('2014', '20001568')]);
    assert.equal(files[1].md5, md5('pdf'));
    assert.equal(files[1].size, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plan uploads what the bucket lacks and leaves matching objects alone', () => {
  const local = [file(pdfKey(2014, '20001568'), 'a'), file(pdfKey(2014, '20001540'), 'b')];
  const p = plan(local, [object(pdfKey(2014, '20001568'), 'a')]);
  assert.deepEqual(p.upload.map((f) => f.key), [pdfKey(2014, '20001540')]);
  assert.equal(p.same, 1);
  assert.deepEqual([p.replace, p.conflicts, p.extra], [[], [], []]);
});

test('a changed index ZIP is replaced; a changed PDF is a conflict, never overwritten', () => {
  const local = [file(indexKey(2026), 'new index'), file(pdfKey(2020, '20016000'), 'local pdf')];
  const remote = [object(indexKey(2026), 'old index'), object(pdfKey(2020, '20016000'), 'archived!')];
  const p = plan(local, remote);
  assert.deepEqual(p.replace.map((f) => f.key), [indexKey(2026)]);
  assert.deepEqual(p.conflicts.map((f) => f.key), [pdfKey(2020, '20016000')]);
  assert.deepEqual(p.upload, []);
});

test('archived objects with no local copy are counted, not failures', () => {
  const p = plan([], [object(pdfKey(2015, '20003000'), 'kept')]);
  assert.deepEqual(p.extra, [pdfKey(2015, '20003000')]);
  assert.deepEqual([p.upload, p.replace, p.conflicts], [[], [], []]);
});

test('a multipart ETag compares by size only', () => {
  const local = [file(pdfKey(2016, '20005000'), 'big')];
  const same = plan(local, [object(pdfKey(2016, '20005000'), 'big', '"0123456789abcdef0123456789abcdef-2"')]);
  assert.deepEqual([same.same, same.sizeOnly, same.conflicts.length], [1, 1, 0]);
  const shorter = plan(local, [object(pdfKey(2016, '20005000'), 'bi', '"0123456789abcdef0123456789abcdef-2"')]);
  assert.equal(shorter.conflicts.length, 1);
});

const U = '32550a8f-923e-416f-84f3-e19ab4f148b1';

test('Senate keys: one page per lowercase UUID, list and ledger under index/', () => {
  assert.equal(senatePageKey(U), `verbatim/senate-ptr/${U}.html`);
  assert.equal(senateIndexKey('p03.json'), 'verbatim/senate-ptr/index/p03.json');
  assert.equal(senateIndexKey('filings.json'), 'verbatim/senate-ptr/index/filings.json');
});

test('senateFiles takes pages, list pages and the ledger, never the request log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'archive-test-'));
  try {
    await mkdir(join(dir, 'index'), { recursive: true });
    await mkdir(join(dir, 'ptr'), { recursive: true });
    await writeFile(join(dir, 'index/p00.json'), '{}');
    await writeFile(join(dir, 'index/p00.json.tmp'), 'stray');
    await writeFile(join(dir, 'filings.json'), '[]');
    await writeFile(join(dir, 'requests.log'), 'log');
    await writeFile(join(dir, 'blocked-until'), 'x');
    await writeFile(join(dir, `ptr/${U}.html`), '<h1>PTR</h1>');
    await writeFile(join(dir, 'ptr/notes.html'), 'stray');
    const files = await senateFiles(dir);
    assert.deepEqual(files.map((f) => f.key), [senateIndexKey('p00.json'), senateIndexKey('filings.json'), senatePageKey(U)]);
    assert.equal(files[2].md5, md5('<h1>PTR</h1>'));
    assert.deepEqual(await senateFiles(join(dir, 'absent')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Senate: a changed ledger is replaced; a changed page is a conflict', () => {
  const local = [file(senateIndexKey('filings.json'), 'new ledger'), file(senatePageKey(U), 'page')];
  const remote = [object(senateIndexKey('filings.json'), 'old ledger'), object(senatePageKey(U), 'other page')];
  const p = plan(local, remote, isSenateIndexKey);
  assert.deepEqual(p.replace.map((f) => f.key), [senateIndexKey('filings.json')]);
  assert.deepEqual(p.conflicts.map((f) => f.key), [senatePageKey(U)]);
  assert.deepEqual(plan(local, remote).replace, [], 'the House predicate replaces no Senate key');
});
