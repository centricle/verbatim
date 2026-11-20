// Supreme Court sources for the G1 survey: every URL, local file name and
// pace. Fetching and archiving only; nothing here reaches the site.
//
// Hosts and what their robots.txt said on 2026-11-20 (the fetcher reads it
// again on every run and obeys what it finds, not this list):
// - com-courtlistener-storage.s3-us-west-2.amazonaws.com: no robots.txt (404).
//   Free Law Project's public bulk-data bucket, quarterly snapshots.
// - www.supremecourt.gov: Crawl-delay 1; /images/, /rss/ and /cdn/ disallowed.
// - www.fjc.gov: Crawl-delay 30.
// - static.case.law: "Disallow: /" for every user agent. A source on that
//   host is refused unless it names a decision to fetch it anyway
//   (`robotsException`, below).
// - scdb.la.psu.edu: answers scripts with a Cloudflare challenge (403), so
//   SCDB's files are saved by hand, like the Institute for Justice's qi data.
//
// Pace: at least MIN_PACE_MS between requests to one host, or the host's
// Crawl-delay when longer. One request at a time per host; different hosts
// run in parallel.
//
// Raw downloads are untrusted data. Nothing is ever run from tmp/scotus/raw/,
// including CourtListener's load-bulk-data script, kept only as the record of
// its CSV dialect and column order.
import { resolve } from 'node:path';
import { REPO } from '../lib/archive.mjs';

export const UA = 'verbatim.fyi data loader (+https://github.com/centricle/verbatim)';
export const MIN_PACE_MS = 2000;
export const RAW = resolve(REPO, 'tmp/scotus/raw');
export const rawDir = (source) => resolve(RAW, source);

// The Court's term begins on the first Monday in October; OT2026 is the term
// that began in October 2026.
export function currentTerm(date = new Date()) {
  return date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}
export const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// --- CourtListener -------------------------------------------------------
// The newest quarterly snapshot when this was written. Opinions are 55 GB of
// bz2 across every court; filter-cl cuts the Supreme Court's rows out, and
// only those slices and the small whole tables are archived.
export const CL_SNAPSHOT = '2026-09-30';
export const CL_BASE = 'https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data';
const clFile = (table, ext = 'csv.bz2') => `${table}-${CL_SNAPSHOT}.${ext}`;

// Kept whole: small, and the people tables are how authors resolve.
export const CL_WHOLE = [
  clFile('schema', 'sql'),
  clFile('load-bulk-data', 'sh'),
  clFile('courts'),
  clFile('people-db-people'),
  clFile('people-db-positions'),
  clFile('people-db-political-affiliations'),
  clFile('people-db-retention-events'),
  clFile('people-db-educations'),
  clFile('people-db-schools'),
  clFile('people-db-races'),
  clFile('people_db_race'),
];

// Every court's rows; filter-cl keeps the Supreme Court's. `key` is the
// column that ties a row to the court, `keeps` the id set it adds to.
export const CL_SLICED = [
  { table: 'dockets', file: clFile('dockets'), key: 'court_id', court: 'scotus', keeps: 'docket' },
  { table: 'opinion-clusters', file: clFile('opinion-clusters'), key: 'docket_id', in: 'docket', keeps: 'cluster' },
  { table: 'opinions', file: clFile('opinions'), key: 'cluster_id', in: 'cluster', keeps: 'opinion' },
  { table: 'citations', file: clFile('citations'), key: 'cluster_id', in: 'cluster' },
  { table: 'search_opinioncluster_panel', file: clFile('search_opinioncluster_panel'), key: 'opinioncluster_id', in: 'cluster' },
  { table: 'search_opinioncluster_non_participating_judges', file: clFile('search_opinioncluster_non_participating_judges'), key: 'opinioncluster_id', in: 'cluster' },
  { table: 'search_opinion_joined_by', file: clFile('search_opinion_joined_by'), key: 'opinion_id', in: 'opinion' },
];
export const sliceName = (file) => file.replace(/\.csv\.bz2$/, '.scotus.csv.zst');

// --- supremecourt.gov ----------------------------------------------------
export const COURT = 'https://www.supremecourt.gov';
export const US_REPORTS_PAGE = `${COURT}/opinions/USReports.aspx`;
// Volumes 573 to 587 are the bound volumes CAP lacks (it stops at 572);
// 588 on are preliminary prints, in parts. The older volumes are the OCR
// comparison sample: spread across eras, each also in CAP, and holding Dred
// Scott (60), Plessy (163), Brown (347), Miranda (384) and Roe (410).
export const BOUND_NEW = range(573, 587);
export const BOUND_SAMPLE = [2, 10, 25, 40, 60, 80, 100, 125, 150, 163, 200, 250, 300, 347, 384, 410, 450, 500, 530, 560];
export const FIRST_PRELIM = 588;
export const FIRST_SLIP_TERM = 2018;
const yy = (term) => String(term % 100).padStart(2, '0');
export const slipPage = (term) => ({ file: `pages/slipopinion-${yy(term)}.html`, url: `${COURT}/opinions/slipopinion/${yy(term)}`, term });
export const ordersPage = (term) => ({ file: `pages/relatingtoorders-${yy(term)}.html`, url: `${COURT}/opinions/relatingtoorders/${yy(term)}`, term });

// Argument transcripts: the Court's archive starts with OT1968. OT2000 on are
// listed per term under argument_transcript/<term>; earlier terms, scanned
// from the Court's library, under archived_transcripts/<term>.
export const FIRST_TRANSCRIPT_TERM = 1968;
export const LAST_ARCHIVED_TERM = 1999;
// The scans run about 9.6 MB a PDF, 4,256 of them (about 41 GB), against
// about 1 GB for the 1,818 born-digital transcripts from OT2000. G1 fetches
// the born-digital terms and one scanned term per decade, and none of it goes
// to R2 until the design gate decides whether oral arguments ship (ksmith,
// 2026-11-20).
export const TRANSCRIPT_SCAN_SAMPLE = [1968, 1978, 1988, 1998];
export const transcriptPage = (term) => term <= LAST_ARCHIVED_TERM
  ? { file: `pages/archived_transcripts-${term}.html`, url: `${COURT}/oral_arguments/archived_transcripts/${term}`, term }
  : { file: `pages/argument_transcript-${term}.html`, url: `${COURT}/oral_arguments/argument_transcript/${term}`, term };

// --- FJC Biographical Directory -------------------------------------------
// The export page links judges.csv and its relational tables, updated nightly.
export const FJC_PAGE = 'https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export';

// --- SCDB (saved by hand) --------------------------------------------------
// From each file's release page in a browser. Case-centered and
// justice-centered, organized by citation. The names are the ones the site
// serves (its download links are ?jet_download=<hash>, and WordPress's file
// name sanitizer turns ".csv.zip" into ".csv_.zip"); the CSV inside keeps the
// release's name. Any file saved into tmp/scotus/raw/scdb/ is taken; these
// are the ones the survey expects, each with the page it comes from.
export const SCDB_PAGE = 'https://scdb.la.psu.edu/data/';
export const SCDB_FILES = {
  'SCDB_2026_01_caseCentered_Citation.csv_.zip': 'https://scdb.la.psu.edu/data/2026-release-01/',
  'SCDB_2026_01_justiceCentered_Citation.csv_.zip': 'https://scdb.la.psu.edu/data/2026-release-01/',
  'SCDB_Legacy_07_caseCentered_Citation.csv_.zip': 'https://scdb.la.psu.edu/data/scdb-legacy-07/',
  'SCDB_Legacy_07_justiceCentered_Citation.csv_.zip': 'https://scdb.la.psu.edu/data/scdb-legacy-07/',
};

// --- Caselaw Access Project ------------------------------------------------
// static.case.law serves CAP's bulk export: per volume, a zip of case JSON
// plus the reporter's metadata JSON. Its robots.txt disallows everything, so
// a CAP source fetches nothing until `robotsException` records who decided
// otherwise, when and why. Decision (ksmith, 2026-11-20): skip it; the survey
// reads CAP's text from CourtListener, which imported it. Asking Harvard's
// Library Innovation Lab stays open.
export const CAP_BASE = 'https://static.case.law';
export const CAP = {
  'cap-us': { reporter: 'us', robotsException: null },
  'cap-sct': { reporter: 's-ct', volumes: range(134, 140), robotsException: null },
};
