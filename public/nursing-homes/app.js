import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const SEVERITY_COLORS = {
  J: 'text-red-800 font-semibold', K: 'text-red-800 font-semibold', L: 'text-red-800 font-semibold',
  G: 'text-amber-800 font-semibold', H: 'text-amber-800 font-semibold', I: 'text-amber-800 font-semibold',
};

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('nhd-search-form');
const searchInput = document.getElementById('nhd-search');
const filterState = document.getElementById('filter-state');
const filterCategory = document.getElementById('filter-category');
const filterSeverity = document.getElementById('filter-severity');
const resultsBody = document.getElementById('nhd-results');
const resultsInfo = document.getElementById('nhd-results-info');
const pagination = document.getElementById('nhd-pagination');
const prevBtn = document.getElementById('nhd-prev');
const nextBtn = document.getElementById('nhd-next');
const pageInfo = document.getElementById('nhd-page-info');

function shortCategory(cat) {
  if (!cat) return '—';
  return cat.replace(/ Deficiencies$/, '');
}

function shortStatus(s) {
  if (!s) return '—';
  if (s.includes('date of correction')) return 'Corrected';
  if (s.includes('plan of correction')) return 'Plan filed';
  if (s.includes('no plan')) return 'No plan';
  if (s.includes('Past Non-Compliance')) return 'Past';
  if (s.includes('Waiver')) return 'Waiver';
  return s;
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_category: filterCategory.value || null,
    filter_severity: filterSeverity.value || null,
    sort_by: 'date',
    sort_dir: 'desc',
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_nursing_homes', params);

  if (error) {
    console.error('Search error:', error);
    resultsInfo.textContent = 'Error loading data.';
    return;
  }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No deficiencies match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} deficiencies`;
  }

  resultsBody.innerHTML = rows.map(d => {
    const sevClass = SEVERITY_COLORS[d.scope_severity] || '';
    return `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 text-xs max-w-[200px] truncate" title="${(d.provider_name || '').replace(/"/g, '&quot;')}">${d.provider_name || '—'}</td>
      <td class="py-2 pr-3 text-xs whitespace-nowrap">${d.city || '—'}, ${d.state || ''}</td>
      <td class="py-2 pr-3 text-xs whitespace-nowrap">${d.survey_date || '—'}</td>
      <td class="py-2 pr-3 text-xs max-w-[180px] truncate" title="${(d.deficiency_category || '').replace(/"/g, '&quot;')}">${shortCategory(d.deficiency_category)}</td>
      <td class="py-2 pr-3 text-xs ${sevClass}" title="${d.severity_label || ''} — ${d.scope_label || ''}">${d.scope_severity || '—'}</td>
      <td class="py-2 text-xs">${shortStatus(d.deficiency_corrected)}</td>
    </tr>`;
  }).join('');

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
[filterState, filterCategory, filterSeverity].forEach(el => {
  el.addEventListener('change', () => { currentPage = 1; search(); });
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; search(); } });
nextBtn.addEventListener('click', () => { currentPage++; search(); });

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) searchInput.value = params.get('q');
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('category')) filterCategory.value = params.get('category');
  if (params.get('severity')) filterSeverity.value = params.get('severity');
  if (params.get('page')) currentPage = parseInt(params.get('page')) || 1;
}

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
      opt.textContent = shortCategory(c.category);
      filterCategory.appendChild(opt);
    });
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('category')) filterCategory.value = params.get('category');
}

// Chart-to-filter bridge
function handleFilter({ key, value }) {
  const el = document.getElementById(`filter-${key}`);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }
}

async function loadViz() {
  const [
    { mountNhdByState },
    { mountNhdByCategory },
    { mountNhdBySeverity },
    { mountNhdByYear },
  ] = await Promise.all([
    import('../../src/viz/nhd-by-state.jsx'),
    import('../../src/viz/nhd-by-category.jsx'),
    import('../../src/viz/nhd-by-severity.jsx'),
    import('../../src/viz/nhd-by-year.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('nursing_home_stats');
  if (error) { console.error('Stats error:', error); return; }

  populateDropdowns(stats);

  const opts = { onFilter: handleFilter };
  mountNhdByState(document.getElementById('viz-by-state'), stats, opts);
  mountNhdByCategory(document.getElementById('viz-by-category'), stats, opts);
  mountNhdBySeverity(document.getElementById('viz-by-severity'), stats, opts);
  mountNhdByYear(document.getElementById('viz-by-year'), stats, opts);
}

readUrlState();
search();
loadViz();
