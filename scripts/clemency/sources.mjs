// The Office of the Pardon Attorney's clemency recipient lists, as linked from
// https://www.justice.gov/pardon/clemency-recipients. DOJ publishes one page of
// pardons and one of commutations per president from Nixon through Biden, one
// combined page for the second Trump administration, and a detail page naming
// the recipients of each of Biden's two group commutations.
//
// Slugs follow no single pattern, so every page is listed by hand. `layout`
// names the parser in parse.mjs that reads it; the same president's two pages
// often differ. `president` uses the corpus speaker slugs; `term` is the year
// span DOJ's own slug names, which keeps Trump's two administrations apart.
//
// DOJ's robots.txt asks for ten seconds between requests (Crawl-delay: 10).
// Information on DOJ websites is in the public domain unless otherwise
// indicated (https://www.justice.gov/legalpolicies). Warrant PDFs are linked,
// never copied.

export const ORIGIN = 'https://www.justice.gov';
export const BASE = `${ORIGIN}/pardon`;
export const PACE_MS = 10_000;

const page = (slug, president, type, layout, term = /(\d{4}-(?:\d{4}|present))$/.exec(slug)?.[1]) => ({
  slug,
  term,
  file: `${slug}.html`,
  url: `${BASE}/${slug}`,
  president,
  type,
  layout,
});

export const PAGES = [
  page('clemency-grants-president-donald-j-trump-2025-present', 'donald-trump', null, 'trump-2025'),
  page('pardons-granted-president-joseph-biden-2021-2025', 'joe-biden', 'pardon', 'headed-tables'),
  page('commutations-granted-president-joseph-biden-2021-2025', 'joe-biden', 'commutation', 'headed-tables'),
  page('pardons-granted-president-donald-j-trump-2017-2021', 'donald-trump', 'pardon', 'headed-tables'),
  page('commutations-granted-president-donald-j-trump-2017-2021', 'donald-trump', 'commutation', 'headed-tables'),
  page('pardons-granted-president-barack-h-obama-2009-2017', 'barack-obama', 'pardon', 'headed-tables'),
  page('commutations-granted-president-barack-h-obama-2009-2017', 'barack-obama', 'commutation', 'blocks'),
  page('pardons-granted-president-george-w-bush-2001-2009', 'george-w-bush', 'pardon', 'headed-tables'),
  page('commutations-granted-president-george-w-bush-2001-2009', 'george-w-bush', 'commutation', 'blocks'),
  page('pardons-granted-president-william-j-clinton-1993-2001', 'bill-clinton', 'pardon', 'headed-tables'),
  page('commutations-granted-president-william-j-clinton-1993-2001', 'bill-clinton', 'commutation', 'blocks'),
  page('pardons-granted-president-george-h-w-bush-1989-1993', 'george-h-w-bush', 'pardon', 'headed-tables'),
  page('commutations-granted-president-george-h-w-bush-1989-1993', 'george-h-w-bush', 'commutation', 'blocks'),
  page('pardons-granted-president-ronald-reagan-1981-1989', 'ronald-reagan', 'pardon', 'dated-rows'),
  page('commutations-granted-president-ronald-reagan-1981-1989', 'ronald-reagan', 'commutation', 'dated-rows'),
  page('pardons-granted-president-jimmy-carter-1977-1981', 'jimmy-carter', 'pardon', 'dated-rows'),
  page('commutations-granted-president-jimmy-carter-1977-1981', 'jimmy-carter', 'commutation', 'dated-rows'),
  page('pardons-granted-president-gerald-ford-1974-1977', 'gerald-ford', 'pardon', 'dated-rows'),
  page('commutations-granted-president-gerald-ford-1974-1977', 'gerald-ford', 'commutation', 'dated-rows'),
  page('pardons-granted-president-richard-nixon-1969-1974', 'richard-nixon', 'pardon', 'dated-rows'),
  page('commutations-granted-president-richard-nixon-1969-1974', 'richard-nixon', 'commutation', 'dated-rows'),
  page('december-12-2024-commutation-recipients', 'joe-biden', 'commutation', 'group-detail', '2021-2025'),
  page('january-17-2025-commutation-recipients', 'joe-biden', 'commutation', 'group-detail', '2021-2025'),
];
