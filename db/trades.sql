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
--   efd          Senate PTRs from eFD (efdsearch.senate.gov) itself: its PTR
--                list for every filing, each electronic report's own page for
--                its rows. carambat supplies only what eFD's copy lacks
--                (splitSenate in scripts/trades/build.mjs).
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
-- Amendments: a House PTR corrects single rows in a later PTR, printed as
-- "Filing Status: Amended", and withdraws them as "Filing Status: Deleted",
-- each with a transaction ID the original row lacks. The loader links such a
-- notice to the one earlier row of the same member it matches
-- (scripts/trades/amendments.mjs has the rule). Exactly one match: the link is
-- set and the earlier row is superseded, so a corrected trade is counted once.
-- Zero or several: no link, the earlier rows stay, and amendment_match says
-- which. `counted` is what search and stats read: a row neither superseded
-- nor a Deleted notice. Nothing is removed; every row stays reachable.
--
-- A Senate amendment is a whole new report that restates every row, so it
-- supersedes the whole filing before it: trade_filings.amends_filing_id names
-- that version, and every row of a filing another filing names is superseded
-- (supersedeFilings in scripts/trades/amendments.mjs).
--
-- Amounts: the House and Senate print the same ranges, plus the House form's
-- "Spouse/DC Over $1,000,000". A few House filers print an exact figure
-- instead ("$758.17"); it is kept as printed, sorts by its value, and is left
-- out of by_amount, which counts ranges only (exact_amounts counts the rest).
--
-- Dates: a transaction date is kept as printed, even after the filing that
-- reports it ("04/30/3031" in one House PTR). The date-keyed stats (by_year,
-- date_range, by_chamber's min and max) count only rows dated on or before
-- their filing; after_filing counts the rest. Search finds every row, and
-- lists newest filing first. Decisions 13 and 14 of the House trades record.

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

-- Added with the eFD loader (2026-11-18). Kept out of the CREATE so `schema`
-- also brings a database that already has the table up to date.
--
-- title: eFD's report title as printed, "Periodic Transaction Report for
-- MM/DD/YYYY" plus " (Amendment N)" on an amendment. An electronic report's
-- comes from its page's h1, which prints the date in Eastern time; the PTR
-- list prints it in UTC, a day late for a report filed after 19:00 ET. Paper
-- and unfetched reports have only the list's. NULL for House and carambat.
ALTER TABLE public.trade_filings ADD COLUMN IF NOT EXISTS title text;

-- An eFD amendment names the version it replaces. Deferred to commit, since
-- load inserts filings in batches in no particular order.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_filings_amends_fkey') THEN
    ALTER TABLE public.trade_filings ADD CONSTRAINT trade_filings_amends_fkey
      FOREIGN KEY (chamber, amends_filing_id) REFERENCES public.trade_filings (chamber, filing_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trade_filings_amends ON public.trade_filings (chamber, amends_filing_id)
  WHERE amends_filing_id IS NOT NULL;

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
  -- The House's labeled sub-lines under a row, as printed.
  subholding_of text,
  description text,
  location text,
  comment text,
  amends_filing_id text,
  amends_row_num integer,
  amendment_match text CHECK (amendment_match IN ('unique', 'none', 'ambiguous')),
  superseded boolean NOT NULL DEFAULT false,
  counted boolean GENERATED ALWAYS AS (NOT superseded AND filing_status IS DISTINCT FROM 'Deleted') STORED,
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
CREATE INDEX IF NOT EXISTS idx_stock_trades_chamber ON public.stock_trades (chamber) WHERE counted;
CREATE INDEX IF NOT EXISTS idx_stock_trades_amends ON public.stock_trades (chamber, amends_filing_id, amends_row_num)
  WHERE amends_filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_trades_fts ON public.stock_trades USING gin (fts);

-- The printed ranges in order of their lower bound ("Spouse/DC Over
-- $1,000,000" starts above $1,000,000, just below "$1,000,001 - ..."); any
-- other amount ranks 0. check.mjs fails a rank-0 amount that is not an exact
-- dollar figure.
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
    WHEN 'Spouse/DC Over $1,000,000' THEN 7
    WHEN '$1,000,001 - $5,000,000' THEN 8
    WHEN '$5,000,001 - $25,000,000' THEN 9
    WHEN '$25,000,001 - $50,000,000' THEN 10
    WHEN 'Over $50,000,000' THEN 11
    ELSE 0 END
$$;

-- The sort key: the first dollar figure printed, so a range sorts by its
-- lower bound and an exact amount by itself.
CREATE OR REPLACE FUNCTION public.trade_amount_low(amount text) RETURNS numeric
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
  SELECT nullif(replace(substring(amount FROM '\$([0-9,]*\.?[0-9]*)'), ',', ''), '')::numeric
$$;

CREATE OR REPLACE FUNCTION public.search_stock_trades(
  search_text text DEFAULT NULL,
  filter_chamber text DEFAULT NULL,
  filter_member text DEFAULT NULL,
  filter_type text DEFAULT NULL,
  filter_asset_type text DEFAULT NULL,
  filter_ticker text DEFAULT NULL,
  filter_year integer DEFAULT NULL,
  sort_col text DEFAULT 'filed_date',
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
    WHERE t.counted
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
        CASE WHEN sort_col = 'filed_date' AND sort_dir = 'asc' THEN filed_date END ASC,
        CASE WHEN sort_col = 'transaction_date' AND sort_dir = 'desc' THEN transaction_date END DESC NULLS LAST,
        CASE WHEN sort_col = 'transaction_date' AND sort_dir = 'asc' THEN transaction_date END ASC NULLS LAST,
        CASE WHEN sort_col = 'member' AND sort_dir = 'asc' THEN member END ASC,
        CASE WHEN sort_col = 'member' AND sort_dir = 'desc' THEN member END DESC,
        CASE WHEN sort_col = 'amount' AND sort_dir = 'desc' THEN trade_amount_low(amount) END DESC NULLS LAST,
        CASE WHEN sort_col = 'amount' AND sort_dir = 'asc' THEN trade_amount_low(amount) END ASC NULLS LAST,
        filed_date DESC, chamber, filing_id, row_num
      LIMIT page_size OFFSET page_offset
    ) r), '[]'::json)
  ) INTO result;
  RETURN result;
END; $$;

-- Every key the four charts read (by_year, top_traders, top_tickers,
-- by_amount) keeps its shape; top_traders entries keep `senator` for the
-- chart and carry `member` beside it, plus `chambers`, the chambers their
-- counted rows here come from (two for a member with rows from both).
CREATE OR REPLACE FUNCTION public.stock_trades_stats(filter_chamber text DEFAULT NULL) RETURNS json
  LANGUAGE sql STABLE
  AS $$
  WITH t AS (
    SELECT st.*, fl.filed_date FROM stock_trades st JOIN trade_filings fl USING (chamber, filing_id)
    WHERE st.counted AND (filter_chamber IS NULL OR st.chamber = filter_chamber)
  ), dated AS (
    SELECT * FROM t WHERE transaction_date <= filed_date
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
    'date_range', json_build_object('min', (SELECT min(transaction_date) FROM dated), 'max', (SELECT max(transaction_date) FROM dated)),
    'after_filing', (SELECT count(*) FROM t WHERE transaction_date > filed_date),
    'by_chamber', (SELECT coalesce(json_agg(json_build_object('chamber', chamber, 'count', cnt, 'members', members,
        'min', mn, 'max', mx) ORDER BY chamber), '[]'::json)
      FROM (SELECT chamber, count(*) AS cnt, count(DISTINCT bioguide) AS members,
        min(transaction_date) FILTER (WHERE transaction_date <= filed_date) AS mn,
        max(transaction_date) FILTER (WHERE transaction_date <= filed_date) AS mx FROM t GROUP BY chamber) c),
    'by_type', (SELECT coalesce(json_agg(json_build_object('type', type, 'count', cnt) ORDER BY cnt DESC, type), '[]'::json)
      FROM (SELECT type, count(*) AS cnt FROM t GROUP BY type) x),
    'by_year', (SELECT coalesce(json_agg(json_build_object('year', yr, 'count', cnt, 'purchases', purchases, 'sales', sales) ORDER BY yr), '[]'::json)
      FROM (SELECT EXTRACT(YEAR FROM transaction_date)::int AS yr, count(*) AS cnt,
        count(*) FILTER (WHERE type = 'Purchase') AS purchases,
        count(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) AS sales
        FROM dated GROUP BY yr) x),
    'top_traders', (SELECT coalesce(json_agg(json_build_object('senator', m.member, 'member', m.member, 'bioguide', x.bioguide,
        'chambers', x.chambers, 'total_trades', cnt, 'purchases', purchases, 'sales', sales) ORDER BY cnt DESC, m.member_sort), '[]'::json)
      FROM (SELECT bioguide, count(*) AS cnt, array_agg(DISTINCT chamber ORDER BY chamber) AS chambers,
        count(*) FILTER (WHERE type = 'Purchase') AS purchases,
        count(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) AS sales
        FROM t GROUP BY bioguide ORDER BY cnt DESC, bioguide LIMIT 20) x
      JOIN trade_members m USING (bioguide)),
    'top_tickers', (SELECT coalesce(json_agg(json_build_object('ticker', ticker, 'count', cnt, 'purchases', purchases, 'sales', sales) ORDER BY cnt DESC, ticker), '[]'::json)
      FROM (SELECT ticker, count(*) AS cnt,
        count(*) FILTER (WHERE type = 'Purchase') AS purchases,
        count(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) AS sales
        FROM t WHERE ticker IS NOT NULL GROUP BY ticker ORDER BY cnt DESC, ticker LIMIT 20) x),
    'by_amount', (SELECT coalesce(json_agg(json_build_object('amount', amount, 'count', cnt) ORDER BY trade_amount_rank(amount)), '[]'::json)
      FROM (SELECT amount, count(*) AS cnt FROM t WHERE trade_amount_rank(amount) > 0 GROUP BY amount) x),
    'exact_amounts', (SELECT count(*) FROM t WHERE amount IS NOT NULL AND trade_amount_rank(amount) = 0),
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
