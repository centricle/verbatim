#!/usr/bin/env node
// Build the eFD parser fixtures from PTR pages already fetched into
// tmp/trades/senate/ptr/: each is the page's <main> element as eFD served it,
// with the filer's heading (h2.filedReport, the one place the page prints a
// name) replaced by the fake cast. Every other byte is the page's.
//
//   node scripts/trades/make-efd-fixtures.mjs [--dir <dir of <uuid>.html>]
//
// `expect` is the parser's output at the time the fixture was cut, checked
// then (2026-11-18): deb8df2a and 691f9cb6 against Senate Stock Watcher's
// transcription of the same filings, identical on every field but asset type
// (SSW "Other Securities", eFD "Other"); 07935a4d against 691f9cb6, which it
// restates with #9's amount corrected and a comment added; 21941188's two rows
// read off the page. Regenerating means checking the rows again.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parsePtr } from './parse-senate.mjs';
import { efd } from './sources.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'efd');

// [uuid, what the fixture is for]
export const SPEC = [
  ['21941188-c04d-4713-8e6f-d954918e93fd', '2026 report: ticker cells are links, Joint, Sale (Partial)'],
  ['deb8df2a-b8ef-4f02-ae44-1f3b7168ccc2', 'div.text-muted (coupon, maturity) inside the Asset Name cell'],
  ['691f9cb6-84a2-41c3-b270-63e606869a0d', 'an original, restated by 07935a4d'],
  ['07935a4d-85ec-406f-8c1c-bd951dfd2903', 'Amendment 1 of 691f9cb6: every row again, #9 corrected'],
];
const CAST = 'The Honorable Wile E. Coyote';
const H2 = /(<h2 class="filedReport">)([\s\S]*?)(<\/h2>)/;

function cut(html, uuid) {
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>');
  if (start < 0 || end < start) throw new Error(`${uuid}: no <main>`);
  const main = html.slice(start, end + '</main>'.length);
  const h2 = H2.exec(main);
  if (!h2) throw new Error(`${uuid}: no h2.filedReport`);
  // Surnames are the heading's capitalized words other than the honorific and
  // status; none may survive the replacement anywhere in the page.
  const names = h2[2].replace(/<[^>]*>|[(),.]/g, ' ').split(/\s+/)
    .filter((w) => /^[A-Z][a-z]{2,}/.test(w) && !['The', 'Honorable', 'Former', 'Senator'].includes(w));
  const out = main.replace(H2, `$1\n                ${CAST}\n            $3`);
  const left = names.filter((n) => new RegExp(`\\b${n}\\b`).test(out));
  if (left.length) throw new Error(`${uuid}: ${left.join(', ')} still on the page`);
  return out;
}

const { values } = parseArgs({ options: { dir: { type: 'string' } } });
const source = (uuid) => (values.dir ? resolve(values.dir, `${uuid}.html`) : efd.ptrPath(uuid));

await mkdir(OUT, { recursive: true });
for (const [uuid, why] of SPEC) {
  const html = cut(await readFile(source(uuid), 'utf8'), uuid);
  const expect = parsePtr(html);
  await writeFile(resolve(OUT, `${uuid}.html`), html + '\n');
  await writeFile(resolve(OUT, `${uuid}.json`), JSON.stringify({ uuid, why, expect }, null, 1) + '\n');
  console.log(`${uuid}  ${html.length} bytes, ${expect.rows.length} rows`);
}
