// Paging parameters for the search endpoints, clamped before they reach SQL.
//
// The explorers always ask for 50 rows (PAGE_SIZE in public/js/explorer.js).
// The ceiling keeps one request from pulling a whole table; the floors keep a
// zero or negative value from becoming a negative OFFSET, which Postgres
// rejects as an error.

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

const positiveInt = (raw) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const pageSize = (raw) => Math.min(positiveInt(raw) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
export const pageNum = (raw) => positiveInt(raw) || 1
export const rowOffset = (raw) => positiveInt(raw)
