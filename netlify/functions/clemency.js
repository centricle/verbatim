import { getSQL } from './shared/db.js'
import { pageNum, pageSize } from './shared/paging.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

const TYPES = new Set(['pardon', 'commutation'])

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT clemency_grants_stats() as data`
    return json(row.data)
  }

  // A value outside what the table holds filters to nothing rather than
  // reaching Postgres as a cast error.
  const year = /^\d{4}$/.test(params.year || '') ? parseInt(params.year, 10) : null
  const type = TYPES.has(params.type) ? params.type : null

  const [row] = await sql`SELECT search_clemency_grants(
    ${params.q || null}, ${params.president || null}, ${type}, ${year},
    ${params.sortBy || 'date'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
