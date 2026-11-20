import { getSQL } from './shared/db.js'
import { guard, jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('compas')

// search_compas casts recid to an integer; anything but the table's 0 or 1
// drops the filter rather than reaching Postgres as a cast error.
const recidOrBlank = (raw) => (/^[01]$/.test(raw || '') ? raw : '')

async function handle(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT compas_stats() as data`
    return json(row.data)
  }

  // search
  const rows = await sql`SELECT * FROM search_compas(
    ${params.q || ''}, ${params.race || ''}, ${params.score || ''},
    ${params.sex || ''}, ${recidOrBlank(params.recid)},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  )`
  const total = rows.length > 0 ? rows[0].total_count : 0
  return json({ total, rows: rows.map(({ total_count, ...r }) => r) })
}

export const handler = guard('compas', handle)
