import { getSQL } from './shared/db.js'
import { jsonFor } from './shared/respond.js'
import { pageNum, pageSize } from './shared/paging.js'

const json = jsonFor('disbursements')

// The page shows one chamber at a time, and the House is the default: a
// request without `chamber=senate` (every link from before the Senate
// arrived among them) is the House's, for the stats and the rows alike, so
// the two always describe the same chamber.
const chamberOf = (raw) => (raw === 'senate' ? 'senate' : 'house')

// `2026q2` becomes the quarter's first day, the table's period_start. A
// Senate half year starts on a quarter's first day too (`2025q4` is October
// to March). Any other value drops the filter rather than reaching Postgres
// as a cast error.
const QUARTER = /^(\d{4})q([1-4])$/
function quarterStart(raw) {
  const m = QUARTER.exec(raw || '')
  if (!m) return null
  const month = String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')
  return `${m[1]}-${month}-01`
}

// The stored function caps the total at 10,000 and clamps the page to match
// (db/disbursements.sql); a capped answer carries total_capped.
export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()
  const chamber = chamberOf(params.chamber)

  if (params.action === 'stats') {
    const [row] = await sql`SELECT disbursements_stats(${chamber}::text) as data`
    return json(row.data ?? {})
  }

  const [row] = await sql`SELECT search_disbursements(
    ${params.q || null}, ${chamber}, ${quarterStart(params.quarter)},
    ${params.category || null}, ${params.office || null},
    ${params.sortBy || 'date'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
