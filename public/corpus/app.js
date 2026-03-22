import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const SPEAKERS = {
  'george-washington': 'George Washington',
  'john-adams': 'John Adams',
  'thomas-jefferson': 'Thomas Jefferson',
  'james-madison': 'James Madison',
  'james-monroe': 'James Monroe',
  'john-quincy-adams': 'John Quincy Adams',
  'andrew-jackson': 'Andrew Jackson',
  'martin-van-buren': 'Martin Van Buren',
  'william-henry-harrison': 'William Henry Harrison',
  'john-tyler': 'John Tyler',
  'james-k-polk': 'James K. Polk',
  'zachary-taylor': 'Zachary Taylor',
  'millard-fillmore': 'Millard Fillmore',
  'franklin-pierce': 'Franklin Pierce',
  'james-buchanan': 'James Buchanan',
  'abraham-lincoln': 'Abraham Lincoln',
  'andrew-johnson': 'Andrew Johnson',
  'ulysses-s-grant': 'Ulysses S. Grant',
  'rutherford-b-hayes': 'Rutherford B. Hayes',
  'james-a-garfield': 'James A. Garfield',
  'chester-a-arthur': 'Chester A. Arthur',
  'grover-cleveland': 'Grover Cleveland',
  'benjamin-harrison': 'Benjamin Harrison',
  'william-mckinley': 'William McKinley',
  'theodore-roosevelt': 'Theodore Roosevelt',
  'william-howard-taft': 'William Howard Taft',
  'woodrow-wilson': 'Woodrow Wilson',
  'warren-g-harding': 'Warren G. Harding',
  'calvin-coolidge': 'Calvin Coolidge',
  'herbert-hoover': 'Herbert Hoover',
  'franklin-d-roosevelt': 'Franklin D. Roosevelt',
  'harry-s-truman': 'Harry S. Truman',
  'dwight-d-eisenhower': 'Dwight D. Eisenhower',
  'john-f-kennedy': 'John F. Kennedy',
  'lyndon-b-johnson': 'Lyndon B. Johnson',
  'richard-nixon': 'Richard Nixon',
  'gerald-ford': 'Gerald Ford',
  'jimmy-carter': 'Jimmy Carter',
  'ronald-reagan': 'Ronald Reagan',
  'george-h-w-bush': 'George H. W. Bush',
  'bill-clinton': 'Bill Clinton',
  'george-w-bush': 'George W. Bush',
  'barack-obama': 'Barack Obama',
  'donald-trump': 'Donald Trump',
  'joe-biden': 'Joe Biden',
  'alexander-hamilton': 'Alexander Hamilton',
  'john-jay': 'John Jay',
  'constitutional-convention': 'Constitutional Convention',
  'continental-congress': 'Continental Congress',
  'winston-churchill': 'Winston Churchill',
  'mark-twain': 'Mark Twain',
  'frederick-douglass': 'Frederick Douglass',
  'benjamin-franklin': 'Benjamin Franklin',
  'susan-b-anthony': 'Susan B. Anthony',
  'elizabeth-cady-stanton': 'Elizabeth Cady Stanton',
};

const TYPE_LABELS = {
  tweet: 'Tweet',
  speech: 'Speech',
  address: 'Address',
  remarks: 'Remarks',
  press_conference: 'Press Conference',
  press_gaggle: 'Press Gaggle',
  interview: 'Interview',
  statement: 'Statement',
  executive_order: 'Executive Order',
  proclamation: 'Proclamation',
  memo: 'Memo',
  letter: 'Letter',
  founding_document: 'Founding Document',
  essay: 'Essay',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  page: 1,
  q: '',
  speaker: '',
  type: '',
  dateFrom: '',
  dateTo: '',
  tweets: false,
};

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

  // Tweet toggle
  $('#tweet-toggle').addEventListener('change', (e) => {
    state.tweets = e.target.checked;
    state.page = 1;
    loadStats();
    loadSpeakers();
    // If already searching, re-search
    if (state.q || state.speaker || state.type) {
      search();
    }
  });

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

  // Check URL params for initial search
  const params = new URLSearchParams(location.search);
  if (params.get('tweets') === '1') {
    state.tweets = true;
    $('#tweet-toggle').checked = true;
    // Reload stats/speakers with tweets included
    await loadStats();
    await loadSpeakers();
  }
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

  updateCorpusSummary();
}

function readFilters() {
  state.q = $('#search-input').value.trim();
  state.speaker = $('#filter-speaker').value;
  state.type = $('#filter-type').value;
  state.dateFrom = $('#filter-date-from').value;
  state.dateTo = $('#filter-date-to').value;
}

// --- Supabase API ---

async function loadStats() {
  const { data, error } = await supabase.rpc('get_stats', {
    exclude_tweets: !state.tweets,
  });

  if (error) {
    console.error('Stats error:', error);
    return;
  }

  $('#corpus-total').textContent = `${data.total.toLocaleString()} records`;

  // Types dropdown
  const typeSelect = $('#filter-type');
  // Preserve current selection
  const currentType = typeSelect.value;
  // Clear existing options (except first)
  while (typeSelect.options.length > 1) typeSelect.remove(1);

  data.by_type.forEach((t) => {
    const label = TYPE_LABELS[t.type] || t.type;
    const opt = document.createElement('option');
    opt.value = t.type;
    opt.textContent = `${label} (${t.count.toLocaleString()})`;
    typeSelect.appendChild(opt);
  });
  typeSelect.value = currentType;

  // Sidebar types
  $('#type-list').innerHTML = data.by_type
    .map((t) => {
      const label = TYPE_LABELS[t.type] || t.type;
      return `<button class="sidebar-btn w-full text-left px-2 py-1 rounded text-sm hover:bg-surface-hover transition-colors flex justify-between" data-type="${t.type}">
      <span>${label}</span><span class="text-text-dim">${t.count.toLocaleString()}</span>
    </button>`;
    }).join('');

  $$('#type-list .sidebar-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.type = btn.dataset.type;
      state.page = 1;
      $('#filter-type').value = state.type;
      search();
    });
  });

  // Sidebar sources
  $('#source-list').innerHTML = data.by_source
    .map((s) => `<div class="px-2 py-1 text-sm flex justify-between">
      <span class="text-text-dim">${s.source_name}</span><span class="text-text-dim">${s.count.toLocaleString()}</span>
    </div>`).join('');

  updateCorpusSummary();
}

async function loadSpeakers() {
  const { data, error } = await supabase.rpc('get_speakers', {
    exclude_tweets: !state.tweets,
  });

  if (error) {
    console.error('Speakers error:', error);
    return;
  }

  const select = $('#filter-speaker');
  const currentSpeaker = select.value;
  while (select.options.length > 1) select.remove(1);

  data.forEach((s) => {
    const name = SPEAKERS[s.slug] || s.slug;
    const opt = document.createElement('option');
    opt.value = s.slug;
    opt.textContent = `${name} (${s.count.toLocaleString()})`;
    select.appendChild(opt);
  });
  select.value = currentSpeaker;

  // Sidebar speaker list
  $('#speaker-list').innerHTML = data
    .map((s) => {
      const name = SPEAKERS[s.slug] || s.slug;
      return `<button class="sidebar-btn w-full text-left px-2 py-1 rounded text-sm hover:bg-surface-hover transition-colors flex justify-between" data-speaker="${s.slug}">
      <span>${name}</span><span class="text-text-dim">${s.count.toLocaleString()}</span>
    </button>`;
    }).join('');

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
  // Update URL
  const urlParams = new URLSearchParams();
  if (state.q) urlParams.set('q', state.q);
  if (state.speaker) urlParams.set('speaker', state.speaker);
  if (state.type) urlParams.set('type', state.type);
  if (state.dateFrom) urlParams.set('dateFrom', state.dateFrom);
  if (state.dateTo) urlParams.set('dateTo', state.dateTo);
  if (state.tweets) urlParams.set('tweets', '1');
  urlParams.set('page', state.page);
  history.replaceState(null, '', `?${urlParams}`);

  // If type is explicitly tweet, don't exclude tweets regardless of toggle
  const excludeTweets = state.type === 'tweet' ? false : !state.tweets;

  const { data, error } = await supabase.rpc('search_statements', {
    search_query: state.q || null,
    filter_speaker: state.speaker || null,
    filter_type: state.type || null,
    filter_date_from: state.dateFrom || null,
    filter_date_to: state.dateTo || null,
    exclude_tweets: excludeTweets,
    page_num: state.page,
    page_size: 25,
  });

  if (error) {
    console.error('Search error:', error);
    return;
  }

  const total = data.length > 0 ? data[0].total_count : 0;
  const pages = Math.ceil(total / 25);

  const results = data.map((r) => ({
    ...r,
    speaker_name: SPEAKERS[r.speaker] || r.speaker,
    type_label: TYPE_LABELS[r.type] || r.type,
  }));

  renderResults({ results, total, page: state.page, pages });
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

  $('main').scrollTo({ top: 0 });
}

function updateCorpusSummary() {
  const totalText = $('#corpus-total').textContent;
  const summary = $('#corpus-summary');
  if (summary && totalText) {
    summary.textContent = totalText + ' · 91 speakers · 1776–2025';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
