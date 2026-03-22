import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('tri-search-form');
const searchInput = document.getElementById('tri-search');
const filterState = document.getElementById('filter-state');
const filterChemical = document.getElementById('filter-chemical');
const filterIndustry = document.getElementById('filter-industry');
const filterCarcinogen = document.getElementById('filter-carcinogen');
const resultsBody = document.getElementById('tri-results');
const resultsInfo = document.getElementById('tri-results-info');
const pagination = document.getElementById('tri-pagination');
const prevBtn = document.getElementById('tri-prev');
const nextBtn = document.getElementById('tri-next');
const pageInfo = document.getElementById('tri-page-info');

function formatLbs(v) {
  v = Number(v);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B lbs`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M lbs`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K lbs`;
  return `${v.toLocaleString()} lbs`;
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_chemical: filterChemical.value || null,
    filter_industry: filterIndustry.value || null,
    filter_carcinogen: filterCarcinogen.value === '' ? null : filterCarcinogen.value === 'true',
    sort_by: 'total_releases',
    sort_dir: 'desc',
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_tri_releases', params);

  if (error) {
    console.error('Search error:', error);
    resultsInfo.textContent = 'Error loading data.';
    return;
  }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No releases match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} releases`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 text-xs max-w-[200px] truncate" title="${(d.facility_name || '').replace(/"/g, '&quot;')}">${d.facility_name || '—'}</td>
      <td class="py-2 pr-3 font-mono text-xs">${d.state || '—'}</td>
      <td class="py-2 pr-3 text-xs max-w-[160px] truncate" title="${(d.chemical || '').replace(/"/g, '&quot;')}">${d.chemical || '—'}</td>
      <td class="py-2 pr-3 text-xs max-w-[140px] truncate" title="${(d.industry_sector || '').replace(/"/g, '&quot;')}">${d.industry_sector || '—'}</td>
      <td class="py-2 pr-3 text-right text-xs">${formatLbs(d.total_releases)}</td>
      <td class="py-2 text-xs ${d.carcinogen ? 'text-red-800 font-semibold' : ''}">${d.carcinogen ? 'Yes' : 'No'}</td>
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
[filterState, filterChemical, filterIndustry, filterCarcinogen].forEach(el => {
  el.addEventListener('change', () => { currentPage = 1; search(); });
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; search(); } });
nextBtn.addEventListener('click', () => { currentPage++; search(); });

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('q')) searchInput.value = params.get('q');
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('chemical')) filterChemical.value = params.get('chemical');
  if (params.get('industry')) filterIndustry.value = params.get('industry');
  if (params.get('carcinogen')) filterCarcinogen.value = params.get('carcinogen');
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
  if (stats.chemical_list) {
    stats.chemical_list.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.chemical;
      opt.textContent = c.chemical;
      filterChemical.appendChild(opt);
    });
  }
  if (stats.industry_list) {
    stats.industry_list.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.industry_sector;
      opt.textContent = i.industry_sector;
      filterIndustry.appendChild(opt);
    });
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('state')) filterState.value = params.get('state');
  if (params.get('chemical')) filterChemical.value = params.get('chemical');
  if (params.get('industry')) filterIndustry.value = params.get('industry');
}

async function loadViz() {
  const [
    { mountTriByState },
    { mountTriByChemical },
    { mountTriByIndustry },
    { mountTriCarcinogen },
  ] = await Promise.all([
    import('../../src/viz/tri-by-state.jsx'),
    import('../../src/viz/tri-by-chemical.jsx'),
    import('../../src/viz/tri-by-industry.jsx'),
    import('../../src/viz/tri-carcinogen.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('tri_releases_stats');
  if (error) { console.error('Stats error:', error); return; }

  populateDropdowns(stats);

  mountTriByState(document.getElementById('viz-by-state'), stats);
  mountTriByChemical(document.getElementById('viz-by-chemical'), stats);
  mountTriByIndustry(document.getElementById('viz-by-industry'), stats);
  mountTriCarcinogen(document.getElementById('viz-carcinogen'), stats);
}

readUrlState();
search();
loadViz();
