-- EmergingData, 4 November 2026: the global drivers of the country reports (country WLD), loaded by /api/global-run
-- from EmergingTextiles' own workbooks (Brent monthly average, US and EU apparel imports). Run once in the Supabase
-- SQL Editor before the first call of /api/global-run.

insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('GLB_US_APP_USD', 'US apparel imports, value', 'GLB', 'APP', 'flow', 'USD million', 'monthly', 'context', null, 'latest 3 months vs previous 3 months', '5-year change', false, 'pilot', 'OTEXA (EmergingTextiles US-Apparel-Imports-Monthly)', 'own', 'api', 'Category 1 (all apparel), customs value; the % change series is GLB_US_APP'),
  ('GLB_EU_APP_EUR', 'EU-27 clothing imports, value in EUR', 'GLB', 'APP', 'flow', 'EUR million', 'monthly', 'context', null, 'latest 3 months vs previous 3 months', '5-year change', false, 'pilot', 'Eurostat (EmergingTextiles EU-Clothing-Imports-MONTHLY)', 'own', 'api', 'HS 61 and 62, extra-EU, UK excluded; the % change series is GLB_EU_APP'),
  ('GLB_EU_APP_USD', 'EU-27 clothing imports, value in USD', 'GLB', 'APP', 'flow', 'USD million', 'monthly', 'context', null, 'latest 3 months vs previous 3 months', '5-year change', false, 'pilot', 'Eurostat (EmergingTextiles EU-Clothing-Imports-MONTHLY)', 'own', 'api', 'EUR value converted at the monthly EUR/USD rate used by EmergingTextiles')
on conflict (code) do update set name = excluded.name, unit = excluded.unit, frequency = excluded.frequency, default_source = excluded.default_source, source_type = excluded.source_type, collection = excluded.collection, notes = excluded.notes;

update indicator set frequency = 'monthly', default_source = 'EmergingTextiles_Monthly (Brent spot, monthly average)', source_type = 'own', collection = 'api',
       notes = 'Monthly average of the Brent spot price kept by EmergingTextiles; the current month is the month to date, revised at the next run'
 where code = 'GLB_BRENT';
update indicator set collection = 'api', default_source = 'OTEXA (EmergingTextiles US-Apparel-Imports-Monthly)' where code = 'GLB_US_APP';
update indicator set collection = 'api', default_source = 'Eurostat (EmergingTextiles EU-Clothing-Imports-MONTHLY)' where code = 'GLB_EU_APP';

insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days) values
  ('GLB_BRENT',      'WLD', 'EmergingTextiles', 'EmergingTextiles_Monthly, Polyester-Chain.csv (via the ET Sheets API)', 'https://api.emergingtextiles.com', 'month to date, daily', 'api', 'confirmed', 60),
  ('GLB_US_APP_USD', 'WLD', 'OTEXA via EmergingTextiles', 'US-Apparel-Imports-Monthly, Source (via the ET Sheets API)', 'https://api.emergingtextiles.com', 'about 5 weeks', 'api', 'confirmed', 150),
  ('GLB_US_APP',     'WLD', 'OTEXA via EmergingTextiles', 'computed from GLB_US_APP_USD', 'https://api.emergingtextiles.com', 'about 5 weeks', 'api', 'confirmed', 150),
  ('GLB_EU_APP_EUR', 'WLD', 'Eurostat via EmergingTextiles', 'EU-Clothing-Imports-MONTHLY, Source (via the ET Sheets API)', 'https://api.emergingtextiles.com', 'about 2 months', 'api', 'confirmed', 150),
  ('GLB_EU_APP_USD', 'WLD', 'Eurostat via EmergingTextiles', 'EU-Clothing-Imports-MONTHLY, Source (via the ET Sheets API)', 'https://api.emergingtextiles.com', 'about 2 months', 'api', 'confirmed', 150),
  ('GLB_EU_APP',     'WLD', 'Eurostat via EmergingTextiles', 'computed from GLB_EU_APP_EUR', 'https://api.emergingtextiles.com', 'about 2 months', 'api', 'confirmed', 150)
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, institution, tolerance_days from source where iso3 = 'WLD' and indicator_code like 'GLB_%' order by 1;
