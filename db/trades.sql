-- Congressional stock trades: tables and stored functions behind /trades/,
-- both chambers in one table. Applied with `npm run trades -- schema`;
-- db/schema.sql is the dump of what production holds afterward.
--
-- Sources (README "Data sources"; decisions in the 2026-11-18 House trades
-- record):
--   house-clerk  House Periodic Transaction Reports from the Clerk's
--                disclosure site, January 2014 on: the yearly index for every
--                filing, the PDF text for each electronic one.
--   carambat     Senate PTRs as published in timothycarambat/
--                senate-stock-watcher-data, aggregate/all_daily_summaries.json
--                (filed 2012 to March 2021), one filing per eFD link.
--   efd          Senate PTRs from eFD directly, when that loader exists.
--
-- A filing is one PTR. A paper filing is recorded with its link and no
-- transactions: paper PTRs are scans, and nothing here transcribes them.
--
-- Every text column holds what the filing printed. Where the filing prints a
-- code, the code is kept as printed (owner_code, type_code, asset_type_code)
-- and the label column beside it holds the source's own definition of that
-- code; the page and the stats read the label. A code the source does not
-- define has no label (a blank House owner stays blank).
--
-- Amendments: a House PTR amends single rows, printed again in a later PTR as
-- "Filing Status: Amended" with a transaction ID the original row lacks. The
-- loader links an amended row to the one earlier row of the same member that
-- matches on owner, type and amount plus the asset or the transaction date.
-- Exactly one match: the link is set and the earlier row is superseded, so a
-- corrected trade is counted once. Zero or several: no link, both rows stay,
-- and amendment_match says which. Superseded rows are kept and never searched
-- or counted.

-- Display names: one per person, from unitedstates/congress-legislators by
-- bioguide ID, for both chambers. member_sort orders the member select.
CREATE TABLE IF NOT EXISTS public.trade_members (
  bioguide text PRIMARY KEY,
  member text NOT NULL,
  member_sort text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.trade_filings (
  chamber text NOT NULL CHECK (chamber IN ('house', 'senate')),
  filing_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('house-clerk', 'efd', 'carambat')),
  kind text NOT NULL CHECK (kind IN ('electronic', 'paper')),
  bioguide text NOT NULL REFERENCES public.trade_members (bioguide),
  -- The filer as the source names them. House: the index's Prefix, First,
  -- Last and Suffix, and the PDF's own "Name:" line. Senate: first and last
  -- name and the office string.
  filer_prefix text,
  filer_first text,
  filer_last text,
  filer_suffix text,
  filer_name text,
  office text,
  state_district text,
  -- The House index's Year column, which is also the PDF's folder.
  report_year integer,
  filed_date date NOT NULL,
  url text NOT NULL,
  -- Senate eFD amends whole filings; House amends rows (stock_trades).
  amends_filing_id text,
  parse_status text NOT NULL CHECK (parse_status IN ('parsed', 'failed', 'paper')),
  parse_error text,
  row_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz,
  PRIMARY KEY (chamber, filing_id),
  CHECK ((kind = 'paper') = (parse_status = 'paper')),
  CHECK (parse_status = 'parsed' OR row_count = 0),
  CHECK ((parse_status = 'failed') = (parse_error IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_trade_filings_bioguide ON public.trade_filings (bioguide);
CREATE INDEX IF NOT EXISTS idx_trade_filings_filed ON public.trade_filings (filed_date);

CREATE TABLE IF NOT EXISTS public.stock_trades (
  chamber text NOT NULL,
  filing_id text NOT NULL,
  row_num integer NOT NULL CHECK (row_num > 0),
  source text NOT NULL CHECK (source IN ('house-clerk', 'efd', 'carambat')),
  bioguide text NOT NULL REFERENCES public.trade_members (bioguide),
  -- Copied from trade_members so search can match it; check.mjs holds the two
  -- equal.
  member text NOT NULL,
  transaction_id text,
  filing_status text,
  transaction_date date,
  notification_date date,
  owner_code text,
  owner text,
  asset_description text,
  ticker text,
  asset_type_code text,
  asset_type text,
  type_code text NOT NULL,
  type text NOT NULL CHECK (type IN ('Purchase', 'Sale (Full)', 'Sale (Partial)', 'Exchange')),
  amount text,
  subholding_of text,
  description text,
  comment text,
  amends_filing_id text,
  amends_row_num integer,
  amendment_match text CHECK (amendment_match IN ('unique', 'none', 'ambiguous')),
  superseded boolean NOT NULL DEFAULT false,
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig,
      member || ' ' || coalesce(ticker, '') || ' ' || coalesce(asset_description, ''))
  ) STORED,
  PRIMARY KEY (chamber, filing_id, row_num),
  FOREIGN KEY (chamber, filing_id) REFERENCES public.trade_filings (chamber, filing_id)
    ON DELETE CASCADE,
  -- A reload deletes and reinserts a filing's rows; the loader then relinks.
  FOREIGN KEY (chamber, amends_filing_id, amends_row_num)
    REFERENCES public.stock_trades (chamber, filing_id, row_num)
    ON DELETE SET NULL (amends_filing_id, amends_row_num),
  CHECK ((amends_filing_id IS NULL) = (amends_row_num IS NULL)),
  CHECK (amends_filing_id IS NULL OR amendment_match = 'unique')
);

CREATE INDEX IF NOT EXISTS idx_stock_trades_bioguide ON public.stock_trades (bioguide);
CREATE INDEX IF NOT EXISTS idx_stock_trades_date ON public.stock_trades (transaction_date);
CREATE INDEX IF NOT EXISTS idx_stock_trades_ticker ON public.stock_trades (ticker);
CREATE INDEX IF NOT EXISTS idx_stock_trades_type ON public.stock_trades (type);
CREATE INDEX IF NOT EXISTS idx_stock_trades_chamber ON public.stock_trades (chamber) WHERE NOT superseded;
CREATE INDEX IF NOT EXISTS idx_stock_trades_amends ON public.stock_trades (chamber, amends_filing_id, amends_row_num)
  WHERE amends_filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_trades_fts ON public.stock_trades USING gin (fts);

-- The filings' own amount ranges, ranked by lower bound; anything else ranks
-- 0 and is reported by check.mjs. The House form's eleventh option, "Spouse/DC
-- Over $1,000,000", is open-ended above $1,000,000, so it shares rank 7 with
-- "$1,000,001 - $5,000,000" (and sorts after it on the text).
CREATE OR REPLACE FUNCTION public.trade_amount_rank(amount text) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
  SELECT CASE amount
    WHEN '$1,001 - $15,000' THEN 1
    WHEN '$15,001 - $50,000' THEN 2
    WHEN '$50,001 - $100,000' THEN 3
    WHEN '$100,001 - $250,000' THEN 4
    WHEN '$250,001 - $500,000' THEN 5
    WHEN '$500,001 - $1,000,000' THEN 6
    WHEN '$1,000,001 - $5,000,000' THEN 7
    WHEN 'Spouse/DC Over $1,000,000' THEN 7
    WHEN '$5,000,001 - $25,000,000' THEN 8
    WHEN '$25,000,001 - $50,000,000' THEN 9
    WHEN 'Over $50,000,000' THEN 10
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.search_stock_trades(
  search_text text DEFAULT NULL,
  filter_chamber text DEFAULT NULL,
  filter_member text DEFAULT NULL,
  filter_type text DEFAULT NULL,
  filter_asset_type text DEFAULT NULL,
  filter_ticker text DEFAULT NULL,
  filter_year integer DEFAULT NULL,
  sort_col text DEFAULT 'transaction_date',
  sort_dir text DEFAULT 'desc',
  page_size integer DEFAULT 50,
  page_offset integer DEFAULT 0
) RETURNS json
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE result json; q tsquery;
BEGIN
  IF search_text IS NOT NULL AND search_text <> '' THEN q := plainto_tsquery('english', search_text); END IF;
  WITH filtered AS (
    SELECT t.*, f.state_district, f.url, f.filed_date
    FROM stock_trades t
    JOIN trade_filings f USING (chamber, filing_id)
    WHERE NOT t.superseded
      AND (q IS NULL OR t.fts @@ q)
      AND (filter_chamber IS NULL OR t.chamber = filter_chamber)
      AND (filter_member IS NULL OR t.member = filter_member)
      AND (filter_type IS NULL OR t.type = filter_type)
      AND (filter_asset_type IS NULL OR t.asset_type = filter_asset_type)
      AND (filter_ticker IS NULL OR t.ticker = filter_ticker)
      AND (filter_year IS NULL OR EXTRACT(YEAR FROM t.transaction_date) = filter_year)
  )
  SELECT json_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', coalesce((SELECT json_agg(row_to_json(r)) FROM (
      SELECT chamber, filing_id, row_num, transaction_date, owner, ticker,
        asset_description, asset_type, type, amount, member, bioguide,
        state_district, filing_status, amends_filing_id, amends_row_num,
        url, filed_date
      FROM filtered
      ORDER BY
        CASE WHEN sort_col = 'transaction_date' AND sort_dir = 'desc' THEN transaction_date END DESC NULLS LAST,
        CASE WHEN sort_col = 'transaction_date' AND sort_dir = 'asc' THEN transaction_date END ASC NULLS LAST,
        CASE WHEN sort_col = 'member' AND sort_dir = 'asc' THEN member END ASC,
        CASE WHEN sort_col = 'member' AND sort_dir = 'desc' THEN member END DESC,
        CASE WHEN sort_col = 'amount' AND sort_dir = 'desc' THEN trade_amount_rank(amount) END DESC NULLS LAST,
        CASE WHEN sort_col = 'amount' AND sort_dir = 'asc' THEN trade_amount_rank(amount) END ASC NULLS LAST,
        filed_date DESC, chamber, filing_id, row_num
      LIMIT page_size OFFSET page_offset
    ) r), '[]'::json)
  ) INTO result;
  RETURN result;
END; $$;

-- Every key the four charts read (by_year, top_traders, top_tickers,
-- by_amount) keeps its shape; top_traders entries keep `senator` for the
-- chart and carry `member` beside it.
CREATE OR REPLACE FUNCTION public.stock_trades_stats(filter_chamber text DEFAULT NULL) RETURNS json
  LANGUAGE sql STABLE
  AS $$
  WITH t AS (
    SELECT * FROM stock_trades
    WHERE NOT superseded AND (filter_chamber IS NULL OR chamber = filter_chamber)
  ), f AS (
    SELECT * FROM trade_filings WHERE filter_chamber IS NULL OR chamber = filter_chamber
  )
  SELECT json_build_object(
    'total', (SELECT count(*) FROM t),
    'members', (SELECT count(DISTINCT bioguide) FROM t),
    'filings', (SELECT count(*) FROM f),
    'paper_count', (SELECT count(*) FROM f WHERE kind = 'paper'),
    'failed_count', (SELECT count(*) FROM f WHERE parse_status = 'failed'),
    'last_filed', (SELECT max(filed_date) FROM f),
    'date_range', json_build_object('min', (SELECT min(transaction_date) FROM t), 'max', (SELECT max(transaction_date) FROM t)),
    'by_chamber', (SELECT coalesce(json_agg(json_build_object('chamber', chamber, 'count', cnt, 'members', members,
        'min', mn, 'max', mx) ORDER BY chamber), '[]'::json)
      FROM (SELECT chamber, count(*) AS cnt, count(DISTINCT bioguide) AS members,
        min(transaction_date) AS mn, max(transaction_date) AS mx FROM t GROUP BY chamber) c),
    'by_type', (SELECT coalesce(json_agg(json_build_object('type', type, 'count', cnt) ORDER BY cnt DESC, type), '[]'::json)
      FROM (SELECT type, count(*) AS cnt FROM t GROUP BY type) x),
    'by_year', (SELECT coalesce(json_agg(json_build_object('year', yr, 'count', cnt, 'purchases', purchases, 'sales', sales) ORDER BY yr), '[]'::json)
      FROM (SELECT EXTRACT(YEAR FROM transaction_date)::int AS yr, count(*) AS cnt,
        count(*) FILTER (WHERE type = 'Purchase') AS purchases,
        count(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) AS sales
        FROM t WHERE transaction_date IS NOT NULL GROUP BY yr) x),
    'top_traders', (SELECT coalesce(json_agg(json_build_object('senator', m.member, 'member', m.member, 'bioguide', x.bioguide,
        'total_trades', cnt, 'purchases', purchases, 'sales', sales) ORDER BY cnt DESC, m.member_sort), '[]'::json)
      FROM (SELECT bioguide, count(*) AS cnt,
        count(*) FILTER (WHERE type = 'Purchase') AS purchases,
        count(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) AS sales
        FROM t GROUP BY bioguide ORDER BY cnt DESC, bioguide LIMIT 20) x
      JOIN trade_members m USING (bioguide)),
    'top_tickers', (SELECT coalesce(json_agg(json_build_object('ticker', ticker, 'count', cnt, 'purchases', purchases, 'sales', sales) ORDER BY cnt DESC, ticker), '[]'::json)
      FROM (SELECT ticker, count(*) AS cnt,
        count(*) FILTER (WHERE type = 'Purchase') AS purchases,
        count(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) AS sales
        FROM t WHERE ticker IS NOT NULL GROUP BY ticker ORDER BY cnt DESC, ticker LIMIT 20) x),
    'by_amount', (SELECT coalesce(json_agg(json_build_object('amount', amount, 'count', cnt) ORDER BY trade_amount_rank(amount), amount), '[]'::json)
      FROM (SELECT amount, count(*) AS cnt FROM t WHERE amount IS NOT NULL GROUP BY amount) x),
    'by_asset_type', (SELECT coalesce(json_agg(json_build_object('asset_type', asset_type, 'count', cnt) ORDER BY cnt DESC, asset_type), '[]'::json)
      FROM (SELECT coalesce(nullif(asset_type, ''), 'Unknown') AS asset_type, count(*) AS cnt FROM t GROUP BY 1) x),
    'member_list', (SELECT coalesce(json_agg(json_build_object('member', m.member, 'bioguide', m.bioguide) ORDER BY m.member_sort), '[]'::json)
      FROM trade_members m WHERE EXISTS (SELECT 1 FROM t WHERE t.bioguide = m.bioguide))
  )
$$;

-- Paper filings, newest first, for the page's paper note.
CREATE OR REPLACE FUNCTION public.stock_trades_paper(filter_chamber text DEFAULT NULL) RETURNS json
  LANGUAGE sql STABLE
  AS $$
  SELECT coalesce(json_agg(json_build_object('chamber', f.chamber, 'filing_id', f.filing_id,
      'member', m.member, 'state_district', f.state_district, 'filed_date', f.filed_date, 'url', f.url)
    ORDER BY f.filed_date DESC, f.filing_id), '[]'::json)
  FROM trade_filings f JOIN trade_members m USING (bioguide)
  WHERE f.kind = 'paper' AND (filter_chamber IS NULL OR f.chamber = filter_chamber)
$$;
