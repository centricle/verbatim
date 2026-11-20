// Shared behavior for the dataset explorers (trades, compas, incidents,
// finance, qi, crashes, corpus, executive, clemency, disbursements). Each page is the same machine: a search box, filter selects,
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
//
// Stats are fetched once, unless the page names `statsKeys`: filters the
// stats themselves take (trades' chamber). Changing one refetches stats,
// rebuilds the select options from the answer, redraws the charts and calls
// `onStats` again. A rebuilt list can be narrower than the last (one
// chamber's members); a filter it has no option for is then cleared, in the
// same history entry, rather than left filtering invisibly. A refetch that
// fails leaves the last answer drawn and is asked for again on the next change.
//
// A filter whose list is too long for a select (disbursements' 1,221
// offices) is an `<input data-combobox>`, driven by combobox.js. Its value
// comes from `state` and changes only when an option is picked or cleared, so
// half-typed text never filters, and Enter in it never submits the form.
//
// A page with `cfg.detail` gets row details: a last column holding each
// row's toggle (a real button, for keyboard and screen readers), and a click
// anywhere on the row, or on its open detail, does the same, except on a link
// or after a drag that selected text. The detail opens as a full-width row
// beneath, its fields in a grid (`fieldList`). It replaced a <details> inside
// the row's last cell (2026-11-19), which put a dozen fields in the narrowest
// column.
//
// A search can answer with `total_capped` (disbursements: 3.9 M rows, where an
// exact count of a broad filter outlasts a function's 10 s). `total` is then
// the cap, the count reads "10,000+", and paging stops at the cap's last page,
// where the stored function stops too.
//
// A page with `cfg.sort` sorts from its column headings: each
// `<th data-sort="<key>">` becomes a button, the order in force is its
// `aria-sort`, and the state is two more URL and API params, `sortBy` (empty
// for `cfg.sort.default`) and `sortDir` (empty for descending). A heading's
// first click sorts it descending (newest, largest), the next flips it. It
// replaced disbursements' order select (2026-11-19). Below 768px the headings
// are clipped and the buttons hidden (app.css), so phones do not sort.

import { CHEVRON, clearButton, combobox } from './combobox.js';

const PAGE_SIZE = 50;

// Two arrows, the lit one the way the sorted column runs (app.css).
const SORT_ICON = '<svg class="sort-icon" viewBox="0 0 6 10" aria-hidden="true" focusable="false">'
  + '<path class="sort-up" d="M3 0 6 4H0z" fill="currentColor"/>'
  + '<path class="sort-down" d="M3 10 0 6h6z" fill="currentColor"/></svg>';

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

// Some sources bake HTML entities into their text (`&amp;`, `&nbsp;` in Senate
// Stock Watcher's asset descriptions; the trades loader now decodes eFD's
// itself, `htmlText` in scripts/trades/senate.mjs). innerHTML used to decode
// them as a side effect of parsing each row as markup, which is the same
// property that made it unsafe. Decode them explicitly instead: a textarea's
// content is raw text, so nothing inside it is ever parsed as an element or
// run.
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

// A search snippet with its matches marked. search_corpus (db/corpus.sql)
// wraps each match in U+0001 ... U+0002 rather than markup. The snippet is
// split on those pairs and every piece escaped like any other value; only
// then does each match get its <mark>. A marker without its partner is
// dropped. No markup from the database is ever rendered. ts_headline marks
// each word of a phrase on its own; matches separated only by whitespace are
// joined first, so a phrase reads as one highlight.
export function highlight(text) {
  const joined = String(text ?? '').replace(/\u0002(\s+)\u0001/g, '$1');
  const parts = joined.split(/(\u0001[^\u0001\u0002]*\u0002)/);
  return new Markup(parts.map((part) => (part.startsWith('\u0001') && part.endsWith('\u0002')
    ? `<mark>${interpolate(part.slice(1, -1))}</mark>`
    : interpolate(part.replace(/[\u0001\u0002]/g, '')))).join(''));
}

// A row's detail (`cfg.detail`): each field under its label, in a grid.
// `[label, value]`, or `[label, value, 'wide']` for a value that reads best
// across the whole width. Empty values are dropped. Values are escaped like
// any other; an `html` result (a link) passes through.
export function fieldList(fields) {
  const kept = fields.filter(([, value]) => value != null && value !== '' && value !== false);
  return html`<dl class="row-fields">${kept.map(([label, value, wide]) => html`
    <div class="${wide ? 'row-field row-field--wide' : 'row-field'}"><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>`;
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
 * @param {string[]} cfg.filters  Filter keys. Each is a `#filter-<key>` control (a
 *                                select, or an input such as a year), a URL param
 *                                and an API param of the same name.
 * @param {(row: object) => Markup} cfg.row  One `<tr>`, built with `html`.
 * @param {{ default: string }} [cfg.sort] Sorting from the headings marked
 *                                `data-sort` (top of this file). `default` is the key
 *                                the endpoint sorts by when `sortBy` is empty.
 * @param {(row: object) => Markup} [cfg.detail] The row's detail, built with `html`
 *                                (`fieldList`). Adds the toggle column and the
 *                                full-width detail row (top of this file).
 * @param {string} cfg.noun       Plural noun in "Showing 1–50 of 7,740 <noun>".
 * @param {string} cfg.emptyText  Results line when nothing matches.
 * @param {string} [cfg.errorText] Results line when a search fails. Unset leaves the
 *                                table as it was.
 * @param {(page: number, pageSize: number) => object} [cfg.pageParams]
 *                                How the endpoint takes paging. Default `{ page, pageSize }`.
 * @param {(stats: object) => Record<string, [string, string][]>} [cfg.options]
 *                                Options read from stats, as `[value, label]` pairs per
 *                                filter key: appended after a select's own, or the whole
 *                                list of a combobox.
 * @param {(stats: object, opts: { onFilter: Function }) => unknown} [cfg.charts]
 *                                Mount the charts. Start their imports before calling
 *                                `createExplorer`, so they load while stats is in flight.
 *                                With `statsKeys`, called again on each refetch, so a
 *                                mount must reuse its container's root (src/viz/mount.js).
 * @param {string[]} [cfg.statsKeys] Filter keys also sent with `?action=stats`. Changing
 *                                one refetches stats (comment at the top of this file).
 * @param {Record<string, string>} [cfg.fixed] Params sent with every search and stats
 *                                request and never put in the URL: what the page's
 *                                address already says (disbursements' chamber, a page each).
 * @param {(stats: object, params: Record<string, string>) => void} [cfg.onStats]
 *                                Called with each stats answer and the filters it was
 *                                asked with, before the charts: page copy read off the
 *                                data, such as a lede's counts.
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
  const controls = Object.fromEntries(
    cfg.filters.map((key) => [key, document.getElementById(`filter-${key}`)]),
  );
  // Filters too long for a select. `onPick` runs only on a user's pick.
  const boxes = {};
  for (const [key, control] of Object.entries(controls)) {
    if (control.dataset.combobox === undefined) continue;
    boxes[key] = combobox(control, {
      noun: control.dataset.combobox || key,
      onPick: (value) => {
        if (value !== state[key]) commit({ [key]: value, page: 1 });
      },
    });
  }
  // The search box's ×: empties it and, if a search was running on that
  // text, runs the search without it.
  const searchClear = clearButton('Clear search');
  searchInput.after(searchClear);
  const showSearchClear = () => { searchClear.hidden = !searchInput.value; };
  searchInput.addEventListener('input', showSearchClear);
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    showSearchClear();
    searchInput.focus();
    if (state.q) commit({ page: 1 });
  });
  // Row details: the rows on show, by index, for the detail of the one opened.
  let shown = [];
  if (cfg.detail) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = 'cell-toggle';
    th.innerHTML = '<span class="visually-hidden">Details</span>';
    resultsBody.closest('table').tHead.rows[0].append(th);
    resultsBody.addEventListener('click', (e) => {
      // A click in an open detail closes it, as one on its row does.
      const detail = e.target.closest('tr.row-detail');
      const tr = detail ? detail.previousElementSibling : e.target.closest('tr.has-detail');
      if (!tr?.classList.contains('has-detail')) return;
      if (!e.target.closest('.row-toggle')
        && (e.target.closest('a, button, input, select, summary') || String(getSelection()).length)) return;
      toggleDetail(tr);
    });
  }
  // Sortable headings (top of this file). The heading keeps its name in
  // aria-label, because below 768px its button is hidden (app.css).
  const sortHeads = cfg.sort
    ? [...resultsBody.closest('table').tHead.querySelectorAll('th[data-sort]')]
    : [];
  for (const th of sortHeads) {
    const label = th.textContent.trim();
    th.setAttribute('aria-label', label);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
    button.insertAdjacentHTML('beforeend', SORT_ICON);
    button.addEventListener('click', () => sortOn(th.dataset.sort));
    th.replaceChildren(button);
  }
  const keys = ['q', ...cfg.filters, ...(cfg.sort ? ['sortBy', 'sortDir'] : [])];
  const statsKeys = cfg.statsKeys ?? [];
  const pageParams = cfg.pageParams ?? ((page, pageSize) => ({ page, pageSize }));

  let state = readUrl();
  let inFlight = null;
  // The stats query last asked for, and the one whose answer is drawn.
  let statsQuery = null;
  let statsShown = null;
  let statsInFlight = null;
  // Options each select was given from stats, removed before the next list.
  const listed = new Map();

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
    showSearchClear();
    for (const key of cfg.filters) {
      if (boxes[key]) boxes[key].set(state[key]);
      else controls[key].value = state[key];
    }
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
    loadStats();
  }

  // The order in force. A key no heading names (an edited URL) reads as the
  // default.
  function sorted() {
    const by = sortHeads.some((th) => th.dataset.sort === state.sortBy) ? state.sortBy : cfg.sort.default;
    return [by, state.sortDir === 'asc' ? 'asc' : 'desc'];
  }

  function showSort() {
    if (!sortHeads.length) return;
    const [by, dir] = sorted();
    for (const th of sortHeads) {
      if (th.dataset.sort === by) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    }
  }

  function sortOn(key) {
    const [by, dir] = sorted();
    const asc = key === by && dir === 'desc';
    commit({ sortBy: key === cfg.sort.default ? '' : key, sortDir: asc ? 'asc' : '', page: 1 });
  }

  async function search() {
    // Every change of state ends here, the back button included.
    showSort();
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    const params = { ...cfg.fixed };
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
    const more = data.total_capped ? '+' : '';
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
      resultsInfo.textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}${more} ${cfg.noun}`;
    }

    resultsBody.innerHTML = rows.map(cfg.row).join('');
    shown = rows;
    if (cfg.detail) addToggles();

    if (totalPages > 1) {
      pagination.classList.remove('hidden');
      pageInfo.textContent = `Page ${state.page.toLocaleString()} of ${totalPages.toLocaleString()}`;
      prevBtn.disabled = state.page <= 1;
      nextBtn.disabled = state.page >= totalPages;
    } else {
      pagination.classList.add('hidden');
    }
  }

  // Each row's toggle, in the last column. Its label names the row by the
  // lead cell's own text (a payee, a recipient), not any link under it.
  function addToggles() {
    [...resultsBody.rows].forEach((tr, i) => {
      tr.classList.add('has-detail');
      tr.dataset.i = String(i);
      const lead = tr.querySelector('.cell-lead')?.firstChild?.textContent.trim();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'row-toggle';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', lead ? `Details: ${lead}` : 'Details');
      button.innerHTML = CHEVRON;
      const td = document.createElement('td');
      td.className = 'cell-toggle';
      td.append(button);
      tr.append(td);
    });
  }

  function toggleDetail(tr) {
    const button = tr.querySelector('.row-toggle');
    const next = tr.nextElementSibling;
    if (next?.classList.contains('row-detail')) {
      next.remove();
      tr.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('aria-controls');
      return;
    }
    const detail = document.createElement('tr');
    detail.className = 'row-detail';
    detail.id = `${cfg.prefix}-detail-${tr.dataset.i}`;
    const td = document.createElement('td');
    td.colSpan = tr.cells.length;
    td.innerHTML = String(cfg.detail(shown[Number(tr.dataset.i)]));
    detail.append(td);
    tr.after(detail);
    tr.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', detail.id);
  }

  // Chart click: same path as choosing the option by hand. A value the select
  // has no option for clears the filter rather than filtering invisibly. A
  // chart can set several filters at once, `{ set: { from, to } }`, as one
  // history entry and one search.
  function onFilter(arg) {
    const pairs = arg.set ? Object.entries(arg.set) : [[arg.key, arg.value]];
    const changes = {};
    for (const [key, value] of pairs) {
      const control = controls[key];
      if (!control) continue;
      if (boxes[key]) {
        boxes[key].set(value);
        changes[key] = value;
        continue;
      }
      control.value = value;
      changes[key] = control.value;
    }
    if (Object.keys(changes).length) commit({ ...changes, page: 1 });
  }

  function addOptions(stats, refetch) {
    const lists = cfg.options?.(stats) ?? {};
    const cleared = {};
    for (const [key, pairs] of Object.entries(lists)) {
      if (boxes[key]) {
        boxes[key].setOptions(pairs);
        // A value the refetched list no longer holds (one chamber's member).
        if (refetch && state[key] && !pairs.some(([value]) => value === state[key])) cleared[key] = '';
        continue;
      }
      const control = controls[key];
      for (const option of listed.get(control) ?? []) option.remove();
      const added = pairs.map(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      });
      control.append(...added);
      listed.set(control, added);
      // The deep-linked value has an option to land on now.
      control.value = state[key];
      if (refetch && state[key] && control.value !== state[key]) cleared[key] = '';
    }
    if (Object.keys(cleared).length) {
      state = { ...state, ...cleared, page: 1 };
      history.replaceState(null, '', urlFor(state));
      syncControls();
      search();
    }
  }

  // Stats feeds the select options, onStats and the charts. The first request
  // goes out with the first search rather than after the chart modules load,
  // so the selects never wait on the React + D3 chunk. Asking again for the
  // stats already asked for does nothing.
  function loadStats() {
    const params = { action: 'stats', ...cfg.fixed };
    for (const key of statsKeys) if (state[key]) params[key] = state[key];
    const query = new URLSearchParams(params).toString();
    if (query === statsQuery) return;
    const refetch = statsQuery !== null;
    statsQuery = query;
    statsInFlight?.abort();
    const controller = new AbortController();
    statsInFlight = controller;
    getJson(`${cfg.endpoint}?${query}`, controller.signal)
      .then((stats) => {
        if (controller.signal.aborted) return undefined;
        statsShown = query;
        addOptions(stats, refetch);
        cfg.onStats?.(stats, params);
        return cfg.charts?.(stats, { onFilter });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(err);
        // The last answer is still what is drawn. Put its query back, so the
        // next change asks for this one again instead of reading it as done.
        statsQuery = statsShown;
        // Stops the loading hairline (app.css) on the plots that never drew.
        for (const el of document.querySelectorAll('.figure-plot:empty')) el.setAttribute('aria-busy', 'false');
      });
  }

  // Enter in a typed control (a year) submits the form, and need not fire
  // change first, so typed controls are read here. Selects are not: before
  // stats arrive, one cannot yet hold a deep-linked value (top of this file).
  const typed = () => Object.fromEntries(cfg.filters
    .filter((key) => controls[key].tagName !== 'SELECT' && !boxes[key])
    .map((key) => [key, controls[key].value.trim()]));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    commit({ ...typed(), page: 1 });
  });
  // The forms have no submit button: every select and the combobox act on
  // change, so it had nothing left to do but submit typed text. Enter does
  // that here, because a form with more than one text field and no submit
  // button does not submit on Enter by itself (HTML implicit submission).
  // The combobox claims its own Enter first (defaultPrevented).
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    commit({ ...typed(), page: 1 });
  });
  for (const key of cfg.filters) {
    if (boxes[key]) continue;
    const control = controls[key];
    // A typed control fires change on blur too, after Enter has already
    // submitted its value; asking again for the same state would only repeat
    // the search.
    control.addEventListener('change', () => {
      const value = control.value.trim();
      if (value !== state[key]) commit({ [key]: value, page: 1 });
    });
  }
  prevBtn.addEventListener('click', () => {
    if (state.page > 1) commit({ page: state.page - 1 });
  });
  nextBtn.addEventListener('click', () => commit({ page: state.page + 1 }));
  window.addEventListener('popstate', () => {
    state = readUrl();
    syncControls();
    search();
    loadStats();
  });

  syncControls();
  search();
  loadStats();
}
