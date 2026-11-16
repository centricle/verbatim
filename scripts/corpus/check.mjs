// The comparison behind `cli.mjs check`, kept pure so planted defects can be
// tested without a database (check.test.mjs).
//
// Three views of the same data have to agree:
//
// 1. Raw: a scan of release.jsonl that does not use the JSON parser.
//    build_release.py writes one record per line, opening with its id, and
//    writes `collection` before `text`. Inside a JSON string a quote is
//    always escaped, so `"collection": "core"` with bare quotes can only be
//    the field itself, never words in a record's text.
// 2. Parsed: parse.mjs over the same file.
// 3. Loaded: every row of the table, every column the loader writes.
//
// The invariant: the loaded rows are exactly the release's core and voices
// records, once each, with every column equal to the release's value.
import { COLLECTIONS, COLUMNS } from './parse.mjs';

const LINE = /^\{"id": "([0-9a-f]{64})".*?"collection": "([a-z]+)"/;

/** Ids of the site's records, read off each line without parsing JSON. */
export function rawScan(text) {
  const ids = [];
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (m && COLLECTIONS.includes(m[2])) ids.push(m[1]);
  }
  return ids;
}

// Postgres hands back a date column as a Date at UTC midnight; the release
// has 'YYYY-MM-DD' strings. Compare on one footing.
function norm(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? null;
}

/**
 * @param {object} input
 * @param {string[]} input.raw        rawScan of the release
 * @param {object[]} input.expected   siteRows of the parsed release
 * @param {object[]} input.loaded     every row of the table
 * @returns {string[]} failures; empty means the check passed
 */
export function compare({ raw, expected, loaded }) {
  const failures = [];
  const fail = (msg) => failures.push(msg);

  // 1 vs 2: the parser keeps exactly the records the raw scan sees.
  const rawSet = new Set(raw);
  const expectedIds = new Set(expected.map((r) => r.id));
  if (raw.length !== expected.length) {
    fail(`raw scan found ${raw.length} site records, parser ${expected.length}`);
  }
  if (rawSet.size !== raw.length) fail(`raw scan found ${raw.length - rawSet.size} repeated ids`);
  const onlyRaw = raw.filter((id) => !expectedIds.has(id));
  const onlyParsed = [...expectedIds].filter((id) => !rawSet.has(id));
  if (onlyRaw.length) fail(`in raw scan, not parsed: ${onlyRaw.slice(0, 5).join(', ')}`);
  if (onlyParsed.length) fail(`parsed, not in raw scan: ${onlyParsed.slice(0, 5).join(', ')}`);

  // 2 vs 3: same ids, once each, every column equal.
  if (loaded.length !== rawSet.size) {
    fail(`loaded ${loaded.length} rows; the release has ${rawSet.size} site records`);
  }
  const loadedById = new Map();
  for (const row of loaded) {
    if (loadedById.has(row.id)) fail(`loaded twice: ${row.id}`);
    loadedById.set(row.id, row);
  }
  const missing = expected.filter((r) => !loadedById.has(r.id)).map((r) => r.id);
  const extra = [...loadedById.keys()].filter((id) => !expectedIds.has(id));
  if (missing.length) fail(`not loaded (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) fail(`loaded but not in the release (${extra.length}): ${extra.slice(0, 5).join(', ')}`);

  const diffs = new Map();
  for (const want of expected) {
    const got = loadedById.get(want.id);
    if (!got) continue;
    for (const col of COLUMNS) {
      if (norm(got[col]) !== norm(want[col])) {
        if (!diffs.has(col)) diffs.set(col, []);
        diffs.get(col).push(want.id);
      }
    }
  }
  for (const [col, ids] of diffs) {
    fail(`${col} differs in ${ids.length} rows: ${ids.slice(0, 5).join(', ')}`);
  }
  return failures;
}
