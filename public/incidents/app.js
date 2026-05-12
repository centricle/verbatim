async function api(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/incidents?${qs}`);
  return res.json();
}

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('incidents-search-form');
const searchInput = document.getElementById('incidents-search');
const filterState = document.getElementById('filter-state');
const filterRace = document.getElementById('filter-race');
const filterArmed = document.getElementById('filter-armed');
const filterYear = document.getElementById('filter-year');
const resultsBody = document.getElementById('incidents-results');
const resultsInfo = document.getElementById('incidents-results-info');
const pagination = document.getElementById('incidents-pagination');
const prevBtn = document.getElementById('incidents-prev');
const nextBtn = document.getElementById('incidents-next');
const pageInfo = document.getElementById('incidents-page-info');

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
  const data = await api({
    q: searchInput.value.trim(),
    state: filterState.value,
    race: filterRace.value,
    armed: filterArmed.value,
    year: filterYear.value,
    page: currentPage,
    pageSize: PAGE_SIZE,
  });

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

function handleFilter({ key, value }) {
  const el = document.getElementById(`filter-${key}`);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }
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

  const stats = await api({ action: 'stats' });

  populateDropdowns(stats);
  const opts = { onFilter: handleFilter };
  mountShootingsByYear(document.getElementById('viz-by-year'), stats, opts);
  mountShootingsByRace(document.getElementById('viz-by-race'), stats, opts);
  mountShootingsByArmed(document.getElementById('viz-by-armed'), stats, opts);
  mountShootingsByState(document.getElementById('viz-by-state'), stats, opts);
}

search();
loadViz();
