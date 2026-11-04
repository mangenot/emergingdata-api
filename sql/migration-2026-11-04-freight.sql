-- EmergingData, 4 November 2026: the Drewry World Container Index (composite and four Shanghai lanes), loaded weekly
-- by /api/freight-run from Drewry's public page for country WLD. Run once in the Supabase SQL Editor.

insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('GLB_FRT_SH_RT', 'Container freight, Shanghai to Rotterdam', 'GLB', null, 'level', 'USD per 40ft', 'weekly', 'context', null, 'latest 3 months vs previous 3 months', 'level vs 5-year average', false, 'pilot', 'Drewry World Container Index', 'international', 'api', 'Weekly Thursday assessment; history from November 2026'),
  ('GLB_FRT_SH_GE', 'Container freight, Shanghai to Genoa', 'GLB', null, 'level', 'USD per 40ft', 'weekly', 'context', null, 'latest 3 months vs previous 3 months', 'level vs 5-year average', false, 'pilot', 'Drewry World Container Index', 'international', 'api', 'Weekly Thursday assessment; history from November 2026'),
  ('GLB_FRT_SH_LA', 'Container freight, Shanghai to Los Angeles', 'GLB', null, 'level', 'USD per 40ft', 'weekly', 'context', null, 'latest 3 months vs previous 3 months', 'level vs 5-year average', false, 'pilot', 'Drewry World Container Index', 'international', 'api', 'Weekly Thursday assessment; history from November 2026'),
  ('GLB_FRT_SH_NY', 'Container freight, Shanghai to New York', 'GLB', null, 'level', 'USD per 40ft', 'weekly', 'context', null, 'latest 3 months vs previous 3 months', 'level vs 5-year average', false, 'pilot', 'Drewry World Container Index', 'international', 'api', 'Weekly Thursday assessment; history from November 2026')
on conflict (code) do update set name = excluded.name, unit = excluded.unit, frequency = excluded.frequency, default_source = excluded.default_source, collection = excluded.collection, notes = excluded.notes;

update indicator set unit = 'USD per 40ft', collection = 'api', default_source = 'Drewry World Container Index (composite)',
       notes = 'WCI composite of eight routes, weekly Thursday assessment read from drewry.co.uk; history from November 2026'
 where code = 'GLB_FRT';

insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days)
select code, 'WLD', 'Drewry Supply Chain Advisors', 'World Container Index, weekly assessment page', 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry', 'Thursday, same day', 'api', 'confirmed', 21
  from indicator where code in ('GLB_FRT', 'GLB_FRT_SH_RT', 'GLB_FRT_SH_GE', 'GLB_FRT_SH_LA', 'GLB_FRT_SH_NY')
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, tolerance_days from source where iso3 = 'WLD' and indicator_code like 'GLB_FRT%' order by 1;
