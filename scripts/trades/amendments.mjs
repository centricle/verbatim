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
// order. Mutates and returns counts.

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
    if (!byFiling.has(r.filing_id)) byFiling.set(r.filing_id, { filing_id: r.filing_id, filed_date: filedDate.get(r.filing_id), rows: [] });
    byFiling.get(r.filing_id).rows.push(r);
  }
  const seen = new Map(); // bioguide -> rows of filings already passed
  for (const f of [...byFiling.values()].sort(order)) {
    const claims = new Map();
    for (const r of f.rows) {
      if (!NOTICE.has(r.filing_status)) continue;
      counts[r.filing_status === AMENDED ? 'amended' : 'deleted']++;
      const c = candidates(r, seen.get(r.bioguide) ?? []);
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
      if (!seen.has(r.bioguide)) seen.set(r.bioguide, []);
      seen.get(r.bioguide).push(r);
    }
  }
  return counts;
}
