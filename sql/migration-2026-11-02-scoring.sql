-- EmergingData, 2 November 2026: scoring. Run in the Supabase SQL Editor before the first /api/score-run.

-- 1. The composite table keeps the detail of each run (components used, weights, derived inputs).
alter table composite add column if not exists note text;
grant select, insert, update on score, composite to service_role;

-- 2. Two annual inputs the rulebook needs and no sheet feeds yet, seeded once (a later Manual Series row with the
--    same indicator and date adds a new vintage and wins):
--    POL_CPI_TI: Transparency International Corruption Perceptions Index 2024 (published February 2025), score 0 to 100.
--    TRD_DEST_US and TRD_DEST_EU: share of apparel exports going to the US and the EU, %, 2024, approximate (from OTEXA,
--    Eurostat and Trade Map); to replace with the Intracen mirror figures.
insert into observation (indicator_code, iso3, obs_date, value, vintage_date, note) values
  ('POL_CPI_TI', 'BGD', '2024-01-01', 23, current_date, 'Transparency International CPI 2024, published February 2025; 2025 edition to enter when published'),
  ('POL_CPI_TI', 'PAK', '2024-01-01', 27, current_date, 'Transparency International CPI 2024, published February 2025; 2025 edition to enter when published'),
  ('POL_CPI_TI', 'KEN', '2024-01-01', 32, current_date, 'Transparency International CPI 2024, published February 2025; 2025 edition to enter when published'),
  ('POL_CPI_TI', 'KHM', '2024-01-01', 21, current_date, 'Transparency International CPI 2024, published February 2025; 2025 edition to enter when published'),
  ('POL_CPI_TI', 'HND', '2024-01-01', 22, current_date, 'Transparency International CPI 2024, published February 2025; 2025 edition to enter when published'),
  ('TRD_DEST_US', 'BGD', '2024-01-01', 17, current_date, 'approximate 2024 share of apparel exports to the US; replace with the Intracen mirror figure'),
  ('TRD_DEST_EU', 'BGD', '2024-01-01', 48, current_date, 'approximate 2024 share of apparel exports to the EU; replace with the Intracen mirror figure'),
  ('TRD_DEST_US', 'PAK', '2024-01-01', 22, current_date, 'approximate 2024 share of apparel exports to the US; replace with the Intracen mirror figure'),
  ('TRD_DEST_EU', 'PAK', '2024-01-01', 35, current_date, 'approximate 2024 share of apparel exports to the EU; replace with the Intracen mirror figure'),
  ('TRD_DEST_US', 'KEN', '2024-01-01', 88, current_date, 'approximate 2024 share of apparel exports to the US (AGOA); replace with the Intracen mirror figure'),
  ('TRD_DEST_EU', 'KEN', '2024-01-01', 4, current_date, 'approximate 2024 share of apparel exports to the EU; replace with the Intracen mirror figure'),
  ('TRD_DEST_US', 'KHM', '2024-01-01', 40, current_date, 'approximate 2024 share of apparel exports to the US; replace with the Intracen mirror figure'),
  ('TRD_DEST_EU', 'KHM', '2024-01-01', 22, current_date, 'approximate 2024 share of apparel exports to the EU; replace with the Intracen mirror figure'),
  ('TRD_DEST_US', 'HND', '2024-01-01', 80, current_date, 'approximate 2024 share of apparel exports to the US (CAFTA-DR); replace with the Intracen mirror figure'),
  ('TRD_DEST_EU', 'HND', '2024-01-01', 1, current_date, 'approximate 2024 share of apparel exports to the EU; replace with the Intracen mirror figure')
on conflict (indicator_code, iso3, obs_date, vintage_date) do nothing;

select indicator_code, iso3, obs_date, value from observation_latest
 where indicator_code in ('POL_CPI_TI', 'TRD_DEST_US', 'TRD_DEST_EU') order by 1, 2;
