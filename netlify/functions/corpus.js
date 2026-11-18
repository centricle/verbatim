import { getSQL } from './shared/db.js'
import { jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('corpus')

// Years bound a date range in search_corpus via make_date, which rejects year
// 0. Anything but one to four digits, or 0, is no bound at all.
const yearOrNull = (raw) => {
  if (!/^\d{1,4}$/.test(raw || '')) return null
  const n = parseInt(raw, 10)
  return n > 0 ? n : null
}

const ID = /^[0-9a-f]{64}$/
// A series key as scripts/corpus/series.json writes it; an unknown one
// matches no record.
const SERIES = /^[a-z]{1,20}$/
const seriesOrNull = (raw) => (SERIES.test(raw || '') ? raw : null)

// Terms for /over-time/: `t` repeated, at most three, each one word as typed.
// Postgres reduces each to its lexeme and says when it can't.
function terms(event) {
  const raw = event.multiValueQueryStringParameters?.t ?? [event.queryStringParameters?.t]
  return raw.filter(Boolean).map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 3)
}

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT corpus_stats() as data`
    return json(row.data)
  }

  if (params.action === 'terms') {
    const series = seriesOrNull(params.series)
    if (!series) return json({ error: 'unknown series' }, 400)
    const [row] = await sql`SELECT corpus_term_series(${series}, ${terms(event)}::text[]) as data`
    return json(row.data)
  }

  if (params.action === 'amendments') {
    const [row] = await sql`SELECT corpus_amendments() as data`
    return json(row.data)
  }

  if (params.action === 'contents') {
    const [row] = await sql`SELECT corpus_contents() as data`
    return json(row.data)
  }

  if (params.action === 'get') {
    if (!ID.test(params.id || '')) return json({ error: 'not found' }, 404)
    const [row] = await sql`SELECT get_corpus_statement(${params.id}) as data`
    return row.data ? json(row.data) : json({ error: 'not found' }, 404)
  }

  const [row] = await sql`SELECT search_corpus(
    ${params.q || null}, ${params.speaker || null}, ${params.genre || null},
    ${params.collection || null}, ${seriesOrNull(params.series)},
    ${yearOrNull(params.from)}, ${yearOrNull(params.to)},
    ${params.sortBy || 'date'}, ${params.sortDir || 'asc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
