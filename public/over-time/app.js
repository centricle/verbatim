import { html } from '../js/explorer.js';
import { formatDate } from '../js/format.js';
import { series as SERIES } from '../../scripts/corpus/series.json';
import { amendments as DATED } from '../../scripts/corpus/amendments.json';

// State lives in the URL: ?series=inaugural&t=liberty&t=union. The default
// series is left out, so a bare /over-time/ is the State of the Union with no
// terms. Pushed on each new plot, read back on popstate.
const DEFAULT_SERIES = 'sotu';
const chart = import('../../src/viz/corpus-term-rate.jsx');

const form = document.getElementById('terms-form');
const select = document.getElementById('series');
const inputs = [...form.querySelectorAll('input[name="t"]')];
const status = document.getElementById('terms-status');
const plot = document.getElementById('viz-term-rate');
const quoted = (s) => `“${s}”`;

select.innerHTML = Object.entries(SERIES)
  .map(([key, s]) => html`<option value="${key}">${s.label}</option>`).join('');

// Ratification years for the hairlines, one rule per year. 1791 carries ten
// amendments, 1913 and 1933 two each; a run of three or more consecutive
// numerals prints as a range.
const NUMERALS = DATED.map((a) => a.number);
function numeralLabel(list) {
  const idx = list.map((n) => NUMERALS.indexOf(n));
  const run = idx.length >= 3 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return run ? `${list[0]}–${list[list.length - 1]}` : list.join(', ');
}
const RATIFICATIONS = [...Map.groupBy(DATED, (a) => Number(a.date.slice(0, 4)))].map(([year, list]) => ({
  year,
  label: numeralLabel(list.map((a) => a.number)),
  details: [...Map.groupBy(list, (a) => a.date)].map(([date, same]) =>
    `${same.length > 1 ? 'Amendments' : 'Amendment'} ${numeralLabel(same.map((a) => a.number))} ratified ${formatDate(date, 'day')}`),
}));

function readUrl() {
  const p = new URLSearchParams(location.search);
  const series = SERIES[p.get('series')] ? p.get('series') : DEFAULT_SERIES;
  return { series, terms: p.getAll('t').map((t) => t.trim()).filter(Boolean).slice(0, 3) };
}

function writeUrl({ series, terms }) {
  const p = new URLSearchParams();
  if (series !== DEFAULT_SERIES) p.set('series', series);
  for (const t of terms) p.append('t', t);
  const qs = p.toString();
  return qs ? `?${qs}` : location.pathname;
}

function setControls({ series, terms }) {
  select.value = series;
  inputs.forEach((input, i) => { input.value = terms[i] || ''; });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const state = { series: select.value, terms: inputs.map((i) => i.value.trim()).filter(Boolean) };
  const url = writeUrl(state);
  if (url !== location.search && !(url === location.pathname && !location.search)) history.pushState(null, '', url);
  run(state);
});
select.addEventListener('change', () => form.requestSubmit());
window.addEventListener('popstate', () => {
  const state = readUrl();
  setControls(state);
  run(state);
});

let inflight = null;
async function run(state) {
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  const p = new URLSearchParams({ action: 'terms', series: state.series });
  for (const t of state.terms) p.append('t', t);
  let data;
  try {
    const res = await fetch(`/api/corpus?${p}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    status.textContent = 'Could not load the counts. Try again.';
    return;
  }
  if (ctrl !== inflight) return;
  render(state, data);
}

function render(state, data) {
  const s = SERIES[state.series];
  // Every member has a year; only those House History dates also have a day.
  const members = [...new Set(s.members.map((m) => m.year))].sort((a, b) => a - b);
  const counted = new Set(data.years.map((d) => d.year));
  const absent = members.filter((y) => !counted.has(y));
  const ok = data.terms.filter((t) => t.status === 'ok');
  const lineMode = ok.length > 0;

  status.textContent = data.terms.filter((t) => t.status !== 'ok').map((t) => (t.status === 'stopword'
    ? `${quoted(t.input)} is not counted: very common words such as “the” are left out.`
    : `${quoted(t.input)} is more than one word to the counter. Enter one word in each box.`)).join(' ');

  document.title = lineMode
    ? `${ok.map((t) => t.input).join(', ')}: ${s.label} — Words Over Time — Verbatim`
    : 'Words Over Time — Verbatim';
  document.getElementById('figure-title').textContent = lineMode
    ? `Uses per million words, ${s.label}` : `Words per year, ${s.label}`;
  const missing = absent.length ? ' Open circles on the baseline mark addresses in the list with no record in the corpus.' : '';
  document.getElementById('figure-caption').textContent = lineMode
    ? `Each word’s uses in a year’s records per million words in them. A line breaks at an address with no record.${missing} Dotted lines mark the years amendments were ratified. Select a year to open its records in the corpus.`
    : `Words in each year’s records.${missing} Dotted lines mark the years amendments were ratified. Select a year to open its records in the corpus.`;
  plot.setAttribute('aria-label', lineMode
    ? `Figure 1: ${ok.map((t) => t.input).join(', ')}, uses per million words in each year's ${s.label} records`
    : `Figure 1: words in each year's ${s.label} records`);
  // Members missing from years that still have a record: those years are
  // counted from the records present. A record only carries a series when it
  // matches a member, so members minus records per year is exact.
  const perYear = Map.groupBy(s.members, (m) => m.year);
  const short = data.years.filter((d) => (perYear.get(d.year)?.length || 0) > d.records);
  const shortN = short.reduce((n, d) => n + perYear.get(d.year).length - d.records, 0);
  document.getElementById('viz-term-rate-note').textContent = [
    absent.length ? `No record in the corpus for ${absent.length} of the ${members.length} years in the list: ${yearRuns(absent)}.` : '',
    shortN ? `${shortN} more ${shortN === 1 ? 'address in the list is' : 'addresses in the list are'} not in the corpus; ${shortN === 1 ? 'its year is' : 'their years are'} counted from the other records: ${yearRuns(short.map((d) => d.year))}.` : '',
  ].filter(Boolean).join(' ');
  document.getElementById('figure-source').innerHTML = s.source_url
    ? html`<span class="byline-role">List</span><a href="${s.source_url}" target="_blank" rel="noopener" class="byline-source source-link">${s.source_name}</a>`
    : '';

  chart.then(({ mountTermRate }) => mountTermRate(plot, {
    data,
    members,
    ratifications: RATIFICATIONS,
    onYear: (year, termIndex) => {
      const q = new URLSearchParams();
      if (termIndex != null) q.set('q', data.terms[termIndex].input);
      q.set('series', state.series);
      q.set('from', year);
      q.set('to', year);
      location.href = `/corpus/?${q}`;
    },
  }));
  table(data, ok);
}

// 1934, 1935, 1936, 1942 -> "1934–1936, 1942"
function yearRuns(years) {
  const runs = [];
  for (const y of years) {
    const r = runs[runs.length - 1];
    if (r && y === r[1] + 1) r[1] = y; else runs.push([y, y]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

function table(data, ok) {
  const counts = ok.map((t) => new Map(t.counts.map((c) => [c.year, c.n])));
  const rate = (n, words) => ((n / words) * 1e6).toFixed(1);
  const head = html`<thead><tr><th scope="col">Year</th><th scope="col">Speaker</th><th scope="col" class="num">Words</th>${
    ok.map((t) => html`<th scope="col" class="num">${quoted(t.input)}</th><th scope="col" class="num">Per million</th>`)}</tr></thead>`;
  const body = data.years.map((d) => html`<tr><td>${d.year}</td><td>${d.speakers.join(', ')}</td><td class="num">${d.words.toLocaleString()}</td>${
    counts.map((m) => html`<td class="num">${(m.get(d.year) || 0).toLocaleString()}</td><td class="num">${rate(m.get(d.year) || 0, d.words)}</td>`)}</tr>`);
  document.getElementById('counts-table').innerHTML = html`${head}<tbody>${body}</tbody>`.toString();
}

const initial = readUrl();
setControls(initial);
run(initial);
// A bare URL waits for a word; a linked view is there to be read.
if (!initial.terms.length) inputs[0].focus({ preventScroll: true });
