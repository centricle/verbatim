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

// Risk key: one neutral hue stepped light to dark, Low to High
function scoreBadgeClass(scoreText) {
  switch (scoreText) {
    case 'Low': return 'tx-level-1';
    case 'Medium': return 'tx-level-2';
    case 'High': return 'tx-level-3';
    default: return 'tx-other';
  }
}

// Recidivism key: filled for yes, empty for no
function recidBadge(val) {
  if (val === 1) return '<span class="tx-type tx-yes">Yes</span>';
  return '<span class="tx-type tx-no">No</span>';
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
    <tr>
      <td class="cell-name cell-lead">${d.name}</td>
      <td class="cell-nowrap">${d.race}</td>
      <td class="cell-num" data-label="Age">${d.age}</td>
      <td class="cell-dim">${d.sex}</td>
      <td class="cell-clip cell-dim cell-wide" title="${(d.c_charge_desc || '').replace(/"/g, '&quot;')}">${d.c_charge_desc || '—'}</td>
      <td class="cell-num cell-l3" data-label="Score">${d.decile_score}</td>
      <td class="cell-trail">
        <span class="tx-type ${scoreBadgeClass(d.score_text)}">${d.score_text}</span>
      </td>
      <td class="cell-push cell-l3" data-label="Recidivated">${recidBadge(d.two_year_recid)}</td>
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
