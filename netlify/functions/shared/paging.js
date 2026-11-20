// Paging parameters for the search endpoints, clamped before they reach SQL.
//
// The explorers always ask for 50 rows (PAGE_SIZE in public/js/explorer.js).
// The ceiling keeps one request from pulling a whole table; the floors keep a
// zero or negative value from becoming a negative OFFSET, which Postgres
// rejects as an error.
//
// MAX_ROWS bounds how deep a request can page. Without it a page past
// 2^31 failed Postgres' integer cast, and any page past the end of a big
// result made Postgres walk every row only to return none. No explorer's
// unfiltered total comes near it (each `?action=stats` says), and
// /disbursements/ caps its own at 10,000 in SQL; raise this before a total
// does. A request past it gets the page at the ceiling, which is empty for
// every result smaller than the ceiling.

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100
export const MAX_ROWS = 250000

const positiveInt = (raw) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const pageSize = (raw) => Math.min(positiveInt(raw) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
export const pageNum = (raw) => Math.min(positiveInt(raw) || 1, MAX_ROWS / DEFAULT_PAGE_SIZE + 1)
export const rowOffset = (raw) => Math.min(positiveInt(raw), MAX_ROWS)
