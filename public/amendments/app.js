import { html } from '../js/explorer.js';
import { formatDate } from '../js/format.js';
import { convention, sources, amendments as DATED } from '../../scripts/corpus/amendments.json';

// The dates come from scripts/corpus/amendments.json, which the release
// builder reads too; the text, record id and text source come from Neon.
// Each date source is shown by name. A key missing here prints as its URL.
const SOURCE_NAMES = {
  'nara-bill-of-rights': 'National Archives',
  'nara-11-27': 'National Archives',
  'conan-2022': 'Constitution Annotated (2022)',
  'house-manual-118': 'House Manual (118th Congress)',
  'statute-76-1259': '76 Stat. 1259',
};
const SOURCES_BY_NUMERAL = Object.fromEntries(DATED.map((a) => [a.number, a.sources]));

const anchor = (numeral) => `amendment-${numeral.toLowerCase()}`;

document.getElementById('date-conventions').innerHTML = [
  ['Proposed', convention.proposed],
  ['Ratified', convention.date],
  ['Certified', convention.certified],
].map(([term, text]) => html`<li><strong>${term}:</strong> ${text}</li>`).join('');

const status = document.getElementById('amendments-status');
load();

async function load() {
  let rows;
  try {
    const res = await fetch('/api/corpus?action=amendments');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not load the amendments. Try again.';
    return;
  }
  status.textContent = '';
  status.classList.add('hidden');

  document.getElementById('amendment-index').innerHTML = rows
    .map((a) => html`<a href="#${anchor(a.numeral)}" class="amendment-index-link">${a.numeral}</a>`)
    .join('');
  document.getElementById('amendment-list').innerHTML = rows.map(entry).join('');

  // The list is drawn after load, so a link to #amendment-xiv arrives before
  // its target exists. Jump once it does.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
}

function entry(a) {
  // Arrays of html results interpolate as markup; a joined string would be
  // escaped as text.
  const dateSources = (SOURCES_BY_NUMERAL[a.numeral] || [])
    .map((key, i) => html`${i ? ', ' : ''}<a href="${sources[key]}" target="_blank" rel="noopener" class="source-link">${SOURCE_NAMES[key] || sources[key]}</a>`);
  const meta = [
    ['Proposed', formatDate(a.proposed, 'day')],
    ['Ratified', formatDate(a.date, 'day')],
    ...(a.certified ? [['Certified', formatDate(a.certified, 'day')]] : []),
    ['Dates', dateSources],
    ['Text', html`<a href="${a.source_url}" target="_blank" rel="noopener" class="source-link">National Archives</a>`],
  ];
  // "Section 1." stands as its own paragraph in the National Archives text.
  const paras = a.text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => (/^Section \d+\.$/.test(p) ? html`<p class="amendment-section">${p}</p>` : html`<p>${p}</p>`));
  return html`<li class="amendment" id="${anchor(a.numeral)}">
    <div class="amendment-head">
      <h3 class="amendment-title">${a.title}</h3>
      <dl class="record-meta">${meta.map(([term, value]) => html`<div class="record-meta-row"><dt>${term}</dt><dd>${value}</dd></div>`)}</dl>
      <p class="amendment-record"><a href="/corpus/?id=${a.id}" class="text-link">Corpus record</a></p>
    </div>
    <div class="record-text amendment-text">${paras}</div>
  </li>`;
}
