// The one Senate page printed as an image, with no text under it, read by
// OCR.
//
// Of the 30 volumes, only Apr to Sep 2023 has a B page like that: page 352
// (B-336) carries a whole block header, SERGEANT AT ARMS AND DOORKEEPER,
// funding year 2020-2024, and its first entries, as a picture. pdftotext
// finds only the page label on it. (Page 841, B-825, also has no text, and
// is blank: its OCR file holds no lines.) Without the page, the block's
// remaining lines would run on under the block before it.
//
// `npm run disbursements -- senate ocr <unit> <page>` renders the page with
// pdftoppm, reads it with tesseract, and writes the words, grouped into
// lines the way pdftotext groups them, in PDF points, under tmp/. From that
// reading, checked by eye against a sharper render, comes the page's
// transcription in senate-ocr/<unit>-p<page>.json: the lines the parser is
// given, the edits made to the OCR's reading, and how it was checked. Those
// files are committed: a parse never runs tesseract, and a reviewer can read
// exactly what the parser was given. The parser then checks the page as it
// checks any other: every amount against the subtotals and class totals
// printed on the text pages that follow, and the block against its
// ORGANIZATION TOTALS. Rows from the page carry extras.ocr. The raw check
// cannot see the page (its text layer is empty on both sides), so the money
// read there is left out of that comparison only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const OCR_DIR = new URL('./senate-ocr/', import.meta.url);
const DPI = 400;

export const ocrFile = (unit, page) => new URL(`${unit}-p${page}.json`, OCR_DIR);

// Every committed transcription for a unit, keyed by page number.
export function loadOcr(unit) {
  const out = {};
  for (const name of readdirSync(OCR_DIR)) {
    const m = /^(.+)-p(\d+)\.json$/.exec(name);
    if (m && m[1] === unit) out[Number(m[2])] = JSON.parse(readFileSync(new URL(name, OCR_DIR), 'utf8'));
  }
  return out;
}

// Tesseract's words (TSV, level 5) as pdftotext-style lines: words on the
// same baseline, split wherever the gap between two words is wider than the
// text is tall (a column gap; a space is about a third of that).
export function linesFromTsv(tsv, dpi = DPI) {
  const k = 72 / dpi;
  const words = [];
  for (const row of tsv.trim().split('\n').slice(1)) {
    const f = row.split('\t');
    if (f[0] !== '5' || !f[11]?.trim()) continue;
    const [x, y, w, h] = f.slice(6, 10).map(Number);
    words.push({ x0: x * k, x1: (x + w) * k, y0: y * k, y1: (y + h) * k, text: f[11].trim(), conf: Number(f[10]) });
  }
  words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rows = [];
  for (const w of words) {
    const mid = (w.y0 + w.y1) / 2;
    const r = rows.find((x) => Math.abs(x.mid - mid) < Math.max(1.2, (w.y1 - w.y0) / 2));
    if (r) r.words.push(w);
    else rows.push({ mid, words: [w] });
  }
  const lines = [];
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    for (const w of r.words) {
      const tall = w.y1 - w.y0;
      if (cur && w.x0 - cur.x1 <= Math.max(3, tall)) {
        cur.words.push(w);
        cur.x1 = w.x1;
        cur.y0 = Math.min(cur.y0, w.y0);
        cur.y1 = Math.max(cur.y1, w.y1);
      } else {
        cur = { x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, words: [w] };
        lines.push(cur);
      }
    }
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  return lines
    .map((l) => ({
      x0: r1(l.x0), y0: r1(l.y0), x1: r1(l.x1), y1: r1(l.y1),
      text: l.words.map((w) => w.text).join(' '),
      words: l.words.map((w) => ({ x0: r1(w.x0), x1: r1(w.x1), text: w.text, conf: Math.round(w.conf) })),
    }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

export function ocrPage(pdf, page) {
  const dir = mkdtempSync(join(tmpdir(), 'senate-ocr-'));
  try {
    execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(DPI), '-gray', '-png', '-singlefile', pdf, join(dir, 'p')]);
    // psm 6: one uniform block, so a table row reads across its columns.
    const tsv = execFileSync('tesseract', [join(dir, 'p.png'), 'stdout', '--psm', '6', 'tsv'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const version = execFileSync('tesseract', ['--version'], { encoding: 'utf8' }).split('\n')[0];
    return { page, dpi: DPI, engine: version, psm: 6, lines: linesFromTsv(tsv) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
