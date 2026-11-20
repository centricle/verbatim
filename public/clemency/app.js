import { createExplorer, fieldList, html } from '../js/explorer.js';

// Type key: the series colors Figures 1 and 2 use.
const TYPES = {
  pardon: ['Pardon', 'tx-series-1'],
  commutation: ['Commutation', 'tx-series-2'],
  title: ['Listed by title', 'tx-series-3'],
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const granted = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
};

const EXECUTIVE_TYPES = { executive_order: 'Executive Order', proclamation: 'Proclamation' };

// The entry in full: each field DOJ lists for it, under the label DOJ's own
// lists use, the offense first (the table clips it) and the long ones across
// the full width.
function detail(d) {
  const links = [
    d.warrant_url && html`<a href="${d.warrant_url}" class="text-link" target="_blank" rel="noopener">${d.warrant_label || 'Warrant'}</a>`,
    html`<a href="${d.source_url}" class="text-link" target="_blank" rel="noopener">DOJ list</a>`,
  ].filter(Boolean);
  return fieldList([
    ['Offense', d.offense, 'wide'],
    ['District', d.district],
    ['Sentence', d.sentence],
    ['Terms of grant', d.terms],
    ['Date sentence began', d.sentence_began],
    ['Sentence commuted to', d.commuted_to],
    ['Group', d.group_description, 'wide'],
    ['Note', d.note, 'wide'],
    ['Source', html`${links.map((l, i) => html`${i ? ' · ' : ''}${l}`)}`],
  ]);
}

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/clemency-by-term.jsx'),
  import('../../src/viz/clemency-by-year.jsx'),
]);

createExplorer({
  prefix: 'clemency',
  endpoint: '/api/clemency',
  filters: ['president', 'type', 'year'],
  noun: 'entries',
  emptyText: 'No entries match your filters.',
  errorText: 'Could not load entries. Try again.',
  row: (d) => {
    const [typeLabel, typeClass] = TYPES[d.type ?? 'title'];
    const proclamation = d.executive
      ? html`<a href="/executive/?id=${d.executive.id}" class="text-link grant-link">${EXECUTIVE_TYPES[d.executive.type] ?? 'Document'} ${d.executive.number ?? ''}</a>`
      : '';
    // President on one line, the longest ("George H. W. Bush") included;
    // District clips at --narrow and Offense at --mid so that, with the
    // details column, the table stays inside its 1184px frame. The detail
    // shows both in full.
    return html`
      <tr>
        <td class="cell-dim cell-nowrap cell-trail">${granted(d.grant_date)}</td>
        <td class="cell-name cell-lead cell-wrap cell-lines">${d.name}${proclamation}</td>
        <td><span class="tx-type ${typeClass}">${typeLabel}</span></td>
        <td class="cell-dim cell-nowrap">${d.president_name}</td>
        <td class="cell-dim cell-l3 cell-clip cell-clip--narrow cell-lines" title="${d.district || ''}" data-label="District">${d.district || '—'}</td>
        <td class="cell-dim cell-clip cell-clip--mid cell-wide" title="${d.offense || ''}">${d.offense || '—'}</td>
      </tr>
    `;
  },
  detail,
  options: (stats) => ({
    // Term order, as Figure 1 draws them.
    president: (stats.president_list || []).map((p) => [p.president, p.president_name]),
    year: (stats.year_list || []).map((y) => [String(y), String(y)]),
  }),
  charts: async (stats, opts) => {
    // The dek's reach, read off the data so it never goes stale in the HTML.
    const reach = document.getElementById('clemency-reach');
    const span = stats.date_range;
    if (reach && stats.total && span?.min) {
      reach.textContent = ` ${Number(stats.total).toLocaleString()} entries, granted ${span.min.slice(0, 4)} to ${span.max.slice(0, 4)}.`;
    }
    const [{ mountClemencyByTerm }, { mountClemencyByYear }] = await charts;
    mountClemencyByTerm(document.getElementById('viz-by-term'), stats, opts);
    mountClemencyByYear(document.getElementById('viz-by-year'), stats, opts);
  },
});
