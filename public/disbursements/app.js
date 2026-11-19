import { createExplorer, html } from '../js/explorer.js';
import { moneyExact, moneyShort, quarterKey, quarterLabel } from '../../src/viz/disbursements-format.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${MON[m - 1]} ${d}, ${y}`;
};
// '2026-04-01' -> 'Apr–Jun 2026', for the date cell of a subtotal row, which
// covers the quarter and carries no date of its own.
const quarterShort = (iso) => {
  const m = Number(String(iso).slice(5, 7));
  return `${MON[m - 1]}–${MON[m + 1]} ${String(iso).slice(0, 4)}`;
};

function when(d) {
  if (d.transaction_date) return day(d.transaction_date);
  const filed = d.extras?.dates_as_filed?.transaction_date;
  if (filed) return filed;
  return quarterShort(d.period_start);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (iso) => `${MONTHS[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;

const span = (a, b) => (a && b && a !== b ? `${day(a)} to ${day(b)}` : a ? day(a) : '');

// Every other field the House files for the row, under the House's own
// column names. The program leads the record, so it is the summary.
function record(d) {
  const x = d.extras || {};
  const asFiled = x.dates_as_filed
    ? Object.entries(x.dates_as_filed).map(([k, v]) => `${DATE_COLUMNS[k]}: ${v}`).join('\n')
    : '';
  const rows = [
    ['Organization', d.organization],
    ['Fiscal year or legislative year', d.funding_year],
    ['Document', d.document],
    ['Performance period', span(d.start_date, d.end_date)],
    ['Dates as filed', asFiled],
    ['Vendor ID', x.vendor_id],
    ['Organization code', x.org_code],
    ['Program code', x.program_code],
    ['Budget object class', x.object_class],
    ['Budget object code', x.object_code],
    ['Data source', x.data_source],
    ['Unquoted comma', x.unquoted_comma && `Rejoined in ${x.unquoted_comma === 'payee' ? 'vendor name' : 'description'}`],
  ].filter(([, v]) => v);
  return html`
    <details class="narrative">
      <summary>${d.program || '—'}</summary>
      <dl class="record-meta grant-record">
        ${rows.map(([k, v]) => html`<div class="record-meta-row"><dt>${k}</dt><dd>${v}</dd></div>`)}
        <div class="record-meta-row"><dt>Source</dt><dd><a href="${d.source_ref}" class="text-link" target="_blank" rel="noopener">House CSV, row ${d.row_number.toLocaleString()}</a></dd></div>
      </dl>
    </details>
  `;
}

const DATE_COLUMNS = {
  transaction_date: 'Transaction date',
  start_date: 'Perform start date',
  end_date: 'Perform end date',
};

// Started now so the chunks load while the first search and stats are in flight.
const charts = Promise.all([
  import('../../src/viz/disbursements-by-quarter.jsx'),
  import('../../src/viz/ranked-bars.jsx'),
]);

createExplorer({
  prefix: 'disbursements',
  endpoint: '/api/disbursements',
  filters: ['quarter', 'category', 'office', 'sortBy'],
  noun: 'rows',
  emptyText: 'No rows match your filters.',
  errorText: 'Could not load rows. Try again.',
  row: (d) => html`
    <tr>
      <td class="cell-dim cell-nowrap">${when(d)}</td>
      <td class="cell-name cell-lead cell-wrap">${d.payee
        ? html`${d.payee}<span class="cell-snippet">${d.description}</span>`
        : d.description}</td>
      <td class="cell-dim cell-clip cell-clip--mid" title="${d.office}" data-label="Office">${d.office}</td>
      <td class="cell-dim cell-clip cell-clip--narrow" title="${d.category || ''}">${d.category || '—'}</td>
      <td class="cell-num cell-trail">${moneyExact(d.amount)}</td>
      <td class="cell-dim cell-wide cell-narrative">${record(d)}</td>
    </tr>
  `,
  options: (stats) => ({
    // Newest first, as the table lists rows.
    quarter: [...new Set((stats.by_period || []).map((p) => String(p.period_start).slice(0, 10)))]
      .sort().reverse().map((iso) => [quarterKey(iso), quarterLabel(iso)]),
    category: (stats.by_category || []).map((c) => c.category).filter(Boolean)
      .sort().map((c) => [c, c]),
    // 1,221 names, too many for a select: suggestions for the office field.
    office: (stats.office_list || []).map((o) => [o, o]),
  }),
  onStats: (stats) => {
    // The dek's reach, read off the data so it never goes stale in the HTML.
    const reach = document.getElementById('disbursements-reach');
    const range = stats.period_range;
    if (reach && stats.total && range?.min) {
      reach.textContent = ` ${Number(stats.total).toLocaleString()} rows, ${monthYear(range.min)} to ${monthYear(range.max)}.`;
    }
  },
  charts: async (stats, opts) => {
    const [{ mountDisbursementsByQuarter }, { mountRankedBars }] = await charts;
    mountDisbursementsByQuarter(document.getElementById('viz-by-quarter'), stats, opts);
    mountRankedBars(document.getElementById('viz-by-category'), stats.by_category || [], {
      label: 'category', value: 'amount', noun: '', filterKey: 'category',
      onFilter: opts.onFilter, format: moneyShort, exact: moneyExact,
    });
    mountRankedBars(document.getElementById('viz-top-payees'), stats.top_payees || [], {
      label: 'payee', value: 'amount', noun: '', format: moneyShort, exact: moneyExact,
    });
  },
});
