import { getSQL } from './shared/db.js'
import { guard, jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('crashes')

// Not a year: no year filter, rather than an out-of-range error from Postgres.
const yearOrNull = (raw) => (/^\d{4}$/.test(raw || '') ? parseInt(raw, 10) : null)

async function handle(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT sgo_crashes_stats() as data`
    return json(row.data)
  }

  const [row] = await sql`SELECT search_sgo_crashes(
    ${params.q || null}, ${params.system || null}, ${params.make || null},
    ${params.state || null}, ${yearOrNull(params.year)}, ${params.period || null},
    ${params.severity || null},
    ${params.sortBy || 'incident'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}

export const handler = guard('crashes', handle)
