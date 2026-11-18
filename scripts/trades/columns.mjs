// The columns load writes and check reads back, with their Postgres types
// (text unless named). Generated columns (counted, fts) are left out: the
// database computes them.

const typed = (types, names) => names.map((n) => [n, types[n] ?? 'text']);

export const MEMBER_COLUMNS = typed({}, ['bioguide', 'member', 'member_sort']);

export const FILING_COLUMNS = typed(
  { report_year: 'integer', filed_date: 'date', row_count: 'integer', fetched_at: 'timestamptz' },
  ['chamber', 'filing_id', 'source', 'kind', 'bioguide', 'filer_prefix', 'filer_first', 'filer_last',
    'filer_suffix', 'filer_name', 'office', 'state_district', 'report_year', 'filed_date', 'url',
    'amends_filing_id', 'parse_status', 'parse_error', 'row_count', 'fetched_at'],
);

export const ROW_COLUMNS = typed(
  { row_num: 'integer', transaction_date: 'date', notification_date: 'date', amends_row_num: 'integer', superseded: 'boolean' },
  ['chamber', 'filing_id', 'row_num', 'source', 'bioguide', 'member', 'transaction_id', 'filing_status',
    'transaction_date', 'notification_date', 'owner_code', 'owner', 'asset_description', 'ticker',
    'asset_type_code', 'asset_type', 'type_code', 'type', 'amount', 'subholding_of', 'description',
    'location', 'comment', 'amends_filing_id', 'amends_row_num', 'amendment_match', 'superseded'],
);

// A SELECT list that reads each column back in the form build() produces:
// dates as YYYY-MM-DD, timestamps as JavaScript's toISOString().
export function selectList(columns) {
  return columns.map(([n, t]) => {
    if (t === 'date') return `to_char(${n}, 'YYYY-MM-DD') AS ${n}`;
    if (t === 'timestamptz') return `to_char(${n} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${n}`;
    return n;
  }).join(', ');
}
