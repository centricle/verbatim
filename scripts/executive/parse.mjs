// Joins the corpus release's Federal Register records to FR's own metadata,
// and parses FR's disposition notes. Pure: data in, rows out, so the tests
// need no database, no network and no file system.
//
// The join key is the FR document number in each record's source_url
// (federalregister.gov/documents/YYYY/MM/DD/<document number>/<slug>). The
// release's `fr_doc` field is read from the text's own footer, which can
// differ (one footer prints 97-26440 for document 97-26440-2), so it is
// reported, never joined on. EO and proclamation numbers are not keys either:
// reprints and corrections repeat them, and some documents have none.
//
// Every value is FR's or the release's as published. Nothing is cleaned:
// a note's typos, a missing signing date and FR's title all load as they are.

/** The FR document number in a federalregister.gov document URL, or null. */
export function documentNumberFromUrl(url) {
  const m = /^https:\/\/www\.federalregister\.gov\/documents\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\//.exec(url ?? '');
  return m ? m[1] : null;
}

/** The document number at the end of an API document URL (`correction_of`). */
export function documentNumberFromApiUrl(url) {
  const m = /\/api\/v1\/documents\/([^/?#]+)$/.exec(url ?? '');
  return m ? m[1] : null;
}

/**
 * Every document in the raw listing pages, each tagged with the listing it
 * came from. A document number listed twice throws: it would make the join
 * ambiguous.
 * @param {{ type: string, json: { results?: object[] } }[]} pages
 */
export function frDocuments(pages) {
  const docs = [];
  const seen = new Set();
  for (const { type, json } of pages) {
    for (const doc of json.results ?? []) {
      if (seen.has(doc.document_number)) throw new Error(`FR lists ${doc.document_number} twice`);
      seen.add(doc.document_number);
      docs.push({ ...doc, listing: type });
    }
  }
  return docs;
}

// ---- Disposition notes ----------------------------------------------------
//
// FR writes a note as relations, one per line or several on a line, each a
// label and a colon followed by references separated by semicolons:
//
//   Revokes: EO 13771, January 30, 2017; EO 13777, February 24, 2017
//   See: EO 13807, August 15, 2017; Revoked by: EO 13990, January 20, 2021
//
// The grammar is loose in practice: 37 distinct labels (typos included),
// stray semicolons, a line with no label, two references with no semicolon
// between them. So the parser keeps every label exactly as printed, keeps
// every reference's text exactly as printed, and only adds structure on top:
// a reference that opens with an EO or proclamation number is marked with
// that number and its date, so the record view can link it. Anything the
// parser cannot place is kept in place and reported (`irregularities`), never
// dropped. `renderNotes` puts a parse back together; the check holds it
// against FR's string.

const LABEL = /^([A-Za-z][A-Za-z ()]{0,58}?)\s*:\s*(.*)$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DATE = `(${MONTHS.join('|')}) (\\d{1,2}), (\\d{4})`;
const EO_REF = new RegExp(`^(?:EO|Executive Order)\\s+(\\d+(?:-[A-Z])?)\\b(?:,?\\s+(?:of\\s+)?${DATE})?`);
const PROC_REF = new RegExp(`^(?:Proc\\.|Proclamation)\\s+(\\d+)\\b(?:,?\\s+(?:of\\s+)?${DATE})?`);

function isoDate(month, day, year) {
  if (!month) return null;
  const m = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
  return `${year}-${m}-${String(day).padStart(2, '0')}`;
}

function reference(text) {
  for (const [kind, re] of [['eo', EO_REF], ['proclamation', PROC_REF]]) {
    const m = re.exec(text);
    if (m) return { kind, number: m[1], date: isoDate(m[2], m[3], m[4]), text };
  }
  return { kind: 'text', number: null, date: null, text };
}

/**
 * @param {string} text  FR's note, as published
 * @returns {{ relation: string|null, refs: { kind: string, number: string|null, date: string|null, text: string }[] }[]}
 *   `relation` is the label as printed, or null for references with no label
 *   before them on their line.
 */
export function parseNotes(text) {
  const relations = [];
  for (const line of String(text).split(/\r\n|\r|\n/)) {
    let current = null; // a new line starts a new relation
    for (const piece of line.split(';')) {
      const segment = piece.trim();
      if (!segment) continue;
      const m = LABEL.exec(segment);
      if (m) {
        current = { relation: m[1].trim(), refs: [] };
        relations.push(current);
        if (m[2].trim()) current.refs.push(reference(m[2].trim()));
      } else {
        if (!current) {
          current = { relation: null, refs: [] };
          relations.push(current);
        }
        current.refs.push(reference(segment));
      }
    }
  }
  return relations;
}

/** A parse put back together: one relation per line, references joined by "; ". */
export function renderNotes(relations) {
  return relations
    .map((r) => (r.relation === null ? '' : `${r.relation}: `) + r.refs.map((x) => x.text).join('; '))
    .join('\n');
}

/**
 * The comparable form of a note: whitespace collapsed, and every run of
 * semicolons and line breaks read as one separator, since FR uses both
 * between relations and doubles them at random.
 */
export function normalizeNotes(text) {
  return String(text)
    .replace(/\s*:\s*/g, ': ')
    .replace(/[\s;]*[;\r\n][\s;]*/g, '|')
    .replace(/\s+/g, ' ')
    .replace(/^\|+|\|+$/g, '')
    .trim();
}

/**
 * What the parser kept but could not place, one line each: references on a
 * line with no label before them. (A reference that mentions a second order,
 * "EO 12965 is nullified ... by EO 13138", is not one: the record view links
 * every order a reference names, MENTION below.)
 */
export function irregularities(relations) {
  return relations
    .filter((r) => r.relation === null)
    .map((r) => `no label: ${r.refs.map((x) => x.text).join('; ')}`);
}

// Every order or proclamation a note names, wherever it sits in a reference.
// db/executive.sql resolves the same pattern against the table, and the
// record view links what it resolves. "EEO 13218" (FR's typo) is not matched.
export const MENTION = /\b(EO|Executive Order|Proc\.|Proclamation)\s+(\d+)\b/g;

// ---- Rows -------------------------------------------------------------------

// Every column the loader writes, with its Postgres type. db/executive.sql
// declares the same columns; `tsv` is generated there.
export const LOAD_COLUMNS = [
  ['id', 'text'],
  ['document_number', 'text'],
  ['type', 'text'],
  ['number', 'text'],
  ['president', 'text'],
  ['president_name', 'text'],
  ['signing_date', 'date'],
  ['publication_date', 'date'],
  ['citation', 'text'],
  ['title', 'text'],
  ['html_url', 'text'],
  ['pdf_url', 'text'],
  ['correction_of', 'text'],
  ['notes', 'text'],
  ['notes_parsed', 'jsonb'],
  ['text', 'text'],
];
export const COLUMNS = LOAD_COLUMNS.map(([name]) => name);

const blank = (s) => s == null || String(s).trim() === '';

/**
 * @param {object[]} records  the release, every collection (parseRelease)
 * @param {object[]} docs     frDocuments of the raw pages
 * @returns {{ rows: object[], unjoined: object[], frOnly: object[],
 *             frDocDiffers: object[], conflicts: string[] }}
 *   rows: one per joined executive record. unjoined: executive records FR
 *   does not list. frOnly: FR documents the release does not hold.
 *   frDocDiffers: records whose footer number is not their URL's.
 *   conflicts: anything that makes the join untrustworthy; the check fails
 *   on any.
 */
export function buildRows(records, docs) {
  const byNumber = new Map(docs.map((d) => [d.document_number, d]));
  const used = new Map();
  const rows = [];
  const unjoined = [];
  const frDocDiffers = [];
  const conflicts = [];

  for (const r of records) {
    if (r.collection !== 'executive') continue;
    const key = documentNumberFromUrl(r.source_url);
    const d = key && byNumber.get(key);
    if (!d) {
      unjoined.push({ id: r.id, title: r.title, source_url: r.source_url });
      continue;
    }
    if (used.has(key)) conflicts.push(`${key}: joined by two records, ${used.get(key)} and ${r.id}`);
    used.set(key, r.id);
    if (r.fr_doc !== key) frDocDiffers.push({ id: r.id, fr_doc: r.fr_doc, document_number: key });
    if (d.listing !== r.type) conflicts.push(`${key}: FR lists it as ${d.listing}, the release as ${r.type}`);
    if ((d.executive_order_notes ?? null) !== (d.disposition_notes ?? null)) {
      conflicts.push(`${key}: executive_order_notes and disposition_notes differ`);
    }
    const notes = blank(d.disposition_notes) ? null : d.disposition_notes;
    rows.push({
      id: r.id,
      document_number: key,
      type: r.type,
      number: d.executive_order_number ?? d.proclamation_number ?? null,
      president: r.speaker,
      president_name: r.speaker_name,
      signing_date: d.signing_date ?? null,
      publication_date: d.publication_date,
      citation: d.citation ?? null,
      title: d.title,
      html_url: d.html_url,
      pdf_url: d.pdf_url ?? null,
      correction_of: documentNumberFromApiUrl(d.correction_of),
      notes,
      notes_parsed: notes === null ? null : parseNotes(notes),
      text: r.text,
    });
  }

  const frOnly = docs
    .filter((d) => !used.has(d.document_number))
    .map((d) => ({ document_number: d.document_number, listing: d.listing, title: d.title, signing_date: d.signing_date ?? null }));
  return { rows, unjoined, frOnly, frDocDiffers, conflicts };
}
