// Senate filings from Senate Stock Watcher's aggregate/all_daily_summaries.json
// (decision 8 of the 2026-11-18 House trades record): one record per eFD
// filing, with its link, received date and transactions in filing order.
//
// Two changes to what the file holds, both to what eFD showed rather than
// away from it: eFD's own markup in a description is reduced to its text
// (tags and <br> to a space, entities decoded), and a cell eFD printed as
// "--" or left empty is NULL, as the existing senate_trades table has it.
import { usDate } from './house.mjs';

export const TYPES = ['Purchase', 'Sale (Full)', 'Sale (Partial)', 'Exchange'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function htmlText(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : m))
    .replace(/\s+/g, ' ')
    .trim();
}

const cell = (s) => {
  if (s == null) return null;
  const t = htmlText(String(s));
  return t === '' || t === '--' ? null : t;
};

export function filingId(link) {
  const m = /\/search\/view\/(ptr|paper)\/([0-9a-f-]{36})\/?$/i.exec(link ?? '');
  if (!m) throw new Error(`not an eFD filing link: ${link}`);
  return { kind: m[1] === 'paper' ? 'paper' : 'electronic', id: m[2] };
}

// Each record's bioguide, held to a Senate term at its received date.
// `pins` is overrides.json's `senate`: Senate Stock Watcher's bioguide ->
// the right one, applied only when the record's last name is the pin's, so a
// pin cannot move some other filer who happens to carry the same wrong ID.
// Anything still without a term comes back in `failures`, and the load stops.
export function resolveSenate(records, hasSenateTerm, pins = {}) {
  const out = [], fixed = [], failures = [];
  for (const rec of records) {
    const pin = pins[rec.bioguide];
    const last = rec.last_name?.trim() ?? '';
    const applies = pin && pin.last.localeCompare(last.replace(/,.*$/, ''), 'en', { sensitivity: 'base' }) === 0;
    const bioguide = applies ? pin.bioguide : rec.bioguide;
    if (applies) fixed.push({ from: rec.bioguide, to: bioguide, link: rec.ptr_link });
    const filed = usDate(rec.date_recieved);
    if (!filed || !hasSenateTerm(bioguide, filed)) {
      failures.push(`${rec.first_name?.trim()} ${last} (${rec.office}) ${rec.date_recieved} ${bioguide}: no Senate term at this date`);
    }
    out.push(applies ? { ...rec, bioguide } : rec);
  }
  return { records: out, fixed, failures };
}

export function senateFilings(records, members) {
  const out = [];
  for (const rec of records) {
    const { kind, id } = filingId(rec.ptr_link);
    const member = members.get(rec.bioguide);
    if (!member) throw new Error(`${id}: bioguide ${rec.bioguide} has no member row`);
    const errors = [];
    const filed = usDate(rec.date_recieved);
    if (!filed) errors.push(`received date "${rec.date_recieved}"`);
    const rows = (rec.transactions ?? []).map((t, i) => {
      const type = cell(t.type);
      if (!TYPES.includes(type)) errors.push(`row ${i + 1}: type "${t.type}"`);
      const date = cell(t.transaction_date);
      const iso = date && usDate(date);
      if (date && !iso) errors.push(`row ${i + 1}: transaction date "${t.transaction_date}"`);
      return {
        chamber: 'senate',
        filing_id: id,
        row_num: i + 1,
        source: 'carambat',
        bioguide: rec.bioguide,
        member: member.member,
        transaction_id: null,
        filing_status: null,
        transaction_date: iso ?? null,
        notification_date: null,
        owner_code: null,
        owner: cell(t.owner),
        asset_description: cell(t.asset_description),
        ticker: cell(t.ticker),
        asset_type_code: null,
        asset_type: cell(t.asset_type),
        type_code: t.type,
        type,
        amount: cell(t.amount),
        subholding_of: null,
        description: null,
        location: null,
        comment: cell(t.comment),
      };
    });
    if (kind === 'paper' && rows.length) errors.push(`paper filing with ${rows.length} transactions`);
    const filing = {
      chamber: 'senate',
      filing_id: id,
      source: 'carambat',
      kind,
      bioguide: rec.bioguide,
      filer_prefix: null,
      filer_first: rec.first_name?.trim() || null,
      filer_last: rec.last_name?.trim() || null,
      filer_suffix: null,
      filer_name: null,
      office: rec.office?.trim() || null,
      state_district: null,
      report_year: null,
      filed_date: filed,
      url: rec.ptr_link,
      amends_filing_id: null,
      parse_status: kind === 'paper' ? 'paper' : 'parsed',
      parse_error: null,
      row_count: kind === 'paper' ? 0 : rows.length,
      fetched_at: null,
    };
    if (errors.length) throw new Error(`Senate filing ${id}: ${errors.join('; ')}`);
    out.push({ filing, rows: kind === 'paper' ? [] : rows });
  }
  return out;
}
