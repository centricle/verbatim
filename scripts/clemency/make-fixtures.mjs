#!/usr/bin/env node
// Build the test fixtures from pages already fetched into tmp/clemency/raw/:
// each one a real page trimmed to a few entries per kept section, with every
// recipient's name replaced by the fake cast. The markup is otherwise left as
// DOJ wrote it, quirks included: that is what the tests are for.
//
//   node scripts/clemency/make-fixtures.mjs
//
// Headings that state counts, and group rows that state a number of
// individuals, are rewritten to match what the trim kept, so check.mjs holds
// on the fixtures as it does on the full pages.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseHtml } from 'node-html-parser';
import { PAGES } from './sources.mjs';
import { textOf, parseDate, headingCounts, headerKeys } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, '../../tmp/clemency/raw');
const OUT = resolve(HERE, 'fixtures');

// Surname, given name. Ralph Wolf is the alias: the near-double who must not
// be folded into the name before him.
const CAST = [
  ['Coyote', 'Wile E.'], ['Runner', 'Road'], ['Bunny', 'Bugs'], ['Duck', 'Daffy'],
  ['Acme', 'Marvin Q.'], ['Sheepdog', 'Sam'],
];
const ALIAS = 'Ralph Wolf';

const SPEC = [
  { out: 'dated-rows.html', slug: 'pardons-granted-president-jimmy-carter-1977-1981', per: 3, also: [/Popillo/] },
  { out: 'headed-tables.html', slug: 'pardons-granted-president-william-j-clinton-1993-2001', sections: [/^November 23, 1994/, /^April 17, 1995/], per: 3, also: [/McKinney/] },
  {
    out: 'headed-disclosure.html', slug: 'commutations-granted-president-joseph-biden-2021-2025',
    sections: [/^April 25, 2022/, /^April 26, 2022/, /^June 13, 2022/, /^December 12, 2024/, /^December 23, 2024/, /^January 17, 2025/, /^January 19, 2025/],
    per: 2, also: [/Krambeck/, /Peltier/],
  },
  {
    out: 'blocks.html', slug: 'commutations-granted-president-barack-h-obama-2009-2017',
    sections: [/^January 19, 2017/, /^January 17, 2017/, /^October 27, 2016/, /^August 3, 2016/, /^JULY 13, 2015/, /^DECEMBER 17, 2014/],
    per: 2, also: [/Lopez-Rivera/, /Bourgeois/, /Sedillo Gutierrez/, /Arnold Ray Jones/, /Lindsay, II/, /Jamel Washington/],
  },
  {
    out: 'mixed.html', slug: 'pardons-granted-president-barack-h-obama-2009-2017',
    sections: [/^January 17, 2017/, /^January 16, 2016/, /^December 18, 2015/], per: 2, also: [/Mitchell Ray Campbell/],
  },
  {
    out: 'trump-2025.html', slug: 'clemency-grants-president-donald-j-trump-2025-present',
    sections: [/^January 20, 2025$/, /^January 21, 2025/, /^May 28, 2025/, /^November 7, 2025/, /^June 4, 2026/, /^September 3, 2026/],
    per: 2, also: [/Duran/, /Hoover/, /Bloom/],
  },
  { out: 'detail-2024-12-12.html', slug: 'december-12-2024-commutation-recipients', per: 2 },
  { out: 'detail-2025-01-17.html', slug: 'january-17-2025-commutation-recipients', per: 0, also: [/Warrant 1/, /Warrant 2/, /Warrant 3/], firstOnly: true },
];

const cells = (tr) => tr.childNodes.filter((c) => c.nodeType === 1 && ['td', 'th'].includes(c.rawTagName?.toLowerCase()));
const isHeaderRow = (tr) => !!headerKeys(cells(tr).map((c) => textOf(c)));
const LABEL = /^(offenses?|district\/date|district|sentence|terms of grant)\s*:?$/i;

// Which rows start an entry, by the rule check.mjs's raw scan uses.
function startsEntry(tr, kind) {
  const c = cells(tr).map((x) => textOf(x));
  if (kind === 'headed') return c.length > 1 && !!c.join('') && !tr.innerHTML.includes('rowspan') ? true : c.length > 1 && !!c.join('');
  if (c.length === 1) return !!c[0] && !parseDate(c[0].split('\n')[0]);
  return c.length === 2 && !c[0] && !!c[1] && !/^\d+\.\s*\S/.test(c[1]) && !LABEL.test(c[1]);
}
const isDateRow = (tr) => { const c = cells(tr); return c.length === 1 && !!parseDate(textOf(c[0]).split('\n')[0]); };

// Entries kept so far, per section: a section can span several tables
// (later Obama commutations put each entry in a table of its own).
function trimTable(table, spec, keepSection, sectionOf, keptBy) {
  const rows = table.querySelectorAll('tr').filter((tr) => tr.closest('table') === table);
  const header = rows.length && isHeaderRow(rows[0]) ? rows[0] : null;
  const kind = header ? 'headed' : 'blocks';
  let section = sectionOf();
  let keepingEntry = false;
  let pendingSpan = 0;
  for (const tr of rows) {
    if (tr === header) continue;
    if (kind === 'blocks' && isDateRow(tr)) {
      section = textOf(cells(tr)[0]).split('\n')[0];
      keepingEntry = false;
      if (!keepSection(section)) tr.remove();
      continue;
    }
    const continuation = kind === 'headed' ? pendingSpan > 0 : !startsEntry(tr, kind);
    if (kind === 'headed') {
      if (pendingSpan > 0) pendingSpan--;
      const spans = [...tr.innerHTML.matchAll(/rowspan\s*=\s*"?(\d+)/gi)].map((m) => Number(m[1]));
      if (!continuation && spans.length) pendingSpan = Math.max(...spans) - 1;
    }
    if (!continuation) {
      const text = textOf(tr);
      const kept = keptBy.get(section) ?? 0;
      keepingEntry = keepSection(section) && (kept < spec.per || (spec.also ?? []).some((re) => re.test(text)));
      if (keepingEntry) keptBy.set(section, kept + 1);
    }
    if (!keepingEntry) tr.remove();
  }
  if (spec.firstOnly) {
    // Detail page: one row per warrant.
    const seen = new Set();
    for (const tr of table.querySelectorAll('tr').slice(1)) {
      const w = textOf(cells(tr).at(-1));
      if (seen.has(w)) tr.remove(); else seen.add(w);
    }
  }
}

function trimPage(html, spec) {
  const root = parseHtml(html);
  const body = root.querySelector('.field_body');
  const keepSection = (h) => !spec.sections || spec.sections.some((re) => re.test(h ?? ''));
  let current = null;
  const keptBy = new Map();
  const walk = (node) => {
    for (const el of [...node.childNodes]) {
      if (el.nodeType !== 1) continue;
      const tag = el.rawTagName.toLowerCase();
      if (tag === 'h2' || tag === 'h3') {
        current = textOf(el);
        if (!keepSection(current)) el.remove();
        continue;
      }
      if (tag === 'table') {
        // A one-row `*` footnote table goes with its section, whole.
        const own = el.querySelectorAll('tr');
        if (own.length === 1 && textOf(own[0]).startsWith('*')) {
          if (!keepSection(current)) el.remove();
          continue;
        }
        // A table whose own rows carry dates decides section by section.
        const hasDates = el.querySelectorAll('tr').some(isDateRow);
        if (!hasDates && !keepSection(current)) { el.remove(); continue; }
        trimTable(el, spec, keepSection, () => current, keptBy);
        continue;
      }
      if (el.querySelector('h2, h3, table')) { walk(el); continue; }
      if (current !== null && !keepSection(current)) el.remove();
    }
  };
  walk(body);
  return { root, body };
}

function anonymize(body, layout) {
  const names = new Map();
  const castFor = (original) => {
    const key = original.replace(/\s+/g, ' ').trim();
    if (!names.has(key)) names.set(key, CAST[names.size % CAST.length]);
    return names.get(key);
  };
  const format = (original, [last, first]) => {
    const star = /(\s*\*.*)$/s.exec(original)?.[1] ?? '';
    const alias = /\b(aka|fka|nka)\b/i.test(original) ? `, aka ${ALIAS}` : '';
    if (/^[A-Z'-]{2,}, /.test(original)) return `${last.toUpperCase()}, ${first}${alias}${star}`;
    if (/^[A-Za-z'-]+, /.test(original)) return `${last}, ${first}${alias}${star}`;
    return `${first} ${last}${alias}${star}`;
  };
  const rename = (cell) => {
    const original = textOf(cell);
    if (!original) return;
    const cast = castFor(original.replace(/\s*\*.*$/s, '').replace(/,?\s*\b(aka|fka|nka)\b.*$/is, ''));
    const replacement = format(original, cast);
    const texts = [];
    (function collect(n) { for (const c of n.childNodes) { if (c.nodeType === 3) texts.push(c); else collect(c); } })(cell);
    const firstText = texts.find((t) => t.text.trim());
    for (const t of texts) t.textContent = t === firstText ? replacement : (t.text.trim() ? '' : t.text);
    for (const a of cell.querySelectorAll('a')) {
      const title = a.getAttribute('title');
      if (title) {
        const type = /commutation/i.test(title) ? 'Commutation' : 'Pardon';
        a.setAttribute('title', `${type}_Warrant_${cast[0]}`);
      }
      const href = a.getAttribute('href') ?? '';
      if (/whitehouse\.gov/.test(href)) a.setAttribute('href', href.replace(/[^/]+\/?$/, `granting-pardon-to-${cast[1].toLowerCase().replace(/[^a-z]+/g, '-')}-${cast[0].toLowerCase()}/`));
    }
  };

  for (const table of body.querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr');
    if (!rows.length) continue;
    const head = cells(rows[0]).map((c) => textOf(c).replace(/\*$/, '').trim().toLowerCase());
    const nameCol = head.findIndex((h) => h === 'name' || h === 'name and warrant');
    if (head[0] === 'description') continue;
    if (nameCol >= 0) {
      let pending = 0;
      for (const tr of rows.slice(1)) {
        const c = cells(tr);
        if (pending > 0) { pending--; continue; }
        const spans = [...tr.innerHTML.matchAll(/rowspan\s*=\s*"?(\d+)/gi)].map((m) => Number(m[1]));
        if (spans.length) pending = Math.max(...spans) - 1;
        if (c[nameCol]) rename(c[nameCol]);
      }
      continue;
    }
    for (const tr of rows) {
      const c = cells(tr);
      if (c.length === 1 && textOf(c[0]) && !parseDate(textOf(c[0]).split('\n')[0]) && !textOf(c[0]).startsWith('*')) rename(c[0]);
      else if (c.length === 2 && startsEntry(tr, 'blocks')) rename(c[1]);
    }
  }
  if (layout === 'trump-2025') {
    // A name in a Trump 2025 table is the warrant link.
    for (const a of body.querySelectorAll('table a')) if (/warrant/i.test(a.getAttribute('title') ?? '') && !a.getAttribute('title').includes('_Warrant_')) rename(a.parentNode);
  }
}

// Rewrite stated counts to what the trim kept.
function restate(body, layout) {
  if (layout === 'trump-2025') {
    for (const h3 of body.querySelectorAll('h3')) {
      const hc = headingCounts(textOf(h3));
      if (!hc) continue;
      let table = h3.nextElementSibling;
      while (table && table.rawTagName.toLowerCase() !== 'table' && !table.querySelector('table')) table = table.nextElementSibling;
      if (table && table.rawTagName.toLowerCase() !== 'table') table = table.querySelector('table');
      // One type: every row is that type. Both: the warrant titles say which.
      const dataRows = table ? table.querySelectorAll('tr').filter((tr) => cells(tr).some((c) => c.rawTagName.toLowerCase() === 'td')) : [];
      const titles = dataRows.map((tr) => tr.querySelector('a')?.getAttribute('title') ?? '');
      const n = hc.counts.pardon && hc.counts.commutation
        ? { pardon: titles.filter((t) => /pardon/i.test(t)).length, commutation: titles.filter((t) => /commutation/i.test(t)).length }
        : { pardon: hc.counts.pardon ? dataRows.length : 0, commutation: hc.counts.commutation ? dataRows.length : 0 };
      const word = (k, v) => `${v} ${k === 'pardon' ? 'Pardon' : 'Commutation'}${v === 1 ? '' : 's'}`;
      const dash = /–/.test(textOf(h3)) ? '–' : '-';
      const parts = ['pardon', 'commutation'].filter((k) => hc.counts[k]).map((k) => word(k, n[k]));
      const date = textOf(h3).split(/\s+[-–]\s+/)[0];
      const amended = /\(Amended\)/.test(textOf(h3)) ? ' (Amended)' : '';
      h3.set_content(`${date} ${dash} ${parts.join(' and ')}${amended}`);
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const detailCounts = {};
  for (const spec of SPEC.filter((s) => s.slug.endsWith('recipients'))) {
    const source = PAGES.find((p) => p.slug === spec.slug);
    const { root, body } = trimPage(await readFile(resolve(RAW, source.file), 'utf8'), spec);
    anonymize(body, source.layout);
    detailCounts[source.url] = body.querySelectorAll('table tr').length - 1;
    await writeFile(resolve(OUT, spec.out), fixtureHtml(root, body));
  }
  for (const spec of SPEC.filter((s) => !s.slug.endsWith('recipients'))) {
    const source = PAGES.find((p) => p.slug === spec.slug);
    const { root, body } = trimPage(await readFile(resolve(RAW, source.file), 'utf8'), spec);
    anonymize(body, source.layout);
    restate(body, source.layout);
    // Group rows state how many their detail page lists.
    for (const td of body.querySelectorAll('td')) {
      const link = td.parentNode.querySelectorAll('a').find((a) => detailCounts[new URL(a.getAttribute('href') ?? '', 'https://www.justice.gov/').href]);
      if (link && /granted to [\d,]+ individuals/i.test(textOf(td))) {
        td.set_content(textOf(td).replace(/[\d,]+ individuals/, `${detailCounts[new URL(link.getAttribute('href'), 'https://www.justice.gov/').href]} individuals`));
      }
    }
    await writeFile(resolve(OUT, spec.out), fixtureHtml(root, body));
  }
  console.log(`wrote ${SPEC.length} fixtures to ${OUT}`);
}

// Only the content area is kept: the page's navigation, scripts and footer
// are not what the parser reads.
function fixtureHtml(root, body) {
  const title = root.querySelector('title')?.text ?? '';
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title></head><body>\n<div class="${body.getAttribute('class')}">${body.innerHTML}</div>\n</body></html>\n`;
}

await main();
