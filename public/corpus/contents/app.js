import { html } from '../../js/explorer.js';
import { formatDate } from '../../js/format.js';
import { GENRES, label } from '../../js/corpus-labels.js';
import { memberKey } from '../../js/series-member.js';
import SPEAKERS from '../../../scripts/corpus/speakers.json';
import { rosters as ROSTERS, bodies as BODIES, speakers as ROLES } from '../../../scripts/corpus/rosters.json';
import { series as SERIES } from '../../../scripts/corpus/series.json';

// What is in the corpus, in one fetch (/api/corpus?action=contents): records
// per speaker, every series record under its series_member, records per
// genre. Who sits in which group, and in what words, comes from
// scripts/corpus/rosters.json; each cited list from series.json. Grouping and
// order are rules, never a judgment: a speaker appears in every group whose
// rosters list them, in surname order (speakers.json `sort`).
const GROUPS = [
  { id: 'presidents', title: 'Presidents', rosters: ['presidents'] },
  { id: 'supreme-court', title: 'Supreme Court', rosters: ['supreme_court'] },
  // The Directory's descriptor already names both chambers, so a speaker it
  // lists shows that; the Senate's state list speaks only for the rest.
  { id: 'congress', title: 'Congress', rosters: ['congress', 'senate'], prefer: 'congress' },
];

const bySurname = (a, b) => SPEAKERS[a.speaker].sort.localeCompare(SPEAKERS[b.speaker].sort);
const years = (s) => (s.first === null ? 'Undated' : s.first === s.last ? String(s.first) : `${s.first}–${s.last}`);
const count = (n, unit) => html`<div class="toc-count"><span class="toc-num">${n.toLocaleString()}</span><span class="toc-unit">${n === 1 ? unit : `${unit}s`}</span></div>`;

const status = document.getElementById('contents-status');
load();

async function load() {
  let data;
  try {
    const res = await fetch('/api/corpus?action=contents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not load the contents. Try again.';
    return;
  }
  status.textContent = '';
  status.classList.add('hidden');

  const speakers = data.speakers.filter((s) => SPEAKERS[s.speaker]);
  const groups = GROUPS.map((g) => ({ ...g, rows: speakers.filter((s) => entries(s.speaker, g.rosters).length) }));
  const listed = new Set(groups.flatMap((g) => g.rows.map((s) => s.speaker)));
  groups.push(
    { id: 'bodies', title: 'Bodies', rosters: [], rows: speakers.filter((s) => BODIES.includes(s.speaker)) },
    { id: 'not-on-rosters', title: 'Not on these rosters', rosters: [], rows: speakers.filter((s) => !listed.has(s.speaker) && !BODIES.includes(s.speaker)) },
  );
  const series = Object.entries(SERIES).map(([key, spec]) => ({ key, id: `series-${key}`, spec }));

  document.getElementById('contents-index').innerHTML = [
    ...groups.filter((g) => g.rows.length).map((g) => [g.id, g.title]),
    ...series.map((s) => [s.id, s.spec.label]),
    ['kinds', 'Kinds of record'],
  ].map(([id, title]) => html`<a href="#${id}">${title}</a>`).join('');

  document.getElementById('speaker-groups').innerHTML = groups
    .filter((g) => g.rows.length)
    .map((g) => speakerGroup(g, g.rows.sort(bySurname)))
    .join('');

  const records = Object.fromEntries(data.series.map((r) => [r.series_member, r]));
  document.getElementById('series-groups').innerHTML = series.map((s) => seriesGroup(s, records)).join('');

  document.getElementById('genre-list').innerHTML = data.by_genre.map((g) => html`<li class="toc-entry">
    ${count(g.count, 'record')}
    <div class="toc-main"><h3 class="toc-title"><a href="/corpus/?genre=${g.genre}">${label(GENRES, g.genre)}</a></h3></div>
  </li>`).join('');

  // Drawn after load, so a link to #congress arrives before its target exists.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
}

// A speaker's entries on the given rosters, in roster order.
function entries(slug, rosters) {
  return (ROLES[slug] || []).filter((e) => rosters.includes(e.roster));
}

function speakerGroup(g, rows) {
  const used = g.rosters.filter((k) => rows.some((s) => entries(s.speaker, [k]).length));
  const words = (s) => {
    const es = entries(s.speaker, g.rosters);
    const preferred = g.prefer ? es.filter((e) => e.roster === g.prefer) : [];
    return preferred.length ? preferred : es;
  };
  // A roster that prints one line for everyone (the White House's list) says
  // nothing per row; its source line in the group head carries it.
  const uniform = new Set(rows.flatMap((s) => words(s).map((e) => e.as))).size === 1;
  return html`<div class="contents-group" id="${g.id}">
    <div class="contents-group-head">
      <h3 class="contents-group-title">${g.title}</h3>
      ${used.length ? html`<p class="contents-group-meta"><span class="byline-role">Roster</span>${used.map((k, i) => html`${i ? ' · ' : ''}<a href="${ROSTERS[k].source_url}" target="_blank" rel="noopener">${ROSTERS[k].label}</a>`)}</p>` : ''}
    </div>
    <ol class="toc toc--index">${rows.map((s) => speakerRow(s, uniform ? [] : words(s)))}</ol>
  </div>`;
}

function speakerRow(s, es) {
  return html`<li class="toc-entry">
    ${count(s.count, 'record')}
    <div class="toc-main">
      <h4 class="toc-title"><a href="/corpus/?speaker=${s.speaker}">${SPEAKERS[s.speaker].name}</a></h4>
      ${es.length ? html`<p class="toc-dek">${es.map((e, i) => html`${i ? '; ' : ''}<a href="${e.url}" target="_blank" rel="noopener">${e.as}</a>`)}</p>` : ''}
    </div>
    <p class="toc-years">${years(s)}</p>
  </li>`;
}

// One row per member of the cited list, in its order, found by the key the
// release builder wrote into the record (memberKey).
function seriesGroup({ key, id, spec }, records) {
  const members = spec.members;
  const inCorpus = members.filter((m) => records[memberKey(key, m)]).length;
  const hasOrdinal = members.some((m) => m.ordinal != null);
  const hasForm = members.some((m) => m.form);
  const sources = [
    html`<span class="byline-role">List</span><a href="${spec.source_url}" target="_blank" rel="noopener">${spec.source_name}</a>`,
    spec.dates_from ? html` · <span class="byline-role">Dates</span><a href="${spec.dates_from.url}" target="_blank" rel="noopener">${spec.dates_from.name}</a>` : '',
  ];
  return html`<div class="contents-group" id="${id}">
    <div class="contents-group-head">
      <h3 class="contents-group-title"><a href="/corpus/?series=${key}">${spec.label}</a></h3>
      <p class="contents-group-meta">${sources}</p>
    </div>
    <p class="results-info">${inCorpus.toLocaleString()} of ${members.length.toLocaleString()} in the corpus</p>
    <div class="record-table-wrap">
      <table class="record-table">
        <thead><tr>
          ${hasOrdinal ? html`<th scope="col" class="cell-num">No.</th>` : ''}
          <th scope="col">Date</th>
          <th scope="col">Speaker</th>
          ${hasForm ? html`<th scope="col">Form</th>` : ''}
          <th scope="col">Record</th>
        </tr></thead>
        <tbody>${members.map((m) => memberRow(key, spec, m, records[memberKey(key, m)], hasOrdinal, hasForm))}</tbody>
      </table>
    </div>
  </div>`;
}

function memberRow(key, spec, m, r, hasOrdinal, hasForm) {
  const note = m.flag && spec.flags?.[m.flag];
  return html`<tr>
    ${hasOrdinal ? html`<td class="cell-num" data-label="No.">${m.ordinal}</td>` : ''}
    <td class="cell-trail series-date">${m.date ? formatDate(m.date, 'day') : String(m.year)}</td>
    <td>${SPEAKERS[m.speaker]?.name || m.speaker}</td>
    ${hasForm ? html`<td class="cell-push">${label({}, m.form)}</td>` : ''}
    <td class="cell-lead">${r
      ? html`<a href="/corpus/?id=${r.id}" class="text-link">${r.title}</a>`
      : html`<span class="series-absent">Not in the corpus</span>`}${note ? html`<span class="series-note">${note}</span>` : ''}</td>
  </tr>`;
}
