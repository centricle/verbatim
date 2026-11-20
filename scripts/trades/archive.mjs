// Raw sources to the private R2 bucket verbatim-sources (machinery, key
// policy and credentials: scripts/lib/archive.mjs), one source at a time:
// - house: every PTR PDF and every yearly index ZIP in tmp/trades/house/.
//   The Clerk destroys a Member's reports six years after they leave office
//   (5 U.S.C. § 13107(d)(3)).
// - senate: every eFD report page in tmp/trades/senate/ptr/, the list pages
//   and the ledger. eFD says it keeps reports six years after a senator
//   leaves, and has already stopped serving Jeff Sessions' pages while still
//   listing them.
//
// Keys: verbatim/house-ptr/<Year>/<DocID>.pdf and
// verbatim/house-ptr/index/<Year>FD.zip (Year is the index's Year column, the
// folder the Clerk serves the PDF from, same as the local layout);
// verbatim/senate-ptr/<uuid>.html, lowercase, and
// verbatim/senate-ptr/index/{p<NN>,filings}.json.
//
// A filing (a PDF, a report page) is never replaced: a DocID or a UUID names
// one filing. (eFD serves a page byte for byte the same on every fetch, so a
// refetch is never a conflict.) Index files are replaced when they change:
// the Clerk rebuilds every index nightly, eFD's list moves with every filing,
// and the ledger keeps its own history.
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { archive as archiveSources, archiveCommand, entry } from '../lib/archive.mjs';
import { RAW, efd } from './sources.mjs';

export const PREFIX = 'verbatim/house-ptr/';
export const SENATE_PREFIX = 'verbatim/senate-ptr/';
const HOUSE = resolve(RAW, 'house');
const AWS_CONFIG = resolve(RAW, 'archive-aws.config');

export const pdfKey = (year, docId) => `${PREFIX}${year}/${docId}.pdf`;
export const indexKey = (year) => `${PREFIX}index/${year}FD.zip`;
export const isIndexKey = (key) => key.startsWith(`${PREFIX}index/`);
export const senatePageKey = (uuid) => `${SENATE_PREFIX}${uuid}.html`;
export const senateIndexKey = (name) => `${SENATE_PREFIX}index/${name}`;
export const isSenateIndexKey = (key) => key.startsWith(`${SENATE_PREFIX}index/`);

// Every index ZIP and PDF in the cache, with its key. The extracted x<Year>/
// folders are derived from the ZIPs and are not archived.
export async function localFiles(house = HOUSE) {
  const out = [];
  for (const name of (await readdir(join(house, 'index'))).sort()) {
    const m = name.match(/^(\d{4})FD\.zip$/);
    if (m) out.push(await entry(indexKey(m[1]), join(house, 'index', name)));
  }
  const years = (await readdir(join(house, 'pdf'))).filter((y) => /^\d{4}$/.test(y)).sort();
  for (const year of years) {
    for (const name of (await readdir(join(house, 'pdf', year))).sort()) {
      const m = name.match(/^([0-9A-Za-z_-]+)\.pdf$/);
      if (m) out.push(await entry(pdfKey(year, m[1]), join(house, 'pdf', year, name)));
    }
  }
  return out;
}

// eFD's report pages, list pages and ledger. requests.log and blocked-until
// are this machine's, not the source's, and stay local.
export async function senateFiles(dir = efd.dir) {
  const out = [];
  const list = async (sub) => {
    try { return (await readdir(join(dir, sub))).sort(); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  };
  for (const name of await list('index')) if (/^p\d+\.json$/.test(name)) out.push(await entry(senateIndexKey(name), join(dir, 'index', name)));
  try {
    await stat(join(dir, 'filings.json'));
    out.push(await entry(senateIndexKey('filings.json'), join(dir, 'filings.json')));
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  for (const name of await list('ptr')) {
    const m = name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.html$/);
    if (m) out.push(await entry(senatePageKey(m[1]), join(dir, 'ptr', name)));
  }
  return out;
}

export const SOURCES = {
  house: { prefix: PREFIX, stage: resolve(RAW, 'archive-stage'), files: () => localFiles(), replaceable: isIndexKey },
  senate: { prefix: SENATE_PREFIX, stage: resolve(RAW, 'archive-stage-senate'), files: () => senateFiles(), replaceable: isSenateIndexKey },
};

// Returns the failures; an empty list means every local file of every source
// named is in the bucket byte for byte.
export const archive = ({ dryRun = false, sources = Object.keys(SOURCES) } = {}) =>
  archiveSources(SOURCES, { dryRun, names: sources, config: AWS_CONFIG });

// `archive [house|senate] [--dry-run]`, for cli.mjs.
export const archiveCmd = (args) => archiveCommand(SOURCES, args, { config: AWS_CONFIG });
