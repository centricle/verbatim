// TrueType outline fingerprints and cmap, enough to identify a subset glyph
// by its shape. The House PTRs embed Georgia subsets with no cmap or post
// table, so a glyph's outline is the only evidence of which character it is.
import { createHash } from 'node:crypto';

function tables(buf) {
  const n = buf.readUInt16BE(4);
  const t = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + 16 * i;
    t[buf.toString('latin1', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  return t;
}

export function parseFont(buf) {
  const t = tables(buf);
  const head = t.head.off;
  const indexToLoc = buf.readInt16BE(head + 50);
  const numGlyphs = buf.readUInt16BE(t.maxp.off + 4);
  const loca = [];
  for (let i = 0; i <= numGlyphs; i++) {
    loca.push(indexToLoc === 0 ? buf.readUInt16BE(t.loca.off + 2 * i) * 2 : buf.readUInt32BE(t.loca.off + 4 * i));
  }
  const numH = buf.readUInt16BE(t.hhea.off + 34);
  const adv = (g) => buf.readUInt16BE(t.hmtx.off + 4 * Math.min(g, numH - 1));
  return { buf, t, numGlyphs, loca, adv };
}

function simple(buf, p, nc) {
  const ends = [];
  for (let i = 0; i < nc; i++) ends.push(buf.readUInt16BE(p + 2 * i));
  p += 2 * nc;
  const insLen = buf.readUInt16BE(p);
  p += 2 + insLen;
  const n = ends.length ? ends[ends.length - 1] + 1 : 0;
  const flags = [];
  while (flags.length < n) {
    const f = buf[p++];
    flags.push(f);
    if (f & 8) { let r = buf[p++]; while (r--) flags.push(f); }
  }
  const xs = [], ys = [];
  let v = 0;
  for (const f of flags) {
    if (f & 2) { const d = buf[p++]; v += f & 16 ? d : -d; }
    else if (!(f & 16)) { v += buf.readInt16BE(p); p += 2; }
    xs.push(v);
  }
  v = 0;
  for (const f of flags) {
    if (f & 4) { const d = buf[p++]; v += f & 32 ? d : -d; }
    else if (!(f & 32)) { v += buf.readInt16BE(p); p += 2; }
    ys.push(v);
  }
  return { ends, on: flags.map((f) => f & 1), xs, ys };
}

// Canonical outline: simple glyphs by contour ends, on-curve bits and absolute
// points; composites by their components' own fingerprints and placement.
// Instructions (hinting) are left out, so two builds of one design match.
export function fingerprint(font, gid, memo = new Map()) {
  if (memo.has(gid)) return memo.get(gid);
  const { buf, t, loca } = font;
  if (gid >= font.numGlyphs) return null;
  const start = t.glyf.off + loca[gid], end = t.glyf.off + loca[gid + 1];
  let canon;
  if (end <= start) canon = `empty:${font.adv(gid)}`;
  else {
    const nc = buf.readInt16BE(start);
    if (nc >= 0) {
      const s = simple(buf, start + 10, nc);
      canon = JSON.stringify(['s', s.ends, s.on.join(''), s.xs, s.ys]);
    } else {
      let p = start + 10;
      const comps = [];
      for (;;) {
        const flags = buf.readUInt16BE(p), g = buf.readUInt16BE(p + 2);
        p += 4;
        let a, b;
        if (flags & 1) { a = flags & 2 ? buf.readInt16BE(p) : buf.readUInt16BE(p); b = flags & 2 ? buf.readInt16BE(p + 2) : buf.readUInt16BE(p + 2); p += 4; }
        else { a = flags & 2 ? buf.readInt8(p) : buf[p]; b = flags & 2 ? buf.readInt8(p + 1) : buf[p + 1]; p += 2; }
        const tr = [];
        const n = flags & 8 ? 1 : flags & 0x40 ? 2 : flags & 0x80 ? 4 : 0;
        for (let i = 0; i < n; i++) { tr.push(buf.readInt16BE(p)); p += 2; }
        comps.push([fingerprint(font, g, memo), flags & 2 ? 'xy' : 'pt', a, b, tr]);
        if (!(flags & 0x20)) break;
      }
      canon = JSON.stringify(['c', comps]);
    }
  }
  const h = createHash('sha1').update(canon).digest('hex').slice(0, 16);
  memo.set(gid, h);
  return h;
}

// gid -> sorted codepoints, from cmap (3,10) format 12 or (3,1) format 4.
export function cmap(font) {
  const { buf, t } = font;
  const base = t.cmap.off;
  const n = buf.readUInt16BE(base + 2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const o = base + 4 + 8 * i;
    subs.push({ pid: buf.readUInt16BE(o), eid: buf.readUInt16BE(o + 2), off: base + buf.readUInt32BE(o + 4) });
  }
  const out = new Map();
  const add = (cp, g) => { if (g) { if (!out.has(g)) out.set(g, []); out.get(g).push(cp); } };
  const s12 = subs.find((s) => s.pid === 3 && s.eid === 10 && buf.readUInt16BE(s.off) === 12);
  const s4 = subs.find((s) => s.pid === 3 && s.eid === 1 && buf.readUInt16BE(s.off) === 4);
  if (s12) {
    const ng = buf.readUInt32BE(s12.off + 12);
    for (let i = 0; i < ng; i++) {
      const o = s12.off + 16 + 12 * i;
      const a = buf.readUInt32BE(o), z = buf.readUInt32BE(o + 4), g = buf.readUInt32BE(o + 8);
      for (let c = a; c <= z; c++) add(c, g + c - a);
    }
  } else if (s4) {
    const o = s4.off, segX2 = buf.readUInt16BE(o + 6), seg = segX2 / 2;
    const endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let i = 0; i < seg; i++) {
      const e = buf.readUInt16BE(endO + 2 * i), s = buf.readUInt16BE(startO + 2 * i);
      const d = buf.readInt16BE(deltaO + 2 * i), r = buf.readUInt16BE(rangeO + 2 * i);
      for (let c = s; c <= e && c !== 0xffff; c++) {
        let g;
        if (r === 0) g = (c + d) & 0xffff;
        else {
          const gi = buf.readUInt16BE(rangeO + 2 * i + r + 2 * (c - s));
          g = gi ? (gi + d) & 0xffff : 0;
        }
        add(c, g);
      }
    }
  } else throw new Error('no usable cmap subtable');
  for (const v of out.values()) v.sort((a, b) => a - b);
  return out;
}
