import { createExplorer, html, highlight } from '../js/explorer.js';
import { formatDate } from '../js/format.js';
import { paragraphs } from '../js/record-text.js';
import { MENTION } from '../../scripts/executive/parse.mjs';

const TYPES = { executive_order: 'Executive order', proclamation: 'Proclamation' };
// How the Federal Register names each type before its number.
const NAMED = { executive_order: 'Executive Order', proclamation: 'Proclamation' };

const signed = (d) => (d ? formatDate(d, 'day') : 'No signing date');

const params = new URLSearchParams(location.search);
if (params.get('id')) showRecord(params.get('id'));
else startExplorer();

function startExplorer() {
  // Started now so the chunks load while the first search and stats are in flight.
  const charts = Promise.all([
    import('../../src/viz/executive-by-year.jsx'),
    import('../../src/viz/ranked-bars.jsx'),
  ]);

  createExplorer({
    prefix: 'executive',
    endpoint: '/api/executive',
    filters: ['president', 'type', 'relation', 'from', 'to'],
    noun: 'documents',
    emptyText: 'No documents match your search and filters.',
    errorText: 'Could not load documents. Try again.',
    row: (d) => html`
      <tr>
        <td class="cell-dim cell-nowrap cell-trail">${signed(d.signing_date)}</td>
        <td class="cell-name cell-lead cell-wrap"><a class="text-link" href="/executive/?id=${d.id}">${d.title}</a>${d.snippet ? html`<span class="cell-snippet">${highlight(d.snippet)}</span>` : ''}</td>
        <td class="cell-dim cell-num" data-label="No.">${d.number ?? ''}</td>
        <td class="cell-dim">${d.president_name}</td>
        <td class="cell-dim cell-push">${TYPES[d.type]}</td>
      </tr>
    `,
    options: (stats) => ({
      // Term order, as Figure 2 draws them.
      president: (stats.by_president || []).map((p) => [p.president, p.president_name]),
      relation: (stats.relation_list || []).map((r) => [r.relation, `${r.relation} (${Number(r.count).toLocaleString()})`]),
    }),
    charts: async (stats, opts) => {
      // The dek's reach, read off the data so it never goes stale in the HTML.
      const reach = document.getElementById('executive-reach');
      const span = stats.year_range;
      if (reach && stats.total && span?.min) {
        reach.textContent = ` ${Number(stats.total).toLocaleString()} documents, signed ${span.min} to ${span.max}.`;
      }

      const [{ mountExecutiveByYear }, { mountRankedBars }] = await charts;
      mountExecutiveByYear(document.getElementById('viz-by-year'), stats, {
        ...opts,
        noteEl: document.getElementById('viz-by-year-note'),
      });
      mountRankedBars(document.getElementById('viz-by-president'), stats.by_president, {
        value: 'count', noun: 'documents', onFilter: opts.onFilter,
        label: 'president', filterKey: 'president', display: (d) => d.president_name,
      });
    },
  });
}

// ---- Record view (/executive/?id=…) ----------------------------------------

// A reference's text with every order or proclamation it names linked to its
// record, where get_fr_presidential_document resolved one. The rest of the
// text, and any number with no record here, stays plain.
function linkMentions(text, resolved) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(MENTION)) {
    const type = m[1] === 'EO' || m[1] === 'Executive Order' ? 'executive_order' : 'proclamation';
    const id = resolved.get(`${type}:${m[2]}`);
    out.push(text.slice(at, m.index));
    out.push(id ? html`<a href="/executive/?id=${id}" class="text-link">${m[0]}</a>` : m[0]);
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return html`${out}`;
}

// FR's note, one relation to a line: the label as FR prints it, then its
// references. The loader's check proves this reads as FR's note.
function notesMarkup(r) {
  const resolved = new Map((r.refs || []).map((x) => [`${x.type}:${x.number}`, x.id]));
  return r.notes_parsed.map((rel) => {
    const refs = rel.refs.map((x) => linkMentions(x.text, resolved));
    const joined = refs.flatMap((x, i) => (i ? ['; ', x] : [x]));
    return rel.relation === null
      ? html`<p>${joined}</p>`
      : html`<p><span class="fr-relation">${rel.relation}:</span> ${joined}</p>`;
  }).join('');
}

const documentLink = (doc) => (doc.id
  ? html`<a href="/executive/?id=${doc.id}" class="text-link">FR Doc. ${doc.document_number}</a>`
  : html`FR Doc. ${doc.document_number}`);

async function showRecord(id) {
  document.getElementById('executive-index').classList.add('hidden');
  const view = document.getElementById('executive-record');
  view.classList.remove('hidden');
  const status = document.getElementById('record-status');

  let res;
  try {
    res = await fetch(`/api/executive?${new URLSearchParams({ action: 'get', id })}`);
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not load this document. Try again.';
    return;
  }
  if (res.status === 404) {
    status.textContent = 'No document has this address.';
    return;
  }
  if (!res.ok) {
    status.textContent = 'Could not load this document. Try again.';
    return;
  }
  const r = await res.json();
  status.textContent = '';
  status.classList.add('hidden');

  document.title = `${r.title} — Verbatim`;
  document.getElementById('record-kicker').textContent =
    r.number ? `${NAMED[r.type]} ${r.number}` : TYPES[r.type];
  document.getElementById('record-title').textContent = r.title;
  document.getElementById('record-president').textContent = r.president_name;
  document.getElementById('record-date').textContent = r.signing_date ? `Signed ${signed(r.signing_date)}` : 'No signing date';

  const meta = [
    ...(r.number ? [['Number', `${NAMED[r.type]} ${r.number}`]] : []),
    ['Signed', signed(r.signing_date)],
    ['Published', formatDate(r.publication_date, 'day')],
    ...(r.citation ? [['Citation', r.citation]] : []),
    ['Source', html`<a href="${r.html_url}" target="_blank" rel="noopener" class="source-link">Federal Register, FR Doc. ${r.document_number}</a>`],
    ...(r.pdf_url ? [['Printed page', html`<a href="${r.pdf_url}" target="_blank" rel="noopener" class="source-link">PDF, govinfo.gov</a>`]] : []),
    ...(r.correction_of ? [['Correction of', documentLink(r.correction_of)]] : []),
    ...(r.corrections?.length ? [['Corrected by', html`${r.corrections.map((c, i) => html`${i ? ', ' : ''}${documentLink(c)}`)}`]] : []),
    ['Speeches', html`<a href="/corpus/?speaker=${r.president}" class="text-link">${r.president_name} in the Corpus</a>`],
  ];
  document.getElementById('record-meta').innerHTML = meta
    .map(([term, value]) => html`<div class="record-meta-row"><dt>${term}</dt><dd>${value}</dd></div>`)
    .join('');

  if (r.notes_parsed) {
    document.getElementById('record-notes').classList.remove('hidden');
    document.getElementById('record-notes-body').innerHTML = notesMarkup(r);
  }

  document.getElementById('record-text').innerHTML = paragraphs(r.text, { reflow: true, keepTables: true })
    .map((p) => html`<p>${p}</p>`).join('');
}
