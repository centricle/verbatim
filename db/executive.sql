-- Federal Register presidential documents (executive orders and
-- proclamations): table and stored functions behind /executive/. Applied with
-- `npm run executive -- schema`; db/schema.sql is the dump of what production
-- holds afterward. Named after the Federal Register's own "Presidential
-- Documents" section.
--
-- One row per document in the corpus release's `executive` collection, joined
-- to FR's metadata by document number (scripts/executive/parse.mjs). The text
-- is the release's; number, dates, citation, title, URLs and notes are FR's,
-- as published. A document FR gives no signing date has none here.
--
-- `notes` is FR's disposition note exactly as published ("Revoked by: EO
-- 13992, January 20, 2021"); `notes_parsed` is the same note as relations,
-- [{relation, refs: [{kind, number, date, text}]}], each relation label and
-- reference text as FR prints it. The loader's check proves every parse reads
-- back as its note.

CREATE TABLE IF NOT EXISTS public.fr_presidential_documents (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  document_number text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('executive_order', 'proclamation')),
  number text,
  president text NOT NULL,
  president_name text NOT NULL,
  signing_date date,
  publication_date date NOT NULL,
  citation text,
  title text NOT NULL,
  html_url text NOT NULL,
  pdf_url text,
  correction_of text,
  notes text,
  notes_parsed jsonb,
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, title), 'A') ||
    setweight(to_tsvector('english'::regconfig, text), 'B')
  ) STORED,
  CHECK ((notes IS NULL) = (notes_parsed IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_frpd_type ON public.fr_presidential_documents (type);
CREATE INDEX IF NOT EXISTS idx_frpd_president ON public.fr_presidential_documents (president);
CREATE INDEX IF NOT EXISTS idx_frpd_signing ON public.fr_presidential_documents (signing_date);
CREATE INDEX IF NOT EXISTS idx_frpd_number ON public.fr_presidential_documents (type, number);
CREATE INDEX IF NOT EXISTS idx_frpd_tsv ON public.fr_presidential_documents USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_frpd_notes ON public.fr_presidential_documents USING gin (notes_parsed jsonb_path_ops);

-- Search. websearch_to_tsquery and the U+0001/U+0002 snippet marks work as
-- in search_corpus (db/corpus.sql): the page escapes the snippet, then turns
-- the marks into <mark>. Years bound the signing date, so a document FR gives
-- no signing date matches no year range. `filter_relation` is a note label
-- exactly as FR prints it. Newest first unless asked otherwise.
CREATE OR REPLACE FUNCTION public.search_fr_presidential_documents(
  search_query text DEFAULT NULL,
  filter_president text DEFAULT NULL,
  filter_type text DEFAULT NULL,
  filter_relation text DEFAULT NULL,
  year_from integer DEFAULT NULL,
  year_to integer DEFAULT NULL,
  sort_by text DEFAULT 'signed',
  sort_dir text DEFAULT 'desc',
  page_num integer DEFAULT 1,
  page_size integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE total_count bigint; result jsonb; q tsquery; date_from date; date_to date; opts text; rel jsonb;
BEGIN
  IF search_query IS NOT NULL AND btrim(search_query) <> '' THEN
    q := websearch_to_tsquery('english', search_query);
  END IF;
  IF year_from IS NOT NULL THEN date_from := make_date(year_from, 1, 1); END IF;
  IF year_to IS NOT NULL THEN date_to := make_date(year_to + 1, 1, 1); END IF;
  IF filter_relation IS NOT NULL THEN rel := jsonb_build_array(jsonb_build_object('relation', filter_relation)); END IF;
  opts := 'StartSel=' || chr(1) || ', StopSel=' || chr(2) ||
          ', MaxFragments=2, MinWords=12, MaxWords=28, FragmentDelimiter=" … "';

  SELECT count(*) INTO total_count FROM fr_presidential_documents
  WHERE (q IS NULL OR tsv @@ q)
    AND (filter_president IS NULL OR president = filter_president)
    AND (filter_type IS NULL OR type = filter_type)
    AND (rel IS NULL OR notes_parsed @> rel)
    AND (date_from IS NULL OR signing_date >= date_from)
    AND (date_to IS NULL OR signing_date < date_to);

  SELECT jsonb_build_object('total', total_count, 'rows', coalesce(jsonb_agg(row_data), '[]'::jsonb))
  INTO result FROM (
    SELECT jsonb_build_object('id', p.id, 'document_number', p.document_number, 'type', p.type,
      'number', p.number, 'president', p.president, 'president_name', p.president_name,
      'signing_date', p.signing_date, 'publication_date', p.publication_date,
      'citation', p.citation, 'title', p.title, 'chars', length(p.text),
      'snippet', CASE WHEN q IS NULL THEN NULL
                      ELSE ts_headline('english'::regconfig, p.text, q, opts) END) AS row_data
    FROM (
      SELECT * FROM fr_presidential_documents
      WHERE (q IS NULL OR tsv @@ q)
        AND (filter_president IS NULL OR president = filter_president)
        AND (filter_type IS NULL OR type = filter_type)
        AND (rel IS NULL OR notes_parsed @> rel)
        AND (date_from IS NULL OR signing_date >= date_from)
        AND (date_to IS NULL OR signing_date < date_to)
      ORDER BY
        CASE WHEN sort_by = 'signed' AND sort_dir = 'asc' THEN signing_date END ASC NULLS LAST,
        CASE WHEN sort_by = 'signed' AND sort_dir = 'desc' THEN signing_date END DESC NULLS LAST,
        CASE WHEN sort_by = 'number' AND sort_dir = 'asc' THEN CASE WHEN number ~ '^\d{1,9}$' THEN number::int END END ASC NULLS LAST,
        CASE WHEN sort_by = 'number' AND sort_dir = 'desc' THEN CASE WHEN number ~ '^\d{1,9}$' THEN number::int END END DESC NULLS LAST,
        CASE WHEN sort_by = 'title' AND sort_dir = 'asc' THEN title END ASC,
        CASE WHEN sort_by = 'title' AND sort_dir = 'desc' THEN title END DESC,
        publication_date DESC, document_number
      LIMIT page_size OFFSET (page_num - 1) * page_size
    ) p
  ) sub;
  RETURN result;
END; $$;

-- One whole document, for the record view (/executive/?id=). NULL when no
-- document has that id. `refs` resolves every order and proclamation the note
-- names (the pattern is MENTION in scripts/executive/parse.mjs) to a document
-- in this table with that type and number; one not in the table is left out,
-- never guessed. Reprints and corrections repeat a number, so the original
-- wins: not a correction (C1-), then the earliest published. `corrections`
-- are the documents FR marks as correcting this one.
CREATE OR REPLACE FUNCTION public.get_fr_presidential_document(doc_id text) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
  SELECT jsonb_build_object('id', d.id, 'document_number', d.document_number, 'type', d.type,
    'number', d.number, 'president', d.president, 'president_name', d.president_name,
    'signing_date', d.signing_date, 'publication_date', d.publication_date,
    'citation', d.citation, 'title', d.title, 'html_url', d.html_url, 'pdf_url', d.pdf_url,
    'notes', d.notes, 'notes_parsed', d.notes_parsed, 'text', d.text,
    'correction_of', (SELECT jsonb_build_object('id', c.id, 'document_number', c.document_number, 'title', c.title)
                      FROM fr_presidential_documents c WHERE c.document_number = d.correction_of),
    'corrections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'document_number', c.document_number)
                                    ORDER BY c.publication_date), '[]'::jsonb)
                    FROM fr_presidential_documents c WHERE c.correction_of = d.document_number),
    'refs', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', m.type, 'number', m.number, 'id', r.id)
                             ORDER BY m.type, m.number), '[]'::jsonb)
             FROM (SELECT DISTINCT
                     CASE WHEN x[1] IN ('EO', 'Executive Order') THEN 'executive_order' ELSE 'proclamation' END AS type,
                     x[2] AS number
                   FROM regexp_matches(coalesce(d.notes, ''), '\m(EO|Executive Order|Proc\.|Proclamation)\s+(\d+)\M', 'g') AS x) m
             CROSS JOIN LATERAL (
               SELECT t.id FROM fr_presidential_documents t
               WHERE t.type = m.type AND t.number = m.number
               ORDER BY (t.document_number LIKE 'C1-%'), t.publication_date, t.document_number
               LIMIT 1) r))
  FROM fr_presidential_documents d WHERE d.id = doc_id;
$$;

-- Stats for the page: counts, the select options and both figures.
-- Presidents come in the order of their first signed document (term order),
-- never by count. Relation labels are FR's, alphabetical, each counted once
-- per document that carries it.
CREATE OR REPLACE FUNCTION public.fr_presidential_documents_stats() RETURNS jsonb
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM fr_presidential_documents),
    'unsigned', (SELECT count(*) FROM fr_presidential_documents WHERE signing_date IS NULL),
    'year_range', (SELECT jsonb_build_object('min', min(extract(year FROM signing_date))::int,
                                             'max', max(extract(year FROM signing_date))::int)
                   FROM fr_presidential_documents),
    'by_type', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.type), '[]'::jsonb) FROM (
      SELECT type, count(*) AS count FROM fr_presidential_documents GROUP BY type) s),
    'by_year', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.year), '[]'::jsonb) FROM (
      SELECT extract(year FROM signing_date)::int AS year,
        count(*) FILTER (WHERE type = 'executive_order') AS executive_order,
        count(*) FILTER (WHERE type = 'proclamation') AS proclamation
      FROM fr_presidential_documents WHERE signing_date IS NOT NULL GROUP BY 1) s),
    'by_president', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.first, s.president), '[]'::jsonb) FROM (
      SELECT president, president_name, min(coalesce(signing_date, publication_date)) AS first,
        count(*) AS count,
        count(*) FILTER (WHERE type = 'executive_order') AS executive_order,
        count(*) FILTER (WHERE type = 'proclamation') AS proclamation
      FROM fr_presidential_documents GROUP BY president, president_name) s),
    'relation_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY lower(s.relation), s.relation), '[]'::jsonb) FROM (
      SELECT r.relation, count(DISTINCT d.id) AS count
      FROM fr_presidential_documents d,
           jsonb_to_recordset(d.notes_parsed) AS r(relation text)
      WHERE r.relation IS NOT NULL GROUP BY r.relation) s)
  ) INTO result;
  RETURN result;
END; $$;
