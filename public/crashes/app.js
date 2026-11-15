import { createExplorer, html } from '../js/explorer.js';

// System key: the same series colors Figure 1 uses.
const SYSTEMS = {
  ADS: ['ADS', 'tx-series-1'],
  ADAS: ['Level 2 ADAS', 'tx-series-2'],
  OTHER: ['Other', 'tx-series-3'],
};

const vehicle = (d) => [d.model_year, d.make, d.model].filter(Boolean).join(' ') || '—';
const place = (d) => [d.city, d.state].filter(Boolean).join(', ') || '—';

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/crashes-by-month.jsx'),
  import('../../src/viz/ranked-bars.jsx'),
]);

createExplorer({
  prefix: 'crashes',
  endpoint: '/api/crashes',
  filters: ['system', 'make', 'state', 'year', 'period', 'severity'],
  noun: 'reports',
  emptyText: 'No reports match your filters.',
  errorText: 'Could not load reports. Try again.',
  row: (d) => {
    const [systemLabel, systemClass] = SYSTEMS[d.system] || [d.system, 'tx-other'];
    return html`
      <tr>
        <td class="cell-dim cell-nowrap cell-trail">${d.incident_date || '—'}</td>
        <td class="cell-name cell-lead cell-wrap">${vehicle(d)}</td>
        <td><span class="tx-type ${systemClass}">${systemLabel}</span></td>
        <td class="cell-dim cell-clip cell-clip--narrow" title="${d.reporting_entity || ''}">${d.reporting_entity || '—'}</td>
        <td class="cell-dim">${place(d)}</td>
        <td class="cell-dim cell-l3" data-label="With">${d.crash_with || '—'}</td>
        <td class="cell-dim cell-l3 cell-push" data-label="Severity">${d.injury_severity || '—'}</td>
        <td class="cell-dim cell-wide cell-narrative">${d.narrative
          ? html`<details class="narrative"><summary>${d.narrative}</summary></details>`
          : '—'}</td>
      </tr>
    `;
  },
  options: (stats) => ({
    make: (stats.make_list || []).map((m) => [m, m]),
    state: (stats.state_list || []).map((s) => [s, s]),
    year: (stats.year_list || []).map((y) => [String(y), String(y)]),
    severity: (stats.severity_list || []).map((s) => [s, s]),
  }),
  charts: async (stats, opts) => {
    const [{ mountCrashesByMonth }, { mountRankedBars }] = await charts;
    mountCrashesByMonth(document.getElementById('viz-by-month'), stats, {
      ...opts,
      noteEl: document.getElementById('viz-by-month-note'),
    });
    const bars = { value: 'count', noun: 'reports', onFilter: opts.onFilter };
    mountRankedBars(document.getElementById('viz-by-make'), stats.by_make, { ...bars, label: 'make_key', filterKey: 'make' });
    mountRankedBars(document.getElementById('viz-by-state'), stats.by_state, { ...bars, label: 'state', filterKey: 'state' });
    mountRankedBars(document.getElementById('viz-by-severity'), stats.by_severity, { ...bars, label: 'injury_severity', filterKey: 'severity' });
  },
});
