// The comparisons behind `cli.mjs senate check`, kept pure for the tests.
//
// Three views of each volume have to agree:
//
// 1. Raw: `pdftotext -layout`, a second extraction that shares no code with
//    the parser. On every B page (the page label, B-n, ends one of its
//    lines), each whitespace-separated token shaped like money is counted
//    and summed.
// 2. Parsed: senate-parse.mjs over `pdftotext -bbox-layout`. Every money
//    line it read on a B page, header and lines alike, is counted and
//    summed (tally.money, tally.moneyCents), and the parse itself fails on
//    any line it cannot place, any subtotal its lines do not make, and any
//    block whose rows do not reconcile with ORGANIZATION TOTALS (allowing
//    only the listed discrepancies).
// 3. Loaded: every row of the table for that unit, every column.
//
// Raw and parsed must agree on the count and the sum of the money on B
// pages; the loaded rows must be exactly the parsed rows.
import { COLUMNS, norm } from './check.mjs';
import { moneyCents } from './senate-parse.mjs';

// A page label ends a line: "B-334", "B-2-3" (the committees), or "B - 10"
// where a volume shows it small inside the page as well. The contents pages end lines with B labels
// too, but carry no money, so pages are compared by whether they carry any.
const LABEL = /(?:^|\s{2,})([A-D])(?:-\d+)? ?- ?\d{1,3}(?:,?\d{3})*\s*$/m;

export function rawScan(layoutText) {
  const out = { pages: 0, money: 0, cents: 0 };
  for (const page of layoutText.split('\f')) {
    const m = [...page.matchAll(new RegExp(LABEL.source, 'gm'))];
    if (!m.length || m.at(-1)[1] !== 'B') continue;
    let any = false;
    for (const tok of page.split(/\s+/)) {
      const c = moneyCents(tok);
      if (c == null) continue;
      any = true;
      out.money++;
      out.cents += c;
    }
    if (any) out.pages++;
  }
  return out;
}

/**
 * @param {object} v one volume
 * @param {string} v.unit
 * @param {ReturnType<rawScan>} v.raw
 * @param {object} v.parsed parseVolume output
 * @param {object[]|null} v.loaded rows of the table for this unit, or null to skip
 * @returns {string[]} failures; empty means the volume passed
 */
export function compare({ unit, raw, parsed, loaded }) {
  const failures = [];
  const fail = (m) => failures.push(`${unit}: ${m}`);
  for (const p of parsed.problems.slice(0, 20)) fail(p);
  if (parsed.problems.length > 20) fail(`${parsed.problems.length - 20} more parse problems`);
  const t = parsed.tally;
  if (raw.pages !== t.moneyPages) fail(`B pages with money: raw ${raw.pages}, parsed ${t.moneyPages}`);
  if (raw.money !== t.money) fail(`money on B pages: raw ${raw.money}, parsed ${t.money}`);
  if (raw.cents !== t.moneyCents) fail(`money on B pages sums: raw ${raw.cents} cents, parsed ${t.moneyCents}`);
  if (loaded == null) return failures;

  const expected = parsed.rows;
  const want = new Map(expected.map((r) => [r.row_number, r]));
  if (loaded.length !== expected.length) fail(`loaded ${loaded.length} rows, expected ${expected.length}`);
  const seen = new Set();
  let mismatched = 0;
  for (const row of loaded) {
    const k = row.row_number;
    if (seen.has(k)) { fail(`row ${k} loaded twice`); continue; }
    seen.add(k);
    const exp = want.get(k);
    if (!exp) { fail(`row ${k} loaded but not expected`); continue; }
    for (const col of COLUMNS) {
      if (norm(col, row[col]) !== norm(col, exp[col])) {
        if (++mismatched <= 20) fail(`row ${k} ${col}: loaded ${JSON.stringify(row[col])}, expected ${JSON.stringify(exp[col])}`);
      }
    }
  }
  if (mismatched > 20) fail(`${mismatched - 20} more field mismatches not shown`);
  for (const k of want.keys()) if (!seen.has(k)) fail(`row ${k} expected but not loaded`);
  const sum = loaded.reduce((a, r) => a + norm('amount', r.amount), 0);
  if (sum !== t.keptCents) fail(`loaded rows sum to ${sum} cents, the parse kept ${t.keptCents}`);
  return failures;
}
