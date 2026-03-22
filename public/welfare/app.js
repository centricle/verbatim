import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const LICENSE_LABELS = { A: 'Breeder', B: 'Broker', C: 'Exhibitor', R: 'Research', T: 'Carrier', H: 'Handler', G: 'Govt Research' };

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('welfare-search-form');
const searchInput = document.getElementById('welfare-search');
const filterState = document.getElementById('filter-state');
const filterLicense = document.getElementById('filter-license');
const filterInspType = document.getElementById('filter-insp-type');
const resultsBody = document.getElementById('welfare-results');
const resultsInfo = document.getElementById('welfare-results-info');
const pagination = document.getElementById('welfare-pagination');
const prevBtn = document.getElementById('welfare-prev');
const nextBtn = document.getElementById('welfare-next');
const pageInfo = document.getElementById('welfare-page-info');

function formatType(t) {
  if (!t) return '—';
  return t.replace(/ INSPECTION/g, '').replace(/PRELICENSE/g, 'Pre-License')
    .replace(/PRE-LICENSE/g, 'Pre-License').replace(/RE-LICENSE/g, 'Re-License')
    .replace(/ROUTINE/g, 'Routine').replace(/FOCUSED/g, 'Focused')
    .replace(/NEW SITE/g, 'New Site');
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_license_type: filterLicense.value || null,
    filter_inspection_type: filterInspType.value || null,
    sort_by: 'date',
    sort_dir: 'desc',
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_aphis_inspections', params);

  if (error) {
    console.error('Search error:', error);
    resultsInfo.textContent = 'Error loading data.';
    return;
  }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No inspections match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} inspections`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 whitespace-nowrap">${d.inspection_date || '—'}</td>
      <td class="py-2 pr-3 text-xs max-w-[220px] truncate" title="${(d.entity_name || '').replace(/"/g, '&quot;')}">${d.entity_name || '—'}</td>
      <td class="py-2 pr-3 font-mono text-xs">${d.state || '—'}</td>
      <td class="py-2 pr-3 text-xs">${formatType(d.inspection_type)}</td>
      <td class="py-2 pr-3 text-xs">${LICENSE_LABELS[d.license_type] || d.license_type || '—'}</td>
      <td class="py-2 pr-3 text-right ${d.critical_count > 0 ? 'text-red-800 font-semibold' : ''}">${d.critical_count}</td>
      <td class="py-2 text-right">${d.non_critical_count}</td>
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
[filterState, filterLicense, filterInspType].forEach(el => {
  el.addEventListener('change', () => { currentPage = 1; search(); });
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; search(); } });
nextBtn.addEventListener('click', () => { currentPage++; search(); });

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) searchInput.value = params.get('q');
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('license')) filterLicense.value = params.get('license');
  if (params.get('type')) filterInspType.value = params.get('type');
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
  const params = new URLSearchParams(window.location.search);
  if (params.get('state')) filterState.value = params.get('state');
}

async function loadViz() {
  const [
    { mountAphisByYear },
    { mountAphisByState },
    { mountAphisByLicense },
    { mountAphisByType },
  ] = await Promise.all([
    import('../../src/viz/aphis-by-year.jsx'),
    import('../../src/viz/aphis-by-state.jsx'),
    import('../../src/viz/aphis-by-license.jsx'),
    import('../../src/viz/aphis-by-type.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('aphis_inspections_stats');
  if (error) { console.error('Stats error:', error); return; }

  populateDropdowns(stats);

  mountAphisByYear(document.getElementById('viz-by-year'), stats);
  mountAphisByState(document.getElementById('viz-by-state'), stats);
  mountAphisByLicense(document.getElementById('viz-by-license'), stats);
  mountAphisByType(document.getElementById('viz-by-type'), stats);
}

readUrlState();
search();
loadViz();
