import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// State
let currentPage = 1;
const PAGE_SIZE = 50;

// DOM refs
const form = document.getElementById('leso-search-form');
const searchInput = document.getElementById('leso-search');
const filterState = document.getElementById('filter-state');
const filterCategory = document.getElementById('filter-category');
const filterDemil = document.getElementById('filter-demil');
const resultsBody = document.getElementById('leso-results');
const resultsInfo = document.getElementById('leso-results-info');
const pagination = document.getElementById('leso-pagination');
const prevBtn = document.getElementById('leso-prev');
const nextBtn = document.getElementById('leso-next');
const pageInfo = document.getElementById('leso-page-info');

// DEMIL badge colors
function demilBadgeClass(code) {
  if (code === 'D' || code === 'E' || code === 'F') return 'bg-[oklch(0.88_0.06_25)] text-[oklch(0.38_0.10_20)]';
  if (code === 'A') return 'bg-[oklch(0.88_0.06_145)] text-[oklch(0.35_0.08_145)]';
  return 'bg-surface-hover text-text-dim';
}

// Format date
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Format currency
function fmtCurrency(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_category: filterCategory.value || null,
    filter_demil: filterDemil.value || null,
    sort_by: 'ship_date',
    sort_dir: 'desc',
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_leso_1033', params);

  if (error) {
    console.error('Search error:', error);
    resultsInfo.textContent = 'Error loading data.';
    return;
  }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Results info
  if (totalCount === 0) {
    resultsInfo.textContent = 'No transfers match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} transfers`;
  }

  // Render table rows
  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 whitespace-nowrap">${fmtDate(d.ship_date)}</td>
      <td class="py-2 pr-3 font-mono text-xs">${d.state}</td>
      <td class="py-2 pr-3 text-xs max-w-[180px] truncate" title="${(d.station_name || '').replace(/"/g, '&quot;')}">${d.station_name}</td>
      <td class="py-2 pr-3 text-xs max-w-[200px] truncate" title="${(d.item_name || '').replace(/"/g, '&quot;')}">${d.item_name}</td>
      <td class="py-2 pr-3 text-right">${Number(d.quantity).toLocaleString()}</td>
      <td class="py-2 pr-3 text-right whitespace-nowrap">${fmtCurrency(d.total_value)}</td>
      <td class="py-2">
        <span class="badge ${demilBadgeClass(d.demil_code)}">${d.demil_code || '—'}</span>
      </td>
    </tr>
  `).join('');

  // Pagination
  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    pageInfo.textContent = `Page ${currentPage} of ${totalPages.toLocaleString()}`;
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

[filterState, filterCategory, filterDemil].forEach(el => {
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
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('category')) filterCategory.value = params.get('category');
  if (params.get('demil')) filterDemil.value = params.get('demil');
  if (params.get('page')) currentPage = parseInt(params.get('page')) || 1;
}

// Populate dropdowns from stats
function populateDropdowns(stats) {
  if (stats.state_list) {
    stats.state_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.state;
      opt.textContent = s.state;
      filterState.appendChild(opt);
    });
  }
  if (stats.category_list) {
    stats.category_list.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.category;
      opt.textContent = c.category;
      filterCategory.appendChild(opt);
    });
  }
  // Restore URL state after dropdowns populated
  const params = new URLSearchParams(window.location.search);
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('category')) filterCategory.value = params.get('category');
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
    { mountByState },
    { mountByCategory },
    { mountByYear },
    { mountTopItems },
  ] = await Promise.all([
    import('../../src/viz/leso-by-state.jsx'),
    import('../../src/viz/leso-by-category.jsx'),
    import('../../src/viz/leso-by-year.jsx'),
    import('../../src/viz/leso-top-items.jsx'),
  ]);

  // Fetch stats once for all visualizations
  const { data: stats, error } = await supabase.rpc('leso_1033_stats');
  if (error) {
    console.error('Stats error:', error);
    return;
  }

  populateDropdowns(stats);

  const opts = { onFilter: handleFilter };
  mountByState(document.getElementById('viz-by-state'), stats, opts);
  mountByCategory(document.getElementById('viz-by-category'), stats, opts);
  mountByYear(document.getElementById('viz-by-year'), stats, opts);
  mountTopItems(document.getElementById('viz-top-items'), stats, opts);
}

// Init
readUrlState();
search();
loadViz();
