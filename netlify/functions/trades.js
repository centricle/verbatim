import { getSQL } from './shared/db.js'
import { guard, jsonFor } from './shared/respond.js'
import { pageSize, rowOffset } from './shared/paging.js'
import { legacySenator } from './shared/legacy-senators.js'

const json = jsonFor('trades')

// Both chambers, from stock_trades (db/trades.sql). `chamber` narrows search,
// stats and the paper list; `member` is trade_members' name.
//
// Links from before the House joined carry `?senator=` with the old table's
// string ("Ron L Wyden"). It maps to the person's member name and to the
// Senate, so an old link returns the same senator's Senate trades it did
// (legacy-senators.js). An unknown string goes through as a member name and
// matches whatever, usually nothing, carries that name.
async function handle(event) {
  const params = event.queryStringParameters || {}
  const sql = getSQL()
  const legacy = params.member ? undefined : legacySenator(params.senator)
  const chamber = params.chamber || (legacy ? 'senate' : null)

  if (params.action === 'stats') {
    const [row] = await sql`SELECT stock_trades_stats(${chamber}) as data`
    return json(row.data)
  }

  if (params.action === 'paper') {
    const [row] = await sql`SELECT stock_trades_paper(${chamber}) as data`
    return json(row.data)
  }

  const member = params.member || legacy?.member || params.senator || null
  // Not a year: no year filter, rather than a cast error from Postgres.
  const year = /^\d{4}$/.test(params.year || '') ? parseInt(params.year, 10) : null
  const sortCol = params.sortCol === 'senator' ? 'member' : params.sortCol || 'filed_date'

  const [row] = await sql`SELECT search_stock_trades(
    ${params.q || null}, ${chamber}, ${member}, ${params.type || null},
    ${params.assetType || null}, ${params.ticker || null}, ${year},
    ${sortCol}, ${params.sortDir || 'desc'},
    ${pageSize(params.pageSize)}, ${rowOffset(params.offset)}
  ) as data`
  return json(row.data)
}

export const handler = guard('trades', handle)
