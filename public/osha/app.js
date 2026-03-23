import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('osha-search-form');
const searchInput = document.getElementById('osha-search');
const filterState = document.getElementById('filter-state');
const filterSector = document.getElementById('filter-sector');
const resultsBody = document.getElementById('osha-results');
const resultsInfo = document.getElementById('osha-results-info');
const pagination = document.getElementById('osha-pagination');
const prevBtn = document.getElementById('osha-prev');
const nextBtn = document.getElementById('osha-next');
const pageInfo = document.getElementById('osha-page-info');

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_sector: filterSector.value || null,
    filter_year: null,
    sort_by: 'total_injuries',
    sort_dir: 'desc',
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_osha_injuries', params);

  if (error) {
    console.error('Search error:', error);
    resultsInfo.textContent = 'Error loading data.';
    return;
  }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No reports match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}\u2013${end} of ${totalCount.toLocaleString()} reports`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 text-xs max-w-[220px] truncate" title="${(d.establishment_name || '').replace(/"/g, '&quot;')}">${d.establishment_name || '\u2014'}</td>
      <td class="py-2 pr-3 text-xs whitespace-nowrap">${d.city || '\u2014'}${d.state ? ', ' + d.state : ''}</td>
      <td class="py-2 pr-3 text-xs max-w-[160px] truncate" title="${(d.sector || '').replace(/"/g, '&quot;')}">${d.sector || '\u2014'}</td>
      <td class="py-2 pr-3 text-right font-mono text-xs">${d.annual_average_employees ? Number(d.annual_average_employees).toLocaleString() : '\u2014'}</td>
      <td class="py-2 pr-3 text-right font-mono text-xs">${d.total_injuries != null ? Number(d.total_injuries).toLocaleString() : '\u2014'}</td>
      <td class="py-2 text-right font-mono text-xs ${Number(d.total_deaths) > 0 ? 'text-red-800 font-semibold' : ''}">${d.total_deaths != null ? Number(d.total_deaths) : '\u2014'}</td>
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
[filterState, filterSector].forEach(el => {
  el.addEventListener('change', () => { currentPage = 1; search(); });
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; search(); } });
nextBtn.addEventListener('click', () => { currentPage++; search(); });

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) searchInput.value = params.get('q');
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('sector')) filterSector.value = params.get('sector');
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
  if (stats.sector_list) {
    stats.sector_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.sector;
      opt.textContent = s.sector;
      filterSector.appendChild(opt);
    });
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('sector')) filterSector.value = params.get('sector');
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
    { mountOshaByState },
    { mountOshaBySector },
    { mountOshaByInjuryType },
    { mountOshaDeathsBySector },
  ] = await Promise.all([
    import('../../src/viz/osha-by-state.jsx'),
    import('../../src/viz/osha-by-sector.jsx'),
    import('../../src/viz/osha-by-injury-type.jsx'),
    import('../../src/viz/osha-deaths-by-sector.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('osha_injuries_stats');
  if (error) { console.error('Stats error:', error); return; }

  populateDropdowns(stats);

  const opts = { onFilter: handleFilter };
  mountOshaByState(document.getElementById('viz-by-state'), stats, opts);
  mountOshaBySector(document.getElementById('viz-by-sector'), stats, opts);
  mountOshaByInjuryType(document.getElementById('viz-by-injury-type'), stats);
  mountOshaDeathsBySector(document.getElementById('viz-deaths-by-sector'), stats, opts);
}

readUrlState();
search();
loadViz();
