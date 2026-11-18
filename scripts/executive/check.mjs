// The comparison behind `cli.mjs check`, kept pure so planted defects can be
// tested without a database (check.test.mjs).
//
// Three views of the same data have to agree:
//
// 1. Raw: the release's executive records, found by scanning release.jsonl
//    without the JSON parser (scripts/corpus/check.mjs explains why the scan
//    is safe), and FR's listing pages as fetched.
// 2. Parsed: parse.mjs over both.
// 3. Loaded: every row of the table, every column the loader writes.
//
// The invariants: every raw executive record is parsed, and either loaded
// once with every column equal or named in the unjoined list; and every
// loaded note's parse, put back together, reads as FR's note. A note the
// parser could not fully place is reported (irregularities), never a pass by
// omission and never a failure by itself.
import { COLUMNS, normalizeNotes, renderNotes } from './parse.mjs';

const LINE = /^\{"id": "([0-9a-f]{64})".*?"collection": "([a-z]+)"/;

/** Ids of the release's executive records, read off each line without parsing JSON. */
export function rawScan(text) {
  const ids = [];
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (m && m[2] === 'executive') ids.push(m[1]);
  }
  return ids;
}

// Postgres hands back a date as a Date at UTC midnight and jsonb as an object
// with its keys reordered. Compare on one footing.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
function norm(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object') return JSON.stringify(canonical(value));
  return value ?? null;
}

/** Rows whose parsed notes do not put back together as their note. */
export function notesFailures(rows) {
  const failures = [];
  for (const row of rows) {
    if ((row.notes === null) !== (row.notes_parsed === null)) {
      failures.push(`${row.document_number}: notes and parsed notes disagree on whether there is a note`);
    } else if (row.notes !== null && normalizeNotes(renderNotes(row.notes_parsed)) !== normalizeNotes(row.notes)) {
      failures.push(`${row.document_number}: parsed note does not read as FR's note`);
    }
  }
  return failures;
}

/**
 * @param {object} input
 * @param {string[]} input.raw        rawScan of the release
 * @param {number}   input.parsedCount executive records the parser read
 * @param {object[]} input.expected   buildRows(...).rows
 * @param {object[]} input.unjoined   buildRows(...).unjoined
 * @param {string[]} input.conflicts  buildRows(...).conflicts
 * @param {object[]} input.loaded     every row of the table
 * @returns {string[]} failures; empty means the check passed
 */
export function compare({ raw, parsedCount, expected, unjoined, conflicts, loaded }) {
  const failures = [...conflicts];
  const fail = (msg) => failures.push(msg);

  // 1 vs 2: the parser reads exactly the records the raw scan sees, and every
  // one is either a row or named as unjoined.
  const rawSet = new Set(raw);
  if (rawSet.size !== raw.length) fail(`raw scan found ${raw.length - rawSet.size} repeated ids`);
  if (raw.length !== parsedCount) fail(`raw scan found ${raw.length} executive records, parser ${parsedCount}`);
  const placed = new Set([...expected.map((r) => r.id), ...unjoined.map((r) => r.id)]);
  if (placed.size !== expected.length + unjoined.length) fail('a record is both a row and unjoined');
  const lost = raw.filter((id) => !placed.has(id));
  const invented = [...placed].filter((id) => !rawSet.has(id));
  if (lost.length) fail(`in the release, neither a row nor unjoined (${lost.length}): ${lost.slice(0, 5).join(', ')}`);
  if (invented.length) fail(`parsed but not in the release (${invented.length}): ${invented.slice(0, 5).join(', ')}`);

  // 2 vs 3: same ids, once each, every column equal.
  if (loaded.length !== expected.length) {
    fail(`loaded ${loaded.length} rows; the join made ${expected.length}`);
  }
  const loadedById = new Map();
  for (const row of loaded) {
    if (loadedById.has(row.id)) fail(`loaded twice: ${row.id}`);
    loadedById.set(row.id, row);
  }
  const expectedIds = new Set(expected.map((r) => r.id));
  const missing = expected.filter((r) => !loadedById.has(r.id)).map((r) => r.id);
  const extra = [...loadedById.keys()].filter((id) => !expectedIds.has(id));
  if (missing.length) fail(`not loaded (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) fail(`loaded but not in the join (${extra.length}): ${extra.slice(0, 5).join(', ')}`);

  const diffs = new Map();
  for (const want of expected) {
    const got = loadedById.get(want.id);
    if (!got) continue;
    for (const col of COLUMNS) {
      if (norm(got[col]) !== norm(want[col])) {
        if (!diffs.has(col)) diffs.set(col, []);
        diffs.get(col).push(want.document_number);
      }
    }
  }
  for (const [col, keys] of diffs) {
    fail(`${col} differs in ${keys.length} rows: ${keys.slice(0, 5).join(', ')}`);
  }

  // Notes: the parse of FR's string, and the loaded parse of the loaded string.
  for (const f of notesFailures(expected)) fail(`parsed: ${f}`);
  for (const f of notesFailures(loaded)) fail(`loaded: ${f}`);
  return failures;
}
