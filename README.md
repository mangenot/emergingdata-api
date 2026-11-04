# EmergingData API

Vercel project serving the EmergingData Supabase database: the observation table (latest vintages), the series
status and the registry. Three routes, no framework, Node 18 or later.

    /api/series?country=BGD&indicator=INF_CPI,FX_USD&from=2024-01&to=2026-12&format=json|csv
    /api/status?country=BGD&format=csv
    /api/catalog?type=indicators|countries|events

## Deploy

Once, in Supabase (SQL Editor): run `sql/views.sql` (creates the series_status view read by /api/status).

Then one of two routes to Vercel.

Without a terminal: create an empty GitHub repository named emergingdata-api, use "Add file > Upload files" and
drag the content of this folder into it (api, public, sql, package.json, vercel.json, README.md, .gitignore),
commit. In Vercel: Add New > Project > Import that repository, framework preset "Other", no build command, then
add the environment variables below and Deploy. Every later commit redeploys.

With a terminal: `npm i -g vercel`, then in this folder `vercel` (creates the project and deploys a preview) and
`vercel --prod`. Environment variables are set with `vercel env add` or in the dashboard.

## Environment variables (Vercel > Project > Settings > Environment Variables)

    SUPABASE_URL           https://<project-ref>.supabase.co
    SUPABASE_SERVICE_KEY   the secret key (Supabase > Project Settings > API Keys > Secret keys)
    ED_API_KEYS            optional: comma-separated list of accepted client keys; unset = open access
    SBP_API_KEY            State Bank of Pakistan EasyData key, used only by /api/sbp (the relay for the Pakistan sheet)
    ED_RELAY_SECRET        shared secret the Pakistan sheet sends as x-relay-key to /api/sbp, and the key of /api/score-run and /api/macro-run
    CRON_SECRET            optional: lets the Vercel cron call /api/score-run, /api/macro-run and /api/global-run (Vercel sends it as a Bearer token)
    ET_API_KEY             an EmergingTextiles Sheets API key (api.emergingtextiles.com), used only by /api/global-run
    ET_API_BASE            optional: the ET Sheets API base, default https://api.emergingtextiles.com
    GCP_SA_KEY             the JSON key file of a Google service account with the BigQuery Job User role, pasted whole; used only by /api/unrest-run

## Routes

    /api/series   observations (latest vintage) for countries and indicators, JSON or CSV
    /api/status   one line per series with last date and staleness flag (series_status view)
    /api/catalog  indicators, countries, events
    /api/sbp      relay to the SBP EasyData API for the Pakistan sheet (EasyData's firewall blocks Google's servers);
                  needs SBP_API_KEY and ED_RELAY_SECRET; cached one hour
    /api/scores   the scores of the latest month (or ?date=): two composites and nine section scores per country,
                  ?detail=1 for the inputs and notes behind each score, ?format=csv
    /api/score-run?key=<ED_RELAY_SECRET>[&date=2026-11-01][&country=KEN][&dry=1]
                  runs the scoring engine (api/_scoring.js, the registry rulebook) and writes the score and composite
                  tables; dry=1 computes without writing. Also run by the Vercel cron on the 5th of each month at
                  06:00 UTC (vercel.json); set CRON_SECRET in the environment so that only the cron can call it that way
    /api/macro-run?key=<ED_RELAY_SECRET>[&country=KEN][&dry=1]
                  loads the annual public-finance and external-debt indicators of the pilot countries from the IMF WEO
                  (gross debt, fiscal balance, current account, GDP) and the World Bank (external debt, debt service,
                  interest payments; logistics performance, customs score, liner connectivity, container traffic,
                  power losses) into the observation table; a changed value adds a new vintage. Also run by the
                  Vercel cron on the 3rd of each month at 05:00 UTC
    /api/global-run?key=<ED_RELAY_SECRET>[&dry=1]
                  loads the global drivers (country WLD) from EmergingTextiles' own workbooks through the ET Sheets API:
                  Brent monthly average (EmergingTextiles_Monthly), US apparel imports (US-Apparel-Imports-Monthly) and
                  EU-27 clothing imports (EU-Clothing-Imports-MONTHLY), with the year-on-year changes. The three
                  workbooks must be in the ET API registry. Cron on the 3rd at 05:30 UTC
    /api/freight-run?key=<ED_RELAY_SECRET>[&dry=1]
                  reads the weekly Drewry World Container Index (composite and the four Shanghai lanes) from Drewry's
                  public assessment page and writes it for country WLD, dated the Thursday of the assessment. Cron on
                  Fridays at 07:00 UTC; the history builds up from the first run
    /api/unrest-run?key=<ED_RELAY_SECRET>[&from=2025-08&to=2026-11][&country=KEN][&dry=1]
                  loads the unrest proxy from the GDELT 2.0 event database on Google BigQuery: protest events (CAMEO
                  root code 14) located in each pilot country, per month and per 1,000 events (POL_UNREST,
                  POL_UNREST_SHARE). Default window: the last three months (the month before last becomes final,
                  the last month is refreshed, the current month is the month to date). Needs GCP_SA_KEY. Cron on
                  the 2nd at 04:00 UTC

## Scoring

Once, in Supabase: run `sql/migration-2026-11-02-scoring.sql` (composite.note column, two seeded inputs). Then
`/api/score-run?key=...&dry=1` to see the scores without writing, `/api/score-run?key=...` to write them, and
`/api/scores?detail=1` to read them back. The rules are in api/_scoring.js, one function per section, following the
scoring_rule table of the registry; where an input is missing the score is left empty and the note says so.

## Macro indicators (annual)

Once, in Supabase: run `sql/migration-2026-11-04-macro.sql` (four new indicator codes, their source rows) and
`sql/migration-2026-11-04-logistics.sql` (the logistics and energy codes). Then
`/api/macro-run?key=...&dry=1` to see what would be written, `/api/macro-run?key=...` to write it. Years from the
current year on are IMF projections (flagged in the note); Bangladesh, Kenya and Pakistan report fiscal years ending
in June under the calendar year in which they end.

## Global drivers

Once, in Supabase: run `sql/migration-2026-11-04-global.sql`; in Vercel set ET_API_KEY. Then `/api/global-run?key=...&dry=1`
and without dry=1. The current month of Brent is the month to date and is revised by the next run (new vintage).

## Freight index

Once, in Supabase: run `sql/migration-2026-11-04-freight.sql`. Then `/api/freight-run?key=...&dry=1` to check the parse
(date, composite, four lanes), then without dry=1. If Drewry rewords its page, the parse fails with an error and
nothing is written; the regular expressions are in api/freight-run.js (parseWci).

## Unrest proxy

The source is the GDELT 2.0 event database as published on Google BigQuery (public dataset, refreshed every
15 minutes); GDELT's own web API is too unreliable for a cron. One query covers any window and scans about 0.2 GB
per month of window, inside BigQuery's free tier (1 TB a month), so no billing is needed.

Once, in Google Cloud (project et-sheets-352007, the one of the Sheets API): enable the BigQuery API, give the
service account the role BigQuery Job User, create a JSON key for it and paste the whole key file into the Vercel
environment variable `GCP_SA_KEY` (then redeploy). Once, in Supabase: run `sql/migration-2026-11-04-unrest.sql`.
Then one backfill call: `/api/unrest-run?key=...&from=2025-08&to=2026-11`. The politics rule uses the series once
nine months are present (scoring engine 1.2).

## Checks after deployment

    https://<project>.vercel.app/api/status?country=BGD
    https://<project>.vercel.app/api/series?country=BGD&indicator=INF_CPI&from=2025-07&format=csv
    https://<project>.vercel.app/api/catalog?type=events&country=BGD

## Domain

Vercel > Project > Settings > Domains: add api.emergingdata.com and create the CNAME it asks for at the registrar.

## Later

Replace ED_API_KEYS by a key table in Supabase tied to subscriptions, as on api.emergingtextiles.com; add the
chat tools (why questions over the link table) as further routes.
