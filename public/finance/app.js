async function api(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/finance?${qs}`);
  return res.json();
}

let currentPage = 1;
const PAGE_SIZE = 50;

const form = document.getElementById('fec-search-form');
const searchInput = document.getElementById('fec-search');
const filterState = document.getElementById('filter-state');
const filterParty = document.getElementById('filter-party');
const filterOffice = document.getElementById('filter-office');
const resultsBody = document.getElementById('fec-results');
const resultsInfo = document.getElementById('fec-results-info');
const pagination = document.getElementById('fec-pagination');
const prevBtn = document.getElementById('fec-prev');
const nextBtn = document.getElementById('fec-next');
const pageInfo = document.getElementById('fec-page-info');

const partyColors = { DEM: '#2563eb', REP: '#dc2626', LIB: '#f59e0b', GRE: '#16a34a' };

function fmtMoney(n) {
  if (n == null || n === 0) return '—';
  const v = Number(n);
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toLocaleString();
}

function titleCase(s) {
  if (!s) return '—';
  return s.split(/[, ]+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

async function search() {
  const data = await api({
    q: searchInput.value.trim(),
    state: filterState.value,
    party: filterParty.value,
    office: filterOffice.value,
    page: currentPage,
    pageSize: PAGE_SIZE,
  });

  const totalCount = data.total;
  const rows = data.rows || [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalCount === 0) {
    resultsInfo.textContent = 'No candidates match your filters.';
  } else {
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCount);
    resultsInfo.textContent = `Showing ${start}–${end} of ${totalCount.toLocaleString()} candidates`;
  }

  resultsBody.innerHTML = rows.map(d => `
    <tr class="hover:bg-surface-alt transition-colors">
      <td class="py-2 pr-3 font-medium">${titleCase(d.cand_name)}</td>
      <td class="py-2 pr-3 text-xs"><span class="inline-block px-1.5 py-0.5 rounded text-white" style="background:${partyColors[d.party] || '#6b7280'}">${d.party || '—'}</span></td>
      <td class="py-2 pr-3 text-xs">${d.office || '—'}</td>
      <td class="py-2 pr-3 text-xs">${d.office === 'House' && d.cand_state ? d.cand_state + '-' + (d.cand_district || '00') : d.office === 'Senate' && d.cand_state ? d.cand_state : '—'}</td>
      <td class="py-2 pr-3 text-right tabular-nums">${fmtMoney(d.total_receipts)}</td>
      <td class="py-2 pr-3 text-right tabular-nums text-xs">${fmtMoney(d.total_disbursements)}</td>
      <td class="py-2 pr-3 text-right tabular-nums text-xs">${fmtMoney(d.cash_on_hand)}</td>
      <td class="py-2 text-right tabular-nums text-xs">${fmtMoney(d.indiv_contrib)}</td>
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
[filterState, filterParty, filterOffice].forEach(el => {
  el.addEventListener('change', () => { currentPage = 1; search(); });
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; search(); } });
nextBtn.addEventListener('click', () => { currentPage++; search(); });

function populateDropdowns(stats) {
  if (stats.state_list) {
    stats.state_list.filter(s => s.state !== '00').forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.state;
      opt.textContent = s.state;
      filterState.appendChild(opt);
    });
  }
}

// Bridge: chart click → table filter
function handleFilter({ key, value }) {
  const el = document.getElementById(`filter-${key}`);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }
}

async function loadViz() {
  const [
    { mountTopFundraisers },
    { mountByParty },
    { mountFECByState },
    { mountByOffice },
  ] = await Promise.all([
    import('../../src/viz/fec-top-fundraisers.jsx'),
    import('../../src/viz/fec-by-party.jsx'),
    import('../../src/viz/fec-by-state.jsx'),
    import('../../src/viz/fec-by-office.jsx'),
  ]);

  const stats = await api({ action: 'stats' });

  populateDropdowns(stats);
  const opts = { onFilter: handleFilter };
  mountTopFundraisers(document.getElementById('viz-top-fundraisers'), stats, opts);
  mountByParty(document.getElementById('viz-by-party'), stats, opts);
  mountFECByState(document.getElementById('viz-by-state'), stats, opts);
  mountByOffice(document.getElementById('viz-by-office'), stats, opts);
}

search();
loadViz();
