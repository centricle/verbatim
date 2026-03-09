const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = { page: 1, q: '', speaker: '', type: '', dateFrom: '', dateTo: '' };

// --- Init ---

async function init() {
  await loadStats();
  await loadSpeakers();

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.page = 1;
    readFilters();
    search();
  });

  $('#prev-page').addEventListener('click', () => { state.page--; search(); });
  $('#next-page').addEventListener('click', () => { state.page++; search(); });

  // Thread card clicks
  $$('.thread-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const q = card.dataset.search;
      state.q = q;
      state.speaker = '';
      state.type = '';
      state.dateFrom = '';
      state.dateTo = '';
      state.page = 1;
      $('#search-input').value = q;
      $('#filter-speaker').value = '';
      $('#filter-type').value = '';
      $('#filter-date-from').value = '';
      $('#filter-date-to').value = '';
      search();
    });
  });

  // Corpus summary line (use stats already loaded in header)
  const totalText = $('#corpus-total').textContent;
  const summary = $('#corpus-summary');
  if (summary && totalText) {
    summary.textContent = totalText + ' \u00b7 50 speakers \u00b7 1776\u20132025';
  }

  // Check URL params for initial search
  const params = new URLSearchParams(location.search);
  if (params.get('q') || params.get('speaker') || params.get('type')) {
    state.q = params.get('q') || '';
    state.speaker = params.get('speaker') || '';
    state.type = params.get('type') || '';
    state.dateFrom = params.get('dateFrom') || '';
    state.dateTo = params.get('dateTo') || '';
    $('#search-input').value = state.q;
    $('#filter-speaker').value = state.speaker;
    $('#filter-type').value = state.type;
    $('#filter-date-from').value = state.dateFrom;
    $('#filter-date-to').value = state.dateTo;
    search();
  }
}

function readFilters() {
  state.q = $('#search-input').value.trim();
  state.speaker = $('#filter-speaker').value;
  state.type = $('#filter-type').value;
  state.dateFrom = $('#filter-date-from').value;
  state.dateTo = $('#filter-date-to').value;
}

// --- API ---

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadStats() {
  const stats = await fetchJSON('/api/stats');
  $('#corpus-total').textContent = `${stats.total.toLocaleString()} records`;

  // Types dropdown
  const typeSelect = $('#filter-type');
  stats.by_type.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.type;
    opt.textContent = `${t.label} (${t.count.toLocaleString()})`;
    typeSelect.appendChild(opt);
  });

  // Sidebar types
  $('#type-list').innerHTML = stats.by_type
    .map((t) => `<button class="sidebar-btn w-full text-left px-2 py-1 rounded text-sm hover:bg-surface-hover transition-colors flex justify-between" data-type="${t.type}">
      <span>${t.label}</span><span class="text-text-dim">${t.count.toLocaleString()}</span>
    </button>`).join('');

  $$('#type-list .sidebar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type;
      state.page = 1;
      $('#filter-type').value = state.type;
      search();
    });
  });

  // Sidebar sources
  $('#source-list').innerHTML = stats.by_source
    .map((s) => `<div class="px-2 py-1 text-sm flex justify-between">
      <span class="text-text-dim">${s.source_name}</span><span class="text-text-dim">${s.count.toLocaleString()}</span>
    </div>`).join('');
}

async function loadSpeakers() {
  const speakers = await fetchJSON('/api/speakers');
  const select = $('#filter-speaker');

  speakers.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.slug;
    opt.textContent = `${s.name} (${s.count.toLocaleString()})`;
    select.appendChild(opt);
  });

  // Sidebar speaker list
  $('#speaker-list').innerHTML = speakers
    .map((s) => `<button class="sidebar-btn w-full text-left px-2 py-1 rounded text-sm hover:bg-surface-hover transition-colors flex justify-between" data-speaker="${s.slug}">
      <span>${s.name}</span><span class="text-text-dim">${s.count.toLocaleString()}</span>
    </button>`).join('');

  $$('#speaker-list .sidebar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.speaker = btn.dataset.speaker;
      state.page = 1;
      $('#filter-speaker').value = state.speaker;
      search();
    });
  });
}

async function search() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.speaker) params.set('speaker', state.speaker);
  if (state.type) params.set('type', state.type);
  if (state.dateFrom) params.set('dateFrom', state.dateFrom);
  if (state.dateTo) params.set('dateTo', state.dateTo);
  params.set('page', state.page);
  params.set('limit', 25);

  // Update URL without reload
  const urlParams = new URLSearchParams(params);
  urlParams.delete('limit');
  history.replaceState(null, '', `?${urlParams}`);

  const data = await fetchJSON(`/api/search?${params}`);
  renderResults(data);
}

// --- Render ---

function renderResults(data) {
  const { results, total, page, pages } = data;
  const container = $('#results');
  const empty = $('#empty-state');
  const info = $('#results-info');
  const pagination = $('#pagination');

  if (total === 0 && !state.q && !state.speaker && !state.type) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    info.classList.add('hidden');
    pagination.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  info.classList.remove('hidden');
  info.textContent = total === 0
    ? 'No results found'
    : `${total.toLocaleString()} results — page ${page} of ${pages}`;

  container.innerHTML = results.map((r) => `
    <div class="bg-surface-alt border border-border rounded-lg p-4 hover:border-accent/30 transition-colors">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-medium text-sm">${r.speaker_name}</span>
          <span class="badge badge-${r.type}">${r.type_label}</span>
          ${r.date ? `<span class="text-xs text-text-dim">${r.date}</span>` : ''}
        </div>
        ${r.source_url ? `<a href="${r.source_url}" target="_blank" rel="noopener" class="text-text-dim hover:text-accent text-xs shrink-0">source ↗</a>` : ''}
      </div>
      ${r.title ? `<div class="text-sm font-medium mb-1">${escapeHtml(r.title)}</div>` : ''}
      <div class="text-sm text-text-dim leading-relaxed">${r.snippet || ''}</div>
    </div>
  `).join('');

  // Pagination
  if (pages > 1) {
    pagination.classList.remove('hidden');
    $('#prev-page').disabled = page <= 1;
    $('#next-page').disabled = page >= pages;
    $('#page-info').textContent = `${page} / ${pages}`;
  } else {
    pagination.classList.add('hidden');
  }

  // Scroll to top
  $('main').scrollTo({ top: 0 });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
