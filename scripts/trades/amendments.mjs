// Row-level amendment links for House rows (decision 3 of the 2026-11-18
// House trades record, refined the same day). A House PTR corrects a trade
// by printing it again in a later PTR with "Filing Status: Amended", and
// withdraws one with "Filing Status: Deleted"; both carry a transaction ID
// the original row never printed, so no key links them. The fields have to.
//
// A notice row is matched against the same member's rows in earlier filings
// that agree on owner, type and amount, in two tiers: first rows that also
// agree on both the asset and the transaction date; only if there are none,
// rows that agree on either. (Each of the three amended pairs found at the
// gate changed a different field; same-day rows for other assets are what
// made the one-tier rule ambiguous.) Rows already superseded are not
// candidates, so a second notice for one trade links to the first notice.
//
// - Exactly one match at the tier used: the link is set and the earlier row
//   is superseded.
// - None, or several: no link; the earlier rows stay. amendment_match says
//   which.
// - Two notices in one filing claiming the same earlier row: neither is
//   linked (ambiguous), rather than one winning by position.
//
// An Amended row is a trade and is counted; a Deleted row never is
// (stock_trades.counted). Filings are taken in (filed date, filing id)
// order, keyed by chamber as well as id, and a member's earlier rows are
// kept per chamber: Van Hollen filed House PTRs and then Senate ones, and a
// House notice must never claim a Senate row. Mutates and returns counts.

export const AMENDED = 'Amended';
export const DELETED = 'Deleted';
const NOTICE = new Set([AMENDED, DELETED]);

const order = (a, b) => (a.filed_date < b.filed_date ? -1 : a.filed_date > b.filed_date ? 1 : a.filing_id.localeCompare(b.filing_id));
const same = (a, b) => (a ?? null) === (b ?? null);
const sameDate = (a, b) => a.transaction_date != null && a.transaction_date === b.transaction_date;

export function candidates(r, earlier) {
  const base = earlier.filter((e) => !e.superseded
    && same(e.owner_code, r.owner_code) && e.type_code === r.type_code && same(e.amount, r.amount));
  const both = base.filter((e) => same(e.asset_description, r.asset_description) && sameDate(e, r));
  return both.length ? both : base.filter((e) => same(e.asset_description, r.asset_description) || sameDate(e, r));
}

export function linkAmendments(rows, filedDate) {
  const counts = { amended: 0, deleted: 0, unique: 0, none: 0, ambiguous: 0 };
  for (const r of rows) {
    r.amends_filing_id = null;
    r.amends_row_num = null;
    r.amendment_match = null;
    r.superseded = false;
  }
  const byFiling = new Map();
  for (const r of rows) {
    const k = `${r.chamber}:${r.filing_id}`;
    if (!byFiling.has(k)) byFiling.set(k, { filing_id: r.filing_id, filed_date: filedDate.get(r.filing_id), rows: [] });
    byFiling.get(k).rows.push(r);
  }
  const seen = new Map(); // chamber:bioguide -> rows of filings already passed
  for (const f of [...byFiling.values()].sort(order)) {
    const claims = new Map();
    for (const r of f.rows) {
      if (!NOTICE.has(r.filing_status)) continue;
      counts[r.filing_status === AMENDED ? 'amended' : 'deleted']++;
      const c = candidates(r, seen.get(`${r.chamber}:${r.bioguide}`) ?? []);
      r.amendment_match = c.length === 1 ? 'unique' : c.length ? 'ambiguous' : 'none';
      if (c.length === 1) {
        const k = `${c[0].filing_id}:${c[0].row_num}`;
        if (!claims.has(k)) claims.set(k, { target: c[0], by: [] });
        claims.get(k).by.push(r);
      }
    }
    for (const { target, by } of claims.values()) {
      if (by.length > 1) { for (const r of by) r.amendment_match = 'ambiguous'; continue; }
      by[0].amends_filing_id = target.filing_id;
      by[0].amends_row_num = target.row_num;
      target.superseded = true;
    }
    for (const r of f.rows) {
      if (r.amendment_match) counts[r.amendment_match]++;
      const who = `${r.chamber}:${r.bioguide}`;
      if (!seen.has(who)) seen.set(who, []);
      seen.get(who).push(r);
    }
  }
  return counts;
}

// Filing-level supersede for eFD (gate option (a), 2026-11-18 spike, section
// 5). A Senate amendment is a whole new report, "Periodic Transaction Report
// for MM/DD/YYYY (Amendment N)", that restates every row of the report it
// corrects, with the same `#` numbering. It names that report only by title,
// so an amendment is resolved to its root original by bioguide plus title
// with " (Amendment N)" removed; `title` is the page's h1, whose date is the
// original's Eastern received date (the list's is UTC and shifts). Several
// same-day originals: the one sharing the most rows identical by `#` wins,
// and a tie links nothing. No original: nothing is linked, and the
// amendment's rows are counted.
//
// The amendments of one root form a chain in (N, filed date, filing id)
// order: each one's amends_filing_id is the version before it. Every row of a
// filing another filing names is superseded, so a report counts once, in its
// latest version. Only a parsed amendment joins a chain: one with no rows (its
// page not fetched, gone, or refused) would otherwise supersede rows it does
// not replace. It stays unlinked and is reported in `unparsed`, and the next
// parsed version amends the one before it. Paper amendments ("(Amendment)", no number) carry no rows
// and name nothing. `out` is [{ filing, rows }] for one chamber; mutates it
// and returns what it did.
const AMENDMENT = / \(Amendment (\d+)\)$/;
const ROW_FIELDS = ['transaction_date', 'owner', 'ticker', 'asset_description', 'asset_type', 'type', 'amount', 'comment'];

function sharedRows(a, b) {
  const byNum = new Map(b.rows.map((r) => [r.row_num, r]));
  return a.rows.filter((r) => { const o = byNum.get(r.row_num); return o && ROW_FIELDS.every((f) => o[f] === r[f]); }).length;
}

export function supersedeFilings(out) {
  const done = { amendments: 0, linked: 0, none: [], ambiguous: [], unparsed: [], superseded_filings: 0, superseded_rows: 0 };
  const electronic = out.filter((x) => x.filing.source === 'efd' && x.filing.kind === 'electronic' && x.filing.title);
  const originals = new Map();
  for (const x of electronic) {
    if (AMENDMENT.test(x.filing.title)) continue;
    const k = `${x.filing.bioguide}|${x.filing.title}`;
    if (!originals.has(k)) originals.set(k, []);
    originals.get(k).push(x);
  }
  const chains = new Map(); // root filing_id -> amendments
  for (const x of electronic) {
    const m = AMENDMENT.exec(x.filing.title);
    if (!m) continue;
    done.amendments++;
    if (x.filing.parse_status !== 'parsed') { done.unparsed.push(x.filing.filing_id); continue; }
    const cands = originals.get(`${x.filing.bioguide}|${x.filing.title.replace(AMENDMENT, '')}`) ?? [];
    let root = cands.length === 1 ? cands[0] : null;
    if (cands.length > 1) {
      const scored = cands.map((c) => [sharedRows(x, c), c]).sort((a, b) => b[0] - a[0]);
      if (scored[0][0] > scored[1][0]) root = scored[0][1];
    }
    if (!root) { done[cands.length ? 'ambiguous' : 'none'].push(x.filing.filing_id); continue; }
    if (!chains.has(root.filing.filing_id)) chains.set(root.filing.filing_id, { root, versions: [] });
    chains.get(root.filing.filing_id).versions.push({ n: Number(m[1]), x });
  }
  for (const { root, versions } of chains.values()) {
    versions.sort((a, b) => a.n - b.n || a.x.filing.filed_date.localeCompare(b.x.filing.filed_date) || a.x.filing.filing_id.localeCompare(b.x.filing.filing_id));
    let prev = root;
    for (const { x } of versions) {
      x.filing.amends_filing_id = prev.filing.filing_id;
      done.linked++;
      done.superseded_filings++;
      for (const r of prev.rows) { r.superseded = true; done.superseded_rows++; }
      prev = x;
    }
  }
  return done;
}
