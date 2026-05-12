import { getSQL } from './shared/db.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT senate_trades_stats() as data`
    return json(row.data)
  }

  const [row] = await sql`SELECT search_senate_trades(
    ${params.q || null}, ${params.senator || null}, ${params.type || null},
    ${params.assetType || null}, ${params.ticker || null},
    ${params.year ? parseInt(params.year) : null},
    ${params.sortCol || 'transaction_date'}, ${params.sortDir || 'desc'},
    ${parseInt(params.pageSize) || 50}, ${parseInt(params.offset) || 0}
  ) as data`
  return json(row.data)
}
