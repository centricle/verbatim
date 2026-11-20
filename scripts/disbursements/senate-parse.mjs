// Parse one volume of the Report of the Secretary of the Senate, from the
// positioned lines senate-pdf.mjs reads out of `pdftotext -bbox-layout`.
//
// Pure functions only. cli.mjs runs pdftotext; the fixtures hand in
// hand-written pages with the fake cast's names.
//
// Only the B section is read: "DETAILED AND SUMMARY STATEMENT OF
// EXPENDITURES", one block per office and funding year. A block opens with
// that banner, then a header (office name, funding year, the appropriation
// title, and a summary of the period by object class, closed by ORGANIZATION
// TOTALS), then the column headings (DOCUMENT NO. ... AMOUNT ($)), then the
// lines. Every block starts on a new page and may run over many.
//
// The lines, by where their text sits (columns are read from each table's
// own headings, because two layouts can alternate on one page):
//
// - entry: a document number and dates, payee, description, amount.
// - continuation: description and amount only, right under an entry: a
//   further line of the same document. It takes the document number, dates
//   and payee of the line above, and extras.doc_line counts it (2, 3, ...).
// - person: a name in the payee column, a position title in the
//   description column, an amount, no document and no dates: one staff
//   member's pay for the period.
// - subtotal: a label and an amount, listed after the lines it covers.
//   There are two levels. A class total's label is one of the block
//   summary's object classes (NET PAYROLL EXPENSES, TRAVEL AND
//   TRANSPORTATION OF PERSONS, ...). Anything else is a sub-class
//   (PERSONNEL COMP. FULL-TIME PERMANENT, PERSONNEL BENEFITS, ...), and a
//   class total covers the sub-classes before it. Volumes from 2026 put
//   both levels left of the description column; the 2012 volume puts
//   sub-classes in the description column, where they look like
//   continuations: there a description-only line is a sub-class when its
//   amount equals the lines since the last subtotal, or when no line came
//   since the last subtotal.
// - fragment: text with no amount, a wrapped payee or description. A
//   wrapped payee is centered on its row (one line above, one below), so a
//   payee fragment joins the row nearest it; a wrapped description runs
//   down from its row, so a description fragment joins the row above it.
//
// What reaches the table, and nothing else:
//
// - Every entry and continuation line, as published. A cell's line
//   breaks become single spaces.
// - Never a person line (ksmith, 2026-11-18: the site is never a
//   name-to-salary lookup). In its place, the subtotal that covers it,
//   which must cover nothing but person lines. The block still reconciles,
//   because the subtotal is the sum of the lines it replaces.
// - Every subtotal that covers no line at all (the Senate reports some
//   amounts only as a subtotal, BENEFITS FOR FORMER PERSONNEL among them),
//   with extras.unitemized. Without them the block would not reconcile.
// - row_kind 'subtotal' for both of those; description is the label.
// - category is the class total's label, upper case (2026 gives "Net
//   Payroll Expenses" in title case); a sub-class label rides in
//   extras.subclass.
// - organization and office are the block's office name as published;
//   program is its appropriation title; funding_year as published ("2024",
//   "2021-2026"). transaction_date is DATE POSTED, start_date and end_date
//   the OBLIGATION/SERVICE DATES, as ISO dates; a date in any other form
//   loads as null with the text under extras.dates_as_filed.
// - extras.page (1-based page of the PDF, which source_ref links with
//   #page=) and extras.page_label (the page's own B-n).
// - A document's later lines whose first line is missing from the PDF's
//   text load with no document, payee or dates, and
//   extras.no_document_line.
// - A class the summary charges with no class total in the lines loads as
//   one row (extras.from_summary), unitemized unless it takes person lines
//   listed with no subtotal of their own.
// - The committees' inquiries and investigations statements (section B-2,
//   labeled B-2-1 on) give no funding year: funding_year is null, the
//   first header line is the office, the rest the program.
// - Lines that net to nothing under no class total of their own take the
//   one class the summary lists at zero with no total, or none (null).
// - Rows from a page the report publishes as an image carry extras.ocr; the
//   page's text is a committed transcription (senate-ocr.mjs).
//
// Summary figures carry the opposite sign to the lines (a period's
// spending shows as -88,227.94 above lines that sum to 88,227.94), so the
// checks compare lines with the negated summary.
//
// Every block must reconcile: its rows sum to ORGANIZATION TOTALS, its
// lines to their subtotals, its class totals to the summary. Where the
// report disagrees with itself, the rows load as published and the gap is
// listed as a discrepancy (senate-discrepancies.json), never smoothed over.
// Any other mismatch fails the volume. The kinds:
//
// - summary: a class total (or two of one class, summed) differs from the
//   summary's figure for it. Also a class the summary names otherwise
//   (summaryLabel; paired by an equal figure) and a class the summary
//   leaves out, compared with zero.
// - pay: person lines that do not add up to their pay sub-class, or that no
//   subtotal or summary figure takes at all (label null, `printed: 0`).
// - lines: a class's lines differ from its stated total while that total
//   equals the summary's figure: the report's two figures agree, the lines
//   do not. At most one per block.
// - memo: a subtotal of person lines shown outside the statement's
//   figures (the committees' PERSONNEL COMPENSATION, Oct 2016 to Mar 2017).
//   It does not load.

import { readPages } from './senate-pdf.mjs';
import { centsText } from './parse.mjs';

const BANNER = 'DETAILED AND SUMMARY STATEMENT OF EXPENDITURES';
const MONEY = /^(-)?\$?(-)?(\d{1,3}(?:,\d{3})*|\d+)?\.(\d\d)$/;
const DATE = /^(\d\d)\/(\d\d)\/(\d{4})$/;
// Placed in a date column even when malformed ("10/01/118", Oct 2018 to Mar
// 2019, B-333; "03/202023", Apr to Sep 2023, B-336); datesOf keeps such text
// under extras.dates_as_filed.
const DATE_SHAPED = /^(?=.{8,10}$)\d{1,2}\/\d{1,2}\/?\d{1,4}$/;
const PAGE_LABEL = /^([A-Z])(?:-(\d+)(?=-))? ?- ?(\d{1,3}(?:,\d{3})+|\d+)$/;
const NOT_CLASSES = new Set(['AUTHORIZATION', 'SUPPLEMENTALS', 'TRANSFERS', 'RESC / WITHDRAWALS', 'ORGANIZATION TOTALS']);
// "2024", "2021-2026", or a no-year account: "X" (2012), "X (NO-YEAR)",
// "X (REVOLVING)" (2026).
const FUNDING_YEAR = /^(\d{4}(-\d{4})?|X|X \([A-Z -]+\))$/;
// Sub-classes whose lines are one person's pay each, for placing person
// lines that do not add up to their stated subtotal (see `pay` above).
const PAY = new Set(['PERSONNEL COMP. FULL-TIME PERMANENT', 'OTHER PERSONNEL COMPENSATION', 'RE-EMPLOYED ANNUITANTS', 'WHEN ACTUALLY EMPLOYED (WAE)']);
// Sub-class labels a volume may put in the description column even when
// it puts the rest left of it.
const SUBCLASS_IN_DESC = new Set([...PAY, 'PERSONNEL BENEFITS', 'BENEFITS FOR FORMER PERSONNEL']);
const PAY_ADJUSTMENT = /^SALARIES-.*\(INTERFACE\)$/;
// Where the report disagrees with itself, the lines load as published and
// parseVolume lists the disagreement under `discrepancies` instead of
// failing. Three kinds are allowed, and nothing else:
//
// - summary: a class total in the lines differs from the block summary's
//   figure for that class. About a hundred payroll blocks (CHAPLAIN, FY
//   2026: four pay lines and their stated subtotal say $344,049.88, the
//   summary $342,049.88), and travel in three Senators' blocks, where one
//   $7,399.04 item is itemized under one Senator and summarized under
//   another. The lines must still add up to their own stated subtotals.
// - pay: person lines that do not add up to their stated subtotal
//   (CONSULTANTS, FY 2026-2028: 32 lines sum to $3,082,133.99 under a
//   subtotal of $3,075,864.55, confirmed on the -layout text), or that no
//   subtotal takes at all (label null, `printed: 0`). Person lines never load,
//   and the stated subtotal that does agrees with the summary.
// - summary also covers a class totaled twice in one block: the totals'
//   sum is what is held against the summary.
// - lines: a class's lines do not add up to its stated total, and that
//   total agrees with the block summary (a Senator's FY 2023 block in the
//   Oct 2023 to Mar 2024 volume, page B-904: ten travel lines sum to
//   $1,627.57 under a class total and a summary of $5,116.02). The lines load as
//   published, so the block's rows fall short of ORGANIZATION TOTALS by the
//   gap. Only one such class per block: two could be a line read into the
//   wrong class.

export const fold = (s) => (s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// '-$8,484.00' -> -848400, '$.00' -> 0, '18.75' -> 1875; null if not money.
export function moneyCents(text) {
  const m = MONEY.exec(text);
  if (!m || (m[1] && m[2])) return null;
  const cents = Number((m[3] ?? '0').replaceAll(',', '')) * 100 + Number(m[4]);
  return m[1] || m[2] ? -cents : cents;
}

// '12/16/2025' -> '2025-12-16'; undefined for anything else.
export function isoDate(text) {
  const m = DATE.exec(text);
  if (!m) return undefined;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // A well-formed date in no year the report can mean ("05/16/0421", Apr to
  // Sep 2021; "10/11/0211", Oct 2021 to Mar 2022; "04/24/3013"; "07/31/2109"
  // and "08/31/2109" on consecutive lines, Oct 2019 to Mar 2020) is a
  // typo like any other, kept as published under extras.dates_as_filed.
  if (y < 1900 || y > 2099) return undefined;
  if (mo < 1 || mo > 12) return undefined;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d < 1 || d > last) return undefined;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

const center = (l) => (l.y0 + l.y1) / 2;
const mid = (l) => (l.x0 + l.x1) / 2;

// Lines whose vertical centers lie within 1.5 pt share a baseline. Rows are
// at least 5 pt apart in every volume seen, and a wrapped cell's lines sit
// about 2.6 pt off their row, so neither merges.
export function baselines(lines) {
  const sorted = [...lines].sort((a, b) => center(a) - center(b) || a.x0 - b.x0);
  const groups = [];
  for (const l of sorted) {
    const g = groups.at(-1);
    if (g && center(l) - g.c < 1.5) g.lines.push(l);
    else groups.push({ c: center(l), lines: [l] });
  }
  for (const g of groups) g.lines.sort((a, b) => a.x0 - b.x0);
  return groups;
}

// The page label (B-334), set sideways in the right margin. Some
// volumes show it a second time, small, inside the page ("B - 10", "B -1"),
// and 2017's first volume stamps its jacket number and date sideways in the
// left margin ("JA", "25-107", "05/05/2017"). Those are not the page's text:
// `ignored` holds them, and splitBlocks drops them.
// The committees' statements in the first volume (Apr to Sep 2011, from
// B- 1 again at page 2101) set it upright at the foot of the page
// instead, left of x = 590: the lowest label right of x = 500.
function pageLabel(page) {
  const l = page.lines.find((x) => x.x0 > 590 && PAGE_LABEL.test(x.text))
    ?? page.lines.filter((x) => x.x0 > 500 && PAGE_LABEL.test(x.text)).at(-1);
  if (!l) return { label: null, section: null, ignored: new Set() };
  const [, section, part, n] = PAGE_LABEL.exec(l.text);
  const num = n.replaceAll(',', '');
  const label = `${section}${part ? `-${part}` : ''}-${num}`;
  // The second copy drops the part: "B-2-1" in the margin, "B- 1" below.
  const ignored = new Set(page.lines.filter((x) => x === l
    || (PAGE_LABEL.test(x.text) && (([, s, , m]) => s === section && m.replaceAll(',', '') === num)(PAGE_LABEL.exec(x.text)))
    || x.x1 < 45
    // Rules drawn as text around the column headings (Apr to Sep 2020,
    // B-761: "-", "--", "-~", ",__", and "f----", "t--", ",-- -", ">----").
    // Nothing in them is a word or money.
    || /^[a-z>]?[-~_,.][-~_,. ]*$/.test(x.text)));
  return { label, section, ignored };
}

const has = (g, text) => g.lines.find((l) => l.text === text);
const isColumnHeading = (g) => g.lines.some((l) => l.text === 'DOCUMENT NO.');
const HEADING_BITS = new Set(['DATES', 'POSTED', 'START', 'END', 'START END', 'OBLIGATION/SERVICE', 'DATE', 'PAYEE NAME', 'DESCRIPTION', 'AMOUNT ($)', 'AMOUNT', '($)', 'DOCUMENT NO.']);
const isHeadingBits = (g) => g.lines.every((l) => HEADING_BITS.has(l.text));

// Column positions from a table's headings. START and END sit on a later
// baseline than DOCUMENT NO., so they are merged in as they come.
function readColumns(g, prev) {
  const cols = { ...(prev ?? {}) };
  for (const l of g.lines) {
    if (l.text === 'DOCUMENT NO.') cols.doc = l;
    else if (l.text === 'DATE' || l.text === 'POSTED') cols.posted = cols.posted && cols.posted.text === 'POSTED' && l.text === 'DATE' ? cols.posted : l;
    else if (l.text === 'PAYEE NAME') cols.payee = l;
    else if (l.text === 'DESCRIPTION') cols.desc = l;
    else if (l.text === 'AMOUNT ($)') cols.amount = l;
    // Split in two on some pages (Apr to Sep 2016, B-534): "AMOUNT" "($)".
    else if (l.text === 'AMOUNT') cols.amount = { ...l, x1: g.lines.find((x) => x.text === '($)' && x.x0 > l.x1 && x.x0 - l.x1 < 12)?.x1 ?? l.x1 };
    else if (l.text === 'START') cols.start = l;
    else if (l.text === 'END') cols.end = l;
    else if (l.text === 'START END') {
      const w = l.words;
      cols.start = { ...w[0], y0: l.y0, y1: l.y1, text: 'START' };
      cols.end = { ...w[1], y0: l.y0, y1: l.y1, text: 'END' };
    }
  }
  return cols;
}

/**
 * Split pages into blocks of baseline groups.
 * @returns {{ blocks: object[], problems: string[], bPages: number[] }}
 */
export function splitBlocks(pages) {
  const blocks = [];
  const problems = [];
  const bPages = [];
  // Money-shaped text in what pageLabel drops (the committees put "3.00"
  // beside each class total in the left margin, 2011), for the raw check.
  const margin = { money: 0, cents: 0, pages: new Set() };
  let block = null;
  let mode = 'none';
  let cols = null;
  for (const page of pages) {
    const { label, section, ignored } = pageLabel(page);
    if (section === 'B') for (const l of ignored) for (const w of l.text.split(/\s+/)) { const c = moneyCents(w); if (c != null) { margin.money++; margin.cents += c; margin.pages.add(page.number); } }
    if (section !== 'B') { if (block) { blocks.push(block); block = null; mode = 'none'; } continue; }
    bPages.push(page.number);
    const lines = page.lines.filter((l) => !ignored.has(l));
    for (const g of baselines(lines)) {
      g.page = page.number;
      g.label = label;
      if (has(g, BANNER)) {
        if (block) blocks.push(block);
        block = { page: page.number, label, header: [], detail: [] };
        mode = 'header';
        cols = null;
        continue;
      }
      if (!block) { problems.push(`page ${page.number} (${label}): text before the first block: ${g.lines.map((l) => l.text).join(' | ')}`); continue; }
      if (isColumnHeading(g)) { cols = readColumns(g, mode === 'detail' ? cols : null); mode = 'detail'; continue; }
      if (mode === 'detail' && isHeadingBits(g)) { cols = readColumns(g, cols); continue; }
      if (mode === 'header') block.header.push(g);
      else { g.cols = cols; block.detail.push(g); }
    }
  }
  if (block) blocks.push(block);
  return { blocks, problems, bPages, margin };
}

// The block header: office, funding year, appropriation title, and the
// summary figures by label.
export function readHeader(block) {
  const problems = [];
  const where = `block at page ${block.page} (${block.label})`;
  const all = block.header.flatMap((g) => g.lines);
  const auth = all.find((l) => l.text === 'Authorization');
  const fy = all.find((l) => /^Funding Year\b/.test(l.text));
  const colAvail = all.find((l) => l.text === 'NET FUNDS');
  const colPeriod = all.find((l) => l.text === 'NET EXPENDITURES FOR');
  const colYtd = all.find((l) => l.text === 'TOTAL FUNDING');
  if (!auth || !colAvail || !colPeriod || !colYtd) {
    problems.push(`${where}: header lacks ${[!auth && 'Authorization', !colAvail && 'NET FUNDS', !colPeriod && 'NET EXPENDITURES FOR', !colYtd && 'TOTAL FUNDING'].filter(Boolean).join(', ')}`);
    return { problems };
  }
  const used = new Set([auth, fy, colAvail, colPeriod, colYtd].filter(Boolean));
  const leftEdge = auth.x0 - 100;
  let fundingYear = null;
  let office;
  let program;
  if (fy) {
    // Funding year: the rest of the "Funding Year" line, or the line beside it.
    fundingYear = fy.text.replace(/^Funding Year\s*/, '').trim();
    if (!fundingYear) {
      const v = all.find((l) => l !== fy && Math.abs(center(l) - center(fy)) < 1.5 && l.x0 > fy.x1 && l.x0 < auth.x0 && FUNDING_YEAR.test(l.text));
      if (v) { fundingYear = v.text; used.add(v); }
    }
    if (!FUNDING_YEAR.test(fundingYear)) problems.push(`${where}: funding year "${fundingYear}"`);
    const left = all.filter((l) => !used.has(l) && l.x0 < leftEdge);
    office = left.filter((l) => center(l) < center(fy)).sort((a, b) => a.y0 - b.y0);
    program = left.filter((l) => center(l) > center(fy)).sort((a, b) => a.y0 - b.y0);
  } else {
    // The committees' inquiries and investigations statements (section
    // B-2, Apr to Sep 2011 and later) give no funding year: the committee's
    // name, then its short name and authorizing resolution ("... S.RES.89D
    // (110TH)"), then the appropriation. The first line is the office, the
    // rest the program, as published; the funding year is null.
    const left = all.filter((l) => !used.has(l) && l.x0 < leftEdge).sort((a, b) => a.y0 - b.y0);
    if (left.length < 2) problems.push(`${where}: header lacks Funding Year`);
    office = left.slice(0, 1);
    program = left.slice(1);
  }
  for (const l of [...office, ...program]) used.add(l);
  // Column titles: everything above the first summary label that is not the
  // office name (DESCRIPTION, AVAILABLE AS, OF 10/01/2025, ($), ...).
  const titlesEnd = auth.y0 - 1;
  const periodText = [];
  for (const l of all) {
    if (used.has(l) || l.y1 > titlesEnd + 6 || l.x0 < leftEdge) continue;
    if (moneyCents(l.text) != null) continue;
    used.add(l);
    if (Math.abs(mid(l) - mid(colPeriod)) < 40) periodText.push(l.text);
  }
  // Summary labels sit on the Authorization line's left edge.
  const labels = all.filter((l) => !used.has(l) && Math.abs(l.x0 - auth.x0) < 4 && moneyCents(l.text) == null);
  labels.push(auth);
  for (const l of labels) used.add(l);
  const summary = labels.map((l) => ({ label: l.text, line: l, avail: null, period: null, ytd: null, unexpended: null }));
  const amounts = all.filter((l) => !used.has(l) && moneyCents(l.text) != null && l.x0 > auth.x0);
  for (const a of amounts) {
    used.add(a);
    const dists = summary.map((s) => Math.abs(center(s.line) - center(a))).sort((x, y) => x - y);
    const s = summary.reduce((best, s) => (Math.abs(center(s.line) - center(a)) < Math.abs(center(best.line) - center(a)) ? s : best));
    const cents = moneyCents(a.text);
    // A zero changes no total, so where it lands does not matter: one
    // summary lists "Cash 0.00 0.00" twice with an unlabeled pair of zeros
    // between (Oct 2021 to Mar 2022, B-300).
    if (dists.length > 1 && dists[1] - dists[0] < 1 && cents !== 0) problems.push(`${where}: amount ${a.text} is as near "${s.label}" as another label`);
    if (/^UNEXPENDED BALANCE/.test(s.label)) { s.unexpended = cents; continue; }
    const col = [['avail', colAvail], ['period', colPeriod], ['ytd', colYtd]]
      .reduce((best, c) => (Math.abs(a.x1 - c[1].x1) < Math.abs(a.x1 - best[1].x1) ? c : best))[0];
    if (s[col] != null && cents !== 0 && s[col] !== 0) problems.push(`${where}: "${s.label}" has two ${col} figures`);
    s[col] = (s[col] ?? 0) + cents;
  }
  const leftover = all.filter((l) => !used.has(l));
  for (const l of leftover) problems.push(`${where}: header text not read: "${l.text}" at ${l.x0.toFixed(1)},${l.y0.toFixed(1)}`);
  const org = summary.find((s) => s.label === 'ORGANIZATION TOTALS');
  if (!org || org.period == null) problems.push(`${where}: no ORGANIZATION TOTALS figure for the period`);
  const classes = new Map();
  for (const s of summary) {
    if (NOT_CLASSES.has(fold(s.label)) || /^UNEXPENDED BALANCE/.test(s.label)) continue;
    // RESERVE FOR CONTINGENCIES (2026, B-228) lists Net Payroll Expenses
    // twice; a class's figures are the sum of its summary lines.
    const prev = classes.get(fold(s.label));
    if (prev) {
      for (const k of ['period', 'ytd']) if (s[k] != null) prev[k] = (prev[k] ?? 0) + s[k];
      prev.lines = (prev.lines ?? 1) + 1;
    } else classes.set(fold(s.label), s);
  }
  return {
    office: office.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim(),
    program: program.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim() || null,
    fundingYear,
    periodText: periodText.join(' '),
    summary,
    classes,
    orgPeriod: org?.period ?? null,
    moneyCount: amounts.length,
    moneySum: amounts.reduce((a, l) => a + moneyCents(l.text), 0),
    problems,
  };
}

// Sort one detail baseline's lines into cells by the table's columns.
function cellsOf(g) {
  const c = g.cols;
  const out = { doc: [], posted: [], start: [], end: [], payee: [], label: [], desc: [], amount: [], stray: [], margin: [] };
  if (!c || !c.posted || !c.start || !c.end || !c.amount) { out.stray.push(...g.lines); return out; }
  const postedRight = Math.max(c.posted.x1, c.posted.x0 + 20);
  const descLeft = c.end.x1 + 4;
  for (const l of g.lines) {
    if (moneyCents(l.text) != null && l.x1 > c.amount.x0) { out.amount.push(l); continue; }
    if (DATE_SHAPED.test(l.text)) {
      const d = [['posted', c.posted], ['start', c.start], ['end', c.end]]
        .reduce((best, k) => (Math.abs(mid(l) - mid(k[1])) < Math.abs(mid(l) - mid(best[1])) ? k : best))[0];
      out[d].push(l);
      continue;
    }
    // The committees put a small number ("3.00", "4.00") left of the
    // document column beside some class totals (Apr to Sep 2016 and 2020,
    // B-2-3). No document number is shaped like it, and it is never an amount.
    if (l.x1 < c.posted.x0 - 2 && /^\d{1,2}\.00$/.test(l.text)) out.margin.push(l);
    else if (l.x1 < c.posted.x0 - 2) out.doc.push(l);
    else if (l.x0 >= postedRight + 3 && l.x0 < c.start.x0 - 10) out.payee.push(l);
    // Class labels can start a little left of START (the committees, 2011: 6 pt);
    // payee text starts at the payee column, far to the left.
    else if (l.x0 >= c.start.x0 - 10 && l.x0 < descLeft) out.label.push(l);
    else if (l.x0 >= descLeft) out.desc.push(l);
    else out.stray.push(l);
  }
  return out;
}

const text = (ls) => ls.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim() || null;

// 2012 subtotals a block's pay lines under two or three pay sub-classes at
// once, at the end of the block (MAJORITY CONFERENCE COMMITTEE, B-47: 29
// lines, then OTHER PERSONNEL COMPENSATION $143.46 and PERSONNEL COMP.
// FULL-TIME PERMANENT $702,566.35). Each sub-class's lines sit together,
// so the lines split into consecutive runs, one per sub-class, each adding
// up to its subtotal exactly. Tries every order of every subset of the open
// pay sub-classes; returns [{ sub, lines }] for the first exact split, or
// null.
function splitPersons(lines, subs) {
  const sums = [0];
  for (const l of lines) sums.push(sums.at(-1) + l.cents);
  const orders = [];
  const grow = (picked, rest) => {
    if (picked.length) orders.push(picked);
    for (const [i, s] of rest.entries()) grow([...picked, s], rest.filter((_, j) => j !== i));
  };
  grow([], subs);
  for (const order of orders) {
    if (order.length < 2 || order.reduce((a, s) => a + s.cents, 0) !== sums.at(-1)) continue;
    const cuts = [0];
    let target = 0;
    for (const s of order) {
      target += s.cents;
      const at = sums.findIndex((v, i) => i > cuts.at(-1) && v === target);
      if (at < 0) break;
      cuts.push(at);
    }
    if (cuts.length !== order.length + 1 || cuts.at(-1) !== lines.length) continue;
    return order.map((sub, i) => ({ sub, lines: lines.slice(cuts[i], cuts[i + 1]) }));
  }
  return null;
}

// Failing a split, the lines may add up to two or more pay sub-classes
// together, with no run matching either (B-47 again: 29 lines total
// $702,709.81, the two subtotals' sum, and no line is $143.46: a person's
// line carries pay of both kinds). Every sub-class of the smallest such set
// then loads, standing for the lines jointly. Returns the set, or null.
function jointPersons(lines, subs) {
  const total = lines.reduce((a, l) => a + l.cents, 0);
  let best = null;
  for (let mask = 1; mask < 1 << subs.length; mask++) {
    const set = subs.filter((_, i) => mask & (1 << i));
    if (set.length < 2 || set.reduce((a, s) => a + s.cents, 0) !== total) continue;
    if (!best || set.length < best.length) best = set;
  }
  return best;
}

/**
 * Read one block's lines into items (rows and subtotals) and reconcile them.
 * `subclassInDesc`: this volume puts sub-class subtotals in the
 * description column (decided per volume by parseVolume).
 */
export function readDetail(block, header, subclassInDesc, volumeClasses = new Set()) {
  const where = `block at page ${block.page} (${block.label}) "${header.office}" FY ${header.fundingYear}`;
  const problems = [];
  const discrepancies = [];
  const items = [];
  const frags = [];
  let moneyCount = 0;
  let moneySum = 0;
  for (const g of block.detail) {
    const c = cellsOf(g);
    for (const l of c.stray) problems.push(`${where}: page ${g.page}: text in no column: "${l.text}" at ${l.x0.toFixed(1)}`);
    if (c.amount.length > 1) { problems.push(`${where}: page ${g.page}: two amounts on one line: ${c.amount.map((l) => l.text).join(', ')}`); continue; }
    const base = { page: g.page, label: g.label, c: g.c };
    // The committees' margin numbers (cellsOf): counted as money read, so
    // the raw check agrees, and otherwise ignored.
    for (const l of c.margin) { moneyCount++; moneySum += moneyCents(l.text); }
    if (c.margin.length === g.lines.length) continue;
    if (!c.amount.length) {
      if (c.doc.length || c.posted.length || c.start.length || c.end.length || c.label.length) {
        problems.push(`${where}: page ${g.page}: a line with no amount: ${g.lines.map((l) => l.text).join(' | ')}`);
        continue;
      }
      for (const l of c.payee) frags.push({ ...base, c: center(l), zone: 'payee', line: l });
      for (const l of c.desc) frags.push({ ...base, c: center(l), zone: 'desc', line: l });
      continue;
    }
    moneyCount++;
    const cents = moneyCents(c.amount[0].text);
    moneySum += cents;
    if (c.doc.length || c.posted.length || c.start.length || c.end.length) {
      if (c.label.length) problems.push(`${where}: page ${g.page}: entry with text in the subtotal column: ${text(c.label)}`);
      items.push({ ...base, kind: 'entry', cents, doc: c.doc, posted: c.posted, start: c.start, end: c.end, payee: [...c.payee], desc: [...c.desc] });
    } else if (c.label.length) {
      if (c.payee.length || c.desc.length) problems.push(`${where}: page ${g.page}: subtotal with other text: ${g.lines.map((l) => l.text).join(' | ')}`);
      items.push({ ...base, kind: 'subtotal', cents, labelText: text(c.label) });
    } else if (c.payee.length) {
      items.push({ ...base, kind: 'person', cents, payee: [...c.payee], desc: [...c.desc] });
    } else if (c.desc.length) {
      items.push({ ...base, kind: 'candidate', cents, payee: [], desc: [...c.desc] });
    } else {
      // A pay line with its name and title blank (Apr to Sep 2021,
      // B-496: one amount, the office's whole RE-EMPLOYED ANNUITANTS
      // subtotal). It is a person line: one outside a pay run is left with
      // no subtotal to take it, which fails the block.
      items.push({ ...base, kind: 'person', cents, payee: [], desc: [], blank: true });
    }
  }

  // Fragments join a row on their own page: payee to the nearest, a
  // description to the nearest above unless one is centered on it.
  const rowsOn = (page) => items.filter((it) => it.page === page && it.kind !== 'subtotal');
  // A description that breaks across a page continues at the top of the
  // next one, above that page's first row (2026, page 188).
  const lastRowBefore = (page) => items.filter((it) => it.page < page && it.kind !== 'subtotal').at(-1);
  for (const f of frags) {
    const rows = rowsOn(f.page);
    if (!rows.length) {
      // A description that runs onto a page with no row of its own (Apr to
      // Sep 2021, B-1666) continues the last row before it.
      const prev = f.zone === 'desc' ? lastRowBefore(f.page) : null;
      if (prev) { prev.desc.push({ ...f.line, page: f.page }); continue; }
      problems.push(`${where}: page ${f.page}: wrapped text with no row: "${f.line.text}"`);
      continue;
    }
    const byDist = [...rows].sort((a, b) => Math.abs(a.c - f.c) - Math.abs(b.c - f.c));
    let target = byDist[0];
    if (f.zone === 'desc' && Math.abs(target.c - f.c) >= 4) {
      // With no row above at all, the description is centered on the row
      // below, as a long title is on a person line (Apr to Sep 2025, B-331:
      // four lines, two above the amount and two below).
      const above = rows.filter((r) => r.c < f.c).sort((a, b) => b.c - a.c)[0] ?? lastRowBefore(f.page)
        ?? rows.filter((r) => r.c > f.c).sort((a, b) => a.c - b.c)[0];
      if (!above) { problems.push(`${where}: page ${f.page}: wrapped description with no row above: "${f.line.text}"`); continue; }
      target = above;
    } else if (byDist[1] && Math.abs(byDist[1].c - f.c) - Math.abs(target.c - f.c) < 1) {
      problems.push(`${where}: page ${f.page}: wrapped ${f.zone} "${f.line.text}" is as near two rows`);
      continue;
    }
    target[f.zone].push({ ...f.line, page: f.page });
  }
  // Page first: a fragment carried over from the next page reads last.
  for (const it of items) {
    const pg = (l) => l.page ?? it.page;
    for (const k of ['payee', 'desc']) if (it[k]) it[k].sort((a, b) => pg(a) - pg(b) || a.y0 - b.y0 || a.x0 - b.x0);
  }

  // Subtotals, levels and categories. Person lines keep a run of their own,
  // because 2012 lists a block's pay lines first and their subtotals last,
  // after every other class (B-249), where 2026 subtotals them at once.
  let run = [];          // entries and continuations since the last subtotal
  let classSpan = [];    // the same, and sub-class subtotals, since the last class total
  const netZero = [];    // lines that net to nothing under no class total of their own
  let persons = [];      // person lines no subtotal has taken yet
  let lastEntry = null;  // the entry a continuation belongs to, and its line count
  const out = [];
  const sumOf = (xs) => xs.reduce((a, r) => a + r.cents, 0);
  const subtotalOf = (it, labelText) => {
    it.kind = 'subtotal';
    it.labelText = labelText;
    it.level = header.classes.has(fold(labelText)) || volumeClasses.has(fold(labelText)) ? 2 : 1;
  };
  const takePersons = (sub) => {
    const sum = sumOf(persons);
    if (sum !== sub.cents) discrepancies.push({ kind: 'pay', where, label: sub.labelText, page: sub.page, lines: sum, printed: sub.cents });
    sub.covers = persons;
    persons = [];
  };
  for (const it of items) {
    // A name too long for its cell wraps above and below the line, which
    // then carries only the title and the amount (2026, page 1678).
    if (it.kind === 'candidate' && it.payee.length) it.kind = 'person';
    // A payroll adjustment listed among the pay lines with no name (Apr to
    // Sep 2021, B-1691: SALARIES-PERMANENT FULL-TIME (INTERFACE)
    // -$100,000.00, inside a PERSONNEL COMP. FULL-TIME PERMANENT subtotal
    // that is the pay lines plus it). It goes with the person lines.
    if (it.kind === 'candidate' && PAY_ADJUSTMENT.test(text(it.desc))) it.kind = 'person';
    if (it.kind === 'candidate') {
      const labelText = text(it.desc);
      const fits = !run.length || sumOf(run) === it.cents || (persons.length && sumOf(persons) === it.cents);
      if (subclassInDesc && (!run.length || sumOf(run) === it.cents) && labelText === labelText.toUpperCase()) subtotalOf(it, labelText);
      else if (SUBCLASS_IN_DESC.has(labelText) && fits) {
        // A volume that puts sub-classes left of the description column
        // can still put a pay sub-class in it, even straight after an
        // entry (Oct 2013 to Mar 2014, Oct 2019 to Mar 2020).
        subtotalOf(it, labelText);
      } else if (lastEntry) {
        it.kind = 'continuation';
        it.of = lastEntry.it;
        it.docLine = ++lastEntry.lines;
      } else {
        // A document's later lines with its first line missing from the
        // PDF's text (Oct 2022 to Mar 2023, B-962: the travel lines after
        // Net Payroll Expenses, whose document line is not on the page).
        // They load as published, with no document, payee or dates.
        it.kind = 'continuation';
        it.of = null;
        it.docLine = null;
      }
    } else if (it.kind === 'subtotal') subtotalOf(it, it.labelText);
    if (it.kind === 'entry') lastEntry = { it, lines: 1 };
    else if (it.kind !== 'continuation') lastEntry = null;

    if (it.kind === 'person') { persons.push(it); out.push(it); continue; }
    if (it.kind !== 'subtotal') { run.push(it); classSpan.push(it); out.push(it); continue; }
    if (it.level === 1) {
      // Lines that net to nothing with no subtotal of their own, then a pay
      // sub-class for the person lines further up (Oct 2013 to Mar 2014,
      // B-830: equipment $99.99 and its reversal, then PERSONNEL COMP.
      // FULL-TIME PERMANENT). The sub-class takes the person lines; the
      // pair takes its class at the end of the block, as trailing ones do.
      if (run.length && sumOf(run) === 0 && it.cents !== 0 && PAY.has(fold(it.labelText)) && persons.length && sumOf(persons) === it.cents) {
        for (const r of run) { r.netZero = true; netZero.push(r); }
        run = [];
      }
      if (run.length) {
        it.covers = run;
        if (sumOf(run) !== it.cents) problems.push(`${where}: sub-class "${it.labelText}" is ${centsText(it.cents)}, its ${run.length} lines sum to ${centsText(sumOf(run))}`);
        for (const r of run) r.subclass = it.labelText;
      } else if (persons.length && sumOf(persons) === it.cents) takePersons(it);
      else it.covers = [];  // unitemized, unless its class total hands it the person lines
      classSpan.push(it);
    } else {
      // A class total covers the sub-class subtotals since the last class
      // total, and any lines no sub-class covered. Person lines still
      // waiting go to the one open sub-class they add up to, or failing that
      // the one open pay sub-class (reported as a pay discrepancy), or to
      // the class total itself when it has no sub-classes and they make up
      // its sum. Otherwise they wait for a later class total.
      const subs = classSpan.filter((x) => x.kind === 'subtotal');
      const direct = classSpan.filter((x) => x.kind !== 'subtotal' && !x.subclass);
      if (persons.length) {
        const open = subs.filter((s) => !s.covers.length);
        const exact = open.filter((s) => s.cents === sumOf(persons));
        const pay = open.filter((s) => PAY.has(fold(s.labelText)));
        const split = exact.length ? null : splitPersons(persons, pay);
        const joint = exact.length || split ? null : jointPersons(persons, pay);
        if (exact.length === 1) takePersons(exact[0]);
        else if (split) {
          for (const { sub, lines } of split) { sub.covers = lines; }
          persons = [];
        } else if (joint) {
          for (const [i, sub] of joint.entries()) { sub.covers = persons; sub.joint = i > 0; }
          persons = [];
        } else if (!exact.length && pay.length) {
          // No exact fit: the lines go to every open pay sub-class jointly,
          // and the difference is a pay discrepancy (MAJORITY POLICY
          // COMMITTEE, 2012: 23 lines $717,498.13 under $717,451.99).
          const printed = sumOf(pay);
          if (printed !== sumOf(persons)) discrepancies.push({ kind: 'pay', where, label: pay.map((s) => s.labelText).join(' + '), page: it.page, lines: sumOf(persons), printed });
          for (const [i, sub] of pay.entries()) { sub.covers = persons; sub.joint = i > 0; }
          persons = [];
        } else if (!subs.length && sumOf(direct) + sumOf(persons) === it.cents) { direct.push(...persons); persons = []; }
      }
      let total = sumOf(direct) + sumOf(subs);
      it.covers = direct;
      it.subs = subs;
      const category = fold(it.labelText);
      let s = header.classes.get(category);
      if (!s) {
        // A class the summary names otherwise: FOREIGN TRAVEL - MEMBERS &
        // EMPLOYEES, Apr to Sep 2022, B-212, totals its lines as TRAVEL AND
        // TRANSPORTATION OF PERSONS, $4,852.90, where its summary charges
        // the same $4,852.90 to Supplies and Materials. Paired with the one
        // summary class of that figure with no total in the lines; the rows
        // keep the class shown over them.
        const same = [...header.classes.values()].filter((x) => !x.matched && x.period && -x.period === it.cents);
        if (same.length === 1) {
          s = same[0];
          discrepancies.push({ kind: 'summary', where, label: it.labelText, summaryLabel: s.label, page: it.page, lines: it.cents, summary: -s.period });
        } else {
          // Failing that, a class the summary leaves out, its money counted
          // in another class's figure: Oct 2019 to Mar 2020, B-1946, totals
          // OTHER CONTRACTUAL SERVICES $1,040.00 in the lines, and the
          // summary's Travel is the lines' travel plus that $1,040.00. The
          // class is compared with a summary figure of zero, so both gaps
          // are listed and they cancel against ORGANIZATION TOTALS.
          s = { label: it.labelText, period: 0, omitted: true };
          header.classes.set(category, s);
        }
      }
      // A memo of the committee's staff pay: Oct 2016 to Mar 2017 lists
      // each committee's person lines under PERSONNEL COMPENSATION
      // ($3,943,307.26 at B-2-110), outside the statement's own figures,
      // which carry its pay as an unitemized PERSONNEL COMP. FULL-TIME
      // PERMANENT ($599,533.17). Left in, it lands in the next class total
      // and adds millions no ORGANIZATION TOTALS includes. A non-pay
      // sub-class over person lines only, whose removal makes what the
      // class total covers equal its stated figure, which the summary
      // gives too, is that memo: it does not load, and is listed (`memo`).
      if (classSpan.length && total !== it.cents && s && -(s.period ?? 0) === it.cents) {
        const memo = subs.filter((x) => !PAY.has(fold(x.labelText)) && x.covers.length && x.covers.every((c) => c.kind === 'person') && total - x.cents === it.cents);
        if (memo.length === 1) {
          memo[0].memo = true;
          subs.splice(subs.indexOf(memo[0]), 1);
          total -= memo[0].cents;
          discrepancies.push({ kind: 'memo', where, label: memo[0].labelText, page: memo[0].page, lines: memo[0].cents, printed: 0 });
        }
      }
      if (classSpan.length && total !== it.cents) {
        // Lines short of (or past) a class total that the summary gives
        // too: the report's own two figures agree, so the gap is in its
        // lines (see `lines` above).
        if (s && -(s.period ?? 0) === it.cents) discrepancies.push({ kind: 'lines', where, label: it.labelText, page: it.page, lines: total, printed: it.cents });
        else problems.push(`${where}: class "${it.labelText}" is ${centsText(it.cents)}, what it covers sums to ${centsText(total)}`);
      }
      for (const x of classSpan) x.category = category;
      it.category = category;
      // Compared with the summary once the block is read: a class can be
      // totaled twice (Apr to Sep 2019, B-1530: NET PAYROLL EXPENSES $231.00
      // under one commuting subsidy, then again under the pay sub-classes).
      if (s) {
        s.matched = (s.matched ?? 0) + 1;
        s.totaled = (s.totaled ?? 0) + it.cents;
        s.firstTotal ??= it;
      } else problems.push(`${where}: class total "${it.labelText}" is not in the block summary`);
      classSpan = [];
    }
    run = [];
    out.push(it);
  }
  if (classSpan.length) {
    // Lines that net to nothing, a charge and its reversal, can end a block
    // with no class total given for them (Apr to Sep 2018, B-451: -$60.55
    // and $60.55 in travel). They take the one class the summary lists at
    // zero with no total in the lines. Lines that do not net to zero fail.
    // With more than one such class (Apr to Sep 2016, B-1157: three
    // charges and their three reversals), the report names none, and
    // neither does the row: category null.
    // A class's lines can appear in two places, its total over the first
    // part: Apr to Sep 2017, B-2-93, FOREIGN RELATIONS lists OTHER
    // CONTRACTUAL SERVICES $24,620.40 (the summary's figure too) over
    // $4,544.50 of lines, then ends the statement, after the travel total,
    // with $20,075.90 more of the same services. Lines left at the end that
    // make up exactly one class's `lines` gap take that class, and the gap
    // is closed.
    const plain = classSpan.every((x) => x.kind !== 'subtotal');
    const gap = discrepancies.filter((d) => d.kind === 'lines' && d.printed - d.lines === sumOf(classSpan));
    if (sumOf(classSpan) === 0 && plain) {
      for (const x of classSpan) { x.netZero = true; netZero.push(x); }
    } else if (plain && gap.length === 1) {
      for (const x of classSpan) x.category = fold(gap[0].label);
      discrepancies.splice(discrepancies.indexOf(gap[0]), 1);
    } else problems.push(`${where}: ${classSpan.length} lines after the last class total (${centsText(sumOf(classSpan))}${plain ? '' : ', with sub-class subtotals'})`);
  }
  if (netZero.length) {
    const zero = [...header.classes.values()].filter((s) => !s.matched && !s.period);
    const category = zero.length === 1 ? fold(zero[0].label) : null;
    for (const x of netZero) x.category = category;
    if (zero.length === 1) Object.assign(zero[0], { matched: 1, totaled: 0 });
  }
  // A class the summary charges for the period with no class total in the
  // lines was not itemized (the leadership expense allowances, among
  // others): its summary figure, sign turned to match the lines, becomes a
  // summary item, or the office's spending would be short by it.
  for (const s of header.classes.values()) {
    if (s.matched && -(s.period ?? 0) !== s.totaled) {
      discrepancies.push({ kind: 'summary', where, label: s.firstTotal.labelText, page: s.firstTotal.page, lines: s.totaled, summary: -(s.period ?? 0) });
    }
  }
  for (const s of header.classes.values()) {
    if (s.period && !s.matched) {
      const it = { page: block.page, label: block.label, c: center(s.line), kind: 'summary', level: 2, cents: -s.period, labelText: s.label, category: fold(s.label), covers: [], subs: [] };
      // Person lines listed with no subtotal at all, whose sum is the
      // summary's figure for a class with no total in the lines (Apr to Sep
      // 2016, B-304: one consultant's $790.00, and Net Payroll Expenses
      // $790.00 in the summary only). The summary item takes them, as a
      // stated subtotal would.
      if (persons.length && sumOf(persons) === it.cents) { it.covers = persons; persons = []; }
      out.push(it);
    }
  }
  // Person lines no subtotal or summary figure takes (CONSULTANTS, FY 1921,
  // Oct 2019 to Mar 2020, B-192: one consultant's $1,903.48 listed under a
  // summary and ORGANIZATION TOTALS of $0.00 for the period). They never
  // load either way; listed as a pay discrepancy against nothing. A line
  // read as a person that was not one would leave the block's rows short of
  // ORGANIZATION TOTALS, which still fails.
  if (persons.length) {
    discrepancies.push({ kind: 'pay', where, label: null, page: persons[0].page, lines: sumOf(persons), printed: 0 });
    persons = [];
  }
  const classSum = out.filter((x) => (x.kind === 'subtotal' && x.level === 2) || x.kind === 'summary').reduce((a, x) => a + x.cents, 0);
  const classAllowed = discrepancies.filter((d) => d.kind === 'summary').reduce((a, d) => a + d.lines - d.summary, 0);
  if (header.orgPeriod != null && classSum !== -header.orgPeriod + classAllowed) problems.push(`${where}: class totals sum to ${centsText(classSum)}, ORGANIZATION TOTALS says ${centsText(-header.orgPeriod)}${classAllowed ? ` (${centsText(classAllowed)} of payroll difference allowed)` : ''}`);
  // Two classes off in one block could be one line read into the wrong
  // class, which would look like two gaps that cancel: never allowed.
  const short = discrepancies.filter((d) => d.kind === 'lines');
  if (short.length > 1) problems.push(`${where}: ${short.length} classes whose lines do not make their totals (${short.map((d) => d.label).join(', ')})`);
  // What the kept rows may differ from ORGANIZATION TOTALS by.
  const allowed = classAllowed + short.reduce((a, d) => a + d.lines - d.printed, 0);
  return { items: out, problems, discrepancies, allowed, moneyCount, moneySum, lineCount: block.detail.reduce((a, g) => a + g.lines.length, 0) };
}

// Which items reach the table (see the header comment), with the reason.
export function keepItems(items, where) {
  const problems = [];
  const kept = [];
  for (const it of items) {
    if (it.kind === 'entry' || it.kind === 'continuation') kept.push(it);
    else if (it.kind === 'summary') {
      if (it.covers.length) it.collapses = it.covers.length; else it.unitemized = true;
      kept.push(it);
    }
    else if (it.kind === 'subtotal' && !it.memo) {
      const covered = it.level === 1 ? it.covers : [...it.covers, ...(it.subs ?? [])];
      const persons = it.covers.filter((r) => r.kind === 'person');
      if (!covered.length) { it.unitemized = true; kept.push(it); }
      else if (persons.length) {
        if (persons.length !== it.covers.length || (it.subs ?? []).length) problems.push(`${where}: "${it.labelText}" at page ${it.page} covers person lines and other lines`);
        else { it.collapses = persons.length; kept.push(it); }
      }
    }
  }
  return { kept, problems };
}

function datesOf(it, extras) {
  const out = {};
  for (const [k, cells] of [['transaction_date', it.posted], ['start_date', it.start], ['end_date', it.end]]) {
    const t = text(cells ?? []);
    if (t == null) { out[k] = null; continue; }
    const iso = isoDate(t);
    if (iso === undefined) { (extras.dates_as_filed ??= {})[k] = t; out[k] = null; } else out[k] = iso;
  }
  return out;
}

// One kept item -> one table row.
export function toRow(it, n, header, source) {
  const extras = { page: it.page, page_label: it.label };
  let r;
  if (it.kind === 'subtotal' || it.kind === 'summary') {
    if (it.level === 1) extras.subclass = it.labelText;
    if (it.unitemized) extras.unitemized = true;
    if (it.kind === 'summary') extras.from_summary = true;
    r = { row_kind: 'subtotal', transaction_date: null, start_date: null, end_date: null, document: null, payee: null, description: it.labelText };
  } else {
    // A continuation whose document line is missing from the text has
    // nothing to inherit (see readDetail).
    const e = it.kind === 'continuation' ? (it.of ?? { doc: [], payee: [], posted: [], start: [], end: [] }) : it;
    if (it.subclass) extras.subclass = it.subclass;
    if (it.kind === 'continuation' && it.of) extras.doc_line = it.docLine;
    if (it.kind === 'continuation' && !it.of) extras.no_document_line = true;
    r = {
      row_kind: 'detail',
      ...datesOf(e, extras),
      document: text(e.doc),
      payee: text(e.payee),
      description: text(it.desc),
    };
  }
  return {
    chamber: 'senate',
    unit: source.unit,
    row_number: n,
    period_start: source.start,
    period_end: source.end,
    organization: header.office,
    office: header.office,
    org_year: null,
    funding_year: header.fundingYear,
    program: header.program,
    category: it.category ?? null,
    ...r,
    amount: centsText(it.cents),
    extras: JSON.stringify(extras),
    source_ref: `${source.url}#page=${it.page}`,
  };
}

/**
 * @param {string} xhtml pdftotext -bbox-layout output for one volume
 * @param {{ unit: string, url: string, start: string, end: string, file: string }} source
 */
// ocr: transcriptions of pages published as images, by page number
// (senate-ocr.mjs, loadOcr).
export function parseVolume(xhtml, source, ocr = {}) {
  return parsePages(readPages(xhtml), source, ocr);
}

export function parsePages(pages, source, ocr = {}) {
  // A page published as an image has no text but its label (Apr to Sep 2023,
  // B-336). Its transcription's lines join the label, and the page is
  // parsed like any other; a B page with no text and no transcription fails.
  const ocrPages = new Set();
  const ocrProblems = [];
  for (const page of pages) {
    const t = ocr[page.number];
    if (t) {
      page.lines = [...page.lines, ...t.lines].sort((l, m) => l.y0 - m.y0 || l.x0 - m.x0);
      ocrPages.add(page.number);
    } else if (page.lines.length && page.lines.every((l) => l.x1 < 45 || PAGE_LABEL.test(l.text)) && page.lines.some((l) => PAGE_LABEL.exec(l.text)?.[1] === 'B')) {
      ocrProblems.push(`page ${page.number}: no text but its page label, and no transcription in senate-ocr/`);
    }
  }
  const { blocks, problems, bPages, margin } = splitBlocks(pages);
  problems.push(...ocrProblems);
  const headers = blocks.map(readHeader);
  // Every class any block's summary names, for a class total whose own
  // summary names it otherwise (readDetail). Never a sub-class label.
  const volumeClasses = new Set(headers.flatMap((h) => (h.classes ? [...h.classes.keys()] : [])).filter((k) => !SUBCLASS_IN_DESC.has(k)));
  // A volume puts sub-classes either left of the description column or in
  // it. Any sub-class label left of it settles the question for the volume.
  let subclassLeft = false;
  for (const [i, b] of blocks.entries()) {
    const h = headers[i];
    if (!h.classes) continue;
    for (const g of b.detail) {
      const c = cellsOf(g);
      if (c.amount.length === 1 && c.label.length && !c.doc.length && !c.posted.length && !h.classes.has(fold(text(c.label)))) subclassLeft = true;
    }
  }
  const rows = [];
  const discrepancies = [];
  // B pages that carry any money inside a block, for the raw scan to match
  // (it cannot tell a B page from a contents page that lists B labels, but
  // a contents page carries no money). The raw scan counts every word shaped
  // like money, so a description that holds one ("8.25 MILES") is counted
  // here too, as `embedded`; amounts the parse reads are counted where it
  // reads them.
  const moneyPages = new Set();
  let embedded = margin.money;
  let embeddedCents = margin.cents;
  for (const p of margin.pages) moneyPages.add(p);
  for (const b of blocks) {
    for (const g of [...b.header, ...b.detail]) {
      for (const l of g.lines) {
        if (moneyCents(l.text) != null) { moneyPages.add(g.page); continue; }
        for (const w of l.text.split(/\s+/)) {
          const c = moneyCents(w);
          if (c == null) continue;
          moneyPages.add(g.page);
          embedded++;
          embeddedCents += c;
        }
      }
    }
  }
  const tally = { blocks: blocks.length, bPages: bPages.length, moneyPages: moneyPages.size, entries: 0, continuations: 0, persons: 0, subtotals: 0, summaries: 0, kept: 0, collapsedPersons: 0, unitemized: 0, keptCents: 0, orgCents: 0, discrepancyCents: 0, money: embedded, moneyCents: embeddedCents, embeddedMoney: embedded, subclassLabels: {} };
  let n = 0;
  for (const [i, b] of blocks.entries()) {
    const h = headers[i];
    problems.push(...h.problems);
    if (!h.classes) continue;
    // Every block states the volume's period; a volume listed under the
    // wrong period, or a block from another, stops here.
    const mdy = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
    if (!h.periodText.includes(mdy(source.start)) || !h.periodText.includes(mdy(source.end))) {
      problems.push(`block at page ${b.page} "${h.office}": states the period "${h.periodText}", not ${mdy(source.start)} to ${mdy(source.end)}`);
    }
    tally.money += h.moneyCount;
    tally.moneyCents += h.moneySum;
    const d = readDetail(b, h, !subclassLeft, volumeClasses);
    problems.push(...d.problems);
    discrepancies.push(...d.discrepancies);
    tally.discrepancyCents += d.allowed;
    tally.money += d.moneyCount;
    tally.moneyCents += d.moneySum;
    const where = `block at page ${b.page} "${h.office}" FY ${h.fundingYear}`;
    const { kept, problems: kp } = keepItems(d.items, where);
    problems.push(...kp);
    const keptSet = new Set(kept);
    let blockCents = 0;
    for (const it of d.items) {
      n++;
      tally[{ entry: 'entries', continuation: 'continuations', person: 'persons', subtotal: 'subtotals', summary: 'summaries' }[it.kind]]++;
      if (it.kind === 'subtotal' && it.level === 1) tally.subclassLabels[it.labelText] = (tally.subclassLabels[it.labelText] ?? 0) + 1;
      if (!keptSet.has(it)) continue;
      if (it.unitemized) tally.unitemized++;
      if (it.collapses && !it.joint) tally.collapsedPersons += it.collapses;
      blockCents += it.cents;
      rows.push(toRow(it, n, h, source));
    }
    tally.kept += kept.length;
    tally.keptCents += blockCents;
    if (h.orgPeriod != null) {
      tally.orgCents += -h.orgPeriod;
      if (blockCents !== -h.orgPeriod + d.allowed) problems.push(`${where}: kept rows sum to ${centsText(blockCents)}, ORGANIZATION TOTALS says ${centsText(-h.orgPeriod)}`);
    }
  }
  tally.subclassInDesc = !subclassLeft;
  // The raw scan sees no text on a transcribed page, so its money is taken
  // back out of the comparison: every money-shaped word on it, which the
  // parse must have read in full for the raw and parsed counts to agree.
  for (const p of ocrPages) {
    if (!moneyPages.has(p)) continue;
    tally.moneyPages--;
    for (const l of ocr[p].lines) for (const w of l.text.split(/\s+/)) {
      const c = moneyCents(w);
      if (c != null) { tally.money--; tally.moneyCents -= c; }
    }
  }
  tally.ocrPages = [...ocrPages];
  for (const r of rows) if (ocrPages.has(JSON.parse(r.extras).page)) r.extras = JSON.stringify({ ...JSON.parse(r.extras), ocr: true });
  return { rows, problems, discrepancies, tally, blocks, headers };
}
