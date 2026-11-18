#!/usr/bin/env node
// Build the parser fixtures from PTRs already fetched into tmp/trades/house/:
// each is the first page's words (patched, as pdftotext -bbox gives them),
// cut after a few rows, with the filer's name replaced by the fake cast
// wherever it appears. Coordinates and every other word are left as the PDF
// has them: layout is what the tests are for.
//
//   node scripts/trades/make-fixtures.mjs
//
// `expect` is the parser's output at the time the fixture was cut. The
// first four files are Phase 0 spike samples whose rows were checked against
// the rendered page; 20002620 was checked against its render on 2026-11-18.
// Regenerating means checking the rows against the render again.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchPdf } from './patch.mjs';
import { parseHouse, bboxWords } from './parse-house.mjs';
import { house } from './sources.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const run = promisify(execFile);

// [year, DocID, rows to keep, what the fixture is for]
export const SPEC = [
  [2014, '20001930', 3, '2014 layout: no asset-type codes; adjacent date cells'],
  [2017, '20008062', 3, '2017 layout'],
  [2021, '20018758', 3, '2018-2021 layout: Marlett cap-gains glyphs, [XX] codes'],
  [2025, '20030441', 1, '2022-on layout: synthesized small-caps labels; a long description'],
  [2015, '20002620', 2, 'wrapped sub-line text that looks like a label ("NYSE: MDT)")'],
];
const CAST = ['Wile', 'E.', 'Coyote'];

async function words(year, docId) {
  const { bytes } = await patchPdf(await readFile(house.pdfPath(year, docId)));
  const child = run('pdftotext', ['-bbox', '-f', '1', '-l', '1', '-', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  child.child.stdin.end(bytes);
  return bboxWords((await child).stdout);
}

// The filer's own name tokens, from the "Name:" line.
function nameTokens(ws) {
  const label = ws.find((w) => w.t === 'Name:');
  const line = ws.filter((w) => w.p === label.p && Math.abs(w.y1 - label.y1) < 1.2 && w.x0 > label.x0);
  return { line, tokens: new Set(line.map((w) => w.t.replace(/[.,]$/, '').toLowerCase()).filter((t) => t.length > 1 && t !== 'hon')) };
}

function scrub(ws) {
  const { line, tokens } = nameTokens(ws);
  const first = line[0];
  return ws
    .filter((w) => !line.includes(w) || w === first)
    .map((w) => {
      if (w === first) return { ...w, t: `Hon. ${CAST.join(' ')}` };
      const bare = w.t.replace(/[.,]$/, '').toLowerCase();
      return tokens.has(bare) ? { ...w, t: w.t.replace(/^[^.,]+/, CAST[2]) } : w;
    });
}

// Cut after `keep` rows: drop every word at or below the baseline where the
// next row's Type cell starts.
function cut(ws, keep) {
  const { rows } = parseHouse(ws);
  if (rows.length <= keep) return ws;
  const header = ws.find((w) => w.t === 'Notification');
  const typeX = ws.find((w) => w.t === 'Transaction' && Math.abs(w.y1 - header.y1) < 1.2).x0;
  const starts = ws.filter((w) => w.y0 > header.y1 + 20 && Math.abs(w.x0 - typeX) < 30 && /^(P|S|E|S \(partial\))$/.test(w.t) && w.y1 - w.y0 > 9.95)
    .map((w) => w.y0).sort((a, b) => a - b);
  const stop = starts[keep];
  return stop == null ? ws : ws.filter((w) => w.y0 < stop - 0.5);
}

const round = (w) => ({ p: w.p, x0: +w.x0.toFixed(2), y0: +w.y0.toFixed(2), x1: +w.x1.toFixed(2), y1: +w.y1.toFixed(2), t: w.t });

await mkdir(OUT, { recursive: true });
for (const [year, docId, keep, why] of SPEC) {
  const ws = cut(scrub(await words(year, docId)), keep).map(round);
  const parsed = parseHouse(ws);
  if (parsed.rows.length !== keep) throw new Error(`${docId}: cut kept ${parsed.rows.length} rows, wanted ${keep}`);
  const file = resolve(OUT, `${docId}.json`);
  await writeFile(file, JSON.stringify({ year, docId, why, words: ws, expect: parsed }, null, 1) + '\n');
  console.log(`${docId}.json  ${ws.length} words, ${parsed.rows.length} rows`);
}
