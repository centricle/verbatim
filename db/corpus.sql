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
  series text,
  series_member text,
  CHECK ((date IS NULL) = (date_precision = 'unknown'))
);

-- A series is a recurring occasion (the State of the Union, inaugural
-- addresses) whose membership comes from one cited list,
-- scripts/corpus/series.json. NULL for every other record. Added after the
-- table was first created, hence the ALTER.
ALTER TABLE public.corpus_statements ADD COLUMN IF NOT EXISTS series text;

-- Which member of its series a record is, as build_release.py's member_key
-- writes it: `inaugural:<ordinal>`, or `sotu:<date or year>:<speaker>`. Lets
-- /corpus/contents/ set each cited list beside the records without matching
-- them again. NULL exactly when series is. Added later too.
ALTER TABLE public.corpus_statements ADD COLUMN IF NOT EXISTS series_member text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_corpus_series_member ON public.corpus_statements (series_member);

CREATE INDEX IF NOT EXISTS idx_corpus_speaker ON public.corpus_statements (speaker);
CREATE INDEX IF NOT EXISTS idx_corpus_genre ON public.corpus_statements (genre);
CREATE INDEX IF NOT EXISTS idx_corpus_collection ON public.corpus_statements (collection);
CREATE INDEX IF NOT EXISTS idx_corpus_date ON public.corpus_statements (date);
CREATE INDEX IF NOT EXISTS idx_corpus_tsv ON public.corpus_statements USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_corpus_series ON public.corpus_statements (series);

-- Search. websearch_to_tsquery takes what people type ("quoted phrases",
-- or, -excluded) and never raises an error on input. The snippet is
-- ts_headline's, with U+0001 and U+0002 around each match instead of markup:
-- the page escapes the snippet first and only then turns those two characters
-- into <mark>, so no markup from the database is ever rendered.
-- scripts/corpus/check_release.py fails any record whose text holds either.
-- ts_headline reads a record's whole text, so it runs only on the page of
-- rows being returned, never on the full match set.
-- filter_series was added after the first release, and a new parameter is a
-- new signature, which CREATE OR REPLACE cannot reach: drop the old one.
DROP FUNCTION IF EXISTS public.search_corpus(text, text, text, text, integer, integer, text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.search_corpus(
  search_query text DEFAULT NULL,
  filter_speaker text DEFAULT NULL,
  filter_genre text DEFAULT NULL,
  filter_collection text DEFAULT NULL,
  filter_series text DEFAULT NULL,
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
    AND (filter_series IS NULL OR series = filter_series)
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
        AND (filter_series IS NULL OR series = filter_series)
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

-- The 27 amendments in order, for /amendments/. Each is a core record titled
-- "Amendment <numeral>" from the National Archives
-- (scripts/corpus/import_constitution.py), dated by the completion of its
-- ratification. Order comes from the numeral, since I to X share a date.
CREATE OR REPLACE FUNCTION public.corpus_amendments() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
  WITH a AS (
    SELECT s.*, substring(s.title FROM '^Amendment ([IVXL]+)$') AS numeral
    FROM corpus_statements s
    WHERE s.collection = 'core' AND s.source_name = 'national_archives'
      AND s.title ~ '^Amendment [IVXL]+$'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'numeral', numeral, 'title', title,
      'date', date, 'proposed', proposed, 'certified', certified,
      'source_name', source_name, 'source_url', source_url, 'rights', rights, 'text', text)
    ORDER BY array_position(ARRAY['I','II','III','IV','V','VI','VII','VIII','IX','X',
      'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX',
      'XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII'], numeral)), '[]'::jsonb)
  FROM a;
$$;

-- Everything /corpus/contents/ lists, in one call. Per speaker: how many
-- records, undated ones included (speaker_span in corpus_stats counts dated
-- records only), and the first and last dated year. Every series record under
-- its series_member, which the page sets beside its cited list. Records per
-- genre. Grouping and order are the page's: it groups speakers by roster
-- (scripts/corpus/rosters.json) and names them from speakers.json.
CREATE OR REPLACE FUNCTION public.corpus_contents() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
  SELECT jsonb_build_object(
    'speakers', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.speaker), '[]'::jsonb) FROM (
      SELECT speaker, count(*) AS count,
        min(extract(year FROM date))::int AS first, max(extract(year FROM date))::int AS last
      FROM corpus_statements GROUP BY speaker) s),
    'series', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.series_member), '[]'::jsonb) FROM (
      SELECT series_member, id, date, title
      FROM corpus_statements WHERE series_member IS NOT NULL) s),
    'by_genre', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.genre), '[]'::jsonb) FROM (
      SELECT genre, count(*) AS count FROM corpus_statements GROUP BY genre) s)
  );
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
    -- One row per speaker: first and last dated year, ordered by first record.
    -- Ordered by date, never by count, so the figure ranks nobody (IA session,
    -- 2026-11-15). Every speaker sits in one collection; min() just picks it.
    'speaker_span', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.first, s.last, s.speaker_name), '[]'::jsonb) FROM (
      SELECT speaker, speaker_name, min(collection) AS collection,
        min(extract(year FROM date))::int AS first, max(extract(year FROM date))::int AS last,
        count(*) AS count
      FROM corpus_statements WHERE date IS NOT NULL GROUP BY speaker, speaker_name) s),
    'speaker_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.speaker_name), '[]'::jsonb) FROM (
      SELECT DISTINCT speaker, speaker_name FROM corpus_statements) s),
    'genre_list', (SELECT coalesce(jsonb_agg(genre ORDER BY genre), '[]'::jsonb) FROM (
      SELECT DISTINCT genre FROM corpus_statements) s)
  ) INTO result;
  RETURN result;
END; $$;

-- Term counts for /over-time/: per series and year, how many words the
-- records hold and how often each lexeme occurs. Rebuilt from the records by
-- `npm run corpus -- terms` after every load; nothing else writes them.
--
-- Counted from each record's text (not its title) with ts_debug and the
-- `english` configuration the search uses, so a count is of what a search for
-- that word finds: "liberty" and "liberties" are one lexeme, and each part of
-- a hyphenated word counts as well as the whole. Never counted from tsv, whose
-- positions stop at 16,383 and would undercount the longest records. Words are
-- the word tokens, a hyphenated word once.
CREATE TABLE IF NOT EXISTS public.corpus_series_year (
  series text NOT NULL,
  year integer NOT NULL,
  words integer NOT NULL,
  records integer NOT NULL,
  speakers text[] NOT NULL,
  PRIMARY KEY (series, year)
);

CREATE TABLE IF NOT EXISTS public.corpus_term_year (
  series text NOT NULL,
  lexeme text NOT NULL,
  year integer NOT NULL,
  n integer NOT NULL,
  PRIMARY KEY (series, lexeme, year)
);

CREATE OR REPLACE FUNCTION public.corpus_rebuild_terms() RETURNS jsonb
  LANGUAGE plpgsql
  AS $$
DECLARE result jsonb;
BEGIN
  DELETE FROM corpus_term_year;
  DELETE FROM corpus_series_year;

  CREATE TEMP TABLE corpus_tokens ON COMMIT DROP AS
    SELECT s.series, extract(year FROM s.date)::int AS year, s.id, d.alias, d.lexemes
    FROM corpus_statements s, LATERAL ts_debug('english'::regconfig, s.text) d
    WHERE s.series IS NOT NULL AND s.date IS NOT NULL;

  INSERT INTO corpus_series_year (series, year, words, records, speakers)
    SELECT t.series, t.year, t.words, t.records,
      (SELECT array_agg(DISTINCT s.speaker_name ORDER BY s.speaker_name) FROM corpus_statements s
       WHERE s.series = t.series AND extract(year FROM s.date)::int = t.year)
    FROM (
      SELECT series, year,
        count(*) FILTER (WHERE alias IN ('asciiword', 'word', 'numword', 'asciihword', 'hword', 'numhword')) AS words,
        count(DISTINCT id) AS records
      FROM corpus_tokens GROUP BY series, year) t;

  INSERT INTO corpus_term_year (series, lexeme, year, n)
    SELECT series, lexeme, year, count(*)
    FROM corpus_tokens, unnest(lexemes) AS lexeme
    WHERE cardinality(lexemes) > 0
    GROUP BY series, lexeme, year;

  SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.series), '[]'::jsonb) INTO result FROM (
    SELECT y.series, sum(y.records) AS records, sum(y.words) AS words, count(*) AS years,
      (SELECT count(*) FROM corpus_term_year t WHERE t.series = y.series) AS term_rows
    FROM corpus_series_year y GROUP BY y.series) s;
  RETURN result;
END; $$;

-- One series over time, for up to three terms. Each term is reduced to its
-- lexeme with the same configuration as the counts: a term that reduces to
-- none is a stopword (not counted), one that reduces to more than one is
-- more than one word. `years` lists every year the series has a record;
-- `counts` lists only years where the lexeme occurs, so a counted year
-- missing from it is a zero, and a year missing from `years` has no record.
CREATE OR REPLACE FUNCTION public.corpus_term_series(p_series text, p_terms text[]) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
  WITH input AS (
    SELECT t.term, t.ord,
      (SELECT array_agg(v.lexeme) FROM unnest(to_tsvector('english'::regconfig, t.term)) v) AS lexemes
    FROM unnest(p_terms[1:3]) WITH ORDINALITY AS t(term, ord)
  )
  SELECT jsonb_build_object(
    'series', p_series,
    'years', (SELECT coalesce(jsonb_agg(jsonb_build_object('year', year, 'words', words, 'records', records,
                'speakers', speakers) ORDER BY year), '[]'::jsonb)
              FROM corpus_series_year WHERE series = p_series),
    'terms', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'input', i.term,
        'lexeme', CASE WHEN cardinality(i.lexemes) = 1 THEN i.lexemes[1] END,
        'status', CASE WHEN i.lexemes IS NULL THEN 'stopword'
                       WHEN cardinality(i.lexemes) > 1 THEN 'multiple' ELSE 'ok' END,
        'counts', CASE WHEN cardinality(i.lexemes) = 1 THEN
            (SELECT coalesce(jsonb_agg(jsonb_build_object('year', c.year, 'n', c.n) ORDER BY c.year), '[]'::jsonb)
             FROM corpus_term_year c WHERE c.series = p_series AND c.lexeme = i.lexemes[1])
          ELSE '[]'::jsonb END) ORDER BY i.ord), '[]'::jsonb)
      FROM input i)
  );
$$;
