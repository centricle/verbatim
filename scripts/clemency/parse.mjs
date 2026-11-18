// Parse the Office of the Pardon Attorney's recipient pages into one row per
// entry, exactly as listed. Pure: HTML in, rows out (parse.test.mjs).
//
// DOJ has published these lists over several decades, and the markup shows it.
// Seven layouts, read here by one walker:
//
// - Dated rows (Nixon to Reagan): one table, `Date | Name | District`.
// - Headed tables (Bush I to Biden pardons, Trump 2017-2021, Biden): a date
//   heading over a table whose header names the columns. Multi-part values
//   are either `<p>1. ...</p><p>2. ...</p>` in one cell or a rowspan name
//   with continuation rows (Clinton).
// - Label blocks (commutations from Bush I to Obama, some Obama pardons):
//   two-cell rows, a name row then `Offense:`, `District/Date:`,
//   `Sentence:`, `Terms of Grant:`. Dates are rows inside the table or
//   headings outside it.
// - Trump 2025 to present: one page, an `<h3>` per date stating its counts
//   ("May 28, 2025 - 16 Pardons and 6 Commutations"), a table under each.
//   Which row is which type is said only by each row's warrant, whose title
//   names it ("Pardon Warrant - ..."). A heading with no count is followed
//   by a single linked title instead of a table: DOJ lists that grant by
//   its title alone.
// - Group grants (Biden, Dec 12, 2024 and Jan 17, 2025): a `DESCRIPTION`
//   row on the list page, its recipients on a detail page of their own.
//
// Nothing is normalized beyond whitespace. Names, districts, offenses and
// sentences are as DOJ prints them; a multi-part value keeps its parts on
// separate lines. A footnote marked `*` is carried, in DOJ's words, on the
// rows it marks. Anything the walker does not recognize throws: a layout it
// has not seen is a reason to stop, not to guess.
import { parse as parseHtml } from 'node-html-parser';
import speakers from '../corpus/speakers.json' with { type: 'json' };

export const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n) => String(n).padStart(2, '0');

/** 'August 14, 1989', 'JUNE 3, 2016', 'Dec 22, 2000' or '4/17/1970' to 'YYYY-MM-DD'; null if not a date. */
export function parseDate(text) {
  const s = text.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  return null;
}

const BLOCK_TAGS = new Set(['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'table']);

/** Text of a node, with block boundaries as line breaks and whitespace collapsed within lines. */
export function textOf(node) {
  const parts = [];
  (function walk(n) {
    if (n.nodeType === 3) { parts.push(n.text); return; }
    if (n.nodeType !== 1) return;
    const tag = n.rawTagName?.toLowerCase();
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push('\n');
    for (const c of n.childNodes) walk(c);
    if (block) parts.push('\n');
  })(node);
  return parts.join('')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const elements = (node) => node.childNodes.filter((c) => c.nodeType === 1);
const tagOf = (node) => node.rawTagName?.toLowerCase();
const cellsOf = (tr) => elements(tr).filter((c) => ['td', 'th'].includes(tagOf(c)));
const ownRows = (table) => table.querySelectorAll('tr').filter((tr) => tr.closest('table') === table);
const span = (cell, attr) => Math.max(1, parseInt(cell.getAttribute(attr) ?? '1', 10) || 1);

/** The page's content area. */
export function bodyOf(html) {
  const body = parseHtml(html).querySelector('.field_body');
  if (!body) throw new Error('no .field_body on page');
  return body;
}

// Header text to row field. Keys are lowercased, with a trailing `*` and
// spacing removed; the `*` is noted separately, since it marks a footnote.
const HEADER_FIELDS = {
  'date': 'grant_date',
  'name': 'name',
  'name and warrant': 'name',
  'district': 'district',
  'sentenced': 'sentence',
  'sentence': 'sentence',
  'offense': 'offense',
  'offense as listed on the warrant': 'offense',
  'public disclosure': 'disclosure',
  'date sentence began': 'sentence_began',
  'sentence commuted to': 'commuted_to',
  'warrant': 'warrant_label',
  'description': 'description',
};

/** Lowercased header keys if these cell texts are a header row DOJ uses, else null. */
export function headerKeys(texts) {
  const keys = texts.map((t) => t.replace(/\*$/, '').trim().toLowerCase());
  const ok = keys.length && keys.every((k) => k in HEADER_FIELDS) && keys.some((k) => ['name', 'name and warrant', 'description'].includes(k));
  return ok ? keys : null;
}

// Block labels, as `Offense:`, `Offense :`, `Offenses:`, `District/Date:`
// and so on. District/Date carries the district and the date of sentencing
// in one value; it is kept whole, under district.
const LABEL = /^(offenses?|district\/date|district|sentence|terms of grant)\s*:?$/i;
const LABEL_FIELDS = {
  offense: 'offense', offenses: 'offense', 'district/date': 'district', district: 'district',
  sentence: 'sentence', 'terms of grant': 'terms',
};
const labelField = (text) => LABEL_FIELDS[text.replace(/\s*:$/, '').trim().toLowerCase()];

// A numbered part ("1. ", "2.3 months", "1. & 2. District of ...") continues
// the value above it; it never starts an entry.
const PART = /^\d+\.\s*\S/;

const TRUMP_HEADING = /^(.+?\d{4})\s*[-–]\s*(\d+)\s+(Pardons?|Commutations?)(?:\s+and\s+(\d+)\s+(Pardons?|Commutations?))?\s*(\(Amended\))?$/i;
const typeWord = (w) => (/^pardon/i.test(w) ? 'pardon' : 'commutation');

/** Counts a Trump 2025 heading states, or null for a bare date. */
export function headingCounts(text) {
  const m = TRUMP_HEADING.exec(text);
  if (!m) return null;
  const counts = { pardon: 0, commutation: 0 };
  counts[typeWord(m[3])] += Number(m[2]);
  if (m[4]) counts[typeWord(m[5])] += Number(m[4]);
  return { date: parseDate(m[1]), counts };
}

// Warrant titles name the type between spaces ("Pardon Warrant - ...") or
// underscores ("2026-09-03_Pardon_Warrant_..."), so not \b: `_` is a word
// character.
const WARRANT_TYPE = /(?:^|[^a-z])(pardon|commutation)(?![a-z])/i;

/**
 * Walk a page body in document order. Yields headings, links and `*`
 * footnotes outside tables, and tables (not descended into).
 */
function* walk(node) {
  for (const el of elements(node)) {
    const tag = tagOf(el);
    if (tag === 'table') { yield { kind: 'table', node: el }; continue; }
    if (tag === 'h2' || tag === 'h3') { yield { kind: 'heading', text: textOf(el) }; continue; }
    if (tag === 'a') {
      yield { kind: 'link', text: textOf(el), href: el.getAttribute('href') ?? '', title: el.getAttribute('title') ?? '' };
      continue;
    }
    if ((tag === 'p' || tag === 'div') && /^\*/.test(textOf(el)) && !el.querySelector('table')) {
      yield { kind: 'star', text: textOf(el) };
      continue;
    }
    yield* walk(el);
  }
}

/**
 * Parse one page.
 * @param {string} html
 * @param {{ slug: string, url: string, president: string, type: string|null, layout: string }} source
 * @returns {{ entries: object[], groups: object[], headings: object[] }}
 *   entries: one per listed entry, in page order;
 *   groups: Biden-style DESCRIPTION rows (their recipients are on detail pages);
 *   headings: Trump 2025 headings with their stated counts, for check.
 */
export function parsePage(html, source) {
  const entries = [];
  const groups = [];
  const headings = [];
  let section = null;

  const open = (heading, date) => {
    close();
    section = { heading, date, links: [], stars: [], entries: [], starTables: [], counts: null, bare: false };
    if (source.layout === 'trump-2025') {
      const hc = headingCounts(heading);
      if (hc) {
        section.counts = hc.counts;
        section.date = hc.date;
        headings.push({ heading, date: hc.date, counts: hc.counts, entries: section.entries });
      } else if (date) {
        section.bare = true;
      }
    }
  };

  // A `*` footnote marks the entries whose name ends in `*`, every row of a
  // table whose header carries a `*`, and a group link whose text does.
  const close = () => {
    if (!section) return;
    for (const star of section.stars) {
      for (const e of section.entries) {
        if (/\*\s*$/.test(e.name ?? '') || section.starTables.includes(e._table)) addNote(e, star);
      }
      for (const g of groups.filter((x) => x._section === section)) {
        for (const l of g.links) if (/\*$/.test(l.text)) l.note = l.note ? `${l.note}\n${star}` : star;
      }
    }
    section = null;
  };

  const emit = (fields) => {
    const s = section ?? (open('', null), section);
    const entry = {
      page: source.slug,
      president: source.president,
      term: source.term,
      type: source.type,
      kind: 'entry',
      grant_date: s.date,
      heading: s.heading || null,
      name: null, district: null, sentence: null, offense: null, terms: null,
      sentence_began: null, commuted_to: null,
      warrant_url: null, warrant_label: null,
      group_description: null, note: null, fr_document_number: null,
      ...fields,
    };
    entry.position = entries.length + 1;
    entry.section_position = s.entries.length + 1;
    entries.push(entry);
    s.entries.push(entry);
    return entry;
  };

  for (const ev of walk(bodyOf(html))) {
    if (ev.kind === 'heading') {
      open(ev.text, parseDate(ev.text) ?? headingCounts(ev.text)?.date ?? null);
    } else if (ev.kind === 'link') {
      if (!section || ev.href.startsWith('#')) continue;
      if (section.bare) {
        // Trump 2025: a dated heading with no count, then one linked title.
        emit({ kind: 'title', type: null, name: ev.text, warrant_url: absolute(ev.href) });
        section.bare = false;
      } else if (/warrant|clemency records/i.test(ev.text)) {
        section.links.push({ text: ev.text, href: absolute(ev.href) });
      }
    } else if (ev.kind === 'star') {
      if (!section) open('', null);
      section.stars.push(ev.text);
    } else if (ev.kind === 'table') {
      parseTable(ev.node);
    }
  }
  close();

  function parseTable(table) {
    const rows = ownRows(table);
    if (!rows.length) return;
    const first = cellsOf(rows[0]).map((c) => textOf(c));
    const keys = headerKeys(first);

    if (keys) {
      if (!section) open('', null);
      if (keys[0] === 'description') return parseGroup(rows, keys);
      if (first.some((t) => /\*$/.test(t))) section.starTables.push(table);
      return parseHeaded(table, rows, keys.map((k) => HEADER_FIELDS[k]));
    }
    if (rows.some((tr) => { const c = cellsOf(tr); return c.length === 2 && LABEL.test(textOf(c[0])); })) {
      return parseBlocks(rows);
    }
    if (rows.length === 1 && /^\*/.test(textOf(rows[0]))) {
      if (!section) open('', null);
      section.stars.push(textOf(rows[0]));
      return;
    }
    throw new Error(`${source.slug}: unrecognized table starting "${first.join(' | ').slice(0, 120)}"`);
  }

  function parseGroup(rows) {
    for (const tr of rows.slice(1)) {
      const [desc, links] = cellsOf(tr);
      groups.push({
        date: section.date,
        heading: section.heading,
        description: textOf(desc),
        // "Warrant 2</a>*": the footnote mark can sit just outside the link.
        links: links.querySelectorAll('a').map((a) => ({
          text: /^\*/.test(a.nextSibling?.text ?? '') ? `${textOf(a)}*` : textOf(a),
          href: absolute(a.getAttribute('href') ?? ''),
        })),
        _section: section,
      });
    }
  }

  function parseHeaded(table, rows, fields) {
    const pending = fields.map(() => 0);
    let current = null;
    for (const tr of rows.slice(1)) {
      const cells = cellsOf(tr);
      if (!cells.length || !textOf(tr)) continue;
      // Lay the row's cells out over the header's columns, honoring rowspan
      // from rows above and colspan within this one.
      const laid = [];
      let ci = 0;
      for (let col = 0; col < fields.length; col++) {
        if (pending[col] > 0) { pending[col]--; laid[col] = { spanned: true }; continue; }
        const cell = cells[ci++];
        if (!cell) { laid[col] = { text: '' }; continue; }
        const rs = span(cell, 'rowspan');
        if (rs > 1) pending[col] = rs - 1;
        laid[col] = { text: textOf(cell), cell };
        for (let k = 1; k < span(cell, 'colspan') && col + 1 < fields.length; k++) laid[++col] = { text: '', covered: true };
      }
      if (ci < cells.length) throw new Error(`${source.slug}: row has more cells than its header: "${textOf(tr).slice(0, 80)}"`);

      const nameCol = fields.indexOf('name');
      if (laid[nameCol].spanned) {
        // Continuation of a rowspan entry: each part joins its column.
        for (const [col, f] of fields.entries()) {
          const v = laid[col];
          if (v.spanned || !v.text || f === 'disclosure') continue;
          current[f] = current[f] ? `${current[f]}\n${v.text}` : v.text;
        }
        continue;
      }

      const row = {};
      for (const [col, f] of fields.entries()) {
        const v = laid[col];
        if (f === 'disclosure') {
          const a = v.cell?.querySelector('a');
          if (a) row.warrant_url = absolute(a.getAttribute('href') ?? ''), row.warrant_label = textOf(a);
          else if (v.text) row._disclosure = v.text;
          continue;
        }
        if (f === 'grant_date') { row.grant_date = parseDate(v.text); row._date_text = v.text; continue; }
        row[f] = v.text || null;
        if (f === 'name' && v.cell) {
          const a = v.cell.querySelector('a');
          if (a) { row.warrant_url = absolute(a.getAttribute('href') ?? ''); row._warrant_title = a.getAttribute('title') ?? ''; }
        }
      }
      if (fields.includes('grant_date') && !row.grant_date) {
        throw new Error(`${source.slug}: unreadable date "${row._date_text}"`);
      }
      // No per-row warrant: DOJ points at the heading's own download link
      // ("See above download", or no disclosure column at all).
      if (!row.warrant_url && section.links.length) {
        const l = section.links[section.links.length - 1];
        row.warrant_url = l.href;
        row.warrant_label = l.text;
      }
      if (source.layout === 'trump-2025') row.type = trumpType(row);
      const { _date_text, _disclosure, _warrant_title, ...clean } = row;
      current = emit(clean);
      current._table = table;
      current._warrant_title = _warrant_title;
    }
  }

  function trumpType(row) {
    const counts = section.counts;
    if (!counts) throw new Error(`${source.slug}: table under heading without counts: "${section.heading}"`);
    const named = WARRANT_TYPE.exec(row._warrant_title ?? '')?.[1]?.toLowerCase() ?? null;
    if (counts.pardon && counts.commutation) {
      if (!named) throw new Error(`${source.slug}: mixed heading "${section.heading}" and no type in warrant title for "${row.name}"`);
      return named;
    }
    return counts.pardon ? 'pardon' : 'commutation';
  }

  function parseBlocks(rows) {
    let current = null;
    let field = null;
    for (const tr of rows) {
      const cells = cellsOf(tr);
      if (cells.length === 1) {
        const text = textOf(cells[0]);
        if (!text) continue;
        const date = parseDate(text.split('\n')[0]);
        if (date) {
          open(text.split('\n')[0], date);
          for (const a of cells[0].querySelectorAll('a')) {
            if (/warrant|clemency records/i.test(textOf(a))) section.links.push({ text: textOf(a), href: absolute(a.getAttribute('href') ?? '') });
          }
        } else {
          current = startEntry(text);
          field = null;
        }
        continue;
      }
      if (cells.length !== 2) throw new Error(`${source.slug}: block row with ${cells.length} cells: "${textOf(tr).slice(0, 80)}"`);
      const a = textOf(cells[0]);
      const b = textOf(cells[1]);
      if (a) {
        if (!LABEL.test(a)) throw new Error(`${source.slug}: unknown block label "${a}"`);
        if (!current) throw new Error(`${source.slug}: label "${a}" before any name`);
        field = labelField(a);
        if (b) current[field] = current[field] ? `${current[field]}\n${b}` : b;
        continue;
      }
      if (!b) { field = null; continue; }
      if (LABEL.test(b)) {
        // The label printed in the value column, its value on the rows below.
        if (!current) throw new Error(`${source.slug}: label "${b}" before any name`);
        field = labelField(b);
        continue;
      }
      if (PART.test(b) && current && field) {
        current[field] = current[field] ? `${current[field]}\n${b}` : b;
        continue;
      }
      current = startEntry(b);
      field = null;
    }
  }

  function startEntry(name) {
    if (!section) throw new Error(`${source.slug}: entry "${name}" before any date`);
    const fields = { name };
    if (section.links.length) {
      const l = section.links[section.links.length - 1];
      fields.warrant_url = l.href;
      fields.warrant_label = l.text;
    }
    return emit(fields);
  }

  for (const e of entries) {
    e.source_ref = `${source.url} | ${e.heading ?? 'no heading'} | entry ${e.section_position}`;
  }
  return { entries, groups, headings };
}

function addNote(entry, text) {
  entry.note = entry.note ? `${entry.note}\n${text}` : text;
}

/** Resolve a DOJ link against www.justice.gov. */
export function absolute(href) {
  if (!href) return null;
  return new URL(href, 'https://www.justice.gov/').href;
}

/**
 * Parse every page and join the group detail pages to the group rows that
 * point at them. The group rows themselves are not entries: their
 * recipients are, once each, from the detail page.
 *
 * @param {{ source: object, html: string }[]} files
 * @param {{ entry: { page: string, grant_date: string, name: string }, fr: { document_number: string } }[]} frLinks
 */
export function build(files, frLinks = []) {
  const pages = files.map(({ source, html }) => ({ source, ...parsePage(html, source) }));
  const groups = pages.flatMap((p) => p.groups);

  for (const p of pages.filter((x) => x.source.layout === 'group-detail')) {
    const group = groups.find((g) => g.links.some((l) => l.href === p.source.url));
    if (!group) throw new Error(`${p.source.slug}: no group row links to this page`);
    const warrants = group.links.filter((l) => !/recipient details/i.test(l.text));
    for (const e of p.entries) {
      e.grant_date = group.date;
      e.group_description = group.description;
      e.heading = group.heading;
      let w = warrants.length === 1 ? warrants[0] : null;
      if (e.warrant_label) {
        w = warrants.find((l) => l.text.replace(/\*$/, '').trim() === e.warrant_label.trim());
        if (!w) throw new Error(`${p.source.slug}: "${e.warrant_label}" matches no warrant on the group row`);
      }
      if (!w) throw new Error(`${p.source.slug}: no single warrant for "${e.name}"`);
      e.warrant_url = w.href;
      if (!e.warrant_label) e.warrant_label = w.text;
      if (w.note) addNote(e, w.note);
    }
  }

  const rows = pages.flatMap((p) => p.entries);
  for (const link of frLinks) {
    const hits = rows.filter((r) => r.page === link.entry.page && r.grant_date === link.entry.grant_date && r.name === link.entry.name);
    if (hits.length !== 1) throw new Error(`fr-links: ${link.entry.name} (${link.entry.grant_date}) matches ${hits.length} entries`);
    hits[0].fr_document_number = link.fr.document_number;
  }

  for (const r of rows) {
    r.id = `${r.page}:${r.position}`;
    r.president_name = speakers[r.president]?.name;
    if (!r.president_name) throw new Error(`no speakers.json name for ${r.president}`);
    r.grant_year = Number(r.grant_date.slice(0, 4));
    delete r._table;
    delete r._warrant_title;
    delete r.section_position;
  }
  return { rows, pages, groups };
}
