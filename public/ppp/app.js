import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('ppp-search-form');
const searchInput = document.getElementById('ppp-search');
const filterState = document.getElementById('filter-state');
const filterStatus = document.getElementById('filter-status');
const filterAmount = document.getElementById('filter-amount');
const resultsBody = document.getElementById('ppp-results');
const resultsInfo = document.getElementById('ppp-results-info');
const pagination = document.getElementById('ppp-pagination');
const prevBtn = document.getElementById('ppp-prev');
const nextBtn = document.getElementById('ppp-next');
const pageInfo = document.getElementById('ppp-page-info');

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtJobs(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_status: filterStatus.value || null,
    filter_min_amount: filterAmount.value || null,
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_ppp_loans', params);
  if (error) { console.error('Search error:', error); resultsInfo.textContent = 'Error loading data.'; return; }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No records match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} loans`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 whitespace-nowrap text-xs">${fmtDate(d.date_approved)}</td>
      <td class="py-2 pr-3 font-medium">${d.borrower_name || 'Unknown'}</td>
      <td class="py-2 pr-3 text-xs">${d.borrower_city || ''}, ${d.borrower_state || ''}</td>
      <td class="py-2 pr-3 text-right tabular-nums">${fmtMoney(d.initial_amount)}</td>
      <td class="py-2 pr-3 text-right tabular-nums text-xs">${fmtMoney(d.forgiveness_amount)}</td>
      <td class="py-2 pr-3 text-right tabular-nums text-xs">${fmtJobs(d.jobs_reported)}</td>
      <td class="py-2 pr-3 text-xs">${d.lender_name || '—'}</td>
      <td class="py-2 text-xs">${d.loan_status || '—'}</td>
    </tr>
  `).join('');

  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    pageInfo.textContent = `Page ${currentPage} of ${totalPages.toLocaleString()}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  } else {
    pagination.classList.add('hidden');
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); currentPage = 1; search(); });
[filterState, filterStatus, filterAmount].forEach(el => {
  el.addEventListener('change', () => { currentPage = 1; search(); });
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; search(); } });
nextBtn.addEventListener('click', () => { currentPage++; search(); });

function populateDropdowns(stats) {
  if (stats.state_list) {
    stats.state_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.state;
      opt.textContent = s.state;
      filterState.appendChild(opt);
    });
  }
}

async function loadViz() {
  const [
    { mountPPPByState },
    { mountPPPByAmount },
    { mountPPPByLender },
    { mountPPPByBusiness },
  ] = await Promise.all([
    import('../../src/viz/ppp-by-state.jsx'),
    import('../../src/viz/ppp-by-amount.jsx'),
    import('../../src/viz/ppp-by-lender.jsx'),
    import('../../src/viz/ppp-by-business.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('ppp_loans_stats');
  if (error) { console.error('Stats error:', error); return; }

  populateDropdowns(stats);
  mountPPPByState(document.getElementById('viz-by-state'), stats);
  mountPPPByAmount(document.getElementById('viz-by-amount'), stats);
  mountPPPByLender(document.getElementById('viz-by-lender'), stats);
  mountPPPByBusiness(document.getElementById('viz-by-business'), stats);
}

search();
loadViz();
