// Senate filings, from two copies of eFD: eFD itself (the ledger efd-index.mjs
// keeps, plus each electronic report's page as parse-senate.mjs reads it), and
// Senate Stock Watcher's aggregate/all_daily_summaries.json (decision 8 of the
// 2026-11-18 House trades record), one record per eFD filing with its link,
// received date and transactions in page order. build.mjs decides which copy
// a filing comes from; both go through `tradeRow`, so a Senate row means the
// same thing whichever copy it came from.
//
// Two changes to what the file holds, both to what eFD showed rather than
// away from it: eFD's own markup in a description is reduced to its text
// (tags and <br> to a space, entities decoded), and a cell eFD printed as
// "--" or left empty is NULL, as the existing senate_trades table has it.
import { usDate } from './house.mjs';
import { efd } from './sources.mjs';

export const TYPES = ['Purchase', 'Sale (Full)', 'Sale (Partial)', 'Exchange'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const codePoint = (e) => String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1)));

// eFD pages write an apostrophe as the hex reference &#x27; (213 of them in
// 116 pages as of 2026-11-18), so numeric references decode in both bases.
// Eight pages encode a reference twice ("Merck &amp;amp; Co."), so a browser
// shows "&amp;", and Senate Stock Watcher copied it. That is eFD's encoding,
// not the filer's words: an &amp; that wraps another reference is unwrapped
// first, and the text reads "Merck & Co." (ksmith, 2026-11-18).
export function htmlText(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;(#x[0-9a-f]+|#\d+|[a-z]+);/gi, '&$1;')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? codePoint(e) : m))
    .replace(/\s+/g, ' ')
    .trim();
}

export const cell = (s) => {
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

// One transaction row. `t` holds the cells already reduced to text, plus
// `type_code`, the type as the source wrote it (both sources print the word).
function tradeRow(base, t, label, errors) {
  if (!TYPES.includes(t.type)) errors.push(`${label}: type "${t.type_code}"`);
  const iso = t.transaction_date && usDate(t.transaction_date);
  if (t.transaction_date && !iso) errors.push(`${label}: transaction date "${t.transaction_date}"`);
  return {
    chamber: 'senate',
    filing_id: base.filing_id,
    row_num: base.row_num,
    source: base.source,
    bioguide: base.bioguide,
    member: base.member,
    transaction_id: null,
    filing_status: null,
    transaction_date: iso || null,
    notification_date: null,
    owner_code: null,
    owner: t.owner,
    asset_description: t.asset_description,
    ticker: t.ticker,
    asset_type_code: null,
    asset_type: t.asset_type,
    type_code: t.type_code,
    type: t.type,
    amount: t.amount,
    subholding_of: null,
    description: null,
    location: null,
    comment: t.comment,
  };
}

const CELLS = ['transaction_date', 'owner', 'ticker', 'asset_description', 'asset_type', 'type', 'amount', 'comment'];

export function senateFilings(records, members) {
  const out = [];
  for (const rec of records) {
    const { kind, id } = filingId(rec.ptr_link);
    const member = members.get(rec.bioguide);
    if (!member) throw new Error(`${id}: bioguide ${rec.bioguide} has no member row`);
    const errors = [];
    const filed = usDate(rec.date_recieved);
    if (!filed) errors.push(`received date "${rec.date_recieved}"`);
    const rows = (rec.transactions ?? []).map((t, i) => tradeRow(
      { filing_id: id, row_num: i + 1, source: 'carambat', bioguide: rec.bioguide, member: member.member },
      { ...Object.fromEntries(CELLS.map((c) => [c, cell(t[c])])), type_code: t.type },
      `row ${i + 1}`, errors,
    ));
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
      title: null,
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

const DATE = /\d\d\/\d\d\/\d{4}/;
const nextDay = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

// The list's title and the page's h1 name the same report, but the list
// renders the title's date in UTC and the page in Eastern, so a report filed
// at 19:00 ET or later lists a day late (73 of 1,638 originals, 2026-11-18).
// Any other difference is not the same title.
export function sameTitle(listed, printed) {
  if (listed === printed) return true;
  const a = DATE.exec(listed)?.[0], b = DATE.exec(printed)?.[0];
  if (!a || !b || listed.replace(DATE, '') !== printed.replace(DATE, '')) return false;
  return usDate(a) === nextDay(usDate(b));
}

// Filings from eFD: one per ledger entry given. `pages` maps an electronic
// entry's uuid to { page, fetched_at } (parsePtr's output) or { error,
// fetched_at } when its cached page did not parse; an entry with no page has
// none. `bioguideOf` is build.mjs's efdMatch.
//
// `filing_id` is the lowercase UUID; `url` keeps the case of eFD's link.
// `filed_date` is the list's received date, which the page's "Filed" line
// must equal. `title` is the page's h1 for an electronic report (Eastern, as
// the report prints it), the list's title for paper (it never shifts: 0 of
// 605) and for a report whose page is not held. `office` is as listed: it
// changes when a senator leaves. `filer_name` stays NULL: the page's heading
// prints the filer's status today, not at filing.
//
// A paper filing has no rows. An electronic one with no page, a page that
// did not parse, or a page that disagrees with its listing is `failed` with
// the reason and no rows, as a House PTR whose PDF was never fetched is.
export function efdFilings(entries, pages, bioguideOf, members) {
  return entries.map((e) => {
    const bioguide = bioguideOf(e);
    const member = members.get(bioguide);
    if (!member) throw new Error(`${e.uuid}: bioguide ${bioguide} has no member row`);
    const got = pages.get(e.uuid);
    const filing = {
      chamber: 'senate',
      filing_id: e.uuid,
      source: 'efd',
      kind: e.kind,
      bioguide,
      filer_prefix: null,
      filer_first: e.first || null,
      filer_last: e.last || null,
      filer_suffix: null,
      filer_name: null,
      office: e.office || null,
      state_district: null,
      report_year: null,
      filed_date: e.date_received,
      url: efd.viewUrl(e.kind, e.link_uuid),
      title: e.title || null,
      amends_filing_id: null,
      parse_status: 'paper',
      parse_error: null,
      row_count: 0,
      fetched_at: got?.fetched_at ?? null,
    };
    if (e.kind === 'paper') return { filing, rows: [] };
    const fail = (why) => ({ filing: { ...filing, parse_status: 'failed', parse_error: why }, rows: [] });
    if (!got) {
      return fail(e.page_gone
        ? `eFD answers the page with 302 to /search/ (first seen ${e.page_gone.slice(0, 10)}); no copy is held`
        : 'page not fetched');
    }
    if (got.error) return fail(`parse: ${got.error}`);
    const { page } = got;
    const errors = [];
    if (usDate(page.filed) !== e.date_received) errors.push(`page filed ${page.filed}, listed ${e.date_received}`);
    if (!sameTitle(e.title, page.title)) errors.push(`page title "${page.title}", listed "${e.title}"`);
    const rows = page.rows.map((r) => tradeRow(
      { filing_id: e.uuid, row_num: r.row_num, source: 'efd', bioguide, member: member.member },
      { ...r, type_code: r.type }, `#${r.row_num}`, errors,
    ));
    if (errors.length) return fail(errors.join('; '));
    return { filing: { ...filing, title: page.title, parse_status: 'parsed', row_count: rows.length }, rows };
  });
}
