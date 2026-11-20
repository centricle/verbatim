import { getSQL } from './shared/db.js'
import { guard, jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('qi')

async function handle(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT qi_cases_stats() as data`
    return json(row.data)
  }

  // Not a year: no year filter, rather than a cast error from Postgres.
  const year = /^\d{4}$/.test(params.year || '') ? parseInt(params.year, 10) : null

  const [row] = await sql`SELECT search_qi_cases(
    ${params.q || null}, ${params.circuit || null}, ${year},
    ${params.ruling || null}, ${params.violation || null},
    ${params.sortBy || 'year'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}

export const handler = guard('qi', handle)
