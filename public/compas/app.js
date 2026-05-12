async function api(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/compas?${qs}`);
  return res.json();
}

// State
let currentPage = 1;
const PAGE_SIZE = 50;

// DOM refs
const form = document.getElementById('compas-search-form');
const searchInput = document.getElementById('compas-search');
const filterRace = document.getElementById('filter-race');
const filterScore = document.getElementById('filter-score');
const filterSex = document.getElementById('filter-sex');
const filterRecid = document.getElementById('filter-recid');
const resultsBody = document.getElementById('compas-results');
const resultsInfo = document.getElementById('compas-results-info');
const pagination = document.getElementById('compas-pagination');
const prevBtn = document.getElementById('compas-prev');
const nextBtn = document.getElementById('compas-next');
const pageInfo = document.getElementById('compas-page-info');

// Score badge colors
function scoreBadgeClass(scoreText) {
  switch (scoreText) {
    case 'Low': return 'bg-[oklch(0.92_0.05_145)] text-[oklch(0.35_0.08_145)]';
    case 'Medium': return 'bg-[oklch(0.90_0.07_75)] text-[oklch(0.40_0.10_60)]';
    case 'High': return 'bg-[oklch(0.88_0.06_25)] text-[oklch(0.38_0.10_20)]';
    default: return 'bg-surface-hover text-text-dim';
  }
}

// Recidivism badge
function recidBadge(val) {
  if (val === 1) return '<span class="badge bg-[oklch(0.88_0.06_25)] text-[oklch(0.38_0.10_20)]">Yes</span>';
  return '<span class="badge bg-[oklch(0.92_0.05_145)] text-[oklch(0.35_0.08_145)]">No</span>';
}

async function search() {
  const data = await api({
    q: searchInput.value.trim(),
    race: filterRace.value,
    score: filterScore.value,
    sex: filterSex.value,
    recid: filterRecid.value,
    page: currentPage,
    pageSize: PAGE_SIZE,
  });

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Results info
  if (totalCount === 0) {
    resultsInfo.textContent = 'No defendants match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} defendants`;
  }

  // Render table rows
  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 font-medium">${d.name}</td>
      <td class="py-2 pr-3">${d.race}</td>
      <td class="py-2 pr-3">${d.age}</td>
      <td class="py-2 pr-3">${d.sex}</td>
      <td class="py-2 pr-3 text-xs">${d.c_charge_desc || '—'}</td>
      <td class="py-2 pr-3">
        <span class="badge ${scoreBadgeClass(d.score_text)}">${d.decile_score}</span>
      </td>
      <td class="py-2 pr-3">
        <span class="badge ${scoreBadgeClass(d.score_text)}">${d.score_text}</span>
      </td>
      <td class="py-2">${recidBadge(d.two_year_recid)}</td>
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

// Live filter on select changes
[filterRace, filterScore, filterSex, filterRecid].forEach(el => {
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
  if (params.get('race')) filterRace.value = params.get('race');
  if (params.get('score')) filterScore.value = params.get('score');
  if (params.get('sex')) filterSex.value = params.get('sex');
  if (params.get('recid')) filterRecid.value = params.get('recid');
  if (params.get('page')) currentPage = parseInt(params.get('page')) || 1;
}

// Load viz components (React + D3)
async function loadViz() {
  const { mountScoreDistribution } = await import('../../src/viz/score-distribution.jsx');
  const { mountFalsePositive } = await import('../../src/viz/false-positive.jsx');
  const { mountAccuracy } = await import('../../src/viz/accuracy.jsx');

  const stats = await api({ action: 'stats' });

  mountScoreDistribution(document.getElementById('viz-score-distribution'), stats);
  mountFalsePositive(document.getElementById('viz-false-positive'), stats);
  mountAccuracy(document.getElementById('viz-accuracy'), stats);
}

// Init
readUrlState();
search();
loadViz();
