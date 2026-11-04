-- EmergingData, 4 November 2026: annual public-finance and external-debt indicators for the country report
-- (chapter 4, public finances and external position), loaded by /api/macro-run from the IMF WEO and the World Bank.
-- Run once in the Supabase SQL Editor, before the first call of /api/macro-run.

-- 1. Four new indicator codes; two existing ones aligned with the source actually used.
insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('EXT_GDEBT', 'General government gross debt', 'EXT', null, 'rate', '% of GDP', 'annual', 'risk', null, 'not applicable', '5-year change', true, 'pilot', 'IMF World Economic Outlook', 'international', 'api', 'Years from the current year on are IMF projections (flagged in the observation note); fiscal-year countries report the year ending in June'),
  ('EXT_FISC',  'General government net lending or borrowing (fiscal balance)', 'EXT', null, 'rate', '% of GDP', 'annual', 'risk', null, 'not applicable', '5-year change', true, 'pilot', 'IMF World Economic Outlook', 'international', 'api', 'Negative = deficit; projections flagged as for EXT_GDEBT'),
  ('EXT_INT',   'Interest payments, central government', 'EXT', null, 'rate', '% of revenue', 'annual', 'risk', null, 'not applicable', '5-year change', true, 'pilot', 'World Bank WDI (IMF GFS)', 'international', 'api', 'Published with a lag of one to three years and missing for some countries; the interest burden is the clearest measure of fiscal stress'),
  ('EXT_GDP',   'GDP, current prices', 'EXT', null, 'level', 'USD billion', 'annual', 'context', null, 'not applicable', '5-year change', false, 'pilot', 'IMF World Economic Outlook', 'international', 'api', 'Size of the economy, for context and ratios')
on conflict (code) do update set name = excluded.name, unit = excluded.unit, frequency = excluded.frequency, default_source = excluded.default_source, source_type = excluded.source_type, collection = excluded.collection, notes = excluded.notes;

update indicator set frequency = 'annual', default_source = 'IMF World Economic Outlook', source_type = 'international', collection = 'api',
       notes = 'Annual from the WEO (projections flagged); the quarterly balance of payments can replace it later'
 where code = 'EXT_CA';
update indicator set unit = '% of GNI', default_source = 'World Bank International Debt Statistics', collection = 'api'
 where code = 'EXT_DEBT';
update indicator set default_source = 'World Bank International Debt Statistics', collection = 'api'
 where code = 'EXT_DS';

-- 2. Source rows for the five pilots (status confirmed: the fetcher is tested).
insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days)
select i.code, c.iso3, s.institution, s.publication, s.url, s.delay, 'api', 'confirmed', 540
  from (values
    ('EXT_GDEBT', 'IMF', 'World Economic Outlook database, GGXWDG_NGDP (SDMX dataflow IMF.RES/WEO)', 'https://data.imf.org', 'April and October editions'),
    ('EXT_FISC',  'IMF', 'World Economic Outlook database, GGXCNL_NGDP', 'https://data.imf.org', 'April and October editions'),
    ('EXT_CA',    'IMF', 'World Economic Outlook database, BCA_NGDPD', 'https://data.imf.org', 'April and October editions'),
    ('EXT_GDP',   'IMF', 'World Economic Outlook database, NGDPD', 'https://data.imf.org', 'April and October editions'),
    ('EXT_DEBT',  'World Bank', 'International Debt Statistics, DT.DOD.DECT.GN.ZS (API v2)', 'https://api.worldbank.org', 'annual, December, for the previous year'),
    ('EXT_DS',    'World Bank', 'International Debt Statistics, DT.TDS.DECT.EX.ZS (API v2)', 'https://api.worldbank.org', 'annual, December, for the previous year'),
    ('EXT_INT',   'World Bank', 'World Development Indicators, GC.XPN.INTP.RV.ZS (API v2)', 'https://api.worldbank.org', 'one to three years')
  ) as s(code, institution, publication, url, delay)
  join indicator i on i.code = s.code
  cross join (select iso3 from country where proposal = 'Pilot' and iso3 <> 'WLD') c
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, count(*) as countries, min(status) as status from source
 where indicator_code in ('EXT_GDEBT', 'EXT_FISC', 'EXT_CA', 'EXT_GDP', 'EXT_DEBT', 'EXT_DS', 'EXT_INT') group by 1 order by 1;
