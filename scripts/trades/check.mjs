// What check holds the loaded tables to. Pure: compare() takes what build()
// produced from the raw copies, what the database returned, the
// parser-independent row count of each PDF, and the amounts the database's
// own trade_amount_rank() could not place, and returns failures. An empty
// list is a pass. `legacy` is the old ?senator= map, a parameter so the tests
// can pass their own.
import { MEMBER_COLUMNS, FILING_COLUMNS, ROW_COLUMNS } from './columns.mjs';
import { AMENDED, DELETED } from './amendments.mjs';
import { LEGACY_SENATORS } from '../../netlify/functions/shared/legacy-senators.js';

const fkey = (r) => `${r.chamber}:${r.filing_id}`;
const rkey = (r) => `${r.chamber}:${r.filing_id}:${r.row_num}`;

// Characters that never belong in a printed field: C0 and C1 controls,
// patch.mjs's mark for an unidentified glyph (U+E000), and the no-break space
// and soft hyphen (patch.mjs reads those glyphs as their visible twins). A
// U+FFFD is allowed: one filing (20012439) prints it.
// eslint-disable-next-line no-control-regex
const BAD_CHAR = /[\u0000-\u001f\u007f-\u009f\u00a0\u00ad\ue000]/;

const norm = (v) => (v === undefined ? null : v);

function diffRows(label, columns, expected, loaded, key, failures, limit = 20) {
  const got = new Map(loaded.map((r) => [key(r), r]));
  const want = new Map(expected.map((r) => [key(r), r]));
  let shown = 0;
  const note = (msg) => { if (shown++ < limit) failures.push(msg); };
  for (const [k, w] of want) {
    const g = got.get(k);
    if (!g) { note(`${label} ${k}: not loaded`); continue; }
    for (const [c] of columns) {
      if (norm(w[c]) !== norm(g[c])) note(`${label} ${k}: ${c} is ${JSON.stringify(g[c])}, expected ${JSON.stringify(w[c])}`);
    }
  }
  for (const k of got.keys()) if (!want.has(k)) note(`${label} ${k}: loaded but not in the raw copies`);
  if (shown > limit) failures.push(`${label}: ${shown - limit} more differences`);
}

export function compare({ build, loaded, raw, badAmounts, legacy = LEGACY_SENATORS }) {
  const failures = [];
  const { members, filings, rows, index, excluded, records } = build;

  // Coverage: every index PTR is a filing unless overrides.json excludes it;
  // every Senate Stock Watcher filing is one too.
  const houseFilings = filings.filter((f) => f.chamber === 'house');
  if (houseFilings.length + excluded.length !== index.length) {
    failures.push(`House: ${index.length} index PTRs, ${houseFilings.length} filings + ${excluded.length} excluded`);
  }
  const senateFilings = filings.filter((f) => f.chamber === 'senate');
  const senateRows = rows.filter((r) => r.chamber === 'senate');
  const txCount = records.reduce((n, r) => n + (r.transactions?.length ?? 0), 0);
  const paperLinks = records.filter((r) => /\/paper\//i.test(r.ptr_link)).length;
  if (senateFilings.length !== records.length) failures.push(`Senate: ${records.length} filings in the source, ${senateFilings.length} built`);
  if (senateRows.length !== txCount) failures.push(`Senate: ${txCount} transactions in the source, ${senateRows.length} rows built`);
  if (senateFilings.filter((f) => f.kind === 'paper').length !== paperLinks) failures.push(`Senate: ${paperLinks} paper links in the source`);

  // Every electronic House PTR parsed: a failed one is listed, and fails check.
  for (const f of houseFilings.filter((x) => x.parse_status === 'failed')) {
    failures.push(`House ${f.filing_id} (${f.report_year}): ${f.parse_error}`);
  }

  // The parser against the raw text layer, filing by filing.
  for (const f of houseFilings.filter((x) => x.parse_status === 'parsed')) {
    const n = raw.get(f.filing_id);
    if (n !== f.row_count) failures.push(`House ${f.filing_id}: parsed ${f.row_count} rows, raw text has ${n ?? 'no count'}`);
  }

  // The database against the raw copies, every column of every record.
  diffRows('member', MEMBER_COLUMNS, members, loaded.members, (m) => m.bioguide, failures);
  diffRows('filing', FILING_COLUMNS, filings, loaded.filings, fkey, failures);
  diffRows('row', ROW_COLUMNS, rows, loaded.rows, rkey, failures);

  // Each filing's row_count is its rows.
  const perFiling = new Map();
  for (const r of loaded.rows) perFiling.set(fkey(r), (perFiling.get(fkey(r)) ?? 0) + 1);
  for (const f of loaded.filings) {
    const n = perFiling.get(fkey(f)) ?? 0;
    if (n !== f.row_count) failures.push(`filing ${fkey(f)}: row_count ${f.row_count}, ${n} rows loaded`);
  }

  // One person per member name, and every row carries its member's name.
  const names = new Map();
  for (const m of loaded.members) {
    if (names.has(m.member)) failures.push(`member name "${m.member}" is both ${names.get(m.member)} and ${m.bioguide}`);
    names.set(m.member, m.bioguide);
  }
  const byId = new Map(loaded.members.map((m) => [m.bioguide, m.member]));
  let wrongName = 0;
  for (const r of loaded.rows) if (byId.get(r.bioguide) !== r.member) wrongName++;
  if (wrongName) failures.push(`${wrongName} rows carry a member name that is not their bioguide's`);

  // Every old /trades/?senator= link still finds its senator: the map's name
  // is trade_members', and the person has Senate rows (each of the 53 had
  // rows in senate_trades, so none filed paper only).
  const senateRowsBy = new Map();
  for (const r of loaded.rows) if (r.chamber === 'senate') senateRowsBy.set(r.bioguide, (senateRowsBy.get(r.bioguide) ?? 0) + 1);
  for (const [senator, bioguide, member] of legacy) {
    const got = byId.get(bioguide);
    if (got !== member) failures.push(`legacy senator "${senator}": ${bioguide} is ${got === undefined ? 'not loaded' : JSON.stringify(got)}, legacy-senators.js says ${JSON.stringify(member)}`);
    else if (!senateRowsBy.get(bioguide)) failures.push(`legacy senator "${senator}": ${bioguide} has no Senate rows`);
  }

  // A row is superseded exactly when one notice links to it.
  const linked = new Map();
  for (const r of loaded.rows) {
    if (r.amends_filing_id == null) continue;
    const k = `${r.chamber}:${r.amends_filing_id}:${r.amends_row_num}`;
    linked.set(k, (linked.get(k) ?? 0) + 1);
  }
  for (const r of loaded.rows) {
    const n = linked.get(rkey(r)) ?? 0;
    if (r.superseded && n !== 1) failures.push(`row ${rkey(r)}: superseded, linked from ${n} rows`);
    if (!r.superseded && n) failures.push(`row ${rkey(r)}: linked from ${n} rows, not superseded`);
  }

  // Printed values the schema relies on.
  for (const r of loaded.rows) {
    if (r.chamber === 'house' && ![null, 'New', AMENDED, DELETED].includes(r.filing_status)) {
      failures.push(`row ${rkey(r)}: filing status "${r.filing_status}"`);
    }
    for (const [c] of ROW_COLUMNS) {
      if (typeof r[c] === 'string' && BAD_CHAR.test(r[c])) {
        failures.push(`row ${rkey(r)}: ${c} holds U+${r[c].match(BAD_CHAR)[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }
  }
  for (const a of badAmounts) failures.push(`row ${rkey(a)}: amount "${a.amount}" is neither a printed range nor a dollar figure`);
  return failures;
}
