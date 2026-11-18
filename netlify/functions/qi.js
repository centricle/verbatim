import { getSQL } from './shared/db.js'
import { jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('qi')

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT qi_cases_stats() as data`
    return json(row.data)
  }

  const [row] = await sql`SELECT search_qi_cases(
    ${params.q || null}, ${params.circuit || null},
    ${params.year ? parseInt(params.year) : null},
    ${params.ruling || null}, ${params.violation || null},
    ${params.sortBy || 'year'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
