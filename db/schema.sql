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
-- authored DDL lives beside this file (db/crashes.sql, db/corpus.sql).
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
-- Name: search_corpus(text, text, text, text, integer, integer, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_corpus(search_query text DEFAULT NULL::text, filter_speaker text DEFAULT NULL::text, filter_genre text DEFAULT NULL::text, filter_collection text DEFAULT NULL::text, year_from integer DEFAULT NULL::integer, year_to integer DEFAULT NULL::integer, sort_by text DEFAULT 'date'::text, sort_dir text DEFAULT 'asc'::text, page_num integer DEFAULT 1, page_size integer DEFAULT 50) RETURNS jsonb
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


SET default_tablespace = '';

SET default_table_access_method = heap;

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
-- Name: compas_defendants compas_defendants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compas_defendants
    ADD CONSTRAINT compas_defendants_pkey PRIMARY KEY (id);


--
-- Name: corpus_statements corpus_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_statements
    ADD CONSTRAINT corpus_statements_pkey PRIMARY KEY (id);


--
-- Name: fec_candidates fec_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fec_candidates
    ADD CONSTRAINT fec_candidates_pkey PRIMARY KEY (id);


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
-- PostgreSQL database dump complete
--


