// manifest.json per source directory: one entry per downloaded file, sorted
// by its path under the directory. Written after every file, through a
// temporary file and a rename, so an interrupted run keeps what it finished.
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// What a manifest records for a file: where it came from, its bytes and
// hash, and what the server said about it.
export function manifestEntry({ file, url, bytes, sha256, fetchedAt, headers = {}, servedFrom = null, adopted = false }) {
  const h = (k) => headers[k] ?? null;
  return {
    file,
    url,
    ...(servedFrom && { servedFrom }),
    bytes,
    sha256,
    fetchedAt,
    lastModified: h('last-modified'),
    etag: h('etag'),
    ...(adopted && { adopted: true }),
  };
}

// Entries in file order, one per file; a later entry for a file replaces an
// earlier one.
export function merge(entries, added) {
  const by = new Map(entries.map((e) => [e.file, e]));
  for (const e of added) by.set(e.file, e);
  return [...by.values()].sort((a, b) => a.file.localeCompare(b.file));
}

// Complete means the manifest has it and the file on disk is that size. The
// hash is not recomputed on every run (the opinions file is 55 GB); archive
// checks every byte against the bucket's MD5.
export const isComplete = (entry, size) => Boolean(entry) && entry.bytes === size;

export async function readManifest(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function writeManifest(dir, entries) {
  const part = join(dir, 'manifest.json.part');
  await writeFile(part, JSON.stringify(entries, null, 2) + '\n');
  await rename(part, join(dir, 'manifest.json'));
}

export async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
