import { getSQL } from './shared/db.js'
import { guard, jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('finance')

async function handle(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT fec_candidates_stats() as data`
    return json(row.data)
  }

  const [row] = await sql`SELECT search_fec_candidates(
    ${params.q || null}, ${params.state || null}, ${params.party || null},
    ${params.office || null}, ${params.incumbent || null},
    ${params.sortBy || 'total_receipts'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}

export const handler = guard('finance', handle)
