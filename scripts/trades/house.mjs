// House filings: the Clerk's index rows, the text of each electronic PTR, and
// the rows that go to trade_filings and stock_trades.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchPdf } from './patch.mjs';
import { parseHouse, bboxWords } from './parse-house.mjs';
import { ASSET_TYPES, OWNERS, TYPES } from './labels.mjs';
import { house } from './sources.mjs';

// `{YEAR}FD.txt` inside the year's ZIP: tab-separated, CRLF, a BOM, header
// `Prefix Last First Suffix FilingType StateDst Year FilingDate DocID`,
// dates M/D/YYYY. Only FilingType P (a PTR) is kept.
export function parseIndex(text) {
  const [head, ...lines] = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const cols = head.split('\t');
  const need = ['Prefix', 'Last', 'First', 'Suffix', 'FilingType', 'StateDst', 'Year', 'FilingDate', 'DocID'];
  const missing = need.filter((c) => !cols.includes(c));
  if (missing.length) throw new Error(`index header lacks ${missing.join(', ')}`);
  return lines
    .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v.trim()])))
    .filter((r) => r.FilingType === 'P')
    .map((r) => ({ ...r, Year: Number(r.Year), filed: usDate(r.FilingDate) }));
}

export function readIndexZip(zipPath, entry) {
  return parseIndex(execFileSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8', maxBuffer: 64 << 20 }));
}

// M/D/YYYY (either part may be one digit) to YYYY-MM-DD; null for anything
// that is not a real calendar date, so a misprint never becomes a wrong date.
export function usDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s ?? '');
  if (!m) return null;
  const [, mo, d, y] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// pdftotext on stdin, asynchronously, so a full parse can run files in
// parallel.
function pdftotext(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('pdftotext', [...args, '-', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }, (err, out) => (err ? reject(err) : resolve(out)));
    child.stdin.end(input);
  });
}

// pdf-lib cannot parse every PTR (one in the first 3,500 failed on an
// object it calls invalid). qpdf rewrites such a file cleanly, decrypted;
// it takes no stdin, so the bytes pass through a private temp directory.
async function qpdfDecrypt(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'trades-qpdf-'));
  try {
    const src = join(dir, 'in.pdf');
    await writeFile(src, bytes);
    return await new Promise((resolve, reject) => {
      execFile('qpdf', ['--decrypt', src, '-'], { encoding: 'buffer', maxBuffer: 64 << 20 }, (err, out) => (err ? reject(err) : resolve(out)));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The PDF's text, through the ToUnicode patch. pdftotext reads the patched
// bytes on stdin; nothing is written to disk.
export async function extract(bytes) {
  let result;
  try { result = await patchPdf(bytes); }
  catch { result = await patchPdf(await qpdfDecrypt(bytes)); }
  const { bytes: patched, report } = result;
  const xml = await pdftotext(['-bbox'], patched);
  const parsed = parseHouse(bboxWords(xml));
  return { ...parsed, errors: [...report.flatMap((r) => r.errors.map((e) => `${r.base}: ${e}`)), ...parsed.errors] };
}

// The independent count check.mjs holds the parser to: transaction and
// notification dates print as a pair on every row, in the unpatched text
// layer too (digits are not affected by the font defect).
export async function rawRowCount(bytes) {
  const text = await pdftotext(['-raw'], bytes);
  return text.match(/\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}\/\d{1,2}\/\d{4}/g)?.length ?? 0;
}

// One index row (plus its parse, when electronic) to a filing and its rows.
// Any problem fails the whole filing: it is loaded with no rows and the
// reason, never with some rows missing.
export function houseFiling(ix, member, parsed, fetchedAt) {
  const electronic = house.isElectronic(ix.DocID);
  const filing = {
    chamber: 'house',
    filing_id: ix.DocID,
    source: 'house-clerk',
    kind: electronic ? 'electronic' : 'paper',
    bioguide: member.bioguide,
    filer_prefix: ix.Prefix || null,
    filer_first: ix.First || null,
    filer_last: ix.Last || null,
    filer_suffix: ix.Suffix || null,
    filer_name: parsed?.filer?.name ?? null,
    office: null,
    state_district: ix.StateDst || null,
    report_year: ix.Year,
    filed_date: ix.filed,
    url: house.pdfUrl(ix.Year, ix.DocID),
    amends_filing_id: null,
    parse_status: electronic ? 'parsed' : 'paper',
    parse_error: null,
    row_count: 0,
    fetched_at: electronic ? fetchedAt ?? null : null,
  };
  if (!electronic) return { filing, rows: [] };

  const fail = (errors) => ({ filing: { ...filing, parse_status: 'failed', parse_error: errors.join('; ') }, rows: [] });
  if (!parsed) return fail(['PDF not fetched']);
  const errors = [...parsed.errors];
  if (parsed.filingId !== ix.DocID) errors.push(`PDF says Filing ID #${parsed.filingId}`);
  if (!parsed.rows.length) errors.push('no rows found');
  const rows = parsed.rows.map((r) => {
    const out = {
      chamber: 'house',
      filing_id: ix.DocID,
      row_num: r.row_num,
      source: 'house-clerk',
      bioguide: member.bioguide,
      member: member.member,
      transaction_id: r.transaction_id,
      filing_status: r.filing_status ?? null,
      transaction_date: usDate(r.transaction_date),
      notification_date: usDate(r.notification_date),
      owner_code: r.owner_code,
      owner: r.owner_code ? OWNERS[r.owner_code] : null,
      asset_description: r.asset_description || null,
      ticker: r.ticker,
      asset_type_code: r.asset_type_code,
      asset_type: r.asset_type_code ? ASSET_TYPES[r.asset_type_code] : null,
      type_code: r.type_code,
      type: TYPES[r.type_code],
      amount: r.amount,
      subholding_of: r.subholding_of ?? null,
      description: r.description ?? null,
      location: r.location ?? null,
      comment: r.comment ?? null,
    };
    const at = `row ${r.row_num}`;
    if (r.owner_code && !out.owner) errors.push(`${at}: owner code "${r.owner_code}" has no House definition`);
    if (r.asset_type_code && !out.asset_type) errors.push(`${at}: asset type code "${r.asset_type_code}" is not on the House list`);
    if (!out.type) errors.push(`${at}: type "${r.type_code}"`);
    if (r.transaction_date && !out.transaction_date) errors.push(`${at}: transaction date "${r.transaction_date}"`);
    if (r.notification_date && !out.notification_date) errors.push(`${at}: notification date "${r.notification_date}"`);
    return out;
  });
  if (errors.length) return fail(errors);
  return { filing: { ...filing, row_count: rows.length }, rows };
}
