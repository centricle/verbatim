// Both chambers' raw volumes to the private R2 bucket verbatim-sources
// (machinery, key policy and credentials: scripts/lib/archive.mjs).
//
// Keys: verbatim/disbursements/house/<fetch date>/house-<YYYY>q<N>.csv and
// verbatim/disbursements/senate/<fetch date>/GPO-CDOC-<id>.pdf, each file
// under the date its manifest says it was fetched. Both chambers re-issue a
// period in place under the same URL (`fetch --again`), so a re-issue gets a
// key of its own and the issue it replaced stays archived. Each chamber's
// manifest.json, links.json (and the Senate's listing.html) sit beside the
// dated folders and are replaced when they change: the loader rewrites them.
//
// Not archived: anything the manifest does not list, such as the two
// *_detail.csv copies left from probing the House's file names.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { REPO, archiveCommand, datedFiles, dirFiles } from '../lib/archive.mjs';

const RAW = resolve(REPO, 'tmp/disbursements/raw');
export const PREFIX = 'verbatim/disbursements/';
const INDEX = new Set(['manifest.json', 'links.json', 'listing.html']);
const isIndex = (key) => INDEX.has(key.split('/').at(-1)) && key.split('/').length === 4;

export async function chamberFiles(chamber, dir = join(RAW, chamber)) {
  const prefix = `${PREFIX}${chamber}/`;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const index = await dirFiles(dir, prefix, { keep: (rel) => INDEX.has(rel) });
  return [...index, ...await datedFiles(dir, prefix, Object.values(manifest))];
}

export const SOURCES = {
  house: { prefix: `${PREFIX}house/`, files: () => chamberFiles('house'), replaceable: isIndex },
  senate: { prefix: `${PREFIX}senate/`, files: () => chamberFiles('senate'), replaceable: isIndex },
};

// `archive [house|senate] [--dry-run]`, for cli.mjs.
export const archiveCmd = (args) => archiveCommand(SOURCES, args);
