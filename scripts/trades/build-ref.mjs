#!/usr/bin/env node
// Rebuild georgia-ref.json: for each Georgia face, gid -> { h: outline
// fingerprint, u: codepoints }. Read from the macOS system fonts; the table,
// not the font, is what the repo holds. Every PTR glyph seen so far matched
// these at the same GID, across Georgia revisions 5.0 and 5.51.
//
//   node scripts/trades/build-ref.mjs [out]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFont, fingerprint, cmap } from './glyphs.mjs';

const FACES = {
  regular: '/System/Library/Fonts/Supplemental/Georgia.ttf',
  bold: '/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
};
const out = {};
for (const [face, path] of Object.entries(FACES)) {
  const f = parseFont(readFileSync(path));
  const memo = new Map();
  const g = {};
  for (const [gid, cps] of [...cmap(f)].sort((a, b) => a[0] - b[0])) g[gid] = { h: fingerprint(f, gid, memo), u: cps };
  out[face] = { source: path.split('/').pop(), numGlyphs: f.numGlyphs, glyphs: g };
  console.log(face, f.numGlyphs, 'glyphs,', Object.keys(g).length, 'mapped');
}
writeFileSync(process.argv[2] ?? fileURLToPath(new URL('./georgia-ref.json', import.meta.url)), JSON.stringify(out));
