-- The speech corpus: table and stored functions behind /corpus/. Applied with
-- `npm run corpus -- schema`; db/schema.sql is the dump of what production
-- holds afterward.
--
-- One row per record of data/corpus/release.jsonl in the core and voices
-- collections, every field as the release has it. The release is built by
-- scripts/corpus/build_release.py, whose rules say what it contains and why;
-- nothing here changes a value. `tsv` exists for search.
--
-- Results sort by date, oldest first, unless asked otherwise. There is no
-- relevance ranking: the order of a result list is a fact of the records, not
-- a score.

CREATE TABLE IF NOT EXISTS public.corpus_statements (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  speaker text NOT NULL,
  speaker_name text NOT NULL,
  date date,
  date_precision text NOT NULL CHECK (date_precision IN ('day', 'month', 'year', 'unknown')),
  collection text NOT NULL CHECK (collection IN ('core', 'voices')),
  genre text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  source_name text NOT NULL,
  source_url text NOT NULL,
  rights_group text NOT NULL,
  rights text NOT NULL,
  attribution text,
  proposed date,
  certified date,
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, title), 'A') ||
    setweight(to_tsvector('english'::regconfig, text), 'B')
  ) STORED,
  CHECK ((date IS NULL) = (date_precision = 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_corpus_speaker ON public.corpus_statements (speaker);
CREATE INDEX IF NOT EXISTS idx_corpus_genre ON public.corpus_statements (genre);
CREATE INDEX IF NOT EXISTS idx_corpus_collection ON public.corpus_statements (collection);
CREATE INDEX IF NOT EXISTS idx_corpus_date ON public.corpus_statements (date);
CREATE INDEX IF NOT EXISTS idx_corpus_tsv ON public.corpus_statements USING gin (tsv);

-- Search. websearch_to_tsquery takes what people type ("quoted phrases",
-- or, -excluded) and never raises an error on input. The snippet is
-- ts_headline's, with U+0001 and U+0002 around each match instead of markup:
-- the page escapes the snippet first and only then turns those two characters
-- into <mark>, so no markup from the database is ever rendered.
-- scripts/corpus/check_release.py fails any record whose text holds either.
-- ts_headline reads a record's whole text, so it runs only on the page of
-- rows being returned, never on the full match set.
CREATE OR REPLACE FUNCTION public.search_corpus(
  search_query text DEFAULT NULL,
  filter_speaker text DEFAULT NULL,
  filter_genre text DEFAULT NULL,
  filter_collection text DEFAULT NULL,
  year_from integer DEFAULT NULL,
  year_to integer DEFAULT NULL,
  sort_by text DEFAULT 'date',
  sort_dir text DEFAULT 'asc',
  page_num integer DEFAULT 1,
  page_size integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE total_count bigint; result jsonb; q tsquery; date_from date; date_to date; opts text;
BEGIN
  IF search_query IS NOT NULL AND btrim(search_query) <> '' THEN
    q := websearch_to_tsquery('english', search_query);
  END IF;
  IF year_from IS NOT NULL THEN date_from := make_date(year_from, 1, 1); END IF;
  IF year_to IS NOT NULL THEN date_to := make_date(year_to + 1, 1, 1); END IF;
  opts := 'StartSel=' || chr(1) || ', StopSel=' || chr(2) ||
          ', MaxFragments=2, MinWords=12, MaxWords=28, FragmentDelimiter=" … "';

  SELECT count(*) INTO total_count FROM corpus_statements
  WHERE (q IS NULL OR tsv @@ q)
    AND (filter_speaker IS NULL OR speaker = filter_speaker)
    AND (filter_genre IS NULL OR genre = filter_genre)
    AND (filter_collection IS NULL OR collection = filter_collection)
    AND (date_from IS NULL OR date >= date_from)
    AND (date_to IS NULL OR date < date_to);

  SELECT jsonb_build_object('total', total_count, 'rows', coalesce(jsonb_agg(row_data), '[]'::jsonb))
  INTO result FROM (
    SELECT jsonb_build_object('id', p.id, 'speaker', p.speaker, 'speaker_name', p.speaker_name,
      'date', p.date, 'date_precision', p.date_precision, 'collection', p.collection,
      'genre', p.genre, 'type', p.type, 'title', p.title, 'chars', length(p.text),
      'snippet', CASE WHEN q IS NULL THEN left(p.text, 320)
                      ELSE ts_headline('english'::regconfig, p.text, q, opts) END) AS row_data
    FROM (
      SELECT id, speaker, speaker_name, date, date_precision, collection, genre, type, title, text
      FROM corpus_statements
      WHERE (q IS NULL OR tsv @@ q)
        AND (filter_speaker IS NULL OR speaker = filter_speaker)
        AND (filter_genre IS NULL OR genre = filter_genre)
        AND (filter_collection IS NULL OR collection = filter_collection)
        AND (date_from IS NULL OR date >= date_from)
        AND (date_to IS NULL OR date < date_to)
      ORDER BY
        CASE WHEN sort_by = 'date' AND sort_dir = 'asc' THEN date END ASC NULLS LAST,
        CASE WHEN sort_by = 'date' AND sort_dir = 'desc' THEN date END DESC NULLS LAST,
        CASE WHEN sort_by = 'speaker' AND sort_dir = 'asc' THEN speaker_name END ASC,
        CASE WHEN sort_by = 'speaker' AND sort_dir = 'desc' THEN speaker_name END DESC,
        CASE WHEN sort_by = 'title' AND sort_dir = 'asc' THEN title END ASC,
        CASE WHEN sort_by = 'title' AND sort_dir = 'desc' THEN title END DESC,
        date ASC NULLS LAST, title, id
      LIMIT page_size OFFSET (page_num - 1) * page_size
    ) p
  ) sub;
  RETURN result;
END; $$;

-- One whole record, for the record view (/corpus/?id=). NULL when no record
-- has that id.
CREATE OR REPLACE FUNCTION public.get_corpus_statement(statement_id text) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
  SELECT jsonb_build_object('id', id, 'speaker', speaker, 'speaker_name', speaker_name,
    'date', date, 'date_precision', date_precision, 'collection', collection,
    'genre', genre, 'type', type, 'title', title, 'source_name', source_name,
    'source_url', source_url, 'rights_group', rights_group, 'rights', rights,
    'attribution', attribution, 'proposed', proposed, 'certified', certified,
    'text', text)
  FROM corpus_statements WHERE id = statement_id;
$$;

CREATE OR REPLACE FUNCTION public.corpus_stats() RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM corpus_statements),
    'chars', (SELECT sum(length(text)) FROM corpus_statements),
    'undated', (SELECT count(*) FROM corpus_statements WHERE date IS NULL),
    'year_range', (SELECT jsonb_build_object('min', min(extract(year FROM date))::int,
                                             'max', max(extract(year FROM date))::int)
                   FROM corpus_statements),
    'by_collection', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.collection), '[]'::jsonb) FROM (
      SELECT collection, count(*) AS count FROM corpus_statements GROUP BY collection) s),
    'by_decade', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.decade), '[]'::jsonb) FROM (
      SELECT (extract(year FROM date)::int / 10) * 10 AS decade,
        count(*) FILTER (WHERE collection = 'core') AS core,
        count(*) FILTER (WHERE collection = 'voices') AS voices
      FROM corpus_statements WHERE date IS NOT NULL GROUP BY 1) s),
    'by_genre', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC, s.genre), '[]'::jsonb) FROM (
      SELECT genre, count(*) AS count FROM corpus_statements GROUP BY genre) s),
    'by_speaker', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC, s.speaker_name), '[]'::jsonb) FROM (
      SELECT speaker, speaker_name, count(*) AS count FROM corpus_statements
      GROUP BY speaker, speaker_name ORDER BY count DESC, speaker_name LIMIT 15) s),
    'speaker_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.speaker_name), '[]'::jsonb) FROM (
      SELECT DISTINCT speaker, speaker_name FROM corpus_statements) s),
    'genre_list', (SELECT coalesce(jsonb_agg(genre ORDER BY genre), '[]'::jsonb) FROM (
      SELECT DISTINCT genre FROM corpus_statements) s)
  ) INTO result;
  RETURN result;
END; $$;
