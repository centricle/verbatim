import { createExplorer, html } from '../js/explorer.js';

// Party key: the same party colors the figures use
const partyKeys = { DEM: 'tx-party-dem', REP: 'tx-party-rep', LIB: 'tx-party-lib', GRE: 'tx-party-gre', IND: 'tx-party-ind' };

function fmtMoney(n) {
  if (n == null || n === 0) return '—';
  const v = Number(n);
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toLocaleString();
}

function titleCase(s) {
  if (!s) return '—';
  return s.split(/[, ]+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function district(d) {
  if (d.office === 'House' && d.cand_state) return d.cand_state + '-' + (d.cand_district || '00');
  if (d.office === 'Senate' && d.cand_state) return d.cand_state;
  return '—';
}

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/fec-top-fundraisers.jsx'),
  import('../../src/viz/fec-by-party.jsx'),
  import('../../src/viz/fec-by-state.jsx'),
  import('../../src/viz/fec-by-office.jsx'),
]);

createExplorer({
  prefix: 'fec',
  endpoint: '/api/finance',
  filters: ['state', 'party', 'office'],
  noun: 'candidates',
  emptyText: 'No candidates match your filters.',
  errorText: 'Could not load candidates. Try again.',
  row: (d) => html`
    <tr>
      <td class="cell-name cell-lead">${titleCase(d.cand_name)}</td>
      <td><span class="tx-type ${partyKeys[d.party] || 'tx-other'}">${d.party || '—'}</span></td>
      <td class="cell-dim">${d.office || '—'}</td>
      <td class="cell-code">${district(d)}</td>
      <td class="cell-num cell-trail" data-label="Raised">${fmtMoney(d.total_receipts)}</td>
      <td class="cell-num cell-dim cell-l3" data-label="Spent">${fmtMoney(d.total_disbursements)}</td>
      <td class="cell-num cell-dim cell-l3" data-label="Cash">${fmtMoney(d.cash_on_hand)}</td>
      <td class="cell-num cell-dim cell-l3" data-label="Individual">${fmtMoney(d.indiv_contrib)}</td>
    </tr>
  `,
  // '00' is the FEC's code for no state; it is not offered as a filter.
  options: (stats) => ({
    state: (stats.state_list || []).filter((s) => s.state !== '00').map((s) => [s.state, s.state]),
  }),
  charts: async (stats, opts) => {
    const [
      { mountTopFundraisers },
      { mountByParty },
      { mountFECByState },
      { mountByOffice },
    ] = await charts;
    mountTopFundraisers(document.getElementById('viz-top-fundraisers'), stats, opts);
    mountByParty(document.getElementById('viz-by-party'), stats, opts);
    mountFECByState(document.getElementById('viz-by-state'), stats, opts);
    mountByOffice(document.getElementById('viz-by-office'), stats, opts);
  },
});
