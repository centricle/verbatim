async function api(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/qi?${qs}`);
  return res.json();
}

// State
let currentPage = 1;
const PAGE_SIZE = 50;

// DOM refs
const form = document.getElementById('qi-search-form');
const searchInput = document.getElementById('qi-search');
const filterCircuit = document.getElementById('filter-circuit');
const filterRuling = document.getElementById('filter-ruling');
const filterViolation = document.getElementById('filter-violation');
const resultsBody = document.getElementById('qi-results');
const resultsInfo = document.getElementById('qi-results-info');
const pagination = document.getElementById('qi-pagination');
const prevBtn = document.getElementById('qi-prev');
const nextBtn = document.getElementById('qi-next');
const pageInfo = document.getElementById('qi-page-info');

// Ruling key: the same ruling colors Figure 3 uses
function rulingBadgeClass(ruling) {
  if (ruling === 'granted') return 'tx-series-2';
  if (ruling === 'denied') return 'tx-series-1';
  if (ruling === 'mixed') return 'tx-series-3';
  return 'tx-other';
}

// Title case
function titleCase(s) {
  if (!s) return '—';
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

async function search() {
  const data = await api({
    q: searchInput.value.trim(),
    circuit: filterCircuit.value,
    ruling: filterRuling.value,
    violation: filterViolation.value,
    page: currentPage,
    pageSize: PAGE_SIZE,
  });

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No cases match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} cases`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr>
      <td class="cell-dim cell-nowrap cell-trail">${d.year || '—'}</td>
      <td class="cell-dim">${d.circuit || '—'}</td>
      <td class="cell-name cell-lead cell-clip cell-clip--mid" title="${(d.case_name || '').replace(/"/g, '&quot;')}">${d.case_name || '—'}</td>
      <td class="cell-push">
        <span class="tx-type ${rulingBadgeClass(d.qi_ruling)}">${titleCase(d.qi_ruling)}</span>
      </td>
      <td class="cell-clip cell-clip--narrow cell-dim cell-wide" title="${(d.violation_type || '').replace(/"/g, '&quot;')}">${d.violation_type || '—'}</td>
      <td class="cell-dim cell-l3" data-label="Defendant">${titleCase(d.defendant_type)}</td>
      <td class="cell-dim cell-l3 cell-push" data-label="Prevailing">${titleCase(d.prevailing_party)}</td>
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

[filterCircuit, filterRuling, filterViolation].forEach(el => {
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
  if (params.get('circuit')) filterCircuit.value = params.get('circuit');
  if (params.get('ruling')) filterRuling.value = params.get('ruling');
  if (params.get('violation')) filterViolation.value = params.get('violation');
  if (params.get('page')) currentPage = parseInt(params.get('page')) || 1;
}

// Populate dropdowns from stats
function populateDropdowns(stats) {
  if (stats.circuit_list) {
    stats.circuit_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.circuit;
      opt.textContent = s.circuit;
      filterCircuit.appendChild(opt);
    });
  }
  if (stats.ruling_list) {
    stats.ruling_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.qi_ruling;
      opt.textContent = titleCase(s.qi_ruling);
      filterRuling.appendChild(opt);
    });
  }
  if (stats.violation_list) {
    stats.violation_list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.violation_type;
      opt.textContent = s.violation_type;
      filterViolation.appendChild(opt);
    });
  }
  // Restore URL state after dropdowns populated
  const params = new URLSearchParams(window.location.search);
  if (params.get('circuit')) filterCircuit.value = params.get('circuit');
  if (params.get('ruling')) filterRuling.value = params.get('ruling');
  if (params.get('violation')) filterViolation.value = params.get('violation');
}

// Chart-to-filter bridge
function handleFilter({ key, value }) {
  const el = document.getElementById(`filter-${key}`);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }
}

// Load viz components
async function loadViz() {
  const [
    { mountQiByCircuit },
    { mountQiByYear },
    { mountQiByRuling },
    { mountQiByViolation },
  ] = await Promise.all([
    import('../../src/viz/qi-by-circuit.jsx'),
    import('../../src/viz/qi-by-year.jsx'),
    import('../../src/viz/qi-by-ruling.jsx'),
    import('../../src/viz/qi-by-violation.jsx'),
  ]);

  const stats = await api({ action: 'stats' });

  populateDropdowns(stats);

  const opts = { onFilter: handleFilter };
  mountQiByCircuit(document.getElementById('viz-by-circuit'), stats, opts);
  mountQiByYear(document.getElementById('viz-by-year'), stats, opts);
  mountQiByRuling(document.getElementById('viz-by-ruling'), stats, opts);
  mountQiByViolation(document.getElementById('viz-by-violation'), stats, opts);
}

// Init
readUrlState();
search();
loadViz();
