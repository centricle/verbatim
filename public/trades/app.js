import { createExplorer, html } from '../js/explorer.js';

// Type key: the same purchase/sale colors the figures use
function typeBadgeClass(type) {
  if (type === 'Purchase') return 'tx-purchase';
  if (type?.startsWith('Sale')) return 'tx-sale';
  return 'tx-other';
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/trades-by-year.jsx'),
  import('../../src/viz/top-traders.jsx'),
  import('../../src/viz/top-tickers.jsx'),
  import('../../src/viz/amount-distribution.jsx'),
]);

createExplorer({
  prefix: 'trades',
  endpoint: '/api/trades',
  filters: ['senator', 'type', 'year'],
  noun: 'trades',
  emptyText: 'No trades match your filters.',
  errorText: 'Could not load trades. Try again.',
  // This endpoint pages by offset, not page number.
  pageParams: (page, pageSize) => ({ pageSize, offset: (page - 1) * pageSize }),
  // The amount column prints the filing's own range string, as published.
  row: (d) => html`
    <tr>
      <td class="cell-date">${fmtDate(d.transaction_date)}</td>
      <td class="cell-name">${d.senator}</td>
      <td class="cell-ticker">${d.ticker || '—'}</td>
      <td class="cell-asset" title="${d.asset_description || ''}">${d.asset_description || '—'}</td>
      <td class="cell-type">
        <span class="tx-type ${typeBadgeClass(d.type)}">${d.type}</span>
      </td>
      <td class="cell-amount">${d.amount || '—'}</td>
      <td class="cell-owner cell-dim">${d.owner || '—'}</td>
    </tr>
  `,
  options: (stats) => ({
    senator: (stats.senator_list || []).map((s) => [s, s]),
  }),
  charts: async (stats, opts) => {
    const [
      { mountTradesByYear },
      { mountTopTraders },
      { mountTopTickers },
      { mountAmountDistribution },
    ] = await charts;
    mountTradesByYear(document.getElementById('viz-trades-by-year'), stats, opts);
    mountTopTraders(document.getElementById('viz-top-traders'), stats, opts);
    mountTopTickers(document.getElementById('viz-top-tickers'), stats, opts);
    mountAmountDistribution(document.getElementById('viz-amount-distribution'), stats, opts);
  },
});
