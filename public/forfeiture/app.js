import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// State
let currentPage = 1;
const PAGE_SIZE = 50;

// DOM refs
const form = document.getElementById('forfeiture-search-form');
const searchInput = document.getElementById('forfeiture-search');
const filterState = document.getElementById('filter-state');
const filterPropType = document.getElementById('filter-prop-type');
const filterProceeding = document.getElementById('filter-proceeding');
const filterConviction = document.getElementById('filter-conviction');
const resultsBody = document.getElementById('forfeiture-results');
const resultsInfo = document.getElementById('forfeiture-results-info');
const pagination = document.getElementById('forfeiture-pagination');
const prevBtn = document.getElementById('forfeiture-prev');
const nextBtn = document.getElementById('forfeiture-next');
const pageInfo = document.getElementById('forfeiture-page-info');

// Format currency
function fmtCurrency(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  if (n === 0) return '$0';
  return `$${n.toLocaleString()}`;
}

// Title case
function titleCase(s) {
  if (!s) return '—';
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_prop_type: filterPropType.value || null,
    filter_proceeding: filterProceeding.value || null,
    filter_conviction: filterConviction.value || null,
    sort_by: 'year',
    sort_dir: 'desc',
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_forfeiture', params);

  if (error) {
    console.error('Search error:', error);
    resultsInfo.textContent = 'Error loading data.';
    return;
  }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No properties match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} properties`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 whitespace-nowrap">${d.year}</td>
      <td class="py-2 pr-3 font-mono text-xs">${d.state}</td>
      <td class="py-2 pr-3 text-xs">${titleCase(d.prop_type)}</td>
      <td class="py-2 pr-3 text-right whitespace-nowrap">${fmtCurrency(d.value)}</td>
      <td class="py-2 pr-3 text-xs">${titleCase(d.proceeding_type)}</td>
      <td class="py-2 pr-3 text-xs">${titleCase(d.conviction) || '<span class="text-text-dim">—</span>'}</td>
      <td class="py-2 text-xs font-mono max-w-[160px] truncate" title="${(d.case_no || '').replace(/"/g, '&quot;')}">${d.case_no || '—'}</td>
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

// Event listeners
form.addEventListener('submit', (e) => {
  e.preventDefault();
  currentPage = 1;
  search();
});

[filterState, filterPropType, filterProceeding, filterConviction].forEach(el => {
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
  if (params.get('type')) filterPropType.value = params.get('type');
  if (params.get('proceeding')) filterProceeding.value = params.get('proceeding');
  if (params.get('conviction')) filterConviction.value = params.get('conviction');
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
  // Restore URL state after dropdowns populated
  const params = new URLSearchParams(window.location.search);
  if (params.get('state')) filterState.value = params.get('state');
}

// Load viz components
async function loadViz() {
  const [
    { mountForfeitureByState },
    { mountForfeitureByYear },
    { mountForfeitureByType },
    { mountForfeitureConviction },
  ] = await Promise.all([
    import('../../src/viz/forfeiture-by-state.jsx'),
    import('../../src/viz/forfeiture-by-year.jsx'),
    import('../../src/viz/forfeiture-by-type.jsx'),
    import('../../src/viz/forfeiture-conviction.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('forfeiture_stats');
  if (error) {
    console.error('Stats error:', error);
    return;
  }

  populateDropdowns(stats);

  mountForfeitureByState(document.getElementById('viz-by-state'), stats);
  mountForfeitureByYear(document.getElementById('viz-by-year'), stats);
  mountForfeitureByType(document.getElementById('viz-by-type'), stats);
  mountForfeitureConviction(document.getElementById('viz-conviction'), stats);
}

// Init
readUrlState();
search();
loadViz();
