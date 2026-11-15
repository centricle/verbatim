// Shared behavior for the dataset explorers (trades, compas, incidents,
// finance, qi, crashes). Each page is the same machine: a search box, filter selects,
// a paged table fed by `/api/<x>?action=search`, and chart islands fed by
// `?action=stats` that set a filter when clicked. The page's app.js supplies
// only what differs: its endpoint, filter keys, row markup and charts.
//
// Three properties every explorer gets from here, and none had before:
//
// - The URL is the record of the page's state. Every search, filter and page
//   change is pushed to history and read back on popstate, so a link
//   reproduces the table and the back button walks through the changes.
// - A new search aborts the one in flight, so the response rendered is the
//   one asked for last, not whichever arrived last.
// - Row markup is built with `html`, which escapes every interpolated value.
//   The rows used to interpolate database text straight into innerHTML.
//
// State lives in `state`, not in the form controls. A select whose options
// come from stats cannot hold a deep-linked value until they arrive; reading
// the control back early dropped the filter, so the table loaded unfiltered
// while the select later showed the filter.

const PAGE_SIZE = 50;

// ---- Escaping -------------------------------------------------------------

class Markup {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

let decoder = null;

// Some sources bake HTML entities into their text (`&amp;`, `&nbsp;` in the
// Senate filings' asset descriptions). innerHTML used to decode them as a side
// effect of parsing each row as markup, which is the same property that made
// it unsafe. Decode them explicitly instead: a textarea's content is raw text,
// so nothing inside it is ever parsed as an element or run.
function decodeEntities(text) {
  if (!text.includes('&')) return text;
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = text;
  return decoder.value;
}

function interpolate(value) {
  if (value instanceof Markup) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  if (value == null) return '';
  return decodeEntities(String(value)).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Tagged template for row markup. Each `${value}` is entity-decoded, then
// escaped, so the source's text shows as text. Values that are themselves
// `html` results (a badge inside a cell) pass through as markup.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += interpolate(value) + strings[i + 1];
  });
  return new Markup(out);
}

// ---- Explorer -------------------------------------------------------------

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {object} cfg
 * @param {string} cfg.prefix     Element id prefix: `<prefix>-search-form`, `-search`,
 *                                `-results`, `-results-info`, `-pagination`, `-prev`,
 *                                `-next`, `-page-info`.
 * @param {string} cfg.endpoint   `/api/<x>`.
 * @param {string[]} cfg.filters  Filter keys. Each is a `#filter-<key>` select, a URL
 *                                param and an API param of the same name.
 * @param {(row: object) => Markup} cfg.row  One `<tr>`, built with `html`.
 * @param {string} cfg.noun       Plural noun in "Showing 1–50 of 7,740 <noun>".
 * @param {string} cfg.emptyText  Results line when nothing matches.
 * @param {string} [cfg.errorText] Results line when a search fails. Unset leaves the
 *                                table as it was.
 * @param {(page: number, pageSize: number) => object} [cfg.pageParams]
 *                                How the endpoint takes paging. Default `{ page, pageSize }`.
 * @param {(stats: object) => Record<string, [string, string][]>} [cfg.options]
 *                                Select options read from stats, as `[value, label]`
 *                                pairs per filter key, appended after the markup's own.
 * @param {(stats: object, opts: { onFilter: Function }) => unknown} [cfg.charts]
 *                                Mount the charts. Start their imports before calling
 *                                `createExplorer`, so they load while stats is in flight.
 */
export function createExplorer(cfg) {
  const byId = (suffix) => document.getElementById(`${cfg.prefix}-${suffix}`);
  const form = byId('search-form');
  const searchInput = byId('search');
  const resultsBody = byId('results');
  const resultsInfo = byId('results-info');
  const pagination = byId('pagination');
  const prevBtn = byId('prev');
  const nextBtn = byId('next');
  const pageInfo = byId('page-info');
  const selects = Object.fromEntries(
    cfg.filters.map((key) => [key, document.getElementById(`filter-${key}`)]),
  );
  const keys = ['q', ...cfg.filters];
  const pageParams = cfg.pageParams ?? ((page, pageSize) => ({ page, pageSize }));

  let state = readUrl();
  let inFlight = null;

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const next = { page: Math.max(1, parseInt(params.get('page'), 10) || 1) };
    for (const key of keys) next[key] = params.get(key) ?? '';
    return next;
  }

  // Params this page does not own (a utm tag, say) are kept as they were.
  function urlFor(s) {
    const params = new URLSearchParams(location.search);
    for (const key of [...keys, 'page']) params.delete(key);
    for (const key of keys) if (s[key]) params.set(key, s[key]);
    if (s.page > 1) params.set('page', String(s.page));
    const qs = params.toString();
    return location.pathname + (qs ? `?${qs}` : '') + location.hash;
  }

  function syncControls() {
    searchInput.value = state.q;
    for (const key of cfg.filters) selects[key].value = state[key];
  }

  // Every user action also takes the search box's current text, submitted or
  // not, as the page always has: changing a filter after typing searches both.
  function commit(changes) {
    state = { ...state, q: searchInput.value.trim(), ...changes };
    const url = urlFor(state);
    if (url !== location.pathname + location.search + location.hash) {
      history.pushState(null, '', url);
    }
    search();
  }

  async function search() {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    const params = {};
    for (const key of keys) params[key] = state[key];
    Object.assign(params, pageParams(state.page, PAGE_SIZE));

    let data;
    try {
      data = await getJson(`${cfg.endpoint}?${new URLSearchParams(params)}`, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(err);
      if (cfg.errorText) {
        resultsInfo.textContent = cfg.errorText;
        resultsBody.replaceChildren();
        pagination.classList.add('hidden');
      }
      return;
    }
    if (controller.signal.aborted) return;
    render(data);
  }

  function render(data) {
    const total = Number(data.total) || 0;
    const rows = data.rows || [];
    const totalPages = Math.ceil(total / PAGE_SIZE);

    // A link can name a page past the end: the data changed, or someone
    // edited the URL. Land on the last page rather than print a range that
    // starts beyond the total.
    if (total > 0 && state.page > totalPages) {
      state = { ...state, page: totalPages };
      history.replaceState(null, '', urlFor(state));
      search();
      return;
    }

    if (total === 0) {
      resultsInfo.textContent = cfg.emptyText;
    } else {
      const start = (state.page - 1) * PAGE_SIZE + 1;
      const end = Math.min(state.page * PAGE_SIZE, total);
      resultsInfo.textContent = `Showing ${start}–${end} of ${total.toLocaleString()} ${cfg.noun}`;
    }

    resultsBody.innerHTML = rows.map(cfg.row).join('');

    if (totalPages > 1) {
      pagination.classList.remove('hidden');
      pageInfo.textContent = `Page ${state.page} of ${totalPages.toLocaleString()}`;
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = state.page >= totalPages;
    } else {
      pagination.classList.add('hidden');
    }
  }

  // Chart click: same path as choosing the option by hand. A value the select
  // has no option for clears the filter rather than filtering invisibly.
  function onFilter({ key, value }) {
    const select = selects[key];
    if (!select) return;
    select.value = value;
    commit({ [key]: select.value, page: 1 });
  }

  function addOptions(stats) {
    const lists = cfg.options?.(stats) ?? {};
    for (const [key, pairs] of Object.entries(lists)) {
      const select = selects[key];
      for (const [value, label] of pairs) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      // The deep-linked value has an option to land on now.
      select.value = state[key];
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    commit({ page: 1 });
  });
  for (const key of cfg.filters) {
    selects[key].addEventListener('change', () => commit({ [key]: selects[key].value, page: 1 }));
  }
  prevBtn.addEventListener('click', () => {
    if (state.page > 1) commit({ page: state.page - 1 });
  });
  nextBtn.addEventListener('click', () => commit({ page: state.page + 1 }));
  window.addEventListener('popstate', () => {
    state = readUrl();
    syncControls();
    search();
  });

  syncControls();
  search();

  // Stats feeds the select options and the charts. It used to be requested
  // only after the chart modules had loaded, so the selects waited on the
  // React + D3 chunk; now it goes out with the first search.
  getJson(`${cfg.endpoint}?action=stats`)
    .then((stats) => {
      addOptions(stats);
      return cfg.charts?.(stats, { onFilter });
    })
    .catch((err) => console.error(err));
}
