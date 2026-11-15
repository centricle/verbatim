import { getSQL } from './shared/db.js'
import { pageNum, pageSize } from './shared/paging.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT compas_stats() as data`
    return json(row.data)
  }

  // search
  const rows = await sql`SELECT * FROM search_compas(
    ${params.q || ''}, ${params.race || ''}, ${params.score || ''},
    ${params.sex || ''}, ${params.recid || ''},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  )`
  const total = rows.length > 0 ? rows[0].total_count : 0
  return json({ total, rows: rows.map(({ total_count, ...r }) => r) })
}
