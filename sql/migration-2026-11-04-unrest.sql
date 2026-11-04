-- EmergingData, 4 November 2026: the unrest proxy from the GDELT 2.0 event database (public dataset on Google BigQuery),
-- loaded monthly by /api/unrest-run for the five pilots and read by the politics risk rule (scoring engine 1.2).
-- Run once in the Supabase SQL Editor.

update indicator
   set name = 'Protest events (GDELT)', unit = 'events per month', frequency = 'monthly', side = 'risk',
       derivation = 'GDELT 2.0 events with CAMEO root code 14 (protest) located in the country, by event date, counting only events GDELT added within 31 days of their date',
       default_source = 'GDELT Project (event database on Google BigQuery)', source_type = 'international', collection = 'api',
       notes = 'A machine-coded count of protest events in world news, not a verified event count: it rises with coverage as well as with unrest, so read it with the share and with the calendar. The politics rule compares the last three complete months with the twelve before (1.5 times = sustained protests, 2.5 times = violent unrest). A month is provisional until 31 days after its end. ACLED remains the upgrade if licensed.'
 where code = 'POL_UNREST';

insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('POL_UNREST_SHARE', 'Protest events, share of all events (GDELT)', 'POL', null, 'rate', 'per 1,000 events', 'monthly', 'risk', 'POL_UNREST divided by all GDELT events located in the country that month, times 1,000', 'latest 3 months vs previous 3 months', 'level vs 5-year average', false, 'pilot', 'GDELT Project (event database on Google BigQuery)', 'international', 'api', 'Controls the count for changes in the volume of news about the country')
on conflict (code) do update set name = excluded.name, unit = excluded.unit, frequency = excluded.frequency, derivation = excluded.derivation, default_source = excluded.default_source, collection = excluded.collection, notes = excluded.notes;

insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days)
select i.code, c.iso3, 'GDELT Project', 'GDELT 2.0 event database, table gdelt-bq.gdeltv2.events_partitioned on Google BigQuery', 'https://www.gdeltproject.org/data.html#googlebigquery', '15 minutes; a month is final 31 days after its end', 'api', 'confirmed', 60
  from indicator i cross join (select iso3 from country where proposal = 'Pilot' and iso3 <> 'WLD') c
 where i.code in ('POL_UNREST', 'POL_UNREST_SHARE')
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, count(*) from source where indicator_code in ('POL_UNREST', 'POL_UNREST_SHARE') group by 1;
