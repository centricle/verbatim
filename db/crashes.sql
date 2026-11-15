-- NHTSA Standing General Order 2021-01 crash reports: table and stored
-- functions behind /crashes/. Applied once with `npm run crashes -- schema`;
-- db/schema.sql is the dump of what production holds afterward.
--
-- One row per report, at its latest version across all six NHTSA files.
-- scripts/crashes/parse.mjs documents every change the loader makes to the
-- source. The text columns hold what NHTSA published; make_key, the *_month
-- dates and incident_year exist for filtering, sorting and charts.

CREATE TABLE IF NOT EXISTS public.sgo_crashes (
  report_id text PRIMARY KEY,
  report_version integer NOT NULL,
  system text NOT NULL CHECK (system IN ('ADS', 'ADAS', 'OTHER')),
  period text NOT NULL CHECK (period IN ('archive', 'current')),
  reporting_entity text,
  report_type text,
  submission_date text,
  submission_month date,
  make text,
  make_key text,
  model text,
  model_year integer,
  incident_date text,
  incident_month date,
  incident_year integer,
  city text,
  state text,
  crash_with text,
  injury_severity text,
  same_incident_id text,
  narrative text,
  source_ref text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig,
      coalesce(make, '') || ' ' || coalesce(model, '') || ' ' ||
      coalesce(reporting_entity, '') || ' ' || coalesce(city, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(narrative, '')), 'B')
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_sgo_system ON public.sgo_crashes (system);
CREATE INDEX IF NOT EXISTS idx_sgo_period ON public.sgo_crashes (period);
CREATE INDEX IF NOT EXISTS idx_sgo_make_key ON public.sgo_crashes (make_key);
CREATE INDEX IF NOT EXISTS idx_sgo_state ON public.sgo_crashes (state);
CREATE INDEX IF NOT EXISTS idx_sgo_incident_year ON public.sgo_crashes (incident_year);
CREATE INDEX IF NOT EXISTS idx_sgo_incident_month ON public.sgo_crashes (incident_month);
CREATE INDEX IF NOT EXISTS idx_sgo_severity ON public.sgo_crashes (injury_severity);
CREATE INDEX IF NOT EXISTS idx_sgo_tsv ON public.sgo_crashes USING gin (tsv);

CREATE OR REPLACE FUNCTION public.search_sgo_crashes(
  search_query text DEFAULT NULL,
  filter_system text DEFAULT NULL,
  filter_make text DEFAULT NULL,
  filter_state text DEFAULT NULL,
  filter_year integer DEFAULT NULL,
  filter_period text DEFAULT NULL,
  filter_severity text DEFAULT NULL,
  sort_by text DEFAULT 'incident',
  sort_dir text DEFAULT 'desc',
  page_num integer DEFAULT 1,
  page_size integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE total_count bigint; result jsonb; q tsquery;
BEGIN
  IF search_query IS NOT NULL AND search_query <> '' THEN q := plainto_tsquery('english', search_query); END IF;
  SELECT count(*) INTO total_count FROM sgo_crashes
  WHERE (q IS NULL OR tsv @@ q)
    AND (filter_system IS NULL OR system = filter_system)
    AND (filter_make IS NULL OR make_key = filter_make)
    AND (filter_state IS NULL OR state = filter_state)
    AND (filter_year IS NULL OR incident_year = filter_year)
    AND (filter_period IS NULL OR period = filter_period)
    AND (filter_severity IS NULL OR injury_severity = filter_severity);
  SELECT jsonb_build_object('total', total_count, 'rows', coalesce(jsonb_agg(row_data), '[]'::jsonb))
  INTO result FROM (
    SELECT jsonb_build_object('report_id', report_id, 'report_version', report_version,
      'system', system, 'period', period, 'reporting_entity', reporting_entity,
      'report_type', report_type, 'submission_date', submission_date,
      'make', make, 'model', model, 'model_year', model_year,
      'incident_date', incident_date, 'city', city, 'state', state,
      'crash_with', crash_with, 'injury_severity', injury_severity,
      'same_incident_id', same_incident_id, 'narrative', narrative) AS row_data
    FROM sgo_crashes
    WHERE (q IS NULL OR tsv @@ q)
      AND (filter_system IS NULL OR system = filter_system)
      AND (filter_make IS NULL OR make_key = filter_make)
      AND (filter_state IS NULL OR state = filter_state)
      AND (filter_year IS NULL OR incident_year = filter_year)
      AND (filter_period IS NULL OR period = filter_period)
      AND (filter_severity IS NULL OR injury_severity = filter_severity)
    ORDER BY
      CASE WHEN sort_by = 'incident' AND sort_dir = 'desc' THEN incident_month END DESC NULLS LAST,
      CASE WHEN sort_by = 'incident' AND sort_dir = 'asc' THEN incident_month END ASC NULLS LAST,
      CASE WHEN sort_by = 'make' AND sort_dir = 'asc' THEN make_key END ASC,
      CASE WHEN sort_by = 'make' AND sort_dir = 'desc' THEN make_key END DESC,
      CASE WHEN sort_by = 'state' AND sort_dir = 'asc' THEN state END ASC,
      CASE WHEN sort_by = 'state' AND sort_dir = 'desc' THEN state END DESC,
      CASE WHEN sort_by = 'entity' AND sort_dir = 'asc' THEN reporting_entity END ASC,
      CASE WHEN sort_by = 'entity' AND sort_dir = 'desc' THEN reporting_entity END DESC,
      report_id DESC
    LIMIT page_size OFFSET (page_num - 1) * page_size
  ) sub;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.sgo_crashes_stats() RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM sgo_crashes),
    'no_incident_date', (SELECT count(*) FROM sgo_crashes WHERE incident_month IS NULL),
    'month_range', (SELECT jsonb_build_object('min', min(incident_month), 'max', max(incident_month)) FROM sgo_crashes),
    'by_month', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.month), '[]'::jsonb) FROM (
      SELECT incident_month AS month,
        count(*) FILTER (WHERE system = 'ADS') AS ads,
        count(*) FILTER (WHERE system = 'ADAS') AS adas,
        count(*) FILTER (WHERE system = 'OTHER') AS other
      FROM sgo_crashes WHERE incident_month IS NOT NULL GROUP BY incident_month) s),
    'by_make', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC, s.make_key), '[]'::jsonb) FROM (
      SELECT make_key, count(*) AS count FROM sgo_crashes WHERE make_key IS NOT NULL
      GROUP BY make_key ORDER BY count DESC, make_key LIMIT 15) s),
    'by_state', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC, s.state), '[]'::jsonb) FROM (
      SELECT state, count(*) AS count FROM sgo_crashes WHERE state IS NOT NULL
      GROUP BY state ORDER BY count DESC, state LIMIT 15) s),
    'by_severity', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC, s.injury_severity), '[]'::jsonb) FROM (
      SELECT injury_severity, count(*) AS count FROM sgo_crashes WHERE injury_severity IS NOT NULL
      GROUP BY injury_severity) s),
    'by_system', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.system), '[]'::jsonb) FROM (
      SELECT system, count(*) AS count FROM sgo_crashes GROUP BY system) s),
    'make_list', (SELECT coalesce(jsonb_agg(make_key ORDER BY make_key), '[]'::jsonb) FROM (
      SELECT DISTINCT make_key FROM sgo_crashes WHERE make_key IS NOT NULL) s),
    'state_list', (SELECT coalesce(jsonb_agg(state ORDER BY state), '[]'::jsonb) FROM (
      SELECT DISTINCT state FROM sgo_crashes WHERE state IS NOT NULL) s),
    'year_list', (SELECT coalesce(jsonb_agg(incident_year ORDER BY incident_year DESC), '[]'::jsonb) FROM (
      SELECT DISTINCT incident_year FROM sgo_crashes WHERE incident_year IS NOT NULL) s),
    'severity_list', (SELECT coalesce(jsonb_agg(injury_severity ORDER BY injury_severity), '[]'::jsonb) FROM (
      SELECT DISTINCT injury_severity FROM sgo_crashes WHERE injury_severity IS NOT NULL) s)
  ) INTO result;
  RETURN result;
END; $$;
