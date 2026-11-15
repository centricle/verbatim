import { createExplorer, html } from '../js/explorer.js';

// Risk key: one neutral hue stepped light to dark, Low to High
function scoreBadgeClass(scoreText) {
  switch (scoreText) {
    case 'Low': return 'tx-level-1';
    case 'Medium': return 'tx-level-2';
    case 'High': return 'tx-level-3';
    default: return 'tx-other';
  }
}

// Recidivism key: filled for yes, empty for no
function recidBadge(val) {
  if (val === 1) return html`<span class="tx-type tx-yes">Yes</span>`;
  return html`<span class="tx-type tx-no">No</span>`;
}

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/score-distribution.jsx'),
  import('../../src/viz/false-positive.jsx'),
  import('../../src/viz/accuracy.jsx'),
]);

createExplorer({
  prefix: 'compas',
  endpoint: '/api/compas',
  filters: ['race', 'score', 'sex', 'recid'],
  noun: 'defendants',
  emptyText: 'No defendants match your filters.',
  errorText: 'Could not load defendants. Try again.',
  row: (d) => html`
    <tr>
      <td class="cell-name cell-lead">${d.name}</td>
      <td class="cell-nowrap">${d.race}</td>
      <td class="cell-num" data-label="Age">${d.age}</td>
      <td class="cell-dim">${d.sex}</td>
      <td class="cell-clip cell-dim cell-wide" title="${d.c_charge_desc || ''}">${d.c_charge_desc || '—'}</td>
      <td class="cell-num cell-l3" data-label="Score">${d.decile_score}</td>
      <td class="cell-trail">
        <span class="tx-type ${scoreBadgeClass(d.score_text)}">${d.score_text}</span>
      </td>
      <td class="cell-push cell-l3" data-label="Recidivated">${recidBadge(d.two_year_recid)}</td>
    </tr>
  `,
  // These charts do not set filters.
  charts: async (stats) => {
    const [
      { mountScoreDistribution },
      { mountFalsePositive },
      { mountAccuracy },
    ] = await charts;
    mountScoreDistribution(document.getElementById('viz-score-distribution'), stats);
    mountFalsePositive(document.getElementById('viz-false-positive'), stats);
    mountAccuracy(document.getElementById('viz-accuracy'), stats);
  },
});
