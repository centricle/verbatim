// The comparison behind `cli.mjs check`, kept pure so planted defects can be
// tested without a database (check.test.mjs).
//
// Three views of the same data have to agree:
//
// 1. Raw: a scan of each downloaded file that does not use the CSV parser.
//    Every record in NHTSA's files starts a CRLF-terminated line with
//    `<Report ID>,<Report Version>,` (narratives break lines with bare LF),
//    so counting those line starts counts records independently.
// 2. Parsed: parse.mjs over the same files.
// 3. Loaded: every row of the table, every column the loader writes.
//
// The invariant: loaded rows equal the distinct Report IDs in the source,
// less the reports whose latest version is a "no new reports" filing, and
// each carries the highest version the raw scan saw for its ID.

export const COLUMNS = [
  'report_id', 'report_version', 'system', 'period', 'reporting_entity', 'report_type',
  'submission_date', 'submission_month', 'make', 'make_key', 'model', 'model_year',
  'incident_date', 'incident_month', 'incident_year', 'city', 'state', 'crash_with',
  'injury_severity', 'same_incident_id', 'narrative', 'source_ref',
];

const RECORD_START = /^(\d+-\d+),(\d+),/;

export function rawScan(text) {
  const pairs = [];
  for (const line of text.split('\r\n')) {
    const m = RECORD_START.exec(line);
    if (m) pairs.push(`${m[1]} v${m[2]}`);
  }
  return pairs;
}

// Postgres hands back dates as Date objects and integers as numbers; the
// parser produces 'YYYY-MM-DD' strings and numbers. Compare on one footing.
function norm(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? null;
}

/**
 * @param {object} input
 * @param {{ file: string, pairs: string[] }[]} input.raw     rawScan per file
 * @param {{ file: string, rows: object[] }[]} input.parsed  parseFile per file
 * @param {object[]} input.expected  build().reports
 * @param {number} input.placeholders  build().placeholders.length
 * @param {object[]} input.loaded    every row of the table
 * @returns {string[]} failures; empty means the check passed
 */
export function compare({ raw, parsed, expected, placeholders, loaded }) {
  const failures = [];
  const fail = (msg) => failures.push(msg);

  // 1 vs 2: every file, same records.
  for (const { file, pairs } of raw) {
    const p = parsed.find((x) => x.file === file);
    const parsedPairs = p.rows.map((r) => `${r.report_id} v${r.report_version}`);
    if (pairs.length !== parsedPairs.length) {
      fail(`${file}: raw scan found ${pairs.length} records, parser ${parsedPairs.length}`);
    }
    const a = new Set(pairs);
    const b = new Set(parsedPairs);
    const onlyRaw = [...a].filter((x) => !b.has(x));
    const onlyParsed = [...b].filter((x) => !a.has(x));
    if (onlyRaw.length) fail(`${file}: in raw scan, not parsed: ${onlyRaw.slice(0, 5).join(', ')}`);
    if (onlyParsed.length) fail(`${file}: parsed, not in raw scan: ${onlyParsed.slice(0, 5).join(', ')}`);
  }

  // The invariant, from the raw scan alone plus the placeholder count.
  const maxVersion = new Map();
  for (const { pairs } of raw) {
    for (const pair of pairs) {
      const [id, v] = pair.split(' v');
      maxVersion.set(id, Math.max(maxVersion.get(id) ?? 0, Number(v)));
    }
  }
  const wantCount = maxVersion.size - placeholders;
  if (expected.length !== wantCount) {
    fail(`parsed ${expected.length} reports; raw distinct IDs ${maxVersion.size} less ${placeholders} placeholders is ${wantCount}`);
  }
  if (loaded.length !== wantCount) {
    fail(`loaded ${loaded.length} rows; raw distinct IDs ${maxVersion.size} less ${placeholders} placeholders is ${wantCount}`);
  }

  // 2 vs 3: same IDs, no duplicates, every column equal.
  const loadedById = new Map();
  for (const row of loaded) {
    if (loadedById.has(row.report_id)) fail(`loaded twice: ${row.report_id}`);
    loadedById.set(row.report_id, row);
  }
  const expectedIds = new Set(expected.map((r) => r.report_id));
  const missing = expected.filter((r) => !loadedById.has(r.report_id)).map((r) => r.report_id);
  const extra = [...loadedById.keys()].filter((id) => !expectedIds.has(id));
  if (missing.length) fail(`not loaded (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) fail(`loaded but not in source (${extra.length}): ${extra.slice(0, 5).join(', ')}`);

  const diffs = new Map();
  for (const want of expected) {
    const got = loadedById.get(want.report_id);
    if (!got) continue;
    if (got.report_version !== maxVersion.get(want.report_id)) {
      fail(`${want.report_id}: loaded v${got.report_version}, raw latest v${maxVersion.get(want.report_id)}`);
    }
    for (const col of COLUMNS) {
      if (norm(got[col]) !== norm(want[col])) {
        if (!diffs.has(col)) diffs.set(col, []);
        diffs.get(col).push(want.report_id);
      }
    }
  }
  for (const [col, ids] of diffs) {
    fail(`${col} differs in ${ids.length} rows: ${ids.slice(0, 5).join(', ')}`);
  }

  return failures;
}
