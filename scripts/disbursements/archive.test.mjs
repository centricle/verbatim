import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan } from '../lib/archive.mjs';
import { chamberFiles, SOURCES } from './archive.mjs';

const noon = (d) => new Date(`${d}T12:00:00`).toISOString();

test('a chamber archives what its manifest lists, each file under its fetch date, plus its index files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'archive-test-'));
  try {
    await mkdir(dir, { recursive: true });
    const manifest = {
      '2016q1': { file: 'house-2016q1.csv', fetchedAt: noon('2026-11-19') },
      '2016q2': { file: 'house-2016q2.csv', fetchedAt: noon('2026-12-02') },
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'links.json'), '[]');
    await writeFile(join(dir, 'house-2016q1.csv'), 'q1');
    await writeFile(join(dir, 'house-2016q2.csv'), 'q2');
    await writeFile(join(dir, '2016Q1_detail.csv'), 'probe');
    const files = await chamberFiles('house', dir);
    assert.deepEqual(files.map((f) => f.key), [
      'verbatim/disbursements/house/links.json',
      'verbatim/disbursements/house/manifest.json',
      'verbatim/disbursements/house/2026-11-19/house-2016q1.csv',
      'verbatim/disbursements/house/2026-12-02/house-2016q2.csv',
    ]);
    assert.deepEqual(await chamberFiles('house', join(dir, 'absent')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the index files are replaced when they change; a dated volume never is', () => {
  const { replaceable } = SOURCES.senate;
  assert.equal(replaceable('verbatim/disbursements/senate/manifest.json'), true);
  assert.equal(replaceable('verbatim/disbursements/senate/listing.html'), true);
  assert.equal(replaceable('verbatim/disbursements/senate/2026-11-19/GPO-CDOC-112sdoc4.pdf'), false);
  assert.equal(replaceable('verbatim/disbursements/senate/2026-11-19/manifest.json'), false);
  const f = (key, md5) => ({ key, path: key, size: 1, md5 });
  const o = (key, md5) => ({ key, size: 1, etag: `"${md5}"` });
  const key = 'verbatim/disbursements/senate/2026-11-19/GPO-CDOC-112sdoc4.pdf';
  const p = plan([f(key, 'a'.repeat(32))], [o(key, 'b'.repeat(32))], replaceable);
  assert.deepEqual(p.conflicts.map((x) => x.key), [key]);
});
