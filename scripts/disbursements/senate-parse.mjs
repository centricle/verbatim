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
// - subtotal: a label and an amount, printed after the lines it covers.
//   There are two levels. A class total's label is one of the block
//   summary's object classes (NET PAYROLL EXPENSES, TRAVEL AND
//   TRANSPORTATION OF PERSONS, ...). Anything else is a sub-class
//   (PERSONNEL COMP. FULL-TIME PERMANENT, PERSONNEL BENEFITS, ...), and a
//   class total covers the sub-classes before it. Volumes from 2026 print
//   both levels left of the description column; the 2012 volume prints
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
// - Every entry and continuation line, as printed. A cell's printed line
//   breaks become single spaces.
// - Never a person line (ksmith, 2026-11-18: the site is never a
//   name-to-salary lookup). In its place, the subtotal that covers it,
//   which must cover nothing but person lines. The block still reconciles,
//   because the subtotal is the sum of the lines it replaces.
// - Every subtotal that covers no line at all (the Senate prints some
//   amounts only as a subtotal, BENEFITS FOR FORMER PERSONNEL among them),
//   with extras.unitemized. Without them the block would not reconcile.
// - row_kind 'subtotal' for both of those; description is the label.
// - category is the class total's label, upper case (2026 prints "Net
//   Payroll Expenses" in title case); a sub-class label rides in
//   extras.subclass.
// - organization and office are the block's office name as printed;
//   program is its appropriation title; funding_year as printed ("2024",
//   "2021-2026"). transaction_date is DATE POSTED, start_date and end_date
//   the OBLIGATION/SERVICE DATES, as ISO dates; a date in any other form
//   loads as null with the text under extras.dates_as_filed.
// - extras.page (1-based page of the PDF, which source_ref links with
//   #page=) and extras.page_label (the printed B-n).
//
// Summary figures print with the opposite sign to the lines (a period's
// spending shows as -88,227.94 above lines that sum to 88,227.94), so the
// checks compare lines with the negated summary.

import { readPages } from './senate-pdf.mjs';
import { centsText } from './parse.mjs';

const BANNER = 'DETAILED AND SUMMARY STATEMENT OF EXPENDITURES';
const MONEY = /^(-)?\$?(-)?(\d{1,3}(?:,\d{3})*|\d+)?\.(\d\d)$/;
const DATE = /^(\d\d)\/(\d\d)\/(\d{4})$/;
const PAGE_LABEL = /^([A-Z])-(\d+)$/;
const NOT_CLASSES = new Set(['AUTHORIZATION', 'SUPPLEMENTALS', 'TRANSFERS', 'RESC / WITHDRAWALS', 'ORGANIZATION TOTALS']);
// "2024", "2021-2026", or a no-year account: "X" (2012), "X (NO-YEAR)",
// "X (REVOLVING)" (2026).
const FUNDING_YEAR = /^(\d{4}(-\d{4})?|X|X \([A-Z -]+\))$/;
// Sub-classes whose lines are one person's pay each, for placing person
// lines that do not add up to their printed subtotal (see `pay` above).
const PAY = new Set(['PERSONNEL COMP. FULL-TIME PERMANENT', 'OTHER PERSONNEL COMPENSATION', 'RE-EMPLOYED ANNUITANTS', 'WHEN ACTUALLY EMPLOYED (WAE)']);
// Where the report disagrees with itself, the lines load as printed and
// parseVolume lists the disagreement under `discrepancies` instead of
// failing. Two kinds are allowed, both seen in the Oct 2025 to Mar 2026
// volume, and nothing else:
//
// - summary: a class total in the lines differs from the block summary's
//   figure for that class. About a hundred payroll blocks (CHAPLAIN, FY
//   2026: four pay lines and their printed subtotal say $344,049.88, the
//   summary $342,049.88), and travel in three Senators' blocks, where one
//   $7,399.04 item is itemized under one Senator and summarized under
//   another. The lines must still add up to their own printed subtotals.
// - pay: person lines that do not add up to their printed subtotal
//   (CONSULTANTS, FY 2026-2028: 32 lines sum to $3,082,133.99 under a
//   subtotal of $3,075,864.55, confirmed on the -layout text). Person lines
//   never load, and the printed subtotal that does agrees with the summary.

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

function pageLabel(page) {
  const l = page.lines.find((x) => x.x0 > 590 && PAGE_LABEL.test(x.text));
  return l ? { line: l, label: l.text, section: l.text[0] } : { line: null, label: null, section: null };
}

const has = (g, text) => g.lines.find((l) => l.text === text);
const isColumnHeading = (g) => g.lines.some((l) => l.text === 'DOCUMENT NO.');
const HEADING_BITS = new Set(['DATES', 'POSTED', 'START', 'END', 'START END', 'OBLIGATION/SERVICE', 'DATE', 'PAYEE NAME', 'DESCRIPTION', 'AMOUNT ($)', 'DOCUMENT NO.']);
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
  let block = null;
  let mode = 'none';
  let cols = null;
  for (const page of pages) {
    const { line: labelLine, label, section } = pageLabel(page);
    if (section !== 'B') { if (block) { blocks.push(block); block = null; mode = 'none'; } continue; }
    bPages.push(page.number);
    const lines = page.lines.filter((l) => l !== labelLine);
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
  return { blocks, problems, bPages };
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
  if (!auth || !fy || !colAvail || !colPeriod || !colYtd) {
    problems.push(`${where}: header lacks ${[!auth && 'Authorization', !fy && 'Funding Year', !colAvail && 'NET FUNDS', !colPeriod && 'NET EXPENDITURES FOR', !colYtd && 'TOTAL FUNDING'].filter(Boolean).join(', ')}`);
    return { problems };
  }
  const used = new Set([auth, fy, colAvail, colPeriod, colYtd]);
  const leftEdge = auth.x0 - 100;
  // Funding year: the rest of the "Funding Year" line, or the line beside it.
  let fundingYear = fy.text.replace(/^Funding Year\s*/, '').trim();
  if (!fundingYear) {
    const v = all.find((l) => l !== fy && Math.abs(center(l) - center(fy)) < 1.5 && l.x0 > fy.x1 && l.x0 < auth.x0 && FUNDING_YEAR.test(l.text));
    if (v) { fundingYear = v.text; used.add(v); }
  }
  if (!FUNDING_YEAR.test(fundingYear)) problems.push(`${where}: funding year "${fundingYear}"`);
  const left = all.filter((l) => !used.has(l) && l.x0 < leftEdge);
  const office = left.filter((l) => center(l) < center(fy)).sort((a, b) => a.y0 - b.y0);
  const program = left.filter((l) => center(l) > center(fy)).sort((a, b) => a.y0 - b.y0);
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
    if (dists.length > 1 && dists[1] - dists[0] < 1) problems.push(`${where}: amount ${a.text} is as near "${s.label}" as another label`);
    const cents = moneyCents(a.text);
    if (/^UNEXPENDED BALANCE/.test(s.label)) { s.unexpended = cents; continue; }
    const col = [['avail', colAvail], ['period', colPeriod], ['ytd', colYtd]]
      .reduce((best, c) => (Math.abs(a.x1 - c[1].x1) < Math.abs(a.x1 - best[1].x1) ? c : best))[0];
    if (s[col] != null) problems.push(`${where}: "${s.label}" has two ${col} figures`);
    s[col] = cents;
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
  const out = { doc: [], posted: [], start: [], end: [], payee: [], label: [], desc: [], amount: [], stray: [] };
  if (!c || !c.posted || !c.start || !c.end || !c.amount) { out.stray.push(...g.lines); return out; }
  const postedRight = Math.max(c.posted.x1, c.posted.x0 + 20);
  const descLeft = c.end.x1 + 4;
  for (const l of g.lines) {
    if (moneyCents(l.text) != null && l.x1 > c.amount.x0) { out.amount.push(l); continue; }
    if (DATE.test(l.text)) {
      const d = [['posted', c.posted], ['start', c.start], ['end', c.end]]
        .reduce((best, k) => (Math.abs(mid(l) - mid(k[1])) < Math.abs(mid(l) - mid(best[1])) ? k : best))[0];
      out[d].push(l);
      continue;
    }
    if (l.x1 < c.posted.x0 - 2) out.doc.push(l);
    else if (l.x0 >= postedRight + 3 && l.x0 < c.start.x0 - 3) out.payee.push(l);
    else if (l.x0 >= c.start.x0 - 3 && l.x0 < descLeft) out.label.push(l);
    else if (l.x0 >= descLeft) out.desc.push(l);
    else out.stray.push(l);
  }
  return out;
}

const text = (ls) => ls.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim() || null;

// 2012 subtotals a block's pay lines under two or three pay sub-classes at
// once, at the end of the block (MAJORITY CONFERENCE COMMITTEE, B-47: 29
// lines, then OTHER PERSONNEL COMPENSATION $143.46 and PERSONNEL COMP.
// FULL-TIME PERMANENT $702,566.35). Each sub-class's lines print together,
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
 * `subclassInDesc`: this volume prints sub-class subtotals in the
 * description column (decided per volume by parseVolume).
 */
export function readDetail(block, header, subclassInDesc) {
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
      problems.push(`${where}: page ${g.page}: an amount with no text: ${c.amount[0].text}`);
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
    if (!rows.length) { problems.push(`${where}: page ${f.page}: wrapped text with no row: "${f.line.text}"`); continue; }
    const byDist = [...rows].sort((a, b) => Math.abs(a.c - f.c) - Math.abs(b.c - f.c));
    let target = byDist[0];
    if (f.zone === 'desc' && Math.abs(target.c - f.c) >= 4) {
      const above = rows.filter((r) => r.c < f.c).sort((a, b) => b.c - a.c)[0] ?? lastRowBefore(f.page);
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
  // because 2012 prints a block's pay lines first and their subtotals last,
  // after every other class (B-249), where 2026 subtotals them at once.
  let run = [];          // entries and continuations since the last subtotal
  let classSpan = [];    // the same, and sub-class subtotals, since the last class total
  let persons = [];      // person lines no subtotal has taken yet
  let lastEntry = null;  // the entry a continuation belongs to, and its line count
  const out = [];
  const sumOf = (xs) => xs.reduce((a, r) => a + r.cents, 0);
  const subtotalOf = (it, labelText) => {
    it.kind = 'subtotal';
    it.labelText = labelText;
    it.level = header.classes.has(fold(labelText)) ? 2 : 1;
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
    if (it.kind === 'candidate') {
      const labelText = text(it.desc);
      if (subclassInDesc && (!run.length || sumOf(run) === it.cents) && labelText === labelText.toUpperCase()) subtotalOf(it, labelText);
      else if (lastEntry) {
        it.kind = 'continuation';
        it.of = lastEntry.it;
        it.docLine = ++lastEntry.lines;
      } else {
        problems.push(`${where}: page ${it.page}: description-only line with no entry above: "${labelText}" ${centsText(it.cents)}`);
        continue;
      }
    } else if (it.kind === 'subtotal') subtotalOf(it, it.labelText);
    if (it.kind === 'entry') lastEntry = { it, lines: 1 };
    else if (it.kind !== 'continuation') lastEntry = null;

    if (it.kind === 'person') { persons.push(it); out.push(it); continue; }
    if (it.kind !== 'subtotal') { run.push(it); classSpan.push(it); out.push(it); continue; }
    if (it.level === 1) {
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
      const total = sumOf(direct) + sumOf(subs);
      it.covers = direct;
      it.subs = subs;
      if (classSpan.length && total !== it.cents) problems.push(`${where}: class "${it.labelText}" is ${centsText(it.cents)}, what it covers sums to ${centsText(total)}`);
      const category = fold(it.labelText);
      for (const x of classSpan) x.category = category;
      it.category = category;
      const s = header.classes.get(category);
      if (s && -(s.period ?? 0) !== it.cents) {
        discrepancies.push({ kind: 'summary', where, label: it.labelText, page: it.page, lines: it.cents, summary: -(s.period ?? 0) });
      }
      if (s) s.matched = (s.matched ?? 0) + 1;
      else problems.push(`${where}: class total "${it.labelText}" is not in the block summary`);
      classSpan = [];
    }
    run = [];
    out.push(it);
  }
  if (classSpan.length) problems.push(`${where}: ${classSpan.length} lines after the last class total`);
  if (persons.length) problems.push(`${where}: ${persons.length} person lines (${centsText(sumOf(persons))}) that no subtotal takes`);
  // A class the summary charges for the period with no class total in the
  // lines was not itemized (the leadership expense allowances, among
  // others): its summary figure, sign turned to match the lines, becomes a
  // summary item, or the office's spending would be short by it.
  for (const s of header.classes.values()) {
    if (s.period && !s.matched) {
      out.push({ page: block.page, label: block.label, c: center(s.line), kind: 'summary', level: 2, cents: -s.period, labelText: s.label, category: fold(s.label), covers: [], subs: [] });
    }
    if (s.matched > 1) problems.push(`${where}: class "${s.label}" totaled ${s.matched} times`);
  }
  const classSum = out.filter((x) => (x.kind === 'subtotal' && x.level === 2) || x.kind === 'summary').reduce((a, x) => a + x.cents, 0);
  const allowed = discrepancies.filter((d) => d.kind === 'summary').reduce((a, d) => a + d.lines - d.summary, 0);
  if (header.orgPeriod != null && classSum !== -header.orgPeriod + allowed) problems.push(`${where}: class totals sum to ${centsText(classSum)}, ORGANIZATION TOTALS says ${centsText(-header.orgPeriod)}${allowed ? ` (${centsText(allowed)} of payroll difference allowed)` : ''}`);
  return { items: out, problems, discrepancies, allowed, moneyCount, moneySum, lineCount: block.detail.reduce((a, g) => a + g.lines.length, 0) };
}

// Which items reach the table (see the header comment), with the reason.
export function keepItems(items, where) {
  const problems = [];
  const kept = [];
  for (const it of items) {
    if (it.kind === 'entry' || it.kind === 'continuation') kept.push(it);
    else if (it.kind === 'summary') { it.unitemized = true; kept.push(it); }
    else if (it.kind === 'subtotal') {
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
    const e = it.kind === 'continuation' ? it.of : it;
    if (it.subclass) extras.subclass = it.subclass;
    if (it.kind === 'continuation') extras.doc_line = it.docLine;
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
export function parseVolume(xhtml, source) {
  return parsePages(readPages(xhtml), source);
}

export function parsePages(pages, source) {
  const { blocks, problems, bPages } = splitBlocks(pages);
  const headers = blocks.map(readHeader);
  // A volume prints sub-classes either left of the description column or in
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
  const tally = { blocks: blocks.length, bPages: bPages.length, entries: 0, continuations: 0, persons: 0, subtotals: 0, summaries: 0, kept: 0, collapsedPersons: 0, unitemized: 0, keptCents: 0, orgCents: 0, discrepancyCents: 0, money: 0, moneyCents: 0, subclassLabels: {} };
  let n = 0;
  for (const [i, b] of blocks.entries()) {
    const h = headers[i];
    problems.push(...h.problems);
    if (!h.classes) continue;
    // Every block prints the volume's period; a volume filed under the
    // wrong period, or a block from another, stops here.
    const mdy = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
    if (!h.periodText.includes(mdy(source.start)) || !h.periodText.includes(mdy(source.end))) {
      problems.push(`block at page ${b.page} "${h.office}": prints the period "${h.periodText}", not ${mdy(source.start)} to ${mdy(source.end)}`);
    }
    tally.money += h.moneyCount;
    tally.moneyCents += h.moneySum;
    const d = readDetail(b, h, !subclassLeft);
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
  return { rows, problems, discrepancies, tally, blocks, headers };
}
