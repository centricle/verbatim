// Where the trades loader reads from, and where its raw copies live.
//
// House: the Clerk's financial disclosure site. A yearly index ZIP lists every
// filing (`FilingType` P is a Periodic Transaction Report); each PTR is a PDF
// in a folder named for the index's Year column, which is not always the
// filing year (the 2013 index lists PTRs filed in 2014). A DocID starting
// "20" is an electronic filing with a text layer; any other is a paper
// scan, recorded and never fetched. Every file is rebuilt nightly. Use is
// governed by 5 U.S.C. § 13107(c): nothing commercial.
//
// Senate: Senate Stock Watcher's per-filing aggregate (Timothy Carambat, frozen
// since March 2021), until a loader for eFD itself exists. Pinned by hash,
// since the repo no longer changes.
//
// Members: unitedstates/congress-legislators (CC0), current and historical.
//
// One request every two seconds to the Clerk. Any status but 200 stops the
// run: a 403, 429 or 503 is the publisher saying no.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RAW = resolve(ROOT, 'tmp/trades');
export const UA = 'verbatim.fyi data loader (+https://github.com/centricle/verbatim)';
export const PACE_MS = 2_000;

export const CLERK = 'https://disclosures-clerk.house.gov/public_disc';
// The 2012 index lists no PTRs; 2013's are paper, filed in January 2014.
export const FIRST_INDEX_YEAR = 2013;

export const house = {
  indexUrl: (year) => `${CLERK}/financial-pdfs/${year}FD.zip`,
  indexZip: (year) => resolve(RAW, 'house/index', `${year}FD.zip`),
  indexEntry: (year) => `${year}FD.txt`,
  pdfUrl: (year, docId) => `${CLERK}/ptr-pdfs/${year}/${docId}.pdf`,
  pdfPath: (year, docId) => resolve(RAW, 'house/pdf', String(year), `${docId}.pdf`),
  isElectronic: (docId) => /^20\d{6}$/.test(docId),
};

export const senate = {
  url: 'https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_daily_summaries.json',
  path: resolve(RAW, 'carambat/raw/all_daily_summaries.json'),
  sha256: '7875e90d74100a59e4ce84c72b8b43b62d44df02313228e058f8d5589a185d8d',
};

export const legislators = ['current', 'historical'].map((which) => ({
  url: `https://unitedstates.github.io/congress-legislators/legislators-${which}.json`,
  path: resolve(RAW, 'members', `legislators-${which}.json`),
}));

export const lastIndexYear = () => new Date().getUTCFullYear();
