import { getSQL } from './shared/db.js'
import { pageNum, pageSize } from './shared/paging.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

// Years bound a date range in search_corpus via make_date, which rejects year
// 0. Anything but one to four digits, or 0, is no bound at all.
const yearOrNull = (raw) => {
  if (!/^\d{1,4}$/.test(raw || '')) return null
  const n = parseInt(raw, 10)
  return n > 0 ? n : null
}

const ID = /^[0-9a-f]{64}$/

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT corpus_stats() as data`
    return json(row.data)
  }

  if (params.action === 'get') {
    if (!ID.test(params.id || '')) return json({ error: 'not found' }, 404)
    const [row] = await sql`SELECT get_corpus_statement(${params.id}) as data`
    return row.data ? json(row.data) : json({ error: 'not found' }, 404)
  }

  const [row] = await sql`SELECT search_corpus(
    ${params.q || null}, ${params.speaker || null}, ${params.genre || null},
    ${params.collection || null}, ${yearOrNull(params.from)}, ${yearOrNull(params.to)},
    ${params.sortBy || 'date'}, ${params.sortDir || 'asc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
