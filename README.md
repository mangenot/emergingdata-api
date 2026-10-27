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

## Checks after deployment

    https://<project>.vercel.app/api/status?country=BGD
    https://<project>.vercel.app/api/series?country=BGD&indicator=INF_CPI&from=2025-07&format=csv
    https://<project>.vercel.app/api/catalog?type=events&country=BGD

## Domain

Vercel > Project > Settings > Domains: add api.emergingdata.com and create the CNAME it asks for at the registrar.

## Later

Replace ED_API_KEYS by a key table in Supabase tied to subscriptions, as on api.emergingtextiles.com; add the
chat tools (why questions over the link table) as further routes.
