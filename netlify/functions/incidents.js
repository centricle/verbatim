import { getSQL } from './shared/db.js'
import { pageNum, pageSize } from './shared/paging.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT police_shootings_stats() as data`
    return json(row.data)
  }

  const [row] = await sql`SELECT search_police_shootings(
    ${params.q || null}, ${params.state || null}, ${params.race || null},
    ${params.armed || null}, ${params.gender || null}, ${params.year || null},
    ${params.mental || null}, ${params.sortBy || 'date'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
