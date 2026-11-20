// Read `pdftotext -bbox-layout` output into pages of positioned lines.
//
// Pure: XHTML text in, plain objects out. cli.mjs runs pdftotext (poppler)
// on a downloaded Report of the Secretary of the Senate and hands the output
// here; the fixtures hand in a few hand-written pages instead.
//
// Why coordinates and not `pdftotext -layout`: the report's tables center a
// wrapped cell on its row, so a two-line payee sits one line above the
// row and one below it, and the layout text sometimes moves an amount onto
// a line of its own (Oct 2025 to Mar 2026, page B-27). With coordinates,
// each fragment can be placed by its distance from the row, and the amount
// is where the PDF draws it.
//
// pdftotext groups words into lines inside blocks, and in these volumes a
// line never crosses a table column (checked on 2012 and 2026 volumes): each
// line is one cell's text on one baseline. The words are kept too, so the
// parser can test that claim instead of trusting it.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e] ?? m;
});

const ATTR = /(\w+)="([^"]*)"/g;
const attrs = (s) => Object.fromEntries([...s.matchAll(ATTR)].map(([, k, v]) => [k, v]));
const num = (a, k) => Number(a[k]);

/**
 * @param {string} xhtml pdftotext -bbox-layout output
 * @returns {{ number: number, width: number, height: number, lines: { x0: number, y0: number, x1: number, y1: number, text: string, words: { x0: number, x1: number, text: string }[] }[] }[]}
 *   pages in order, `number` 1-based; lines sorted top to bottom, then left to right
 */
export function readPages(xhtml) {
  const pages = [];
  const pageRe = /<page ([^>]*)>([\s\S]*?)<\/page>/g;
  const lineRe = /<line ([^>]*)>([\s\S]*?)<\/line>/g;
  const wordRe = /<word ([^>]*)>([^<]*)<\/word>/g;
  for (const [, pa, body] of xhtml.matchAll(pageRe)) {
    const p = attrs(pa);
    const lines = [];
    for (const [, la, lbody] of body.matchAll(lineRe)) {
      const a = attrs(la);
      const words = [...lbody.matchAll(wordRe)].map(([, wa, t]) => {
        const w = attrs(wa);
        return { x0: num(w, 'xMin'), x1: num(w, 'xMax'), text: unescape(t) };
      });
      if (!words.length) continue;
      lines.push({
        x0: num(a, 'xMin'), y0: num(a, 'yMin'), x1: num(a, 'xMax'), y1: num(a, 'yMax'),
        text: words.map((w) => w.text).join(' '),
        words,
      });
    }
    lines.sort((l, m) => l.y0 - m.y0 || l.x0 - m.x0);
    pages.push({ number: pages.length + 1, width: num(p, 'width'), height: num(p, 'height'), lines });
  }
  return pages;
}
