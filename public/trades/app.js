async function api(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/trades?${qs}`);
  return res.json();
}

// State
let currentPage = 1;
const PAGE_SIZE = 50;

// DOM refs
const form = document.getElementById('trades-search-form');
const searchInput = document.getElementById('trades-search');
const filterSenator = document.getElementById('filter-senator');
const filterType = document.getElementById('filter-type');
const filterYear = document.getElementById('filter-year');
const resultsBody = document.getElementById('trades-results');
const resultsInfo = document.getElementById('trades-results-info');
const pagination = document.getElementById('trades-pagination');
const prevBtn = document.getElementById('trades-prev');
const nextBtn = document.getElementById('trades-next');
const pageInfo = document.getElementById('trades-page-info');

// Type badge colors
function typeBadgeClass(type) {
  if (type === 'Purchase') return 'bg-[oklch(0.88_0.06_145)] text-[oklch(0.35_0.08_145)]';
  if (type.startsWith('Sale')) return 'bg-[oklch(0.88_0.06_25)] text-[oklch(0.38_0.10_20)]';
  return 'bg-surface-hover text-text-dim';
}

// Format date
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Shorten amount range for table display
function shortAmount(a) {
  if (!a) return '—';
  return a.replace(/,000/g, 'K').replace(/\$1K - \$15K/, '$1K–$15K')
    .replace(/\$15K01 - \$50K/, '$15K–$50K')
    .replace(/\$50K01 - \$100K/, '$50K–$100K')
    .replace(/\$100K01 - \$250K/, '$100K–$250K')
    .replace(/\$250K01 - \$500K/, '$250K–$500K')
    .replace(/\$500K01 - \$1KK/, '$500K–$1M')
    .replace(/\$1KK01 - \$5KK/, '$1M–$5M');
}

async function search() {
  const data = await api({
    q: searchInput.value.trim(),
    senator: filterSenator.value,
    type: filterType.value,
    year: filterYear.value,
    pageSize: PAGE_SIZE,
    offset: (currentPage - 1) * PAGE_SIZE,
  });

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Results info
  if (totalCount === 0) {
    resultsInfo.textContent = 'No trades match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} trades`;
  }

  // Render table rows
  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 whitespace-nowrap">${fmtDate(d.transaction_date)}</td>
      <td class="py-2 pr-3 font-medium">${d.senator}</td>
      <td class="py-2 pr-3 font-mono text-xs">${d.ticker || '—'}</td>
      <td class="py-2 pr-3 text-xs max-w-[200px] truncate" title="${(d.asset_description || '').replace(/"/g, '&quot;')}">${d.asset_description || '—'}</td>
      <td class="py-2 pr-3">
        <span class="badge ${typeBadgeClass(d.type)}">${d.type}</span>
      </td>
      <td class="py-2 pr-3 text-xs whitespace-nowrap">${d.amount || '—'}</td>
      <td class="py-2 text-xs">${d.owner || '—'}</td>
    </tr>
  `).join('');

  // Pagination
  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  } else {
    pagination.classList.add('hidden');
  }
}

// Event listeners
form.addEventListener('submit', (e) => {
  e.preventDefault();
  currentPage = 1;
  search();
});

[filterSenator, filterType, filterYear].forEach(el => {
  el.addEventListener('change', () => {
    currentPage = 1;
    search();
  });
});

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    search();
  }
});

nextBtn.addEventListener('click', () => {
  currentPage++;
  search();
});

// URL state
function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) searchInput.value = params.get('q');
  if (params.get('senator')) filterSenator.value = params.get('senator');
  if (params.get('type')) filterType.value = params.get('type');
  if (params.get('year')) filterYear.value = params.get('year');
  if (params.get('page')) currentPage = parseInt(params.get('page')) || 1;
}

// Populate senator dropdown from stats
async function populateSenators(stats) {
  if (stats.senator_list) {
    stats.senator_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      filterSenator.appendChild(opt);
    });
    // Restore URL state for senator after dropdown is populated
    const params = new URLSearchParams(window.location.search);
    if (params.get('senator')) filterSenator.value = params.get('senator');
  }
}

// Bridge: chart click → table filter
function handleFilter({ key, value }) {
  const el = document.getElementById(`filter-${key}`);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }
}

// Load viz components (React + D3)
async function loadViz() {
  const [
    { mountTradesByYear },
    { mountTopTraders },
    { mountTopTickers },
    { mountAmountDistribution },
  ] = await Promise.all([
    import('../../src/viz/trades-by-year.jsx'),
    import('../../src/viz/top-traders.jsx'),
    import('../../src/viz/top-tickers.jsx'),
    import('../../src/viz/amount-distribution.jsx'),
  ]);

  const stats = await api({ action: 'stats' });

  populateSenators(stats);

  const opts = { onFilter: handleFilter };
  mountTradesByYear(document.getElementById('viz-trades-by-year'), stats, opts);
  mountTopTraders(document.getElementById('viz-top-traders'), stats, opts);
  mountTopTickers(document.getElementById('viz-top-tickers'), stats, opts);
  mountAmountDistribution(document.getElementById('viz-amount-distribution'), stats, opts);
}

// Init
readUrlState();
search();
loadViz();
