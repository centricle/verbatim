# Verbatim

Primary source data, made explorable. Public datasets from their original
publishers, made searchable, filterable and charted, with nothing added.

**Live:** [verbatim.fyi](https://verbatim.fyi)

## Explorers

| Route | Dataset |
|---|---|
| [`/compas/`](https://verbatim.fyi/compas/) | COMPAS recidivism risk scores, from ProPublica’s “Machine Bias” analysis |
| [`/trades/`](https://verbatim.fyi/trades/) | Senate stock trade disclosures filed under the STOCK Act |
| [`/incidents/`](https://verbatim.fyi/incidents/) | The Washington Post Fatal Force database of fatal police shootings |
| [`/finance/`](https://verbatim.fyi/finance/) | 2024 federal campaign finance, one row per candidate, from the FEC |
| [`/qi/`](https://verbatim.fyi/qi/) | Qualified immunity cases in the federal courts of appeals, from the Institute for Justice |
| [`/crashes/`](https://verbatim.fyi/crashes/) | Crash reports filed with NHTSA under Standing General Order 2021-01 for vehicles with automated driving systems or Level 2 driver assistance |
| [`/vs/`](https://verbatim.fyi/vs/) | Vs.: two historical speakers on one topic, quoted side by side |

The data explorers each have full-text search, filters, charts and a
paginated table. Every search and filter is written to the URL, so any view
can be linked.

## Data sources

| Dataset | Publisher | Source | Coverage | Terms |
|---|---|---|---|---|
| COMPAS | ProPublica | [`propublica/compas-analysis`](https://github.com/propublica/compas-analysis), `compas-scores-two-years.csv` | Broward County, Fla., defendants screened 2013 to 2014 | ProPublica Data Store [standard terms of use](https://projects.propublica.org/datastore/terms/): cite ProPublica; no stand-alone redistribution of the raw data |
| Senate trades | U.S. Senate, Office of Public Records (eFD) | [Senate Stock Watcher](https://github.com/timothycarambat/senate-stock-watcher-data), a JSON aggregation of [eFD](https://efdsearch.senate.gov/search/home/) periodic transaction reports | Transactions dated 2012 to 2021; the aggregation was last updated in March 2021 | The aggregation states no license. The reports carry the Ethics in Government Act restriction (5 U.S.C. app. § 105(c)): no commercial use other than by news media, and no use in soliciting money |
| Fatal Force | The Washington Post | [`washingtonpost/data-police-shootings`](https://github.com/washingtonpost/data-police-shootings), v2 CSV | Fatal shootings by on-duty police officers, 2015 to 2024 | [CC BY-NC-SA 4.0](https://github.com/washingtonpost/data-police-shootings/blob/master/LICENSE) |
| Campaign finance | Federal Election Commission | [All candidates file](https://www.fec.gov/campaign-finance-data/all-candidates-file-description/), `weball24` ([bulk data](https://www.fec.gov/data/browse-data/?tab=bulk-data)) | The 2023 to 2024 election cycle | U.S. government data. The FEC’s [sale-or-use restriction](https://www.fec.gov/updates/sale-or-use-contributor-information/) (52 U.S.C. § 30111(a)(4)) covers individual contributor information; this file holds candidate-level totals only |
| Qualified immunity | Institute for Justice | [*Unaccountable*](https://ij.org/report/unaccountable/) report, [data downloads](https://ij.org/report/unaccountable/data-downloads/) | Federal appellate opinions, 2010 to 2020 | No license or terms stated by the publisher |
| SGO crash reports | National Highway Traffic Safety Administration | Standing General Order 2021-01 incident report CSVs (ADS, ADAS and OTHER, current and `Archive-2021-2025/`) at `static.nhtsa.gov/odi/ffdd/sgo-2021-01/`, with the [data dictionary](https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/SGO-2021-01_Data_Element_Definitions.pdf) | Reports filed from July 2021 on; NHTSA republishes the files monthly | U.S. government data. The files and their data dictionary state no license or terms |
| Vs. quotations | Ten historical speakers | Published speeches, letters and writings | 1765 to 1943 | Short quotations, each with its source title and date |

### How the data was loaded

The first five datasets were each loaded once from the source above. COMPAS
was loaded with `import_compas.py`, written for the site’s original Supabase
database; the loaders for the other four were one-off scripts and were not
kept. All five moved to [Neon](https://neon.tech) Postgres in May 2026.

Datasets added since have a loader in `scripts/<dataset>/` with tests
(`npm test`). `npm run crashes -- refresh` downloads NHTSA’s six files,
replaces the crash table in one transaction, and checks every loaded field
against the source; `parse.mjs` there lists each change the loader makes. `db/schema.sql` is
the schema they live in now: one table per dataset plus a `search_*` and a
`*_stats` stored function for each.

Record counts are not listed here because the API reports them:
`curl -s https://verbatim.fyi/api/trades?action=stats | jq .total`.

## Stack

- Plain HTML pages and vanilla JS, built with Vite 6 and styled with Tailwind 4
- React 19 and D3 for the charts only, mounted into static pages
- Netlify Functions for the API, calling Postgres stored functions on Neon
- Hosted on Netlify

## Local development

Requires Node 22 and a Postgres database loaded with `db/schema.sql`.

```bash
npm install
cp .env.example .env    # set DATABASE_URL
npx netlify dev         # http://localhost:7033, pages and /api together
```

`npm run dev` starts Vite alone, which serves the pages without `/api`.
`npm run build` writes the site to `dist/`. `npm run og` regenerates the
per-page social cards from a running copy of the site.

## Layout

| Path | What it holds |
|---|---|
| `public/` | The pages (Vite’s root), one HTML entry per page in `vite.config.js` |
| `public/static/` | Files served as-is at `/`: fonts, social cards, `_redirects` |
| `public/js/explorer.js` | The shared explorer module: state, URL, requests, table, pager |
| `public/<explorer>/app.js` | Each explorer’s configuration: filters, row markup, charts |
| `src/viz/` | Chart components, one per chart |
| `netlify/functions/` | The API, one function per explorer (`/api/<explorer>`) |
| `db/schema.sql` | Tables and stored functions, as dumped from production |
| `db/<dataset>.sql` | The authored table and functions for datasets added since |
| `scripts/<dataset>/` | Loaders for datasets added since: fetch, parse, load, check, with test fixtures |
| `scripts/build-og.mjs` | Social card generator |
| `import_compas.py` | COMPAS loader |

## License

The code is MIT licensed (see [`LICENSE`](LICENSE)). The data is not covered
by that license: each dataset remains under its publisher’s terms, listed
above. Apart from the Vs. quotations and a few source rows kept as loader
test fixtures (`scripts/*/fixtures/`), this repository holds no dataset
records; they live in the database.
