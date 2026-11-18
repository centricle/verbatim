import { getSQL } from './shared/db.js'
import { pageNum, pageSize } from './shared/paging.js'

function json(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }, body: JSON.stringify(data) }
}

// Years bound the signing date via make_date, which rejects year 0. Anything
// but one to four digits, or 0, is no bound at all.
const yearOrNull = (raw) => {
  if (!/^\d{1,4}$/.test(raw || '')) return null
  const n = parseInt(raw, 10)
  return n > 0 ? n : null
}

const ID = /^[0-9a-f]{64}$/
const TYPES = new Set(['executive_order', 'proclamation'])
// A relation label as FR prints it ("Revoked by", "Revoked (in part) by"); an
// unknown one matches no document.
const relationOrNull = (raw) => (/^[A-Za-z][A-Za-z ()]{0,59}$/.test(raw || '') ? raw : null)

export async function handler(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()

  if (params.action === 'stats') {
    const [row] = await sql`SELECT fr_presidential_documents_stats() as data`
    return json(row.data)
  }

  if (params.action === 'get') {
    if (!ID.test(params.id || '')) return json({ error: 'not found' }, 404)
    const [row] = await sql`SELECT get_fr_presidential_document(${params.id}) as data`
    return row.data ? json(row.data) : json({ error: 'not found' }, 404)
  }

  const [row] = await sql`SELECT search_fr_presidential_documents(
    ${params.q || null}, ${params.president || null},
    ${TYPES.has(params.type) ? params.type : null}, ${relationOrNull(params.relation)},
    ${yearOrNull(params.from)}, ${yearOrNull(params.to)},
    ${params.sortBy || 'signed'}, ${params.sortDir || 'desc'},
    ${pageNum(params.page)}, ${pageSize(params.pageSize)}
  ) as data`
  return json(row.data)
}
