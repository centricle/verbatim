// Parse NHTSA's SGO 2021-01 incident report CSVs into one row per report.
//
// Pure functions only: text in, rows out. Fetching, loading and checking live
// in cli.mjs, so these can be tested against the trimmed fixtures in
// fixtures/ without a network or a database.
//
// What the parser does to the source, and nothing else:
//
// - Keeps the latest version of each report. NHTSA publishes every version of
//   a report as its own row (Report Version 1, 2, ...), and the same Report ID
//   can appear in the archive files and the current files, or in two system
//   files, so the latest version is chosen over all six files at once.
// - Drops reports whose latest version is a "No New or Updated Incident
//   Reports" filing. Those are an entity telling NHTSA it had nothing to
//   report that month; they carry no vehicle, date, place or narrative.
// - Trims surrounding whitespace (archive State values arrive as "SC ") and
//   turns empty or whitespace-only fields into null.
// - Adds what the files say only by being separate files: the system (ADS,
//   ADAS or OTHER, from the file name) and the period (the 2021 to 2025
//   archive, or the current third-amendment files).
// - Reads the MON-YYYY dates into a first-of-month date for sorting and
//   charts, keeping the text exactly as filed.
//
// Everything else is as NHTSA published it, redaction markers included. Only
// the columns below are read; VIN fragments, coordinates, street addresses
// and the investigating officer contact fields are never loaded.
import { parse } from 'csv-parse/sync';

export const PLACEHOLDER_TYPE = 'No New or Updated Incident Reports';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// The one non-UTF-8 byte NHTSA has shipped (a truncated curly apostrophe in an
// archive City value) decodes to U+FFFD rather than failing the whole file.
export function decode(buf) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

const clean = (v) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

// 'AUG-2026' -> '2026-08-01'. Blank is null. Anything else is a format NHTSA
// has not used before, so it stops the run instead of loading a guess.
export function monthDate(text) {
  const t = clean(text);
  if (t == null) return null;
  const m = /^([A-Z]{3})-(\d{4})$/.exec(t);
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  if (i < 0) throw new Error(`Unrecognized month "${t}"`);
  return `${m[2]}-${String(i + 1).padStart(2, '0')}-01`;
}

function intOrNull(text, field) {
  const t = clean(text);
  if (t == null) return null;
  if (!/^\d+$/.test(t)) throw new Error(`Non-integer ${field} "${t}"`);
  return Number(t);
}

const REQUIRED = [
  'Report ID', 'Report Version', 'Reporting Entity', 'Report Type', 'Report Submission Date',
  'Make', 'Model', 'Model Year', 'Incident Date', 'Same Incident ID', 'City', 'State',
  'Crash With', 'Highest Injury Severity Alleged', 'Narrative',
];

// One CSV record -> one report row.
export function toReport(rec, source) {
  const reportId = clean(rec['Report ID']);
  if (!reportId || !/^\d+-\d+$/.test(reportId)) throw new Error(`Bad Report ID "${rec['Report ID']}" in ${source.file}`);
  const version = intOrNull(rec['Report Version'], 'Report Version');
  if (version == null) throw new Error(`Missing Report Version for ${reportId} in ${source.file}`);
  const incidentMonth = monthDate(rec['Incident Date']);
  const make = clean(rec['Make']);
  return {
    report_id: reportId,
    report_version: version,
    system: source.system,
    period: source.generation,
    reporting_entity: clean(rec['Reporting Entity']),
    report_type: clean(rec['Report Type']),
    submission_date: clean(rec['Report Submission Date']),
    submission_month: monthDate(rec['Report Submission Date']),
    make,
    make_key: make == null ? null : make.toUpperCase(),
    model: clean(rec['Model']),
    model_year: intOrNull(rec['Model Year'], 'Model Year'),
    incident_date: clean(rec['Incident Date']),
    incident_month: incidentMonth,
    incident_year: incidentMonth == null ? null : Number(incidentMonth.slice(0, 4)),
    city: clean(rec['City']),
    state: clean(rec['State']),
    crash_with: clean(rec['Crash With']),
    injury_severity: clean(rec['Highest Injury Severity Alleged']),
    same_incident_id: clean(rec['Same Incident ID']),
    narrative: clean(rec['Narrative']),
    source_ref: `${source.url}#${reportId}-v${version}`,
  };
}

// Every record in one file, every version. relax_quotes accepts a bare quote
// inside an unquoted field (one archive ADS narrative has one), the same way
// Python's csv module and spreadsheet software read it.
export function parseFile(text, source) {
  const records = parse(text, { columns: true, relax_quotes: true, skip_empty_lines: true });
  if (records.length) {
    const missing = REQUIRED.filter((k) => !(k in records[0]));
    if (missing.length) throw new Error(`${source.file} lacks columns: ${missing.join(', ')}`);
  }
  return records.map((rec) => toReport(rec, source));
}

// Latest version of each Report ID across every file given. Two rows with the
// same ID and version would mean the order is ambiguous, so that throws.
export function latestVersions(rows) {
  const best = new Map();
  for (const row of rows) {
    const prev = best.get(row.report_id);
    if (!prev || row.report_version > prev.report_version) {
      best.set(row.report_id, row);
    } else if (row.report_version === prev.report_version) {
      throw new Error(`Report ${row.report_id} version ${row.report_version} appears twice (${prev.source_ref}, ${row.source_ref})`);
    }
  }
  return [...best.values()];
}

export const isPlaceholder = (row) => row.report_type === PLACEHOLDER_TYPE;

// [{ source, text }] -> the rows to load, plus what was set aside and why.
export function build(files) {
  const all = files.flatMap(({ source, text }) => parseFile(text, source));
  const latest = latestVersions(all);
  const placeholders = latest.filter(isPlaceholder);
  const reports = latest.filter((r) => !isPlaceholder(r))
    .sort((a, b) => a.report_id.localeCompare(b.report_id, 'en', { numeric: true }));
  return { all, latest, placeholders, reports };
}
