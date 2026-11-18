// Which page each fixture was trimmed from (make-fixtures.mjs), so tests read
// a fixture with its real page's source record.
import { PAGES } from './sources.mjs';

export const FIXTURES = [
  ['dated-rows.html', 'pardons-granted-president-jimmy-carter-1977-1981'],
  ['headed-tables.html', 'pardons-granted-president-william-j-clinton-1993-2001'],
  ['headed-disclosure.html', 'commutations-granted-president-joseph-biden-2021-2025'],
  ['blocks.html', 'commutations-granted-president-barack-h-obama-2009-2017'],
  ['mixed.html', 'pardons-granted-president-barack-h-obama-2009-2017'],
  ['trump-2025.html', 'clemency-grants-president-donald-j-trump-2025-present'],
  ['detail-2024-12-12.html', 'december-12-2024-commutation-recipients'],
  ['detail-2025-01-17.html', 'january-17-2025-commutation-recipients'],
].map(([file, slug]) => ({ file, source: PAGES.find((p) => p.slug === slug) }));
