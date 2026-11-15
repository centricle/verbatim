import { createExplorer, html } from '../js/explorer.js';

// Ruling key: the same ruling colors Figure 3 uses
function rulingBadgeClass(ruling) {
  if (ruling === 'granted') return 'tx-series-2';
  if (ruling === 'denied') return 'tx-series-1';
  if (ruling === 'mixed') return 'tx-series-3';
  return 'tx-other';
}

function titleCase(s) {
  if (!s) return '—';
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/qi-by-circuit.jsx'),
  import('../../src/viz/qi-by-year.jsx'),
  import('../../src/viz/qi-by-ruling.jsx'),
  import('../../src/viz/qi-by-violation.jsx'),
]);

createExplorer({
  prefix: 'qi',
  endpoint: '/api/qi',
  filters: ['circuit', 'ruling', 'violation'],
  noun: 'cases',
  emptyText: 'No cases match your filters.',
  errorText: 'Could not load cases. Try again.',
  row: (d) => html`
    <tr>
      <td class="cell-dim cell-nowrap cell-trail">${d.year || '—'}</td>
      <td class="cell-dim">${d.circuit || '—'}</td>
      <td class="cell-name cell-lead cell-clip cell-clip--mid" title="${d.case_name || ''}">${d.case_name || '—'}</td>
      <td class="cell-push">
        <span class="tx-type ${rulingBadgeClass(d.qi_ruling)}">${titleCase(d.qi_ruling)}</span>
      </td>
      <td class="cell-clip cell-clip--narrow cell-dim cell-wide" title="${d.violation_type || ''}">${d.violation_type || '—'}</td>
      <td class="cell-dim cell-l3" data-label="Defendant">${titleCase(d.defendant_type)}</td>
      <td class="cell-dim cell-l3 cell-push" data-label="Prevailing">${titleCase(d.prevailing_party)}</td>
    </tr>
  `,
  options: (stats) => ({
    circuit: (stats.circuit_list || []).map((s) => [s.circuit, s.circuit]),
    ruling: (stats.ruling_list || []).map((s) => [s.qi_ruling, titleCase(s.qi_ruling)]),
    violation: (stats.violation_list || []).map((s) => [s.violation_type, s.violation_type]),
  }),
  charts: async (stats, opts) => {
    const [
      { mountQiByCircuit },
      { mountQiByYear },
      { mountQiByRuling },
      { mountQiByViolation },
    ] = await charts;
    mountQiByCircuit(document.getElementById('viz-by-circuit'), stats, opts);
    mountQiByYear(document.getElementById('viz-by-year'), stats, opts);
    mountQiByRuling(document.getElementById('viz-by-ruling'), stats, opts);
    mountQiByViolation(document.getElementById('viz-by-violation'), stats, opts);
  },
});
