# Verbatim

Primary source data, made explorable. A corpus of speeches, writings and
founding documents, and public datasets from their original publishers, made
searchable, filterable and charted, with nothing added.

**Live:** [verbatim.fyi](https://verbatim.fyi)

## Explorers

| Route | Dataset |
|---|---|
| [`/corpus/`](https://verbatim.fyi/corpus/) | Speeches, writings and founding documents: the Constitution and its amendments, presidential addresses and papers, Supreme Court opinions, speeches in Congress, and other speeches, letters and essays |
| [`/corpus/contents/`](https://verbatim.fyi/corpus/contents/) | Every speaker in the corpus under each official roster that lists them, with their records and years; the State of the Union and inaugural addresses member by member |
| [`/amendments/`](https://verbatim.fyi/amendments/) | The twenty-seven amendments to the Constitution in order, with the text of each and the dates it was proposed, ratified and certified |
| [`/over-time/`](https://verbatim.fyi/over-time/) | Up to three words counted in each year’s State of the Union messages or inaugural addresses, per million words |
| [`/compas/`](https://verbatim.fyi/compas/) | COMPAS recidivism risk scores, from ProPublica’s “Machine Bias” analysis |
| [`/trades/`](https://verbatim.fyi/trades/) | Congressional stock trade disclosures filed under the STOCK Act, House and Senate |
| [`/incidents/`](https://verbatim.fyi/incidents/) | The Washington Post Fatal Force database of fatal police shootings |
| [`/finance/`](https://verbatim.fyi/finance/) | 2024 federal campaign finance, one row per candidate, from the FEC |
| [`/qi/`](https://verbatim.fyi/qi/) | Qualified immunity cases in the federal courts of appeals, from the Institute for Justice |
| [`/crashes/`](https://verbatim.fyi/crashes/) | Crash reports filed with NHTSA under Standing General Order 2021-01 for vehicles with automated driving systems or Level 2 driver assistance |
| [`/executive/`](https://verbatim.fyi/executive/) | Executive orders and proclamations published in the Federal Register since 1994, with the Federal Register’s disposition notes |
| [`/clemency/`](https://verbatim.fyi/clemency/) | Pardons and commutations on the Justice Department’s clemency recipient lists, Richard Nixon to the present |
| [`/vs/`](https://verbatim.fyi/vs/) | Vs.: two historical speakers on one topic, quoted side by side |

The data explorers each have full-text search, filters, charts and a
paginated table. Every search and filter is written to the URL, so any view
can be linked.

## Data sources

| Dataset | Publisher | Source | Coverage | Terms |
|---|---|---|---|---|
| Corpus | The source named on each record | Miller Center, Project Gutenberg, WikiSource, the National Archives, Cornell LII, Historic Hansard and govinfo; [`scripts/corpus/README.md`](scripts/corpus/README.md) lists each importer and its sources | Dated records from 1722 to 2025 | Differs by source. Each record carries the basis for publishing it here, and any notice its source’s terms require (Project Gutenberg’s license notice, linked to the full license); records with no basis are left out |
| COMPAS | ProPublica | [`propublica/compas-analysis`](https://github.com/propublica/compas-analysis), `compas-scores-two-years.csv` | Broward County, Fla., defendants screened 2013 to 2014 | ProPublica Data Store [standard terms of use](https://projects.propublica.org/datastore/terms/): “If you use the data for publication, you must cite ProPublica”; “You can’t republish the raw data in its entirety or otherwise distribute the data (in whole or in part) on a stand-alone basis”; “You can’t change the data except to update or correct it”; no charging for it or selling advertising against it; no sub-licensing or resale. Verbatim loads a subset of the columns with values as published |
| House trades | Clerk of the U.S. House of Representatives | Periodic transaction reports from the Clerk: the yearly index ZIPs ([`financial-pdfs/<year>FD.zip`](https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2025FD.zip)) and each electronic report’s PDF (`ptr-pdfs/<year>/<DocID>.pdf`); paper reports are listed and linked, not transcribed | Reports filed from 2014 on | The same Ethics in Government Act restriction, [5 U.S.C. § 13107(c)](https://www.govinfo.gov/content/pkg/USCODE-2024-title5/html/USCODE-2024-title5-partIV-chap131-subchapI-sec13107.htm), which names the Clerk; the STOCK Act waives only the requester details for online posting. Labels are the House’s own: asset types from [fd.house.gov’s asset type codes](https://fd.house.gov/reference/asset-type-codes.aspx), owners from the 2025 Instruction Guide and the PTR form. The PTR form’s P, S, S (partial) and E take the Senate’s names (Purchase, Sale (Full), Sale (Partial), Exchange), so one type filter covers both chambers |
| Senate trades | U.S. Senate, Office of Public Records (eFD) | [Senate Stock Watcher](https://github.com/timothycarambat/senate-stock-watcher-data), a JSON aggregation of [eFD](https://efdsearch.senate.gov/search/home/) periodic transaction reports | Transactions dated 2012 to 2021; the aggregation was last updated in March 2021 | The aggregation states no license. The reports carry the Ethics in Government Act restriction, [5 U.S.C. § 13107(c)](https://www.govinfo.gov/content/pkg/USCODE-2024-title5/html/USCODE-2024-title5-partIV-chap131-subchapI-sec13107.htm) (formerly 5 U.S.C. app. § 105(c), recodified by Pub. L. 117-286): no one may obtain or use a report for any unlawful purpose; for any commercial purpose, other than by news and communications media for dissemination to the general public; to determine or establish anyone’s credit rating; or in soliciting money for any political, charitable or other purpose. `/trades/` quotes it |
| Fatal Force | The Washington Post | [`washingtonpost/data-police-shootings`](https://github.com/washingtonpost/data-police-shootings), v2 CSV | Fatal shootings by on-duty police officers, 2015 to 2024 | [CC BY-NC-SA 4.0](https://github.com/washingtonpost/data-police-shootings/blob/master/LICENSE). Verbatim’s copy leaves out two columns (`location_precision`, `race_source`) and is shared under the same license; the About page says so |
| Campaign finance | Federal Election Commission | [All candidates file](https://www.fec.gov/campaign-finance-data/all-candidates-file-description/), `weball24` ([bulk data](https://www.fec.gov/data/browse-data/?tab=bulk-data)) | The 2023 to 2024 election cycle | U.S. government data. The FEC’s [sale-or-use restriction](https://www.fec.gov/updates/sale-or-use-contributor-information/) (52 U.S.C. § 30111(a)(4)) covers individual contributor information; this file holds candidate-level totals only |
| Qualified immunity | Institute for Justice | [*Unaccountable*](https://ij.org/report/unaccountable/) report, [data downloads](https://ij.org/report/unaccountable/data-downloads/) | Federal appellate opinions, 2010 to 2020 | The data downloads page states no license or terms |
| SGO crash reports | National Highway Traffic Safety Administration | Standing General Order 2021-01 incident report CSVs (ADS, ADAS and OTHER, current and `Archive-2021-2025/`) at `static.nhtsa.gov/odi/ffdd/sgo-2021-01/`, with the [data dictionary](https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/SGO-2021-01_Data_Element_Definitions.pdf) | Reports filed from July 2021 on; NHTSA republishes the files monthly | U.S. government data. NHTSA’s [terms of use](https://www.nhtsa.gov/about-nhtsa/terms-use): “Information presented on this web site is considered public information and may be distributed or copied.” The files and their data dictionary state no license |
| Executive orders and proclamations | Office of the Federal Register (National Archives) and the U.S. Government Publishing Office | [FederalRegister.gov API](https://www.federalregister.gov/developers/documentation/api/v1) (`documents.json`, presidential documents: executive orders and proclamations) for numbers, dates, citations and notes; text through the same API by `scripts/corpus/import_federal_register.py` | Signed from December 30, 1993; refreshed by hand | U.S. government works (17 U.S.C. § 105). [1 CFR 2.6](https://www.govinfo.gov/content/pkg/CFR-2023-title1-vol1/xml/CFR-2023-title1-vol1-sec2-6.xml): “Any person may reproduce or republish, without restriction, any material appearing in any regular or special edition of the Federal Register.” FederalRegister.gov [says](https://www.federalregister.gov/reader-aids/government-policy-and-ofr-procedures/about-this-site) it “is not an official legal edition of the Federal Register” |
| Clemency recipients | U.S. Department of Justice, Office of the Pardon Attorney | [Clemency recipients](https://www.justice.gov/pardon/clemency-recipients): 21 list pages (pardons and commutations apart through Biden, one page for Trump from 2025) and the detail pages for two group commutations, listed in [`scripts/clemency/sources.mjs`](scripts/clemency/sources.mjs) | Grants from 1969 on; refreshed by hand | DOJ [legal policies](https://www.justice.gov/legalpolicies), “Copyright Status and Citation”: “Unless otherwise indicated, information on Department of Justice websites is in the public domain and may be copied and distributed without permission. Citation of the Department of Justice as source of the information is appreciated, as appropriate.” Warrants are linked on justice.gov, not copied |
| Series lists (`/over-time/`, `/corpus/contents/`) | The American Presidency Project; Joint Congressional Committee on Inaugural Ceremonies; U.S. House of Representatives, History, Art & Archives | [Annual messages to Congress](https://www.presidency.ucsb.edu/documents/presidential-documents-archive-guidebook/annual-messages-congress-the-state-the-union), [past inaugural ceremonies](https://www.inaugural.senate.gov/past-inaugural-ceremonies/), and [in-person addresses](https://history.house.gov/Institution/SOTU/List/) for exact dates; transcribed once into [`scripts/corpus/series.json`](scripts/corpus/series.json) | State of the Union 1790 to 2026; inaugural addresses 1789 to 2025 | Facts only: which address belongs to each series, its speaker and its date. No text is taken from the lists |
| Speaker rosters (`/corpus/contents/`) | The White House; Supreme Court of the United States; U.S. House of Representatives, History, Art & Archives; U.S. Senate | [Presidential Walk of Fame](https://www.whitehouse.gov/walk-of-fame/), [Justices 1789 to Present](https://www.supremecourt.gov/about/members_text.aspx), the [Biographical Directory](https://history.house.gov/People/Search/) and [States in the Senate](https://www.senate.gov/states/statesmap.htm); transcribed once into [`scripts/corpus/rosters.json`](scripts/corpus/rosters.json) | Every speaker in the corpus | Facts only: which roster lists each speaker, in its words. U.S. government works |
| Amendment dates (`/amendments/`) | National Archives; Congressional Research Service; U.S. House of Representatives | NARA transcriptions, *The Constitution of the United States: Analysis and Interpretation* (2022) and the House Manual (118th Congress) on govinfo; each date names its source in [`scripts/corpus/amendments.json`](scripts/corpus/amendments.json) | The 27 amendments | U.S. government works |
| Vs. quotations | Ten historical speakers | Published speeches, letters and writings | 1765 to 1943 | Short quotations, each with its source title and date |

### How the data was loaded

The first five datasets were each loaded once from the source above. COMPAS
was loaded with `import_compas.py`, written for the site’s original Supabase
database; the loaders for the other four were one-off scripts and were not
kept. All five moved to [Neon](https://neon.tech) Postgres in May 2026.

Datasets added since have a loader in `scripts/<dataset>/` with tests
(`npm test`). `npm run crashes -- refresh` downloads NHTSA’s six files,
replaces the crash table in one transaction, and checks every loaded field
against the source; `parse.mjs` there lists each change the loader makes.
`npm run executive -- refresh` fetches the Federal Register’s listings, joins
them to the corpus release, replaces the table in one transaction and checks
every field and note. `npm run clemency -- refresh` downloads the 23 pages
ten seconds apart, as DOJ’s robots.txt asks, replaces the table in one
transaction and checks each page against an independent count.
`db/schema.sql` is
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
above, and the Fatal Force rows Verbatim serves are licensed CC BY-NC-SA 4.0.
Apart from the Vs. quotations and a few source rows kept as loader
test fixtures (`scripts/*/fixtures/`), this repository holds no dataset
records; they live in the database.

The site’s `/api/` endpoints exist to serve its pages. They are not a data
download or a way to redistribute any dataset; get each one from its
publisher, linked above.
