import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComplete, manifestEntry, merge } from './manifest.mjs';

test('manifestEntry records provenance and the server headers', () => {
  const e = manifestEntry({
    file: 'bound/573BV.pdf',
    url: 'https://www.supremecourt.gov/opinions/boundvolumes/573BV.pdf',
    bytes: 4938549,
    sha256: 'ab',
    fetchedAt: '2026-11-20T18:00:00.000Z',
    headers: { 'last-modified': 'Fri, 08 Jan 2021 19:26:11 GMT', etag: '"80b111ff4e5d61:0"', 'content-type': 'application/pdf' },
  });
  assert.deepEqual(e, {
    file: 'bound/573BV.pdf',
    url: 'https://www.supremecourt.gov/opinions/boundvolumes/573BV.pdf',
    bytes: 4938549,
    sha256: 'ab',
    fetchedAt: '2026-11-20T18:00:00.000Z',
    lastModified: 'Fri, 08 Jan 2021 19:26:11 GMT',
    etag: '"80b111ff4e5d61:0"',
  });
  assert.equal(manifestEntry({ file: 'a', url: 'u', bytes: 1, sha256: 's', fetchedAt: 't', servedFrom: 'v', adopted: true }).adopted, true);
});

test('merge keeps one entry per file, the later one, sorted', () => {
  const m = merge([{ file: 'b', bytes: 1 }, { file: 'a', bytes: 1 }], [{ file: 'b', bytes: 2 }, { file: 'c', bytes: 3 }]);
  assert.deepEqual(m.map((e) => [e.file, e.bytes]), [['a', 1], ['b', 2], ['c', 3]]);
});

test('isComplete needs the entry and a matching size on disk', () => {
  assert.equal(isComplete({ bytes: 10 }, 10), true);
  assert.equal(isComplete({ bytes: 10 }, 9), false);
  assert.equal(isComplete({ bytes: 10 }, null), false);
  assert.equal(isComplete(undefined, 10), false);
});
