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
// Senate: eFD, the Senate's own search (efd.mjs has the session rules).
// Every filing in its Periodic Transaction Report list, and the page of each
// electronic one; paper filings are scans, recorded from the list and never
// fetched. The agreement eFD asks for is accepted once per run, and binds the
// use: nothing commercial, the same as 5 U.S.C. § 13107(c). eFD answers
// datacenter and CI addresses with a 403, so this runs from a home network.
//
// Senate Stock Watcher's per-filing aggregate (Timothy Carambat, frozen since
// March 2021) fills any filing eFD no longer serves: one eFD no longer lists,
// or an electronic one whose page is not held (`splitSenate` in build.mjs).
// Pinned by hash, since the repo no longer changes.
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

const EFD = 'https://efdsearch.senate.gov';
const SENATE_RAW = resolve(RAW, 'senate');

export const efd = {
  base: EFD,
  // The earliest received date the list is asked for: the STOCK Act's first
  // PTRs were filed in July 2012.
  since: '01/01/2012 00:00:00',
  pageSize: 100,
  viewUrl: (kind, uuid) => `${EFD}/search/view/${kind === 'paper' ? 'paper' : 'ptr'}/${uuid}/`,
  dir: SENATE_RAW,
  indexPage: (n) => resolve(SENATE_RAW, 'index', `p${String(n).padStart(2, '0')}.json`),
  indexDir: resolve(SENATE_RAW, 'index'),
  ledger: resolve(SENATE_RAW, 'filings.json'),
  ptrPath: (uuid) => resolve(SENATE_RAW, 'ptr', `${uuid}.html`),
  ptrDir: resolve(SENATE_RAW, 'ptr'),
  log: resolve(SENATE_RAW, 'requests.log'),
  blockedUntil: resolve(SENATE_RAW, 'blocked-until'),
  targets: resolve(SENATE_RAW, 'purge-targets.json'),
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
