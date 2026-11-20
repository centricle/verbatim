import { getSQL } from './shared/db.js'
import { guard, jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('incidents')

async function handle(event) {
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

export const handler = guard('incidents', handle)
