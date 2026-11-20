import { createExplorer, html } from '../js/explorer.js';
import { legacySenator } from '../../netlify/functions/shared/legacy-senators.js';

// Links from before the House joined carry `?senator=` with the old table's
// string ("Ron L Wyden"). It is rewritten in place, before the explorer reads
// the URL, to the member it named and the Senate, so an old link shows the
// senator's Senate trades it always did (legacy-senators.js). A string the
// list does not hold is dropped: every one ever linked is in it.
{
  const params = new URLSearchParams(location.search);
  if (params.has('senator')) {
    const legacy = legacySenator(params.get('senator'));
    params.delete('senator');
    if (legacy && !params.get('member')) {
      params.set('member', legacy.member);
      if (!params.get('chamber')) params.set('chamber', 'senate');
    }
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
}

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

const year = (d) => (d ? d.slice(0, 4) : '');

// The chamber a row's member filed in, as the title before the name. The
// figures label top traders the same way.
const TITLE = { house: 'Rep.', senate: 'Sen.' };

// Lede and source lines read off stats. Every [data-stat] span is filled
// from the stats the explorer last fetched, which follow the chamber filter.
const NOUN = { house: 'representatives', senate: 'senators' };
const SOURCES = {
  house: 'From the House Clerk’s electronic filings since 2014.',
  senate: 'From the Senate’s electronic filings since 2014.',
  both: 'From the House Clerk’s and the Senate’s electronic filings since 2014.',
};
const fills = {
  sources: (s, p) => SOURCES[p.chamber] ?? SOURCES.both,
  total: (s) => Number(s.total).toLocaleString(),
  members: (s) => Number(s.members).toLocaleString(),
  noun: (s, p) => NOUN[p.chamber] ?? 'members of Congress',
  range: (s) => `${year(s.date_range?.min)}–${year(s.date_range?.max)}`,
  last_filed: (s) => fmtDate(s.last_filed),
  paper_count: (s) => Number(s.paper_count).toLocaleString(),
  after_filing: (s) => Number(s.after_filing).toLocaleString(),
  exact_amounts: (s) => Number(s.exact_amounts).toLocaleString(),
};

function onStats(stats, params) {
  for (const el of document.querySelectorAll('[data-stat]')) {
    const fill = fills[el.dataset.stat];
    if (fill) el.textContent = fill(stats, params);
  }
  // Lines that state a count hide when it is zero (no exact amounts in the
  // Senate's rows).
  for (const el of document.querySelectorAll('[data-stat-line]')) {
    el.hidden = !Number(stats[el.dataset.statLine]);
  }
  paper.chamber = params.chamber ?? '';
  if (paper.el?.open) loadPaper();
}

// Paper filings: scanned forms, recorded and linked, not transcribed. The
// list loads when the note is first opened, and again if it is open when the
// chamber filter changes.
const paper = {
  el: document.getElementById('paper-note'),
  list: document.getElementById('paper-list'),
  chamber: '',
  loaded: null,
  controller: null,
};

async function loadPaper() {
  if (paper.loaded === paper.chamber) return;
  paper.loaded = paper.chamber;
  paper.controller?.abort();
  const controller = new AbortController();
  paper.controller = controller;
  const qs = new URLSearchParams({ action: 'paper', ...(paper.chamber && { chamber: paper.chamber }) });
  paper.list.replaceChildren();
  paper.list.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(`/api/trades?${qs}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    paper.list.innerHTML = rows.map((r) => html`
      <li>
        <a href="${r.url}" target="_blank" rel="noopener" class="source-link">${TITLE[r.chamber]} ${r.member}</a>
        <span class="cell-dim">${r.state_district || ''} ${fmtDate(r.filed_date)}</span>
      </li>
    `).join('');
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error(err);
    paper.loaded = null;
    paper.list.textContent = 'Could not load the list. Close and reopen this note to try again.';
  } finally {
    if (!controller.signal.aborted) paper.list.setAttribute('aria-busy', 'false');
  }
}

paper.el?.addEventListener('toggle', () => { if (paper.el.open) loadPaper(); });

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
  filters: ['chamber', 'member', 'type', 'year'],
  statsKeys: ['chamber'],
  noun: 'trades',
  emptyText: 'No trades match your filters.',
  errorText: 'Could not load trades. Try again.',
  // This endpoint pages by offset, not page number.
  pageParams: (page, pageSize) => ({ pageSize, offset: (page - 1) * pageSize }),
  // The amount column shows the filing's own range string, as published.
  // The trade date links to the filing it was read from (a Clerk PDF or the
  // eFD page); the filed date is the default sort (decision 14).
  row: (d) => html`
    <tr>
      <td class="cell-date">${d.url?.startsWith('https://')
        ? html`<a href="${d.url}" target="_blank" rel="noopener" class="source-link">${fmtDate(d.transaction_date)}</a>`
        : fmtDate(d.transaction_date)}</td>
      <td class="cell-filed" data-label="Filed">${fmtDate(d.filed_date)}</td>
      <td class="cell-name"><span class="cell-dim">${TITLE[d.chamber] ?? ''}</span> ${d.member ?? d.senator}</td>
      <td class="cell-ticker">${d.ticker || '—'}</td>
      <td class="cell-asset" title="${d.asset_description || ''}">${d.asset_description || '—'}</td>
      <td class="cell-type">
        <span class="tx-type ${typeBadgeClass(d.type)}">${d.type}</span>
      </td>
      <td class="cell-amount">${d.amount || '—'}</td>
      <td class="cell-owner cell-dim">${d.owner || '—'}</td>
    </tr>
  `,
  // Years are the by-year chart's: rows dated after their own filing are in
  // neither (decision 13), and stay findable by search.
  options: (stats) => ({
    member: (stats.member_list || []).map((m) => [m.member, m.member]),
    year: (stats.by_year || []).map((y) => String(y.year)).reverse().map((y) => [y, y]),
  }),
  onStats,
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
