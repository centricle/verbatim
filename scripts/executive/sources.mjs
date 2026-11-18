// The Federal Register's own metadata for presidential documents: executive
// orders and proclamations, one API listing per type. The documents' text is
// not fetched here: it comes from the corpus release (data/corpus/release.jsonl,
// collection `executive`), built from the same API by
// scripts/corpus/import_federal_register.py and build_release.py. This side
// adds what the importer never stored: the order or proclamation number, the
// signing and publication dates, the citation, and FR's disposition notes.
//
// The API needs no key. Results are paged; per_page=1000 is honored, so a full
// pass is a handful of requests.

export const API = 'https://www.federalregister.gov/api/v1/documents.json';

export const TYPES = ['executive_order', 'proclamation'];

export const PER_PAGE = 1000;

// executive_order_notes and disposition_notes have held the same text in
// every document so far; both are fetched so parse.mjs can fail if they ever
// differ. presidential_document_number repeats whichever number is set.
export const FIELDS = [
  'document_number', 'type', 'subtype', 'president', 'title',
  'executive_order_number', 'proclamation_number',
  'signing_date', 'publication_date', 'citation',
  'executive_order_notes', 'disposition_notes',
  'html_url', 'pdf_url', 'correction_of',
];

/** The URL of one listing page. */
export function pageUrl(type, page) {
  const params = new URLSearchParams();
  params.append('conditions[type][]', 'PRESDOCU');
  params.append('conditions[presidential_document_type]', type);
  params.append('per_page', String(PER_PAGE));
  params.append('order', 'oldest');
  params.append('page', String(page));
  for (const f of FIELDS) params.append('fields[]', f);
  return `${API}?${params}`;
}

/** Raw file name for one page, under tmp/executive/raw/. */
export const pageFile = (type, page) => `${type}-p${page}.json`;
