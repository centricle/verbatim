// Rewrite each Type0 font's ToUnicode from glyph identity. House PTRs ship
// ToUnicode maps that disagree with their own glyphs, so copied text is
// wrong while the page renders right.
//
// A complete embedded font is read by its own cmap. A subset (no cmap, no
// post table) is read by outline: a CID's Unicode is trusted only when the
// embedded glyph's outline matches the reference Georgia glyph at that GID
// and the ToUnicode value is one of that glyph's codepoints; otherwise the
// reference codepoint wins. A glyph with no reference match keeps its mapping
// only if it was NUL (renderer-made small caps), and becomes UNKNOWN so it is
// visible; anything else is an error.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync, deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, PDFNumber } from 'pdf-lib';
import { parseFont, fingerprint, cmap } from './glyphs.mjs';

// Georgia draws U+0020 and U+00A0 with one glyph, and U+002D and U+00AD with
// another. A glyph on the page is visible, so it reads as the space and the
// hyphen, never the no-break space or the soft hyphen (which renders as
// nothing), whichever the producer's ToUnicode chose.
// The mark for a glyph the producer synthesized (its small caps), which no
// font maps: U+E000, private use, so it can never be mistaken for text. A
// U+FFFD in the output is one the filing printed (20012439 draws it).
export const UNKNOWN = 0xe000;

const INVISIBLE = new Set([0xa0, 0xad]);
const visible = (cps) => cps.find((c) => !INVISIBLE.has(c)) ?? cps[0];

const REF = JSON.parse(readFileSync(new URL('./georgia-ref.json', import.meta.url)));

function faceOf(base) {
  const n = base.replace(/^[A-Z]{6}\+/, '');
  if (n === 'Georgia') return 'regular';
  if (n === 'Georgia,Bold' || n === 'Georgia-Bold') return 'bold';
  return null;
}

function parseCMap(txt) {
  const m = new Map();
  const hex = (h) => { const cps = []; for (let i = 0; i < h.length; i += 4) cps.push(parseInt(h.slice(i, i + 4), 16)); return cps; };
  for (const blk of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, a, u] of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) m.set(parseInt(a, 16), hex(u));
  }
  for (const blk of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, a, z, rest] of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(a, 16), hi = parseInt(z, 16);
      if (rest.startsWith('[')) {
        const arr = [...rest.matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hex(x[1]));
        for (let c = lo; c <= hi; c++) m.set(c, arr[c - lo]);
      } else {
        const u = hex(rest.slice(1, -1));
        for (let c = lo; c <= hi; c++) { const v = u.slice(); v[v.length - 1] += c - lo; m.set(c, v); }
      }
    }
  }
  return m;
}

function writeCMap(map) {
  const h4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const ents = [...map].sort((a, b) => a[0] - b[0]);
  let s = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  for (let i = 0; i < ents.length; i += 100) {
    const chunk = ents.slice(i, i + 100);
    s += `${chunk.length} beginbfchar\n` + chunk.map(([c, u]) => `<${h4(c)}> <${u.map(h4).join('')}>`).join('\n') + '\nendbfchar\n';
  }
  return s + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
}

// Standard security handler, RC4 only (V 1/2, R 2/3): every PTR seen uses
// R 3 with an empty user password, so the file opens for anyone; the key just
// has to be derived. Node's OpenSSL 3 build leaves RC4 out, hence by hand.
function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...b) => createHash('md5').update(Buffer.concat(b)).digest();
function cipher(ctx) {
  const enc = ctx.trailerInfo.Encrypt;
  if (!enc) return null;
  const e = enc instanceof PDFRef ? ctx.lookup(enc) : enc;
  const num = (k, d) => e.get(PDFName.of(k))?.asNumber?.() ?? d;
  const V = num('V', 0), R = num('R', 2);
  if (!(V === 1 || V === 2) || !(R === 2 || R === 3)) throw new Error(`unsupported encryption V${V} R${R}`);
  const n = (V === 1 ? 40 : num('Length', 40)) / 8;
  const O = Buffer.from(e.get(PDFName.of('O')).asBytes());
  const P = Buffer.alloc(4); P.writeInt32LE(num('P', 0));
  const ID = Buffer.from(ctx.trailerInfo.ID.get(0).asBytes());
  let h = md5(PAD, O, P, ID);
  if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
  const key = h.subarray(0, n);
  return (ref, data) => {
    const o = Buffer.alloc(5);
    o.writeUIntLE(ref.objectNumber, 0, 3); o.writeUIntLE(ref.generationNumber, 3, 2);
    return rc4(md5(key, o).subarray(0, Math.min(n + 5, 16)), data);
  };
}

export async function patchPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const ctx = doc.context;
  const look = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
  const crypt = cipher(ctx);
  const read = (ref) => {
    const st = ctx.lookup(ref);
    let d = Buffer.from(st.contents);
    if (crypt) d = crypt(ref, d);
    const f = st.dict.get(PDFName.of('Filter'))?.toString();
    if (f === '/FlateDecode') d = inflateSync(d);
    else if (f) throw new Error(`filter ${f}`);
    return d;
  };
  const report = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of('Subtype'))?.toString() !== '/Type0') continue;
    const base = obj.get(PDFName.of('BaseFont')).toString().slice(1);
    const face = faceOf(base);
    const tuRef = obj.get(PDFName.of('ToUnicode'));
    const r = { base, face, entries: 0, kept: 0, fixed: [], unknownNul: 0, errors: [] };
    report.push(r);
    if (!tuRef) continue;
    const cid = look(look(obj.get(PDFName.of('DescendantFonts'))).get(0));
    const fd = look(cid.get(PDFName.of('FontDescriptor')));
    const ff = fd?.get(PDFName.of('FontFile2'));
    if (!ff) continue;
    const font = parseFont(read(ff));
    // A complete embedded font (EO.Pdf 17 and 21 embed Georgia whole, both
    // faces under one name) carries its own cmap, which is the font's word on
    // each glyph. A GID it does not map is one the producer synthesized (its
    // small caps), used only for labels. Subsets (2014 to 2021) carry no
    // cmap, so they are checked against the reference outlines instead.
    let own = null;
    if (font.t.cmap) { try { own = cmap(font); } catch { own = null; } }
    if (!own && !face) continue;
    const c2g = cid.get(PDFName.of('CIDToGIDMap'));
    if (c2g?.toString() !== '/Identity') { r.errors.push('CIDToGIDMap not Identity'); continue; }
    const map = parseCMap(read(tuRef).toString('latin1'));
    const out = new Map();
    if (own) {
      for (const [c, u] of map) {
        r.entries++;
        const cps = own.get(c);
        if (!cps) { out.set(c, [UNKNOWN]); r.unknownNul++; }
        else if (u.length === 1 && cps.includes(u[0]) && !INVISIBLE.has(u[0])) { out.set(c, u); r.kept++; }
        else { const v = visible(cps); out.set(c, [v]); r.fixed.push(`${String.fromCodePoint(...u)}>${String.fromCodePoint(v)}`); }
      }
    }
    const ref = own ? null : REF[face].glyphs;
    const memo = new Map();
    for (const [c, u] of own ? [] : map) {
      r.entries++;
      const fp = fingerprint(font, c, memo);
      const rg = ref[c];
      if (rg && fp === rg.h) {
        if (u.length === 1 && rg.u.includes(u[0]) && !INVISIBLE.has(u[0])) { out.set(c, u); r.kept++; }
        else { const v = visible(rg.u); out.set(c, [v]); r.fixed.push(`${String.fromCodePoint(...u)}>${String.fromCodePoint(v)}`); }
      } else if (u.length === 1 && u[0] === 0) { out.set(c, [UNKNOWN]); r.unknownNul++; }
      else { out.set(c, u); r.errors.push(`cid ${c} tu ${u.map((x) => x.toString(16))} unverified`); }
    }
    let data = deflateSync(Buffer.from(writeCMap(out), 'latin1'));
    if (crypt) data = crypt(tuRef, data);
    ctx.assign(tuRef, PDFRawStream.of(ctx.obj({ Filter: 'FlateDecode', Length: data.length }), data));
  }
  return { bytes: await doc.save({ useObjectStreams: false }), report };
}
