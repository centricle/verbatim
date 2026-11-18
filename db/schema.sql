-- verbatim.fyi database schema: the explorer tables and their stored
-- functions (search_* and *_stats), as they exist in production on Neon
-- (Postgres 17).
--
-- Generated with:
--   pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges --schema=public
-- then two edits: the \restrict / \unrestrict lines pg_dump 18 adds (a psql
-- meta-command with a per-run key) and the public schema's CREATE SCHEMA and
-- COMMENT ON SCHEMA statements (present in every new database) are removed,
-- so the file runs cleanly on a fresh database with `psql -f`.
--
-- The fts / tsv columns of the first five tables are plain tsvector columns,
-- filled when each dataset was loaded; no trigger maintains them. Tables
-- added since generate theirs (GENERATED ALWAYS AS ... STORED), and their
-- authored DDL lives beside this file (db/crashes.sql, db/corpus.sql,
-- db/executive.sql, db/clemency.sql, db/trades.sql).
--
-- Netlify functions in netlify/functions/ call the search_* and *_stats
-- functions; sorting is whitelisted inside each function with CASE.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.12 (14c6cec)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: clemency_grants_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clemency_grants_stats() RETURNS jsonb
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


--
-- Name: compas_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compas_stats() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM compas_defendants),
    'by_race', (SELECT jsonb_agg(jsonb_build_object('race', race, 'count', cnt)) FROM (SELECT race, count(*) as cnt FROM compas_defendants GROUP BY race ORDER BY cnt DESC) r),
    'by_score', (SELECT jsonb_agg(jsonb_build_object('score_text', score_text, 'count', cnt)) FROM (SELECT score_text, count(*) as cnt FROM compas_defendants GROUP BY score_text ORDER BY CASE score_text WHEN 'Low' THEN 1 WHEN 'Medium' THEN 2 WHEN 'High' THEN 3 END) s),
    'score_by_race', (SELECT jsonb_agg(jsonb_build_object('race', race, 'score_text', score_text, 'count', cnt)) FROM (SELECT race, score_text, count(*) as cnt FROM compas_defendants GROUP BY race, score_text ORDER BY race, score_text) sr),
    'recid_by_race', (SELECT jsonb_agg(jsonb_build_object('race', race, 'two_year_recid', two_year_recid, 'count', cnt)) FROM (SELECT race, two_year_recid, count(*) as cnt FROM compas_defendants GROUP BY race, two_year_recid ORDER BY race) rr),
    'false_positive_by_race', (SELECT jsonb_agg(jsonb_build_object('race', race, 'false_positives', fp, 'total_non_recid', tnr, 'rate', ROUND(fp::numeric / NULLIF(tnr, 0), 4))) FROM (SELECT race, count(*) FILTER (WHERE score_text IN ('Medium', 'High') AND two_year_recid = 0) as fp, count(*) FILTER (WHERE two_year_recid = 0) as tnr FROM compas_defendants GROUP BY race HAVING count(*) > 50) fpr),
    'false_negative_by_race', (SELECT jsonb_agg(jsonb_build_object('race', race, 'false_negatives', fn, 'total_recid', tr, 'rate', ROUND(fn::numeric / NULLIF(tr, 0), 4))) FROM (SELECT race, count(*) FILTER (WHERE score_text = 'Low' AND two_year_recid = 1) as fn, count(*) FILTER (WHERE two_year_recid = 1) as tr FROM compas_defendants GROUP BY race HAVING count(*) > 50) fnr),
    'score_distribution', (SELECT jsonb_agg(jsonb_build_object('race', race, 'decile_score', decile_score, 'count', cnt)) FROM (SELECT race, decile_score, count(*) as cnt FROM compas_defendants WHERE race IN ('African-American', 'Caucasian', 'Hispanic') GROUP BY race, decile_score ORDER BY race, decile_score) sd)
  ) INTO result;
  RETURN result;
END; $$;


--
-- Name: corpus_amendments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.corpus_amendments() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $_$
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
$_$;


--
-- Name: corpus_contents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.corpus_contents() RETURNS jsonb
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


--
-- Name: corpus_rebuild_terms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.corpus_rebuild_terms() RETURNS jsonb
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


--
-- Name: corpus_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.corpus_stats() RETURNS jsonb
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


--
-- Name: corpus_term_series(text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.corpus_term_series(p_series text, p_terms text[]) RETURNS jsonb
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


--
-- Name: fec_candidates_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fec_candidates_stats() RETURNS json
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'total', (SELECT count(*) FROM fec_candidates),
    'total_raised', (SELECT coalesce(sum(total_receipts), 0) FROM fec_candidates),
    'total_spent', (SELECT coalesce(sum(total_disbursements), 0) FROM fec_candidates),
    'by_party', (SELECT json_agg(sub ORDER BY total_raised DESC) FROM (SELECT party, count(*) as total, sum(total_receipts) as total_raised, sum(total_disbursements) as total_spent FROM fec_candidates WHERE party IS NOT NULL AND party != '' GROUP BY party ORDER BY total_raised DESC LIMIT 10) sub),
    'by_office', (SELECT json_agg(sub) FROM (SELECT office, count(*) as total, sum(total_receipts) as total_raised, sum(total_disbursements) as total_spent FROM fec_candidates WHERE office IS NOT NULL GROUP BY office ORDER BY total_raised DESC) sub),
    'by_state', (SELECT json_agg(sub ORDER BY total_raised DESC) FROM (SELECT cand_state as state, count(*) as total, sum(total_receipts) as total_raised FROM fec_candidates WHERE cand_state IS NOT NULL AND cand_state != '' GROUP BY cand_state ORDER BY total_raised DESC LIMIT 20) sub),
    'top_fundraisers', (SELECT json_agg(sub) FROM (SELECT cand_name, party, office, cand_state, total_receipts, total_disbursements, indiv_contrib FROM fec_candidates ORDER BY total_receipts DESC NULLS LAST LIMIT 15) sub),
    'state_list', (SELECT json_agg(sub ORDER BY state) FROM (SELECT DISTINCT cand_state as state FROM fec_candidates WHERE cand_state IS NOT NULL AND cand_state != '' ORDER BY cand_state) sub)
  ) INTO result;
  RETURN result;
END; $$;


--
-- Name: fr_presidential_documents_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fr_presidential_documents_stats() RETURNS jsonb
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


--
-- Name: get_corpus_statement(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_corpus_statement(statement_id text) RETURNS jsonb
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


--
-- Name: get_fr_presidential_document(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_fr_presidential_document(doc_id text) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  SELECT jsonb_build_object('id', d.id, 'document_number', d.document_number, 'type', d.type,
    'number', d.number, 'president', d.president, 'president_name', d.president_name,
    'signing_date', d.signing_date, 'publication_date', d.publication_date,
    'citation', d.citation, 'title', d.title, 'html_url', d.html_url, 'pdf_url', d.pdf_url,
    'notes', d.notes, 'notes_parsed', d.notes_parsed, 'text', d.text,
    'correction_of', CASE WHEN d.correction_of IS NOT NULL THEN jsonb_build_object(
                       'document_number', d.correction_of,
                       'id', (SELECT c.id FROM fr_presidential_documents c WHERE c.document_number = d.correction_of)) END,
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


--
-- Name: police_shootings_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.police_shootings_stats() RETURNS json
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM police_shootings),
    'date_range', (SELECT json_build_object('min', MIN(date), 'max', MAX(date)) FROM police_shootings),
    'by_year', (SELECT COALESCE(json_agg(r), '[]'::json) FROM (SELECT EXTRACT(YEAR FROM date)::INT as year, COUNT(*) as total, COUNT(*) FILTER (WHERE race = 'W') as white, COUNT(*) FILTER (WHERE race = 'B') as black, COUNT(*) FILTER (WHERE race = 'H') as hispanic, COUNT(*) FILTER (WHERE race NOT IN ('W','B','H') AND race != '') as other FROM police_shootings WHERE date IS NOT NULL GROUP BY year ORDER BY year) r),
    'by_race', (SELECT COALESCE(json_agg(r), '[]'::json) FROM (SELECT CASE race WHEN 'W' THEN 'White' WHEN 'B' THEN 'Black' WHEN 'H' THEN 'Hispanic' WHEN 'A' THEN 'Asian' WHEN 'N' THEN 'Native American' WHEN 'O' THEN 'Other' ELSE 'Unknown' END as race_label, race as race_code, COUNT(*) as total FROM police_shootings GROUP BY race ORDER BY total DESC) r),
    'by_armed', (SELECT COALESCE(json_agg(r), '[]'::json) FROM (SELECT COALESCE(NULLIF(armed_with, ''), 'unknown') as armed, COUNT(*) as total FROM police_shootings GROUP BY armed_with ORDER BY total DESC LIMIT 10) r),
    'by_state', (SELECT COALESCE(json_agg(r), '[]'::json) FROM (SELECT state, COUNT(*) as total FROM police_shootings WHERE state IS NOT NULL GROUP BY state ORDER BY total DESC LIMIT 20) r),
    'by_flee', (SELECT COALESCE(json_agg(r), '[]'::json) FROM (SELECT COALESCE(NULLIF(flee_status, ''), 'unknown') as status, COUNT(*) as total FROM police_shootings GROUP BY flee_status ORDER BY total DESC) r),
    'mental_illness', (SELECT json_build_object('yes', COUNT(*) FILTER (WHERE was_mental_illness), 'no', COUNT(*) FILTER (WHERE NOT was_mental_illness)) FROM police_shootings),
    'body_camera', (SELECT json_build_object('yes', COUNT(*) FILTER (WHERE body_camera), 'no', COUNT(*) FILTER (WHERE NOT body_camera)) FROM police_shootings),
    'state_list', (SELECT COALESCE(json_agg(r), '[]'::json) FROM (SELECT DISTINCT state FROM police_shootings WHERE state IS NOT NULL ORDER BY state) r)
  ) INTO result;
  RETURN result;
END; $$;


--
-- Name: qi_cases_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.qi_cases_stats() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_cases', (SELECT count(*) FROM qi_cases),
    'year_range', (SELECT jsonb_build_object('min', min(year), 'max', max(year)) FROM qi_cases),
    'circuit_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.circuit), '[]'::jsonb) FROM (SELECT DISTINCT circuit FROM qi_cases WHERE circuit IS NOT NULL ORDER BY circuit) s),
    'violation_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.violation_type), '[]'::jsonb) FROM (SELECT DISTINCT violation_type FROM qi_cases WHERE violation_type IS NOT NULL ORDER BY violation_type) s),
    'ruling_list', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.qi_ruling), '[]'::jsonb) FROM (SELECT DISTINCT qi_ruling FROM qi_cases WHERE qi_ruling IS NOT NULL ORDER BY qi_ruling) s),
    'by_circuit', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC), '[]'::jsonb) FROM (SELECT circuit, count(*) as count FROM qi_cases WHERE circuit IS NOT NULL GROUP BY circuit ORDER BY count DESC) s),
    'by_year', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.year), '[]'::jsonb) FROM (SELECT year, count(*) as count FROM qi_cases GROUP BY year ORDER BY year) s),
    'by_ruling', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC), '[]'::jsonb) FROM (SELECT qi_ruling, count(*) as count FROM qi_cases WHERE qi_ruling IS NOT NULL GROUP BY qi_ruling ORDER BY count DESC) s),
    'by_violation', (SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY s.count DESC), '[]'::jsonb) FROM (SELECT violation_type, count(*) as count FROM qi_cases WHERE violation_type IS NOT NULL GROUP BY violation_type ORDER BY count DESC) s)
  ) INTO result;
  RETURN result;
END; $$;


--
-- Name: search_clemency_grants(text, text, text, integer, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_clemency_grants(search_query text DEFAULT NULL::text, filter_president text DEFAULT NULL::text, filter_type text DEFAULT NULL::text, filter_year integer DEFAULT NULL::integer, sort_by text DEFAULT 'date'::text, sort_dir text DEFAULT 'desc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS jsonb
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


--
-- Name: search_compas(text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_compas(search_query text DEFAULT ''::text, filter_race text DEFAULT ''::text, filter_score text DEFAULT ''::text, filter_sex text DEFAULT ''::text, filter_recid text DEFAULT ''::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50, OUT id integer, OUT name text, OUT sex text, OUT age integer, OUT age_cat text, OUT race text, OUT priors_count integer, OUT c_charge_degree text, OUT c_charge_desc text, OUT decile_score integer, OUT score_text text, OUT v_decile_score integer, OUT v_score_text text, OUT is_recid integer, OUT two_year_recid integer, OUT r_charge_desc text, OUT compas_screening_date date, OUT total_count bigint) RETURNS SETOF record
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE offset_val integer := (page_num - 1) * page_size;
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT d.* FROM compas_defendants d
    WHERE (search_query = '' OR to_tsvector('english', d.name || ' ' || COALESCE(d.c_charge_desc, '')) @@ plainto_tsquery('english', search_query))
      AND (filter_race = '' OR d.race = filter_race)
      AND (filter_score = '' OR d.score_text = filter_score)
      AND (filter_sex = '' OR d.sex = filter_sex)
      AND (filter_recid = '' OR d.two_year_recid = filter_recid::integer)
  )
  SELECT f.id, f.name, f.sex, f.age, f.age_cat, f.race, f.priors_count, f.c_charge_degree, f.c_charge_desc,
    f.decile_score, f.score_text, f.v_decile_score, f.v_score_text, f.is_recid, f.two_year_recid, f.r_charge_desc,
    f.compas_screening_date, COUNT(*) OVER() AS total_count
  FROM filtered f ORDER BY f.decile_score DESC, f.name LIMIT page_size OFFSET offset_val;
END; $$;


--
-- Name: search_corpus(text, text, text, text, text, integer, integer, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_corpus(search_query text DEFAULT NULL::text, filter_speaker text DEFAULT NULL::text, filter_genre text DEFAULT NULL::text, filter_collection text DEFAULT NULL::text, filter_series text DEFAULT NULL::text, year_from integer DEFAULT NULL::integer, year_to integer DEFAULT NULL::integer, sort_by text DEFAULT 'date'::text, sort_dir text DEFAULT 'asc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS jsonb
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


--
-- Name: search_fec_candidates(text, text, text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_fec_candidates(search_query text DEFAULT NULL::text, filter_state text DEFAULT NULL::text, filter_party text DEFAULT NULL::text, filter_office text DEFAULT NULL::text, filter_incumbent text DEFAULT NULL::text, sort_by text DEFAULT 'total_receipts'::text, sort_dir text DEFAULT 'desc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS json
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE total_count INTEGER; result JSON; q tsquery;
BEGIN
  IF search_query IS NOT NULL AND search_query != '' THEN q := plainto_tsquery('english', search_query); END IF;
  SELECT count(*) INTO total_count FROM fec_candidates
  WHERE (q IS NULL OR fts @@ q) AND (filter_state IS NULL OR cand_state = filter_state)
    AND (filter_party IS NULL OR party = filter_party) AND (filter_office IS NULL OR office = filter_office)
    AND (filter_incumbent IS NULL OR incumbent_status = filter_incumbent);
  SELECT json_build_object('total', total_count, 'page', page_num, 'page_size', page_size,
    'rows', COALESCE((SELECT json_agg(sub) FROM (
      SELECT id, cand_id, cand_name, incumbent_status, party, office, total_receipts, total_disbursements,
        cash_on_hand, indiv_contrib, other_cmte_contrib, party_contrib, debts_owed, cand_state, cand_district
      FROM fec_candidates
      WHERE (q IS NULL OR fts @@ q) AND (filter_state IS NULL OR cand_state = filter_state)
        AND (filter_party IS NULL OR party = filter_party) AND (filter_office IS NULL OR office = filter_office)
        AND (filter_incumbent IS NULL OR incumbent_status = filter_incumbent)
      ORDER BY
        CASE WHEN sort_by = 'total_receipts' AND sort_dir = 'desc' THEN total_receipts END DESC NULLS LAST,
        CASE WHEN sort_by = 'total_receipts' AND sort_dir = 'asc' THEN total_receipts END ASC NULLS LAST,
        CASE WHEN sort_by = 'cand_name' AND sort_dir = 'asc' THEN cand_name END ASC NULLS LAST,
        CASE WHEN sort_by = 'cand_name' AND sort_dir = 'desc' THEN cand_name END DESC NULLS LAST, id
      LIMIT page_size OFFSET (page_num - 1) * page_size
    ) sub), '[]'::json)
  ) INTO result;
  RETURN result;
END; $$;


--
-- Name: search_fr_presidential_documents(text, text, text, text, integer, integer, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_fr_presidential_documents(search_query text DEFAULT NULL::text, filter_president text DEFAULT NULL::text, filter_type text DEFAULT NULL::text, filter_relation text DEFAULT NULL::text, year_from integer DEFAULT NULL::integer, year_to integer DEFAULT NULL::integer, sort_by text DEFAULT 'signed'::text, sort_dir text DEFAULT 'desc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $_$
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
END; $_$;


--
-- Name: search_police_shootings(text, text, text, text, text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_police_shootings(search_query text DEFAULT NULL::text, filter_state text DEFAULT NULL::text, filter_race text DEFAULT NULL::text, filter_armed text DEFAULT NULL::text, filter_gender text DEFAULT NULL::text, filter_year text DEFAULT NULL::text, filter_mental text DEFAULT NULL::text, sort_by text DEFAULT 'date'::text, sort_dir text DEFAULT 'desc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS json
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE total_count INT; result JSON;
BEGIN
  SELECT COUNT(*) INTO total_count FROM police_shootings
  WHERE (search_query IS NULL OR fts @@ plainto_tsquery('english', search_query))
    AND (filter_state IS NULL OR state = filter_state)
    AND (filter_race IS NULL OR race = filter_race)
    AND (filter_armed IS NULL OR armed_with = filter_armed)
    AND (filter_gender IS NULL OR gender = filter_gender)
    AND (filter_year IS NULL OR EXTRACT(YEAR FROM date)::TEXT = filter_year)
    AND (filter_mental IS NULL OR was_mental_illness = (filter_mental = 'true'));
  SELECT json_build_object('total', total_count, 'page', page_num, 'page_size', page_size,
    'rows', COALESCE((SELECT json_agg(r) FROM (
      SELECT id, date, name, age, gender, race, city, state, armed_with, threat_type, flee_status, was_mental_illness, body_camera
      FROM police_shootings
      WHERE (search_query IS NULL OR fts @@ plainto_tsquery('english', search_query))
        AND (filter_state IS NULL OR state = filter_state) AND (filter_race IS NULL OR race = filter_race)
        AND (filter_armed IS NULL OR armed_with = filter_armed) AND (filter_gender IS NULL OR gender = filter_gender)
        AND (filter_year IS NULL OR EXTRACT(YEAR FROM date)::TEXT = filter_year)
        AND (filter_mental IS NULL OR was_mental_illness = (filter_mental = 'true'))
      ORDER BY CASE WHEN sort_by = 'date' AND sort_dir = 'desc' THEN date END DESC NULLS LAST,
               CASE WHEN sort_by = 'date' AND sort_dir = 'asc' THEN date END ASC NULLS LAST, id
      LIMIT page_size OFFSET (page_num - 1) * page_size
    ) r), '[]'::json)
  ) INTO result;
  RETURN result;
END; $$;


--
-- Name: search_qi_cases(text, text, integer, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_qi_cases(search_query text DEFAULT NULL::text, filter_circuit text DEFAULT NULL::text, filter_year integer DEFAULT NULL::integer, filter_ruling text DEFAULT NULL::text, filter_violation text DEFAULT NULL::text, sort_by text DEFAULT 'year'::text, sort_dir text DEFAULT 'desc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE total_count bigint; result jsonb; q tsquery;
BEGIN
  IF search_query IS NOT NULL AND search_query <> '' THEN q := plainto_tsquery('english', search_query); END IF;
  SELECT count(*) INTO total_count FROM qi_cases
  WHERE (q IS NULL OR tsv @@ q) AND (filter_circuit IS NULL OR circuit = filter_circuit)
    AND (filter_year IS NULL OR year = filter_year) AND (filter_ruling IS NULL OR qi_ruling = filter_ruling)
    AND (filter_violation IS NULL OR violation_type = filter_violation);
  SELECT jsonb_build_object('total', total_count, 'rows', coalesce(jsonb_agg(row_data), '[]'::jsonb))
  INTO result FROM (
    SELECT jsonb_build_object('id', id, 'case_name', case_name, 'year', year, 'circuit', circuit,
      'prevailing_party', prevailing_party, 'qi_ruling', qi_ruling, 'case_stage', case_stage,
      'gov_level', gov_level, 'violation_type', violation_type, 'defendant_type', defendant_type,
      'opinion_author', opinion_author, 'court', court, 'constitutional_right', constitutional_right,
      'factual_context', factual_context) AS row_data
    FROM qi_cases
    WHERE (q IS NULL OR tsv @@ q) AND (filter_circuit IS NULL OR circuit = filter_circuit)
      AND (filter_year IS NULL OR year = filter_year) AND (filter_ruling IS NULL OR qi_ruling = filter_ruling)
      AND (filter_violation IS NULL OR violation_type = filter_violation)
    ORDER BY
      CASE WHEN sort_by = 'year' AND sort_dir = 'desc' THEN year END DESC,
      CASE WHEN sort_by = 'year' AND sort_dir = 'asc' THEN year END ASC,
      CASE WHEN sort_by = 'circuit' AND sort_dir = 'asc' THEN circuit END ASC,
      CASE WHEN sort_by = 'circuit' AND sort_dir = 'desc' THEN circuit END DESC,
      CASE WHEN sort_by = 'case_name' AND sort_dir = 'asc' THEN case_name END ASC,
      CASE WHEN sort_by = 'case_name' AND sort_dir = 'desc' THEN case_name END DESC, id DESC
    LIMIT page_size OFFSET (page_num - 1) * page_size
  ) sub;
  RETURN result;
END; $$;


--
-- Name: search_senate_trades(text, text, text, text, text, integer, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_senate_trades(search_text text DEFAULT NULL::text, filter_senator text DEFAULT NULL::text, filter_type text DEFAULT NULL::text, filter_asset_type text DEFAULT NULL::text, filter_ticker text DEFAULT NULL::text, filter_year integer DEFAULT NULL::integer, sort_col text DEFAULT 'transaction_date'::text, sort_dir text DEFAULT 'desc'::text, page_size integer DEFAULT 50, page_offset integer DEFAULT 0) RETURNS json
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE result JSON;
BEGIN
  WITH filtered AS (
    SELECT * FROM senate_trades
    WHERE (search_text IS NULL OR fts @@ plainto_tsquery('english', search_text))
      AND (filter_senator IS NULL OR senator = filter_senator)
      AND (filter_type IS NULL OR type = filter_type)
      AND (filter_asset_type IS NULL OR asset_type = filter_asset_type)
      AND (filter_ticker IS NULL OR ticker = filter_ticker)
      AND (filter_year IS NULL OR EXTRACT(YEAR FROM transaction_date) = filter_year)
  ), total AS (SELECT COUNT(*) AS count FROM filtered)
  SELECT json_build_object('total', (SELECT count FROM total),
    'rows', COALESCE((SELECT json_agg(row_to_json(r)) FROM (
      SELECT id, transaction_date, owner, ticker, asset_description, asset_type, type, amount, senator, office
      FROM filtered
      ORDER BY
        CASE WHEN sort_col = 'transaction_date' AND sort_dir = 'desc' THEN transaction_date END DESC NULLS LAST,
        CASE WHEN sort_col = 'transaction_date' AND sort_dir = 'asc' THEN transaction_date END ASC NULLS LAST,
        CASE WHEN sort_col = 'senator' AND sort_dir = 'asc' THEN senator END ASC,
        CASE WHEN sort_col = 'senator' AND sort_dir = 'desc' THEN senator END DESC,
        CASE WHEN sort_col = 'amount' AND sort_dir = 'desc' THEN CASE amount WHEN 'Over $50,000,000' THEN 10 WHEN '$25,000,001 - $50,000,000' THEN 9 WHEN '$5,000,001 - $25,000,000' THEN 8 WHEN '$1,000,001 - $5,000,000' THEN 7 WHEN '$500,001 - $1,000,000' THEN 6 WHEN '$250,001 - $500,000' THEN 5 WHEN '$100,001 - $250,000' THEN 4 WHEN '$50,001 - $100,000' THEN 3 WHEN '$15,001 - $50,000' THEN 2 WHEN '$1,001 - $15,000' THEN 1 ELSE 0 END END DESC NULLS LAST,
        CASE WHEN sort_col = 'amount' AND sort_dir = 'asc' THEN CASE amount WHEN 'Over $50,000,000' THEN 10 WHEN '$25,000,001 - $50,000,000' THEN 9 WHEN '$5,000,001 - $25,000,000' THEN 8 WHEN '$1,000,001 - $5,000,000' THEN 7 WHEN '$500,001 - $1,000,000' THEN 6 WHEN '$250,001 - $500,000' THEN 5 WHEN '$100,001 - $250,000' THEN 4 WHEN '$50,001 - $100,000' THEN 3 WHEN '$15,001 - $50,000' THEN 2 WHEN '$1,001 - $15,000' THEN 1 ELSE 0 END END ASC NULLS LAST,
        id DESC
      LIMIT page_size OFFSET page_offset
    ) r), '[]'::json)
  ) INTO result;
  RETURN result;
END; $_$;


--
-- Name: search_sgo_crashes(text, text, text, text, integer, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_sgo_crashes(search_query text DEFAULT NULL::text, filter_system text DEFAULT NULL::text, filter_make text DEFAULT NULL::text, filter_state text DEFAULT NULL::text, filter_year integer DEFAULT NULL::integer, filter_period text DEFAULT NULL::text, filter_severity text DEFAULT NULL::text, sort_by text DEFAULT 'incident'::text, sort_dir text DEFAULT 'desc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS jsonb
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


--
-- Name: search_stock_trades(text, text, text, text, text, text, integer, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_stock_trades(search_text text DEFAULT NULL::text, filter_chamber text DEFAULT NULL::text, filter_member text DEFAULT NULL::text, filter_type text DEFAULT NULL::text, filter_asset_type text DEFAULT NULL::text, filter_ticker text DEFAULT NULL::text, filter_year integer DEFAULT NULL::integer, sort_col text DEFAULT 'filed_date'::text, sort_dir text DEFAULT 'desc'::text, page_size integer DEFAULT 50, page_offset integer DEFAULT 0) RETURNS json
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


--
-- Name: senate_trades_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.senate_trades_stats() RETURNS json
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM senate_trades),
    'senators', (SELECT COUNT(DISTINCT senator) FROM senate_trades),
    'date_range', json_build_object('min', (SELECT MIN(transaction_date) FROM senate_trades), 'max', (SELECT MAX(transaction_date) FROM senate_trades)),
    'by_type', (SELECT json_agg(json_build_object('type', type, 'count', cnt)) FROM (SELECT type, COUNT(*) as cnt FROM senate_trades GROUP BY type ORDER BY cnt DESC) t),
    'by_year', (SELECT json_agg(json_build_object('year', yr, 'count', cnt, 'purchases', purchases, 'sales', sales)) FROM (SELECT EXTRACT(YEAR FROM transaction_date)::int as yr, COUNT(*) as cnt, COUNT(*) FILTER (WHERE type = 'Purchase') as purchases, COUNT(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) as sales FROM senate_trades WHERE transaction_date IS NOT NULL GROUP BY yr ORDER BY yr) t),
    'top_traders', (SELECT json_agg(json_build_object('senator', senator, 'total_trades', cnt, 'purchases', purchases, 'sales', sales)) FROM (SELECT senator, COUNT(*) as cnt, COUNT(*) FILTER (WHERE type = 'Purchase') as purchases, COUNT(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) as sales FROM senate_trades GROUP BY senator ORDER BY cnt DESC LIMIT 20) t),
    'top_tickers', (SELECT json_agg(json_build_object('ticker', ticker, 'count', cnt, 'purchases', purchases, 'sales', sales)) FROM (SELECT ticker, COUNT(*) as cnt, COUNT(*) FILTER (WHERE type = 'Purchase') as purchases, COUNT(*) FILTER (WHERE type IN ('Sale (Full)', 'Sale (Partial)')) as sales FROM senate_trades WHERE ticker IS NOT NULL GROUP BY ticker ORDER BY cnt DESC LIMIT 20) t),
    'by_amount', (SELECT json_agg(json_build_object('amount', amount, 'count', cnt) ORDER BY rank) FROM (SELECT amount, COUNT(*) as cnt, CASE amount WHEN '$1,001 - $15,000' THEN 1 WHEN '$15,001 - $50,000' THEN 2 WHEN '$50,001 - $100,000' THEN 3 WHEN '$100,001 - $250,000' THEN 4 WHEN '$250,001 - $500,000' THEN 5 WHEN '$500,001 - $1,000,000' THEN 6 WHEN '$1,000,001 - $5,000,000' THEN 7 WHEN '$5,000,001 - $25,000,000' THEN 8 WHEN '$25,000,001 - $50,000,000' THEN 9 WHEN 'Over $50,000,000' THEN 10 ELSE 0 END as rank FROM senate_trades WHERE amount IS NOT NULL GROUP BY amount) t),
    'by_asset_type', (SELECT json_agg(json_build_object('asset_type', asset_type, 'count', cnt)) FROM (SELECT COALESCE(NULLIF(asset_type, ''), 'Unknown') as asset_type, COUNT(*) as cnt FROM senate_trades GROUP BY asset_type ORDER BY cnt DESC) t),
    'senator_list', (SELECT json_agg(senator ORDER BY senator) FROM (SELECT DISTINCT senator FROM senate_trades) t)
  ) INTO result;
  RETURN result;
END; $_$;


--
-- Name: sgo_crashes_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sgo_crashes_stats() RETURNS jsonb
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


--
-- Name: stock_trades_paper(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stock_trades_paper(filter_chamber text DEFAULT NULL::text) RETURNS json
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce(json_agg(json_build_object('chamber', f.chamber, 'filing_id', f.filing_id,
      'member', m.member, 'state_district', f.state_district, 'filed_date', f.filed_date, 'url', f.url)
    ORDER BY f.filed_date DESC, f.filing_id), '[]'::json)
  FROM trade_filings f JOIN trade_members m USING (bioguide)
  WHERE f.kind = 'paper' AND (filter_chamber IS NULL OR f.chamber = filter_chamber)
$$;


--
-- Name: stock_trades_stats(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stock_trades_stats(filter_chamber text DEFAULT NULL::text) RETURNS json
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


--
-- Name: trade_amount_low(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trade_amount_low(amount text) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$
  SELECT nullif(replace(substring(amount FROM '\$([0-9,]*\.?[0-9]*)'), ',', ''), '')::numeric
$_$;


--
-- Name: trade_amount_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trade_amount_rank(amount text) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$
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
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clemency_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clemency_grants (
    id text NOT NULL,
    page text NOT NULL,
    "position" integer NOT NULL,
    president text NOT NULL,
    president_name text NOT NULL,
    term text NOT NULL,
    type text,
    kind text NOT NULL,
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
    tsv tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, ((COALESCE(district, ''::text) || ' '::text) || COALESCE(offense, ''::text))), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, ((((((((COALESCE(sentence, ''::text) || ' '::text) || COALESCE(terms, ''::text)) || ' '::text) || COALESCE(commuted_to, ''::text)) || ' '::text) || COALESCE(group_description, ''::text)) || ' '::text) || COALESCE(note, ''::text))), 'C'::"char"))) STORED,
    CONSTRAINT clemency_grants_check CHECK (((kind = 'entry'::text) = (type IS NOT NULL))),
    CONSTRAINT clemency_grants_kind_check CHECK ((kind = ANY (ARRAY['entry'::text, 'title'::text]))),
    CONSTRAINT clemency_grants_type_check CHECK ((type = ANY (ARRAY['pardon'::text, 'commutation'::text])))
);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN id SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN page SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN "position" SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN president SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN president_name SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN term SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN type SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN kind SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN grant_date SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN grant_year SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN heading SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN name SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN district SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN sentence SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN offense SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN terms SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN sentence_began SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN commuted_to SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN warrant_url SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN warrant_label SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN group_description SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN note SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN fr_document_number SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN source_ref SET (pg_attver=1152122912);
ALTER TABLE ONLY public.clemency_grants ALTER COLUMN tsv SET (pg_attver=1152122912);


--
-- Name: compas_defendants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compas_defendants (
    id integer NOT NULL,
    name text NOT NULL,
    first_name text,
    last_name text,
    sex text NOT NULL,
    dob date,
    age integer NOT NULL,
    age_cat text NOT NULL,
    race text NOT NULL,
    juv_fel_count integer DEFAULT 0,
    juv_misd_count integer DEFAULT 0,
    juv_other_count integer DEFAULT 0,
    priors_count integer DEFAULT 0,
    c_charge_degree text,
    c_charge_desc text,
    decile_score integer NOT NULL,
    score_text text NOT NULL,
    v_decile_score integer,
    v_score_text text,
    is_recid integer DEFAULT 0 NOT NULL,
    two_year_recid integer DEFAULT 0 NOT NULL,
    r_charge_degree text,
    r_charge_desc text,
    is_violent_recid integer DEFAULT 0 NOT NULL,
    compas_screening_date date,
    c_offense_date date
);


--
-- Name: corpus_series_year; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corpus_series_year (
    series text NOT NULL,
    year integer NOT NULL,
    words integer NOT NULL,
    records integer NOT NULL,
    speakers text[] NOT NULL
);
ALTER TABLE ONLY public.corpus_series_year ALTER COLUMN series SET (pg_attver=248189240);
ALTER TABLE ONLY public.corpus_series_year ALTER COLUMN year SET (pg_attver=248189240);
ALTER TABLE ONLY public.corpus_series_year ALTER COLUMN words SET (pg_attver=248189240);
ALTER TABLE ONLY public.corpus_series_year ALTER COLUMN records SET (pg_attver=248189240);
ALTER TABLE ONLY public.corpus_series_year ALTER COLUMN speakers SET (pg_attver=248189240);


--
-- Name: corpus_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corpus_statements (
    id text NOT NULL,
    speaker text NOT NULL,
    speaker_name text NOT NULL,
    date date,
    date_precision text NOT NULL,
    collection text NOT NULL,
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
    tsv tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, title), 'A'::"char") || setweight(to_tsvector('english'::regconfig, text), 'B'::"char"))) STORED,
    series text,
    series_member text,
    CONSTRAINT corpus_statements_check CHECK (((date IS NULL) = (date_precision = 'unknown'::text))),
    CONSTRAINT corpus_statements_collection_check CHECK ((collection = ANY (ARRAY['core'::text, 'voices'::text]))),
    CONSTRAINT corpus_statements_date_precision_check CHECK ((date_precision = ANY (ARRAY['day'::text, 'month'::text, 'year'::text, 'unknown'::text]))),
    CONSTRAINT corpus_statements_id_check CHECK ((id ~ '^[0-9a-f]{64}$'::text))
);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN id SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN speaker SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN speaker_name SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN date SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN date_precision SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN collection SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN genre SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN type SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN title SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN source_name SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN source_url SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN rights_group SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN rights SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN attribution SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN proposed SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN certified SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN text SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN tsv SET (pg_attver=172542016);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN series SET (pg_attver=248107256);
ALTER TABLE ONLY public.corpus_statements ALTER COLUMN series_member SET (pg_attver=982123968);


--
-- Name: corpus_term_year; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corpus_term_year (
    series text NOT NULL,
    lexeme text NOT NULL,
    year integer NOT NULL,
    n integer NOT NULL
);
ALTER TABLE ONLY public.corpus_term_year ALTER COLUMN series SET (pg_attver=248143776);
ALTER TABLE ONLY public.corpus_term_year ALTER COLUMN lexeme SET (pg_attver=248143776);
ALTER TABLE ONLY public.corpus_term_year ALTER COLUMN year SET (pg_attver=248143776);
ALTER TABLE ONLY public.corpus_term_year ALTER COLUMN n SET (pg_attver=248143776);


--
-- Name: fec_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fec_candidates (
    id integer NOT NULL,
    cand_id text,
    cand_name text,
    incumbent_status text,
    party text,
    total_receipts numeric,
    total_disbursements numeric,
    cash_on_hand numeric,
    cand_contrib numeric,
    cand_loans numeric,
    debts_owed numeric,
    indiv_contrib numeric,
    other_cmte_contrib numeric,
    party_contrib numeric,
    cand_state text,
    cand_district text,
    office text,
    coverage_end date,
    indiv_refunds numeric,
    cmte_refunds numeric,
    fts tsvector
);


--
-- Name: fec_candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fec_candidates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fec_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fec_candidates_id_seq OWNED BY public.fec_candidates.id;


--
-- Name: fr_presidential_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fr_presidential_documents (
    id text NOT NULL,
    document_number text NOT NULL,
    type text NOT NULL,
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
    tsv tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, title), 'A'::"char") || setweight(to_tsvector('english'::regconfig, text), 'B'::"char"))) STORED,
    CONSTRAINT fr_presidential_documents_check CHECK (((notes IS NULL) = (notes_parsed IS NULL))),
    CONSTRAINT fr_presidential_documents_id_check CHECK ((id ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT fr_presidential_documents_type_check CHECK ((type = ANY (ARRAY['executive_order'::text, 'proclamation'::text])))
);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN id SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN document_number SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN type SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN number SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN president SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN president_name SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN signing_date SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN publication_date SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN citation SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN title SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN html_url SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN pdf_url SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN correction_of SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN notes SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN notes_parsed SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN text SET (pg_attver=401988688);
ALTER TABLE ONLY public.fr_presidential_documents ALTER COLUMN tsv SET (pg_attver=401988688);


--
-- Name: police_shootings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.police_shootings (
    id integer NOT NULL,
    date date NOT NULL,
    name text,
    age integer,
    gender text,
    race text,
    city text,
    county text,
    state text,
    latitude numeric,
    longitude numeric,
    threat_type text,
    flee_status text,
    armed_with text,
    was_mental_illness boolean DEFAULT false,
    body_camera boolean DEFAULT false,
    agency_ids text,
    fts tsvector
);


--
-- Name: qi_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qi_cases (
    id integer NOT NULL,
    case_name text,
    year integer,
    circuit text,
    prevailing_party text,
    qi_ruling text,
    case_stage text,
    gov_level text,
    violation_type text,
    defendant_type text,
    opinion_author text,
    court text,
    constitutional_right text,
    factual_context text,
    tsv tsvector
);


--
-- Name: qi_cases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qi_cases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qi_cases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qi_cases_id_seq OWNED BY public.qi_cases.id;


--
-- Name: senate_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.senate_trades (
    id integer NOT NULL,
    transaction_date date,
    owner text,
    ticker text,
    asset_description text,
    asset_type text,
    type text,
    amount text,
    comment text,
    senator text NOT NULL,
    office text,
    bioguide text,
    fts tsvector
);


--
-- Name: senate_trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.senate_trades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: senate_trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.senate_trades_id_seq OWNED BY public.senate_trades.id;


--
-- Name: sgo_crashes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sgo_crashes (
    report_id text NOT NULL,
    report_version integer NOT NULL,
    system text NOT NULL,
    period text NOT NULL,
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
    tsv tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, ((((((COALESCE(make, ''::text) || ' '::text) || COALESCE(model, ''::text)) || ' '::text) || COALESCE(reporting_entity, ''::text)) || ' '::text) || COALESCE(city, ''::text))), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(narrative, ''::text)), 'B'::"char"))) STORED,
    CONSTRAINT sgo_crashes_period_check CHECK ((period = ANY (ARRAY['archive'::text, 'current'::text]))),
    CONSTRAINT sgo_crashes_system_check CHECK ((system = ANY (ARRAY['ADS'::text, 'ADAS'::text, 'OTHER'::text])))
);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN report_id SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN report_version SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN system SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN period SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN reporting_entity SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN report_type SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN submission_date SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN submission_month SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN make SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN make_key SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN model SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN model_year SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN incident_date SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN incident_month SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN incident_year SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN city SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN state SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN crash_with SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN injury_severity SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN same_incident_id SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN narrative SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN source_ref SET (pg_attver=134258360);
ALTER TABLE ONLY public.sgo_crashes ALTER COLUMN tsv SET (pg_attver=134258360);


--
-- Name: stock_trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_trades (
    chamber text NOT NULL,
    filing_id text NOT NULL,
    row_num integer NOT NULL,
    source text NOT NULL,
    bioguide text NOT NULL,
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
    type text NOT NULL,
    amount text,
    subholding_of text,
    description text,
    location text,
    comment text,
    amends_filing_id text,
    amends_row_num integer,
    amendment_match text,
    superseded boolean DEFAULT false NOT NULL,
    counted boolean GENERATED ALWAYS AS (((NOT superseded) AND (filing_status IS DISTINCT FROM 'Deleted'::text))) STORED,
    fts tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((((member || ' '::text) || COALESCE(ticker, ''::text)) || ' '::text) || COALESCE(asset_description, ''::text)))) STORED,
    CONSTRAINT stock_trades_amendment_match_check CHECK ((amendment_match = ANY (ARRAY['unique'::text, 'none'::text, 'ambiguous'::text]))),
    CONSTRAINT stock_trades_check CHECK (((amends_filing_id IS NULL) = (amends_row_num IS NULL))),
    CONSTRAINT stock_trades_check1 CHECK (((amends_filing_id IS NULL) OR (amendment_match = 'unique'::text))),
    CONSTRAINT stock_trades_row_num_check CHECK ((row_num > 0)),
    CONSTRAINT stock_trades_source_check CHECK ((source = ANY (ARRAY['house-clerk'::text, 'efd'::text, 'carambat'::text]))),
    CONSTRAINT stock_trades_type_check CHECK ((type = ANY (ARRAY['Purchase'::text, 'Sale (Full)'::text, 'Sale (Partial)'::text, 'Exchange'::text])))
);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN chamber SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN filing_id SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN row_num SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN source SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN bioguide SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN member SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN transaction_id SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN filing_status SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN transaction_date SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN notification_date SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN owner_code SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN owner SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN asset_description SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN ticker SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN asset_type_code SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN asset_type SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN type_code SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN type SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN amount SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN subholding_of SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN description SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN location SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN comment SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN amends_filing_id SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN amends_row_num SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN amendment_match SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN superseded SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN counted SET (pg_attver=1189270608);
ALTER TABLE ONLY public.stock_trades ALTER COLUMN fts SET (pg_attver=1189270608);


--
-- Name: trade_filings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_filings (
    chamber text NOT NULL,
    filing_id text NOT NULL,
    source text NOT NULL,
    kind text NOT NULL,
    bioguide text NOT NULL,
    filer_prefix text,
    filer_first text,
    filer_last text,
    filer_suffix text,
    filer_name text,
    office text,
    state_district text,
    report_year integer,
    filed_date date NOT NULL,
    url text NOT NULL,
    amends_filing_id text,
    parse_status text NOT NULL,
    parse_error text,
    row_count integer DEFAULT 0 NOT NULL,
    fetched_at timestamp with time zone,
    CONSTRAINT trade_filings_chamber_check CHECK ((chamber = ANY (ARRAY['house'::text, 'senate'::text]))),
    CONSTRAINT trade_filings_check CHECK (((kind = 'paper'::text) = (parse_status = 'paper'::text))),
    CONSTRAINT trade_filings_check1 CHECK (((parse_status = 'parsed'::text) OR (row_count = 0))),
    CONSTRAINT trade_filings_check2 CHECK (((parse_status = 'failed'::text) = (parse_error IS NOT NULL))),
    CONSTRAINT trade_filings_kind_check CHECK ((kind = ANY (ARRAY['electronic'::text, 'paper'::text]))),
    CONSTRAINT trade_filings_parse_status_check CHECK ((parse_status = ANY (ARRAY['parsed'::text, 'failed'::text, 'paper'::text]))),
    CONSTRAINT trade_filings_source_check CHECK ((source = ANY (ARRAY['house-clerk'::text, 'efd'::text, 'carambat'::text])))
);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN chamber SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filing_id SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN source SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN kind SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN bioguide SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filer_prefix SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filer_first SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filer_last SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filer_suffix SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filer_name SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN office SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN state_district SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN report_year SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN filed_date SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN url SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN amends_filing_id SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN parse_status SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN parse_error SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN row_count SET (pg_attver=1189227016);
ALTER TABLE ONLY public.trade_filings ALTER COLUMN fetched_at SET (pg_attver=1189227016);


--
-- Name: trade_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_members (
    bioguide text NOT NULL,
    member text NOT NULL,
    member_sort text NOT NULL
);
ALTER TABLE ONLY public.trade_members ALTER COLUMN bioguide SET (pg_attver=1189213624);
ALTER TABLE ONLY public.trade_members ALTER COLUMN member SET (pg_attver=1189213624);
ALTER TABLE ONLY public.trade_members ALTER COLUMN member_sort SET (pg_attver=1189213624);


--
-- Name: fec_candidates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fec_candidates ALTER COLUMN id SET DEFAULT nextval('public.fec_candidates_id_seq'::regclass);


--
-- Name: qi_cases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qi_cases ALTER COLUMN id SET DEFAULT nextval('public.qi_cases_id_seq'::regclass);


--
-- Name: senate_trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.senate_trades ALTER COLUMN id SET DEFAULT nextval('public.senate_trades_id_seq'::regclass);


--
-- Name: clemency_grants clemency_grants_page_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clemency_grants
    ADD CONSTRAINT clemency_grants_page_position_key UNIQUE (page, "position");


--
-- Name: clemency_grants clemency_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clemency_grants
    ADD CONSTRAINT clemency_grants_pkey PRIMARY KEY (id);


--
-- Name: compas_defendants compas_defendants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compas_defendants
    ADD CONSTRAINT compas_defendants_pkey PRIMARY KEY (id);


--
-- Name: corpus_series_year corpus_series_year_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_series_year
    ADD CONSTRAINT corpus_series_year_pkey PRIMARY KEY (series, year);


--
-- Name: corpus_statements corpus_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_statements
    ADD CONSTRAINT corpus_statements_pkey PRIMARY KEY (id);


--
-- Name: corpus_term_year corpus_term_year_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_term_year
    ADD CONSTRAINT corpus_term_year_pkey PRIMARY KEY (series, lexeme, year);


--
-- Name: fec_candidates fec_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fec_candidates
    ADD CONSTRAINT fec_candidates_pkey PRIMARY KEY (id);


--
-- Name: fr_presidential_documents fr_presidential_documents_document_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fr_presidential_documents
    ADD CONSTRAINT fr_presidential_documents_document_number_key UNIQUE (document_number);


--
-- Name: fr_presidential_documents fr_presidential_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fr_presidential_documents
    ADD CONSTRAINT fr_presidential_documents_pkey PRIMARY KEY (id);


--
-- Name: police_shootings police_shootings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.police_shootings
    ADD CONSTRAINT police_shootings_pkey PRIMARY KEY (id);


--
-- Name: qi_cases qi_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qi_cases
    ADD CONSTRAINT qi_cases_pkey PRIMARY KEY (id);


--
-- Name: senate_trades senate_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.senate_trades
    ADD CONSTRAINT senate_trades_pkey PRIMARY KEY (id);


--
-- Name: sgo_crashes sgo_crashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sgo_crashes
    ADD CONSTRAINT sgo_crashes_pkey PRIMARY KEY (report_id);


--
-- Name: stock_trades stock_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_trades
    ADD CONSTRAINT stock_trades_pkey PRIMARY KEY (chamber, filing_id, row_num);


--
-- Name: trade_filings trade_filings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_filings
    ADD CONSTRAINT trade_filings_pkey PRIMARY KEY (chamber, filing_id);


--
-- Name: trade_members trade_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_members
    ADD CONSTRAINT trade_members_pkey PRIMARY KEY (bioguide);


--
-- Name: idx_clemency_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clemency_date ON public.clemency_grants USING btree (grant_date, page, "position");


--
-- Name: idx_clemency_president; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clemency_president ON public.clemency_grants USING btree (president);


--
-- Name: idx_clemency_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clemency_tsv ON public.clemency_grants USING gin (tsv);


--
-- Name: idx_clemency_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clemency_type ON public.clemency_grants USING btree (type);


--
-- Name: idx_clemency_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clemency_year ON public.clemency_grants USING btree (grant_year);


--
-- Name: idx_compas_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compas_name ON public.compas_defendants USING gin (to_tsvector('english'::regconfig, name));


--
-- Name: idx_compas_race; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compas_race ON public.compas_defendants USING btree (race);


--
-- Name: idx_compas_recid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compas_recid ON public.compas_defendants USING btree (two_year_recid);


--
-- Name: idx_compas_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compas_score ON public.compas_defendants USING btree (score_text);


--
-- Name: idx_compas_sex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compas_sex ON public.compas_defendants USING btree (sex);


--
-- Name: idx_corpus_collection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corpus_collection ON public.corpus_statements USING btree (collection);


--
-- Name: idx_corpus_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corpus_date ON public.corpus_statements USING btree (date);


--
-- Name: idx_corpus_genre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corpus_genre ON public.corpus_statements USING btree (genre);


--
-- Name: idx_corpus_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corpus_series ON public.corpus_statements USING btree (series);


--
-- Name: idx_corpus_series_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_corpus_series_member ON public.corpus_statements USING btree (series_member);


--
-- Name: idx_corpus_speaker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corpus_speaker ON public.corpus_statements USING btree (speaker);


--
-- Name: idx_corpus_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corpus_tsv ON public.corpus_statements USING gin (tsv);


--
-- Name: idx_fec_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fec_fts ON public.fec_candidates USING gin (fts);


--
-- Name: idx_fec_office; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fec_office ON public.fec_candidates USING btree (office);


--
-- Name: idx_fec_party; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fec_party ON public.fec_candidates USING btree (party);


--
-- Name: idx_fec_receipts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fec_receipts ON public.fec_candidates USING btree (total_receipts);


--
-- Name: idx_fec_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fec_state ON public.fec_candidates USING btree (cand_state);


--
-- Name: idx_frpd_notes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frpd_notes ON public.fr_presidential_documents USING gin (notes_parsed jsonb_path_ops);


--
-- Name: idx_frpd_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frpd_number ON public.fr_presidential_documents USING btree (type, number);


--
-- Name: idx_frpd_president; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frpd_president ON public.fr_presidential_documents USING btree (president);


--
-- Name: idx_frpd_signing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frpd_signing ON public.fr_presidential_documents USING btree (signing_date);


--
-- Name: idx_frpd_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frpd_tsv ON public.fr_presidential_documents USING gin (tsv);


--
-- Name: idx_frpd_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_frpd_type ON public.fr_presidential_documents USING btree (type);


--
-- Name: idx_qi_circuit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qi_circuit ON public.qi_cases USING btree (circuit);


--
-- Name: idx_qi_ruling; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qi_ruling ON public.qi_cases USING btree (qi_ruling);


--
-- Name: idx_qi_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qi_tsv ON public.qi_cases USING gin (tsv);


--
-- Name: idx_qi_violation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qi_violation ON public.qi_cases USING btree (violation_type);


--
-- Name: idx_qi_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qi_year ON public.qi_cases USING btree (year);


--
-- Name: idx_senate_trades_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senate_trades_asset_type ON public.senate_trades USING btree (asset_type);


--
-- Name: idx_senate_trades_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senate_trades_date ON public.senate_trades USING btree (transaction_date);


--
-- Name: idx_senate_trades_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senate_trades_fts ON public.senate_trades USING gin (fts);


--
-- Name: idx_senate_trades_senator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senate_trades_senator ON public.senate_trades USING btree (senator);


--
-- Name: idx_senate_trades_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senate_trades_ticker ON public.senate_trades USING btree (ticker);


--
-- Name: idx_senate_trades_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senate_trades_type ON public.senate_trades USING btree (type);


--
-- Name: idx_sgo_incident_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_incident_month ON public.sgo_crashes USING btree (incident_month);


--
-- Name: idx_sgo_incident_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_incident_year ON public.sgo_crashes USING btree (incident_year);


--
-- Name: idx_sgo_make_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_make_key ON public.sgo_crashes USING btree (make_key);


--
-- Name: idx_sgo_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_period ON public.sgo_crashes USING btree (period);


--
-- Name: idx_sgo_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_severity ON public.sgo_crashes USING btree (injury_severity);


--
-- Name: idx_sgo_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_state ON public.sgo_crashes USING btree (state);


--
-- Name: idx_sgo_system; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_system ON public.sgo_crashes USING btree (system);


--
-- Name: idx_sgo_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgo_tsv ON public.sgo_crashes USING gin (tsv);


--
-- Name: idx_shootings_armed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shootings_armed ON public.police_shootings USING btree (armed_with);


--
-- Name: idx_shootings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shootings_date ON public.police_shootings USING btree (date);


--
-- Name: idx_shootings_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shootings_fts ON public.police_shootings USING gin (fts);


--
-- Name: idx_shootings_gender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shootings_gender ON public.police_shootings USING btree (gender);


--
-- Name: idx_shootings_race; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shootings_race ON public.police_shootings USING btree (race);


--
-- Name: idx_shootings_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shootings_state ON public.police_shootings USING btree (state);


--
-- Name: idx_stock_trades_amends; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_amends ON public.stock_trades USING btree (chamber, amends_filing_id, amends_row_num) WHERE (amends_filing_id IS NOT NULL);


--
-- Name: idx_stock_trades_bioguide; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_bioguide ON public.stock_trades USING btree (bioguide);


--
-- Name: idx_stock_trades_chamber; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_chamber ON public.stock_trades USING btree (chamber) WHERE counted;


--
-- Name: idx_stock_trades_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_date ON public.stock_trades USING btree (transaction_date);


--
-- Name: idx_stock_trades_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_fts ON public.stock_trades USING gin (fts);


--
-- Name: idx_stock_trades_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_ticker ON public.stock_trades USING btree (ticker);


--
-- Name: idx_stock_trades_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_trades_type ON public.stock_trades USING btree (type);


--
-- Name: idx_trade_filings_bioguide; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trade_filings_bioguide ON public.trade_filings USING btree (bioguide);


--
-- Name: idx_trade_filings_filed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trade_filings_filed ON public.trade_filings USING btree (filed_date);


--
-- Name: stock_trades stock_trades_bioguide_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_trades
    ADD CONSTRAINT stock_trades_bioguide_fkey FOREIGN KEY (bioguide) REFERENCES public.trade_members(bioguide);


--
-- Name: stock_trades stock_trades_chamber_amends_filing_id_amends_row_num_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_trades
    ADD CONSTRAINT stock_trades_chamber_amends_filing_id_amends_row_num_fkey FOREIGN KEY (chamber, amends_filing_id, amends_row_num) REFERENCES public.stock_trades(chamber, filing_id, row_num) ON DELETE SET NULL (amends_filing_id, amends_row_num);


--
-- Name: stock_trades stock_trades_chamber_filing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_trades
    ADD CONSTRAINT stock_trades_chamber_filing_id_fkey FOREIGN KEY (chamber, filing_id) REFERENCES public.trade_filings(chamber, filing_id) ON DELETE CASCADE;


--
-- Name: trade_filings trade_filings_bioguide_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_filings
    ADD CONSTRAINT trade_filings_bioguide_fkey FOREIGN KEY (bioguide) REFERENCES public.trade_members(bioguide);


--
-- PostgreSQL database dump complete
--


