-- EmergingData, 4 November 2026: a news-based unrest proxy from GDELT (free), loaded monthly by /api/unrest-run for the
-- five pilots and read by the politics risk rule (scoring engine 1.2). Run once in the Supabase SQL Editor.

update indicator
   set name = 'Protest coverage in domestic media', unit = 'articles per month', frequency = 'monthly', side = 'risk',
       derivation = 'GDELT DOC 2.0: articles with the PROTEST theme published by the country''s media (sourcecountry filter), summed by month',
       default_source = 'GDELT Project (DOC 2.0 API)', source_type = 'international', collection = 'api',
       notes = 'A proxy for unrest, not an event count: the volume of protest-themed news from the country''s own outlets. The politics rule compares the last three months with the twelve before (1.5 times = sustained protests, 2.5 times = violent unrest). ACLED remains the upgrade if licensed.'
 where code = 'POL_UNREST';

insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('POL_UNREST_SHARE', 'Protest coverage, share of monitored news', 'POL', null, 'rate', 'per 100,000 articles', 'monthly', 'risk', 'POL_UNREST divided by the articles GDELT monitored that month, times 100,000', 'latest 3 months vs previous 3 months', 'level vs 5-year average', false, 'pilot', 'GDELT Project (DOC 2.0 API)', 'international', 'api', 'Normalises the count for changes in the volume of news monitored')
on conflict (code) do update set name = excluded.name, unit = excluded.unit, frequency = excluded.frequency, default_source = excluded.default_source, collection = excluded.collection, notes = excluded.notes;

insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days)
select i.code, c.iso3, 'GDELT Project', 'DOC 2.0 API, timeline of articles with the PROTEST theme by source country', 'https://api.gdeltproject.org', 'a few days', 'api', 'confirmed', 60
  from indicator i cross join (select iso3 from country where proposal = 'Pilot' and iso3 <> 'WLD') c
 where i.code in ('POL_UNREST', 'POL_UNREST_SHARE')
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, count(*) from source where indicator_code in ('POL_UNREST', 'POL_UNREST_SHARE') group by 1;
