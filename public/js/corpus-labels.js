// Labels for the corpus release's values, shared by /corpus/ and
// /corpus/contents/. A value missing here prints as itself, sentence-cased,
// rather than not at all (label()).

export const GENRES = {
  speech: 'Speech', writing: 'Writing', letter: 'Letter', document: 'Document',
  opinion: 'Opinion', statement: 'Statement', executive_action: 'Executive action',
  press_conference: 'Press conference', debate: 'Debate',
};

export const label = (map, key) => map[key] || String(key || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
