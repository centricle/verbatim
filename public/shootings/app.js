import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('shootings-search-form');
const searchInput = document.getElementById('shootings-search');
const filterState = document.getElementById('filter-state');
const filterRace = document.getElementById('filter-race');
const filterArmed = document.getElementById('filter-armed');
const filterYear = document.getElementById('filter-year');
const resultsBody = document.getElementById('shootings-results');
const resultsInfo = document.getElementById('shootings-results-info');
const pagination = document.getElementById('shootings-pagination');
const prevBtn = document.getElementById('shootings-prev');
const nextBtn = document.getElementById('shootings-next');
const pageInfo = document.getElementById('shootings-page-info');

const raceLabels = { W: 'White', B: 'Black', H: 'Hispanic', A: 'Asian', N: 'Native Am.', O: 'Other' };

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function armedLabel(a) {
  if (!a) return '—';
  return a.replace(/_/g, ' ');
}

async function search() {
  const params = {
    search_query: searchInput.value.trim() || null,
    filter_state: filterState.value || null,
    filter_race: filterRace.value || null,
    filter_armed: filterArmed.value || null,
    filter_year: filterYear.value || null,
    page_num: currentPage,
    page_size: PAGE_SIZE,
  };

  const { data, error } = await supabase.rpc('search_police_shootings', params);
  if (error) { console.error('Search error:', error); resultsInfo.textContent = 'Error loading data.'; return; }

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No records match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} fatal shootings`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 whitespace-nowrap">${fmtDate(d.date)}</td>
      <td class="py-2 pr-3 font-medium">${d.name || 'Unknown'}</td>
      <td class="py-2 pr-3">${d.age || '—'}</td>
      <td class="py-2 pr-3">${raceLabels[d.race] || d.race || '—'}</td>
      <td class="py-2 pr-3 text-xs">${d.city || ''}, ${d.state || ''}</td>
      <td class="py-2 pr-3 text-xs">${armedLabel(d.armed_with)}</td>
      <td class="py-2 pr-3 text-xs">${d.flee_status || '—'}</td>
      <td class="py-2 text-xs">${d.body_camera ? 'Yes' : 'No'}</td>
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
[filterState, filterRace, filterArmed, filterYear].forEach(el => {
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
    { mountShootingsByYear },
    { mountShootingsByRace },
    { mountShootingsByArmed },
    { mountShootingsByState },
  ] = await Promise.all([
    import('../../src/viz/shootings-by-year.jsx'),
    import('../../src/viz/shootings-by-race.jsx'),
    import('../../src/viz/shootings-by-armed.jsx'),
    import('../../src/viz/shootings-by-state.jsx'),
  ]);

  const { data: stats, error } = await supabase.rpc('police_shootings_stats');
  if (error) { console.error('Stats error:', error); return; }

  populateDropdowns(stats);
  mountShootingsByYear(document.getElementById('viz-by-year'), stats);
  mountShootingsByRace(document.getElementById('viz-by-race'), stats);
  mountShootingsByArmed(document.getElementById('viz-by-armed'), stats);
  mountShootingsByState(document.getElementById('viz-by-state'), stats);
}

search();
loadViz();
