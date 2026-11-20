-- Congressional office disbursements: the table behind /disbursements/.
-- Applied with `npm run disbursements -- schema --target <endpoint>`;
-- db/schema.sql is the dump of what production holds afterward.
--
-- One table for both chambers. House rows come from the CAO's Statement of
-- Disbursements detail CSVs, one unit per quarter (`house-2026q2`), and
-- scripts/disbursements/parse.mjs documents every change the loader makes:
-- staff pay and benefits to former personnel arrive as the source's own
-- subtotal rows (row_kind 'subtotal'), office and org_year are derived from
-- the published organization name, and fields only one chamber publishes live in
-- extras. Everything else is as published.
--
-- Senate rows come from the Report of the Secretary of the Senate, one unit
-- per semiannual volume (`senate-fy2026h1`, October 2025 to March 2026), and
-- scripts/disbursements/senate-parse.mjs documents what its loader keeps:
-- every listed line except the per-person pay lines, which arrive as the
-- report's own subtotals, as the House's do.
CREATE TABLE IF NOT EXISTS public.disbursements (
  chamber text NOT NULL CHECK (chamber IN ('house', 'senate')),
  unit text NOT NULL,
  row_number integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  organization text NOT NULL,
  office text NOT NULL,
  org_year integer,
  funding_year text,
  program text,
  category text,
  row_kind text NOT NULL CHECK (row_kind IN ('detail', 'subtotal')),
  transaction_date date,
  start_date date,
  end_date date,
  document text,
  payee text,
  description text,
  amount numeric(14,2) NOT NULL,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_ref text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce(payee, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig,
      coalesce(description, '') || ' ' || coalesce(office, '') || ' ' || coalesce(program, '')), 'B')
  ) STORED,
  PRIMARY KEY (unit, row_number)
);
CREATE INDEX IF NOT EXISTS idx_disb_period ON public.disbursements (period_start);
CREATE INDEX IF NOT EXISTS idx_disb_chamber_period ON public.disbursements (chamber, period_start);
CREATE INDEX IF NOT EXISTS idx_disb_office ON public.disbursements (office);
CREATE INDEX IF NOT EXISTS idx_disb_category ON public.disbursements (category);
CREATE INDEX IF NOT EXISTS idx_disb_amount ON public.disbursements (amount);
CREATE INDEX IF NOT EXISTS idx_disb_tsv ON public.disbursements USING gin (tsv);

-- Search. Two departures from the other explorers' search functions, both
-- forced by size (3.9 M House rows, measured on a staging branch at 0.25 CU,
-- 2026-11-19):
--
-- - The total is capped. An exact count of a broad filter reads most of the
--   2.3 GB heap (7.3 s for category TRAVEL, 8.9 s for "citibank"), and a
--   Netlify function stops at 10 s. The count stops at cap + 1; past the cap
--   the result carries total_capped, total is the cap, and paging stops
--   there too, so no request pays for a deep OFFSET.
-- - plan_cache_mode = force_custom_plan. Every query is planned with the
--   call's own values, so each `filter IS NULL OR ...` and each sort CASE
--   folds to a plain predicate or column an index can serve. A generic plan
--   keeps them as expressions, and the first page becomes a full sort.
CREATE OR REPLACE FUNCTION public.search_disbursements(
  search_query text DEFAULT NULL,
  filter_chamber text DEFAULT NULL,
  filter_period date DEFAULT NULL,
  filter_category text DEFAULT NULL,
  filter_office text DEFAULT NULL,
  sort_by text DEFAULT 'date',
  sort_dir text DEFAULT 'desc',
  page_num integer DEFAULT 1,
  page_size integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE
  SET plan_cache_mode = force_custom_plan
  AS $$
DECLARE
  cap constant integer := 10000;
  total_count bigint; capped boolean; result jsonb; q tsquery;
  by_amount boolean := sort_by = 'amount';
  ascending boolean := sort_dir = 'asc';
BEGIN
  IF search_query IS NOT NULL AND btrim(search_query) <> '' THEN
    q := websearch_to_tsquery('english', search_query);
  END IF;
  page_num := least(page_num, ceil(cap::numeric / greatest(page_size, 1))::integer);
  SELECT count(*) INTO total_count FROM (
    SELECT 1 FROM disbursements
    WHERE (q IS NULL OR tsv @@ q)
      AND (filter_chamber IS NULL OR chamber = filter_chamber)
      AND (filter_period IS NULL OR period_start = filter_period)
      AND (filter_category IS NULL OR category = filter_category)
      AND (filter_office IS NULL OR office = filter_office)
    LIMIT cap + 1
  ) s;
  capped := total_count > cap;
  -- The page is chosen on bare columns and only its rows become JSON. Built
  -- inside the sorted query, the object was made for every row the sort
  -- read: a whole quarter for "newest", 0.90 s against 0.09 s (2026-11-19).
  SELECT jsonb_build_object('total', least(total_count, cap), 'total_capped', capped,
    'rows', coalesce(jsonb_agg(jsonb_build_object('chamber', p.chamber, 'unit', p.unit,
      'row_number', p.row_number, 'period_start', p.period_start, 'period_end', p.period_end,
      'organization', p.organization, 'office', p.office, 'org_year', p.org_year,
      'funding_year', p.funding_year, 'program', p.program, 'category', p.category,
      'row_kind', p.row_kind, 'transaction_date', p.transaction_date,
      'start_date', p.start_date, 'end_date', p.end_date, 'document', p.document,
      'payee', p.payee, 'description', p.description, 'amount', p.amount,
      'extras', p.extras, 'source_ref', p.source_ref) ORDER BY p.ord), '[]'::jsonb))
  INTO result FROM (
    SELECT d.*, row_number() OVER () AS ord FROM (
      SELECT d.chamber, d.unit, d.row_number, d.period_start, d.period_end, d.organization,
        d.office, d.org_year, d.funding_year, d.program, d.category, d.row_kind,
        d.transaction_date, d.start_date, d.end_date, d.document, d.payee, d.description,
        d.amount, d.extras, d.source_ref
      FROM disbursements d
      WHERE (q IS NULL OR d.tsv @@ q)
        AND (filter_chamber IS NULL OR d.chamber = filter_chamber)
        AND (filter_period IS NULL OR d.period_start = filter_period)
        AND (filter_category IS NULL OR d.category = filter_category)
        AND (filter_office IS NULL OR d.office = filter_office)
      ORDER BY
        CASE WHEN by_amount AND NOT ascending THEN d.amount END DESC,
        CASE WHEN by_amount AND ascending THEN d.amount END ASC,
        CASE WHEN NOT by_amount AND ascending THEN d.period_start END ASC,
        CASE WHEN NOT by_amount AND ascending THEN d.transaction_date END ASC NULLS LAST,
        CASE WHEN NOT by_amount AND NOT ascending THEN d.period_start END DESC,
        CASE WHEN NOT by_amount AND NOT ascending THEN d.transaction_date END DESC NULLS LAST,
        d.unit, d.row_number
      LIMIT page_size OFFSET (page_num - 1) * page_size
    ) d
  ) p;
  RETURN result;
END; $$;

-- Stats for the charts and filter lists, computed once per load: live, each
-- query took 7 to 25 s at 0.25 CU (2026-11-19), and a function stops at 10 s.
-- One row per chamber, because /disbursements/ shows one chamber at a time:
-- the House files by quarter and the Senate by half year, their categories
-- are different lists, and no office is in both.
--
-- `g` is one heap scan behind every count and sum; the payees and the office
-- list take one each. At 0.25 CU a refresh took 33 s straight after a load
-- and 177 s on a cold cache, where five scans took 344 s (2026-11-19).
-- `cli.mjs load` and `cli.mjs senate load` refresh the view as their last
-- step, `cli.mjs stats` refreshes it alone, and both checks fail while its
-- counts disagree with the table. The unique index is what REFRESH ...
-- CONCURRENTLY needs, so a reader never waits on a refresh. IF NOT EXISTS
-- keeps a changed definition from applying: drop the view first, then rerun
-- `schema` and `stats`.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.disbursements_chamber_stats_mv AS
WITH g AS (
  SELECT chamber, period_start, period_end, category, count(*) AS count, sum(amount) AS amount
  FROM disbursements GROUP BY chamber, period_start, period_end, category
), p AS (
  SELECT chamber, payee, count, amount FROM (
    SELECT chamber, payee, count(*) AS count, sum(amount) AS amount,
      row_number() OVER (PARTITION BY chamber ORDER BY sum(amount) DESC, payee) AS rank
    FROM disbursements WHERE payee IS NOT NULL GROUP BY chamber, payee
  ) r WHERE rank <= 25
), o AS (
  SELECT DISTINCT chamber, office FROM disbursements
)
SELECT c.chamber, jsonb_build_object(
  'chamber', c.chamber,
  'total', (SELECT sum(count) FROM g WHERE g.chamber = c.chamber),
  'amount', (SELECT sum(amount) FROM g WHERE g.chamber = c.chamber),
  'period_range', (SELECT jsonb_build_object('min', min(period_start), 'max', max(period_end))
    FROM g WHERE g.chamber = c.chamber),
  'by_period', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.period_start), '[]'::jsonb) FROM (
    SELECT chamber, period_start, period_end, sum(count) AS count, sum(amount) AS amount
    FROM g WHERE g.chamber = c.chamber GROUP BY chamber, period_start, period_end) s),
  'by_category', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.amount DESC), '[]'::jsonb) FROM (
    SELECT category, sum(count) AS count, sum(amount) AS amount
    FROM g WHERE g.chamber = c.chamber GROUP BY category) s),
  'top_payees', (SELECT coalesce(jsonb_agg(jsonb_build_object('payee', payee, 'count', count, 'amount', amount)
    ORDER BY amount DESC, payee), '[]'::jsonb) FROM p WHERE p.chamber = c.chamber),
  'office_list', (SELECT coalesce(jsonb_agg(office ORDER BY office), '[]'::jsonb) FROM o WHERE o.chamber = c.chamber)
) AS data
FROM (SELECT DISTINCT chamber FROM g) c;
CREATE UNIQUE INDEX IF NOT EXISTS disbursements_chamber_stats_mv_chamber ON public.disbursements_chamber_stats_mv (chamber);

-- A chamber with no rows yet answers null; the page draws nothing for it.
CREATE OR REPLACE FUNCTION public.disbursements_stats(filter_chamber text) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT data FROM disbursements_chamber_stats_mv WHERE chamber = filter_chamber $$;

-- The House-only page, from before the chamber select, asks with no
-- chamber. It gets the House's row, which is all it ever showed. Kept so
-- this file can run before the deploy that passes a chamber; drop it once
-- that deploy is live.
CREATE OR REPLACE FUNCTION public.disbursements_stats() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT data FROM disbursements_chamber_stats_mv WHERE chamber = 'house' $$;

-- The one-row view this replaced (2026-11-19). Nothing reads it once the
-- function above is replaced: a LANGUAGE sql body is not a dependency.
DROP MATERIALIZED VIEW IF EXISTS public.disbursements_stats_mv;
