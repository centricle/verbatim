import { createExplorer, html, highlight } from '../js/explorer.js';
import SPEAKERS from '../../scripts/corpus/speakers.json';
import { formatDate } from '../js/format.js';
import { paragraphs } from '../js/record-text.js';

// Labels for the release's values. A value missing here prints as itself,
// sentence-cased, rather than not at all.
const GENRES = {
  speech: 'Speech', writing: 'Writing', letter: 'Letter', document: 'Document',
  opinion: 'Opinion', statement: 'Statement', executive_action: 'Executive action',
  press_conference: 'Press conference', debate: 'Debate',
};
const TYPES = {
  address: 'Address', speech: 'Speech', remarks: 'Remarks', floor_speech: 'Floor speech',
  press_conference: 'Press conference', statement: 'Statement', letter: 'Letter', essay: 'Essay',
  founding_document: 'Founding document', proclamation: 'Proclamation',
  executive_order: 'Executive order', memo: 'Memo', opinion: 'Opinion', debate: 'Debate',
};
const COLLECTIONS = { core: 'Core', voices: 'Voices' };
const SOURCES = {
  national_archives: 'National Archives',
  cornell_lii: 'Legal Information Institute, Cornell Law School',
  govinfo: 'GovInfo, U.S. Government Publishing Office',
  miller_center: 'Miller Center, University of Virginia',
  wikisource: 'Wikisource',
  project_gutenberg: 'Project Gutenberg',
  historic_hansard: 'Historic Hansard, UK Parliament',
};
const RIGHTS = {
  'pd-expired': 'Public domain: the copyright has expired',
  'us-gov-work': 'Public domain: a work of the United States government',
  'license:OPL-3.0': 'Open Parliament Licence v3.0',
};

const label = (map, key) => map[key] || String(key || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());


// Without a search, the snippet is the record's first 320 characters: cut it
// back to a whole word and mark the cut. A search snippet is ts_headline's
// fragments and is shown as they come.
function excerpt(d) {
  const s = d.snippet || '';
  if (s.includes('\u0001') || Number(d.chars) <= s.length) return s;
  return `${s.replace(/\s+\S*$/, '')} …`;
}

const params = new URLSearchParams(location.search);
if (params.get('id')) showRecord(params.get('id'));
else startExplorer();

function startExplorer() {
  // Started now so the chunks load while the first search and stats are in flight.
  const charts = Promise.all([
    import('../../src/viz/corpus-by-decade.jsx'),
    import('../../src/viz/ranked-bars.jsx'),
    import('../../src/viz/corpus-speaker-span.jsx'),
  ]);

  createExplorer({
    prefix: 'corpus',
    endpoint: '/api/corpus',
    filters: ['speaker', 'genre', 'collection', 'series', 'from', 'to'],
    noun: 'records',
    emptyText: 'No records match your search and filters.',
    errorText: 'Could not load records. Try again.',
    row: (d) => html`
      <tr>
        <td class="cell-dim cell-nowrap cell-trail">${formatDate(d.date, d.date_precision)}</td>
        <td class="cell-name cell-lead cell-wrap"><a class="text-link" href="/corpus/?id=${d.id}">${d.title}</a></td>
        <td class="cell-dim">${d.speaker_name}</td>
        <td class="cell-dim">${label(TYPES, d.type)}</td>
        <td class="cell-dim cell-push">${label(COLLECTIONS, d.collection)}</td>
        <td class="cell-dim cell-wide cell-excerpt">${highlight(excerpt(d))}</td>
      </tr>
    `,
    options: (stats) => ({
      // Surname order, like an index; the label still reads first name first.
      speaker: (stats.speaker_list || [])
        .map((s) => [s.speaker, s.speaker_name, SPEAKERS[s.speaker]?.sort || s.speaker_name])
        .sort((a, b) => a[2].localeCompare(b[2], 'en', { sensitivity: 'base' }))
        .map(([slug, name]) => [slug, name]),
      genre: (stats.genre_list || []).map((g) => [g, label(GENRES, g)]),
    }),
    charts: async (stats, opts) => {
      // The dek's reach, read off the data so it never goes stale in the HTML.
      const reach = document.getElementById('corpus-reach');
      const span = stats.year_range;
      if (reach && stats.speaker_list?.length && span?.min) {
        reach.textContent = ` ${stats.speaker_list.length.toLocaleString()} speakers, ${span.min} to ${span.max}.`;
      }

      const [{ mountCorpusByDecade }, { mountRankedBars }, { mountCorpusSpeakerSpan }] = await charts;
      mountCorpusByDecade(document.getElementById('viz-by-decade'), stats, {
        ...opts,
        noteEl: document.getElementById('viz-by-decade-note'),
      });
      mountCorpusSpeakerSpan(document.getElementById('viz-speaker-span'), stats.speaker_span, {
        onFilter: opts.onFilter,
      });
      mountRankedBars(document.getElementById('viz-by-genre'), stats.by_genre, {
        value: 'count', noun: 'records', onFilter: opts.onFilter,
        label: 'genre', filterKey: 'genre', display: (d) => label(GENRES, d.genre),
      });
    },
  });
}

// ---- Record view (/corpus/?id=…) -------------------------------------------

// Project Gutenberg's line breaks are its edition's, so its paragraphs are
// reflowed (public/js/record-text.js). Every other source's line breaks are
// kept (salutations, addresses, verse).
const REFLOW_SOURCES = new Set(['project_gutenberg']);

async function showRecord(id) {
  document.getElementById('corpus-index').classList.add('hidden');
  const view = document.getElementById('corpus-record');
  view.classList.remove('hidden');
  const status = document.getElementById('record-status');

  let res;
  try {
    res = await fetch(`/api/corpus?${new URLSearchParams({ action: 'get', id })}`);
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not load this record. Try again.';
    return;
  }
  if (res.status === 404) {
    status.textContent = 'No record has this address.';
    return;
  }
  if (!res.ok) {
    status.textContent = 'Could not load this record. Try again.';
    return;
  }
  const r = await res.json();
  status.textContent = '';
  status.classList.add('hidden');

  document.title = `${r.title} — Verbatim`;
  document.getElementById('record-kicker').textContent =
    `${label(TYPES, r.type)} · ${label(COLLECTIONS, r.collection)}`;
  document.getElementById('record-title').textContent = r.title;
  document.getElementById('record-speaker').textContent = r.speaker_name;
  document.getElementById('record-date').textContent = formatDate(r.date, r.date_precision);

  // An amendment's record date is the completion of ratification; its
  // proposal and certification ride along (scripts/corpus/build_release.py).
  const meta = [
    ...(r.proposed ? [['Ratified', formatDate(r.date, r.date_precision)], ['Proposed', formatDate(r.proposed, 'day')]] : []),
    ...(r.certified ? [['Certified', formatDate(r.certified, 'day')]] : []),
    ['Source', html`<a href="${r.source_url}" target="_blank" rel="noopener" class="source-link">${label(SOURCES, r.source_name)}</a>`],
    ['Rights', label(RIGHTS, r.rights)],
    ...(r.attribution ? [['Attribution', r.attribution]] : []),
  ];
  document.getElementById('record-meta').innerHTML = meta
    .map(([term, value]) => html`<div class="record-meta-row"><dt>${term}</dt><dd>${value}</dd></div>`)
    .join('');

  document.getElementById('record-text').innerHTML = paragraphs(r.text, { reflow: REFLOW_SOURCES.has(r.source_name) })
    .map((p) => html`<p>${p}</p>`).join('');
}
