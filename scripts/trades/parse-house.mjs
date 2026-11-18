// House PTR words to filer fields and transaction rows. Pure: takes the words
// of `pdftotext -bbox` run on a ToUnicode-patched PDF (patch.mjs), returns
// data. Every value is the printed text; nothing is mapped here.
//
// Layout facts it relies on, measured over 37 PTRs from 2014 to 2025:
// - Column x positions come from each page's own header words.
// - Rows are set at 9 pt (word box 10.2 tall); the labeled sub-lines under a
//   row (Filing Status, Subholding Of, Description, Comments, Location) at
//   8.3 or 8.5 pt (9.4, 9.7). A row starts at a 9 pt line with a Type cell.
// - The table ends at the left margin, the asset-type footnote, or a heading.
// - 2018-2021 draw the cap-gains box as a Marlett glyph (box over 12.5 tall);
//   it is dropped (cap gains are not loaded).
// - From 2022 the producer synthesizes small caps that map to nothing, so
//   labels arrive as initials ("F S" for FILING STATUS) once patch.mjs's
//   marker for them (U+E000) is removed.
//
// words: [{ p, x0, y0, x1, y1, t }] in page order.

const LABELS = {
  'FILING STATUS': 'filing_status', 'F S': 'filing_status',
  'SUBHOLDING OF': 'subholding_of', 'S O': 'subholding_of',
  DESCRIPTION: 'description', D: 'description',
  COMMENTS: 'comment', C: 'comment',
  LOCATION: 'location', L: 'location',
};
const LABEL_RE = /^([A-Z\uE000]+(?: [A-Z\uE000]+)*):(?: (.*))?$/;

// Georgia's ascent and descent are 0.917 and 0.219 em; poppler's word box
// spans both, so the baseline sits 0.219/1.136 of the box above its bottom.
const baseline = (w) => w.y1 - 0.1928 * (w.y1 - w.y0);

function lines(words) {
  const out = [];
  const byPage = new Map();
  for (const w of words) {
    if (!byPage.has(w.p)) byPage.set(w.p, []);
    byPage.get(w.p).push({ ...w, b: baseline(w) });
  }
  for (const [p, ws] of byPage) {
    ws.sort((a, b) => a.b - b.b || a.x0 - b.x0);
    let cur = null;
    for (const w of ws) {
      if (cur && Math.abs(w.b - cur.b) < 1.2) cur.words.push(w);
      else { cur = { p, b: w.b, words: [w] }; out.push(cur); }
    }
    for (const l of out) if (l.p === p) l.words.sort((a, b) => a.x0 - b.x0);
  }
  return out;
}

// Adjacent boxes (small-caps runs) join with nothing, others with one space:
// the source is HTML, which collapses whitespace, so a gap is one space.
function join(ws) {
  let s = '';
  for (let i = 0; i < ws.length; i++) {
    if (i && ws[i].x0 - ws[i - 1].x1 > 0.6) s += ' ';
    s += ws[i].t;
  }
  return s;
}

// A line break after "x-" is a hyphen break (no space was there); any other
// break replaced one space.
function joinLines(ls) {
  return ls.reduce((s, l) => (!s ? l : /[A-Za-z0-9]-$/.test(s) ? s + l : `${s} ${l}`), '');
}

const COLS = ['id', 'owner', 'asset', 'type', 'date', 'notified', 'amount', 'capgains'];

function headerColumns(line) {
  const ws = line.words;
  const find = (t, after = -1) => ws.findIndex((w, i) => i > after && w.t === t);
  const iID = find('ID'), iOwner = find('Owner'), iAsset = find('Asset'), iTx = find('Transaction');
  const iDate = find('Date', iTx), iNot = find('Notification'), iAmt = find('Amount'), iCap = find('Cap.');
  if ([iID, iOwner, iAsset, iTx, iDate, iNot, iAmt].some((i) => i < 0)) return null;
  return [iID, iOwner, iAsset, iTx, iDate, iNot, iAmt, iCap].map((i) => (i < 0 ? Infinity : ws[i].x0));
}

export function parseHouse(words) {
  const L = lines(words);
  const errors = [];
  const filer = {};
  let filingId = null;
  for (const l of L) {
    const s = join(l.words);
    let m;
    if (!filingId && (m = s.match(/Filing ID #(\d+)/))) filingId = m[1];
    if ((m = s.match(/^Name: (.*)$/))) filer.name ??= m[1];
    else if ((m = s.match(/^Status: (.*)$/))) filer.status ??= m[1];
    else if ((m = s.match(/^State\/District: (.*)$/))) filer.state_district ??= m[1];
  }

  const rows = [];
  let cur = null;
  let cols = null;
  const pages = [...new Set(L.map((l) => l.p))];
  for (const p of pages) {
    const pl = L.filter((l) => l.p === p);
    const hi = pl.findIndex((l) => l.words.some((w) => w.t === 'Notification') && l.words.some((w) => w.t === 'Amount'));
    if (hi < 0) continue;
    cols = headerColumns(pl[hi]);
    if (!cols) { errors.push(`page ${p}: header columns not found`); continue; }
    // The header continues over the lines holding Type / Date / Gains > / $200?
    let i = hi + 1;
    while (i < pl.length && pl[i].b - pl[hi].b < 30 && pl[i].words.every((w) => /^(Type|Date|Gains|>|\$200\?)$/.test(w.t))) i++;
    for (; i < pl.length; i++) {
      const l = pl[i];
      const text = join(l.words);
      if (l.words[0].x0 < cols[0] - 1 || /^\* For the complete list of asset type/.test(text)) break;
      const ws = l.words.filter((w) => !(w.x0 + 0.5 >= cols[7] && w.y1 - w.y0 > 12.5));
      if (!ws.length) continue;
      const isData = ws.some((w) => w.y1 - w.y0 > 9.95);
      if (!isData) {
        if (!cur) { errors.push(`page ${p}: sub-line before first row: ${text}`); continue; }
        cur.sub.push(join(ws));
        continue;
      }
      const cells = COLS.map(() => []);
      for (const w of ws) {
        let c = 0;
        for (let k = 0; k < cols.length; k++) if (w.x0 + 0.5 >= cols[k]) c = k;
        cells[c].push(w);
      }
      if (cells[3].length) { cur = { page: p, lines: [], sub: [] }; rows.push(cur); }
      if (!cur) { errors.push(`page ${p}: text before first row: ${text}`); continue; }
      if (cur.sub.length) errors.push(`page ${p}: row text after its sub-lines: ${text}`);
      cur.lines.push(cells.map((c) => (c.length ? join(c) : null)));
    }
  }

  const out = rows.map((r, n) => {
    const col = (k) => r.lines.map((l) => l[k]).filter((x) => x != null);
    const sub = [];
    for (const t of r.sub) {
      const m = t.match(LABEL_RE);
      const key = m && LABELS[m[1].replace(/\uE000/g, '').replace(/\s+/g, ' ').trim()];
      if (key) sub.push([key, m[2] ?? '']);
      // A capitalized word and a colon that is not a known label is wrapped
      // text ("which now uses / NYSE: MDT)", "SEMI ANNUAL REINVESTMENT:"),
      // which is continuation of the field above it.
      else if (sub.length) sub[sub.length - 1][1] = joinLines([sub[sub.length - 1][1], t]);
      else if (m) { errors.push(`row ${n + 1}: unknown label "${m[1]}"`); sub.push(['unknown', t]); }
      else { errors.push(`row ${n + 1}: unlabeled sub-line "${t}"`); sub.push(['unknown', t]); }
    }
    const asset = joinLines(col(2));
    const am = asset.match(/^(.*?)\s*\[([A-Z0-9]{2})\]$/);
    const name = am ? am[1] : asset;
    const tk = name.match(/\(([A-Z0-9.\-/ ]{1,12})\)$/);
    const row = {
      row_num: n + 1,
      transaction_id: joinLines(col(0)) || null,
      owner_code: joinLines(col(1)) || null,
      asset_description: name,
      asset_type_code: am ? am[2] : null,
      ticker: tk ? tk[1] : null,
      type_code: joinLines(col(3)),
      transaction_date: joinLines(col(4)) || null,
      notification_date: joinLines(col(5)) || null,
      amount: joinLines(col(6)) || null,
    };
    for (const [k, v] of sub) {
      if (k === 'unknown') continue;
      if (row[k] != null) errors.push(`row ${n + 1}: second "${k}" line`);
      row[k] = row[k] != null ? `${row[k]} ${v}` : v;
    }
    return row;
  });
  return { filingId, filer, rows: out, errors };
}

// pdftotext -bbox XHTML -> words
export function bboxWords(xml) {
  const words = [];
  let p = 0;
  const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
  for (const m of xml.matchAll(/<page [^>]*>|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
    if (m[0].startsWith('<page')) { p++; continue; }
    words.push({ p, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: ent(m[5]) });
  }
  return words;
}
