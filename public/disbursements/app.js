import { createExplorer, fieldList, html } from '../js/explorer.js';
import { moneyExact, moneyShort, quarterKey, periodLabel } from '../../src/viz/disbursements-format.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${MON[m - 1]} ${d}, ${y}`;
};

// A subtotal row covers its whole period and carries no date of its own, so
// its date cell names the period: 'Apr–Jun 2026', or 'Oct 2025–Mar 2026'
// for a Senate half year.
function when(d) {
  if (d.transaction_date) return day(d.transaction_date);
  const filed = d.extras?.dates_as_filed?.transaction_date;
  if (filed) return filed;
  return periodLabel(d.period_start, d.period_end, { short: true });
}

// The page shows one chamber at a time (the switch in the kicker; the House
// when the chamber filter is empty). Copy that differs by chamber is marked
// data-chamber in the HTML, and only the shown chamber's is visible. Set from
// the URL before the first stats arrive, so a Senate link never flashes the
// House's copy.
const chamberOf = (value) => (value === 'senate' ? 'senate' : 'house');
function showChamber(chamber) {
  for (const el of document.querySelectorAll('[data-chamber]')) el.hidden = el.dataset.chamber !== chamber;
  for (const a of document.querySelectorAll('[data-chamber-link]')) {
    if (a.dataset.chamberLink === chamber) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const all = document.querySelector('#filter-quarter option[value=""]');
  if (all) all.textContent = chamber === 'senate' ? 'All half years' : 'All quarters';
}
showChamber(chamberOf(new URLSearchParams(location.search).get('chamber')));

// The switch's links work as links: a new tab, or no script. A plain click is
// a change of the hidden #filter-chamber instead, so it takes the explorer's
// path (one history entry, the stats refetch, the period cleared) without
// reloading the page. The copy swaps when the new stats arrive (onStats).
const chamberInput = document.getElementById('filter-chamber');
for (const a of document.querySelectorAll('[data-chamber-link]')) {
  a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const value = a.dataset.chamberLink === 'senate' ? 'senate' : '';
    if (chamberInput.value === value) return;
    chamberInput.value = value;
    chamberInput.dispatchEvent(new Event('change'));
  });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (iso) => `${MONTHS[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;

const span = (a, b) => (a && b && a !== b ? `${day(a)} to ${day(b)}` : a ? day(a) : '');

// A break opportunity after each slash. The House runs words together with
// one ("PUBLICATIONS/REFERENCE", 22 letters), and the longest such word set
// the payee column's floor and pushed the table past its frame.
const slashBreaks = (text) => String(text ?? '').split('/').map((part, i) => html`${i ? html`/<wbr>` : ''}${part}`);

// A Senate row in full, under the report's own column names where it has
// them. The source link opens the report's PDF at the row's page.
function senateDetail(d) {
  const x = d.extras || {};
  const asFiled = x.dates_as_filed
    ? Object.entries(x.dates_as_filed).map(([k, v]) => `${SENATE_DATE_COLUMNS[k]}: ${v}`).join('\n')
    : '';
  const how = x.from_summary
    ? 'From the office’s summary: the report charges this amount to the class without a total in its lines'
    : x.unitemized
      ? 'A subtotal in the report with no lines above it'
      : d.row_kind === 'subtotal' ? 'A subtotal in the report for the lines above it'
        : x.no_document_line ? 'A later line of a document whose first line is not in the report’s text' : '';
  return fieldList([
    ['Program', d.program],
    ['Office', d.office],
    ['Class', d.category],
    ['Subclass', x.subclass],
    ['Funding year', d.funding_year],
    ['Document number', d.document],
    ['Line of the document', x.doc_line && `Line ${x.doc_line}, continuing the line above`],
    ['Obligation or service dates', span(d.start_date, d.end_date)],
    ['Dates as published', asFiled],
    ['Row', how],
    ['Read from', x.ocr && 'An image of the page (the report gives this page no text): read by OCR, checked by eye and against the report’s own totals'],
    ['Source', html`<a href="${d.source_ref}" class="text-link" target="_blank" rel="noopener">Senate report, page ${x.page_label ?? x.page}</a>`],
  ]);
}

const SENATE_DATE_COLUMNS = {
  transaction_date: 'Date posted',
  start_date: 'Start date',
  end_date: 'End date',
};

// The row in full: first the three columns the table clips, then every other
// field the House publishes for the row, under the House's own column names.
function detail(d) {
  if (d.chamber === 'senate') return senateDetail(d);
  const x = d.extras || {};
  const asFiled = x.dates_as_filed
    ? Object.entries(x.dates_as_filed).map(([k, v]) => `${DATE_COLUMNS[k]}: ${v}`).join('\n')
    : '';
  return fieldList([
    ['Program', d.program],
    ['Office', d.office],
    ['Category', d.category],
    ['Organization', d.organization],
    ['Fiscal year or legislative year', d.funding_year],
    ['Document', d.document],
    ['Performance period', span(d.start_date, d.end_date)],
    ['Dates as published', asFiled],
    ['Vendor ID', x.vendor_id],
    ['Organization code', x.org_code],
    ['Program code', x.program_code],
    ['Budget object class', x.object_class],
    ['Budget object code', x.object_code],
    ['Data source', x.data_source],
    ['Unquoted comma', x.unquoted_comma && `Rejoined in ${x.unquoted_comma === 'payee' ? 'vendor name' : 'description'}`],
    ['Source', html`<a href="${d.source_ref}" class="text-link" target="_blank" rel="noopener">House CSV, row ${d.row_number.toLocaleString()}</a>`],
  ]);
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
  filters: ['chamber', 'quarter', 'category', 'office'],
  // The stats are one chamber's, so a chamber change refetches them, and
  // clears a period, category or office the other chamber does not have.
  statsKeys: ['chamber'],
  // A Senate half year and a House quarter that start on the same day share
  // a key (2023q2: April to September, or April to June), so the period
  // would survive the switch and quietly mean something else.
  clears: { chamber: ['quarter'] },
  // Date and Amount, the two orders search_disbursements takes.
  sort: { default: 'date' },
  noun: 'rows',
  emptyText: 'No rows match your filters.',
  errorText: 'Could not load rows. Try again.',
  // Office, Category and Program all clip at --narrow: at their widest, with
  // the details column, anything wider runs the table past its 1184px frame.
  // The detail shows all three in full.
  row: (d) => html`
    <tr>
      <td class="cell-dim cell-nowrap">${when(d)}</td>
      <td class="cell-name cell-lead cell-wrap cell-break">${d.payee
        ? html`${d.payee}<span class="cell-snippet">${slashBreaks(d.description)}</span>`
        : d.description}</td>
      <td class="cell-dim cell-clip cell-clip--narrow" title="${d.office}" data-label="Office">${d.office}</td>
      <td class="cell-dim cell-clip cell-clip--narrow" title="${d.category || ''}">${d.category || '—'}</td>
      <td class="cell-num cell-trail">${moneyExact(d.amount)}</td>
      <td class="cell-dim cell-clip cell-clip--narrow cell-wide" title="${d.program || ''}">${d.program || '—'}</td>
    </tr>
  `,
  detail,
  options: (stats) => ({
    // Newest first, as the table lists rows.
    // A Senate half year starts on a quarter's first day, so it takes the
    // same key (2025q4, October 2025 to March 2026).
    quarter: [...(stats.by_period || [])]
      .sort((a, b) => String(b.period_start).localeCompare(String(a.period_start)))
      .map((p) => [quarterKey(p.period_start), periodLabel(p.period_start, p.period_end)]),
    category: (stats.by_category || []).map((c) => c.category).filter(Boolean)
      .sort().map((c) => [c, c]),
    // The House's 1,221 names are too many for a select: the office
    // combobox's list.
    office: (stats.office_list || []).map((o) => [o, o]),
  }),
  onStats: (stats, params) => {
    const chamber = chamberOf(params.chamber);
    showChamber(chamber);
    // The dek's reach, read off the data so it never goes stale in the HTML.
    const reach = document.querySelector(`[data-chamber="${chamber}"] .disbursements-reach`);
    const range = stats.period_range;
    if (reach && stats.total && range?.min) {
      reach.textContent = ` ${Number(stats.total).toLocaleString()} rows, ${monthYear(range.min)} to ${monthYear(range.max)}.`;
    }
  },
  charts: async (stats, opts) => {
    const [{ mountDisbursementsByQuarter }, { mountRankedBars }] = await charts;
    mountDisbursementsByQuarter(document.getElementById('viz-by-quarter'), stats, opts);
    // Rows with no category are left out, as the Senate caption says: charges
    // and their reversals the Senate lists under no class (senate-parse.mjs),
    // netting to $0. Drawn, they were a $0 bar named "null". The House has none.
    mountRankedBars(document.getElementById('viz-by-category'), (stats.by_category || []).filter((c) => c.category), {
      label: 'category', value: 'amount', noun: '', filterKey: 'category',
      onFilter: opts.onFilter, format: moneyShort, exact: moneyExact,
    });
    mountRankedBars(document.getElementById('viz-top-payees'), stats.top_payees || [], {
      label: 'payee', value: 'amount', noun: '', format: moneyShort, exact: moneyExact,
    });
  },
});
