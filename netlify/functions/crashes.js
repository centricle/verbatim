import { getSQL } from './shared/db.js'
import { pageNum, pageSize } from './shared/paging.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

const intOrNull = (raw) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT sgo_crashes_stats() as data`
    return json(row.data)
  }

  const [row] = await sql`SELECT search_sgo_crashes(
    ${params.q || null}, ${params.system || null}, ${params.make || null},
    ${params.state || null}, ${intOrNull(params.year)}, ${params.period || null},
    ${params.severity || null},
    ${params.sortBy || 'incident'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
