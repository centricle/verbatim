-- DOJ Office of the Pardon Attorney clemency recipient lists: table and
-- stored functions behind /clemency/. Applied with `npm run clemency --
-- schema`; db/schema.sql is the dump of what production holds afterward.
--
-- One row per entry as DOJ lists it, Nixon to the present: every per-president
-- page, plus the recipients DOJ names on the detail pages of Biden's two group
-- commutations. A grant DOJ lists only by its title (two in 2025) is one row of
-- kind 'title', with no type. scripts/clemency/parse.mjs documents every
-- layout and what the loader keeps; the text columns hold what DOJ printed.
-- grant_year and the term exist for filtering and charts.
--
-- fr_document_number joins a row to fr_presidential_documents where
-- scripts/clemency/fr-links.json pairs them (by title or White House slug,
-- held by check.mjs). The join is read at query time, never copied.

CREATE TABLE IF NOT EXISTS public.clemency_grants (
  id text PRIMARY KEY,
  page text NOT NULL,
  position integer NOT NULL,
  president text NOT NULL,
  president_name text NOT NULL,
  term text NOT NULL,
  type text CHECK (type IN ('pardon', 'commutation')),
  kind text NOT NULL CHECK (kind IN ('entry', 'title')),
  grant_date date NOT NULL,
  grant_year integer NOT NULL,
  heading text,
  name text NOT NULL,
  district text,
  sentence text,
  offense text,
  terms text,
  sentence_began text,
  commuted_to text,
  warrant_url text,
  warrant_label text,
  group_description text,
  note text,
  fr_document_number text,
  source_ref text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig,
      coalesce(district, '') || ' ' || coalesce(offense, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig,
      coalesce(sentence, '') || ' ' || coalesce(terms, '') || ' ' ||
      coalesce(commuted_to, '') || ' ' || coalesce(group_description, '') || ' ' ||
      coalesce(note, '')), 'C')
  ) STORED,
  UNIQUE (page, position),
  CHECK ((kind = 'entry') = (type IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_clemency_president ON public.clemency_grants (president);
CREATE INDEX IF NOT EXISTS idx_clemency_type ON public.clemency_grants (type);
CREATE INDEX IF NOT EXISTS idx_clemency_year ON public.clemency_grants (grant_year);
CREATE INDEX IF NOT EXISTS idx_clemency_date ON public.clemency_grants (grant_date, page, position);
CREATE INDEX IF NOT EXISTS idx_clemency_tsv ON public.clemency_grants USING gin (tsv);

CREATE OR REPLACE FUNCTION public.search_clemency_grants(
  search_query text DEFAULT NULL,
  filter_president text DEFAULT NULL,
  filter_type text DEFAULT NULL,
  filter_year integer DEFAULT NULL,
  sort_by text DEFAULT 'date',
  sort_dir text DEFAULT 'desc',
  page_num integer DEFAULT 1,
  page_size integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE total_count bigint; result jsonb; q tsquery;
BEGIN
  IF search_query IS NOT NULL AND search_query <> '' THEN q := plainto_tsquery('english', search_query); END IF;
  SELECT count(*) INTO total_count FROM clemency_grants
  WHERE (q IS NULL OR tsv @@ q)
    AND (filter_president IS NULL OR president = filter_president)
    AND (filter_type IS NULL OR type = filter_type)
    AND (filter_year IS NULL OR grant_year = filter_year);
  SELECT jsonb_build_object('total', total_count, 'rows', coalesce(jsonb_agg(row_data), '[]'::jsonb))
  INTO result FROM (
    SELECT jsonb_build_object('id', c.id, 'president', c.president,
      'president_name', c.president_name, 'term', c.term, 'type', c.type, 'kind', c.kind,
      'grant_date', c.grant_date, 'heading', c.heading, 'name', c.name,
      'district', c.district, 'sentence', c.sentence, 'offense', c.offense,
      'terms', c.terms, 'sentence_began', c.sentence_began, 'commuted_to', c.commuted_to,
      'warrant_url', c.warrant_url, 'warrant_label', c.warrant_label,
      'group_description', c.group_description, 'note', c.note,
      'source_url', 'https://www.justice.gov/pardon/' || c.page,
      'executive', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', d.id, 'type', d.type, 'number', d.number, 'citation', d.citation) END) AS row_data
    FROM clemency_grants c
    LEFT JOIN fr_presidential_documents d ON d.document_number = c.fr_document_number
    WHERE (q IS NULL OR c.tsv @@ q)
      AND (filter_president IS NULL OR c.president = filter_president)
      AND (filter_type IS NULL OR c.type = filter_type)
      AND (filter_year IS NULL OR c.grant_year = filter_year)
    ORDER BY
      CASE WHEN sort_by = 'date' AND sort_dir = 'asc' THEN c.grant_date END ASC,
      CASE WHEN sort_by = 'date' AND sort_dir = 'asc' THEN c.page END ASC,
      CASE WHEN sort_by = 'date' AND sort_dir = 'asc' THEN c.position END ASC,
      c.grant_date DESC, c.page ASC, c.position ASC
    LIMIT page_size OFFSET (page_num - 1) * page_size
  ) sub;
  RETURN result;
END; $$;

-- Charts count entries as DOJ lists them, so a grant listed only by title
-- counts once, under `title`.
CREATE OR REPLACE FUNCTION public.clemency_grants_stats() RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM clemency_grants),
    'by_type', (SELECT coalesce(jsonb_object_agg(coalesce(type, 'title'), n), '{}'::jsonb) FROM (
      SELECT type, count(*) AS n FROM clemency_grants GROUP BY type) s),
    'date_range', (SELECT jsonb_build_object('min', min(grant_date), 'max', max(grant_date)) FROM clemency_grants),
    'by_term', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.first, s.president), '[]'::jsonb) FROM (
      SELECT president, president_name, term, min(grant_date) AS first,
        count(*) FILTER (WHERE type = 'pardon') AS pardon,
        count(*) FILTER (WHERE type = 'commutation') AS commutation,
        count(*) FILTER (WHERE kind = 'title') AS title
      FROM clemency_grants GROUP BY president, president_name, term) s),
    'by_year', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.year), '[]'::jsonb) FROM (
      SELECT grant_year AS year,
        count(*) FILTER (WHERE type = 'pardon') AS pardon,
        count(*) FILTER (WHERE type = 'commutation') AS commutation,
        count(*) FILTER (WHERE kind = 'title') AS title
      FROM clemency_grants GROUP BY grant_year) s),
    'president_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.first), '[]'::jsonb) FROM (
      SELECT president, president_name, min(grant_date) AS first
      FROM clemency_grants GROUP BY president, president_name) s),
    'year_list', (SELECT coalesce(jsonb_agg(grant_year ORDER BY grant_year DESC), '[]'::jsonb) FROM (
      SELECT DISTINCT grant_year FROM clemency_grants) s)
  ) INTO result;
  RETURN result;
END; $$;
