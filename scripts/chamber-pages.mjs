// One HTML source, one page per chamber: /disbursements/ is written once, with
// each chamber's copy marked data-chamber="house" or "senate", and the build
// emits /disbursements/house/ and /disbursements/senate/ from it.
//
// Each page is real HTML for its chamber, not one page that swaps its copy in
// the browser: link previews and answer engines read the HTML without running
// it, so a Senate address served the House's title, description and dek until
// the script ran. The other chamber's elements are removed, not hidden, so
// nothing reads the House's copy on the Senate's page either.
//
// The switch in the kicker is two links marked data-chamber-link; the page's
// own chamber gets aria-current="page", which is also how app.js learns which
// chamber it is on.
import { readFile } from 'node:fs/promises';

// Elements with no closing tag that a data-chamber mark can sit on (the head's
// per-chamber title, meta and link tags).
const VOID = new Set(['meta', 'link', 'input', 'img', 'br', 'hr']);

// The end of the element opened at `start`: the close tag that balances it,
// counting nested elements of the same name.
function closeOf(html, tag, start) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (!depth) return m.index + m[0].length;
  }
  throw new Error(`no </${tag}> closes the element at ${start}`);
}

/**
 * The page for one chamber: every element marked for another chamber removed
 * with its contents (and its line, when it had one to itself), the marks on
 * the kept ones dropped, and the chamber's switch link made current.
 */
export function forkChamber(html, chamber) {
  const open = /<([a-z][a-z0-9]*)\b[^>]*?\sdata-chamber="([a-z]+)"[^>]*>/g;
  let out = html;
  let from = 0;
  for (;;) {
    open.lastIndex = from;
    const m = open.exec(out);
    if (!m) break;
    if (m[2] === chamber) {
      from = m.index + m[0].length;
      continue;
    }
    let start = m.index;
    let end = VOID.has(m[1]) ? start + m[0].length : closeOf(out, m[1], start + m[0].length);
    const lineStart = out.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = out.indexOf('\n', end);
    if (!out.slice(lineStart, start).trim() && lineEnd !== -1 && !out.slice(end, lineEnd).trim()) {
      start = lineStart;
      end = lineEnd + 1;
    }
    out = out.slice(0, start) + out.slice(end);
    from = start;
  }
  out = out.replaceAll(` data-chamber="${chamber}"`, '');
  if (out.includes('data-chamber=')) throw new Error(`a data-chamber mark is left on the ${chamber} page`);
  const link = ` data-chamber-link="${chamber}"`;
  if (out.split(link).length !== 2) throw new Error(`the ${chamber} page needs exactly one${link}`);
  out = out.replace(link, `${link} aria-current="page"`);
  if (out.split('<title').length !== 2) throw new Error(`the ${chamber} page needs exactly one <title>`);
  return out;
}

/**
 * Vite plugin. In the build, the template's page (`<dir>/index.html`) is
 * replaced by `<dir>/<chamber>/index.html` for each chamber, so the template's
 * own address serves nothing and netlify.toml redirects it. In dev, each
 * chamber's address is served from the template the same way.
 */
export function chamberPages({ template, dir, chambers }) {
  const route = new RegExp(`^/${dir}/(${chambers.join('|')})/?$`);
  return {
    name: 'chamber-pages',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url.split('?')[0].match(route);
        if (!m) return next();
        try {
          const raw = await readFile(template, 'utf8');
          const html = await server.transformIndexHtml(`/${dir}/index.html`, raw);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(forkChamber(html, m[1]));
        } catch (err) {
          next(err);
        }
      });
    },
    generateBundle(_, bundle) {
      const name = `${dir}/index.html`;
      const page = bundle[name];
      if (!page) this.error(`${name} is not in the bundle`);
      delete bundle[name];
      for (const chamber of chambers) {
        this.emitFile({ type: 'asset', fileName: `${dir}/${chamber}/index.html`, source: forkChamber(String(page.source), chamber) });
      }
    },
  };
}
