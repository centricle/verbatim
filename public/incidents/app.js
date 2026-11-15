import { createExplorer, html } from '../js/explorer.js';

// This page's visible copy is fixed. That is why it sets no `errorText`: a
// failed search leaves the table as it was.

const raceLabels = { W: 'White', B: 'Black', H: 'Hispanic', A: 'Asian', N: 'Native Am.', O: 'Other' };

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function armedLabel(a) {
  if (!a) return '—';
  return a.replace(/_/g, ' ');
}

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/shootings-by-year.jsx'),
  import('../../src/viz/shootings-by-race.jsx'),
  import('../../src/viz/shootings-by-armed.jsx'),
  import('../../src/viz/shootings-by-state.jsx'),
]);

createExplorer({
  prefix: 'incidents',
  endpoint: '/api/incidents',
  filters: ['state', 'race', 'armed', 'year'],
  noun: 'fatal shootings',
  emptyText: 'No records match your filters.',
  row: (d) => html`
    <tr>
      <td class="cell-dim cell-nowrap cell-trail">${fmtDate(d.date)}</td>
      <td class="cell-name cell-lead">${d.name || 'Unknown'}</td>
      <td class="cell-num" data-label="Age">${d.age || '—'}</td>
      <td class="cell-nowrap">${raceLabels[d.race] || d.race || '—'}</td>
      <td class="cell-dim">${d.city || ''}, ${d.state || ''}</td>
      <td class="cell-l3">${armedLabel(d.armed_with)}</td>
      <td class="cell-dim cell-l3" data-label="Flee">${d.flee_status || '—'}</td>
      <td class="cell-dim cell-l3 cell-push" data-label="Camera">${d.body_camera ? 'Yes' : 'No'}</td>
    </tr>
  `,
  options: (stats) => ({
    state: (stats.state_list || []).map((s) => [s.state, s.state]),
  }),
  charts: async (stats, opts) => {
    const [
      { mountShootingsByYear },
      { mountShootingsByRace },
      { mountShootingsByArmed },
      { mountShootingsByState },
    ] = await charts;
    mountShootingsByYear(document.getElementById('viz-by-year'), stats, opts);
    mountShootingsByRace(document.getElementById('viz-by-race'), stats, opts);
    mountShootingsByArmed(document.getElementById('viz-by-armed'), stats, opts);
    mountShootingsByState(document.getElementById('viz-by-state'), stats, opts);
  },
});
