-- EmergingData, 4 November 2026: logistics and energy-reliability indicators from the World Bank (chapters 5 and 6
-- of the country report), loaded by /api/macro-run with the public-finance set. Run once in the Supabase SQL
-- Editor, then call /api/macro-run again.

insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('ENV_LPI_CUST', 'Logistics Performance Index, customs clearance', 'ENV', null, 'index', 'score 1 to 5', 'biennial', 'cost', null, 'not applicable', '5-year change', false, 'pilot', 'World Bank LPI', 'international', 'api', 'Efficiency of the customs clearance process as rated by freight forwarders; the 2023 edition is dated 2022'),
  ('ENV_LSCI',     'Liner shipping connectivity index', 'ENV', null, 'index', 'index, 2004 maximum = 100', 'annual', 'cost', null, 'not applicable', '5-year change', true, 'pilot', 'UNCTAD via World Bank WDI', 'international', 'api', 'How well the country is connected to global liner networks; WDI lags UNCTAD by two to three years'),
  ('ENV_TEU',      'Container port traffic', 'ENV', null, 'flow', 'thousand TEU', 'annual', 'context', null, 'not applicable', '5-year change', false, 'pilot', 'World Bank WDI', 'international', 'api', 'All ports of the country; growth signals capacity and demand'),
  ('ENV_ELOSS',    'Power transmission and distribution losses', 'ENV', null, 'rate', '% of output', 'annual', 'risk', null, 'not applicable', '5-year change', true, 'pilot', 'World Bank WDI', 'international', 'api', 'A proxy for grid reliability where no outage series exists; above 15% signals a weak grid')
on conflict (code) do update set name = excluded.name, unit = excluded.unit, frequency = excluded.frequency, default_source = excluded.default_source, source_type = excluded.source_type, collection = excluded.collection, notes = excluded.notes;

update indicator set collection = 'api', default_source = 'World Bank LPI (API v2)', notes = 'Overall score; the 2023 edition is dated 2022 and did not survey Kenya or Pakistan, which keep their 2018 score'
 where code = 'ENV_LPI';

insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days)
select i.code, c.iso3, s.institution, s.publication, s.url, s.delay, 'api', 'confirmed', s.tol
  from (values
    ('ENV_LPI',      'World Bank', 'Logistics Performance Index, LP.LPI.OVRL.XQ (API v2)', 'https://api.worldbank.org', 'editions every two to five years', 2200),
    ('ENV_LPI_CUST', 'World Bank', 'Logistics Performance Index, LP.LPI.CUST.XQ (API v2)', 'https://api.worldbank.org', 'editions every two to five years', 2200),
    ('ENV_LSCI',     'World Bank', 'World Development Indicators, IS.SHP.GCNW.XQ (API v2)', 'https://api.worldbank.org', 'two to three years', 1500),
    ('ENV_TEU',      'World Bank', 'World Development Indicators, IS.SHP.GOOD.TU (API v2)', 'https://api.worldbank.org', 'about one year', 600),
    ('ENV_ELOSS',    'World Bank', 'World Development Indicators, EG.ELC.LOSS.ZS (API v2)', 'https://api.worldbank.org', 'about one year', 600)
  ) as s(code, institution, publication, url, delay, tol)
  join indicator i on i.code = s.code
  cross join (select iso3 from country where proposal = 'Pilot' and iso3 <> 'WLD') c
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, count(*) as countries from source
 where indicator_code in ('ENV_LPI', 'ENV_LPI_CUST', 'ENV_LSCI', 'ENV_TEU', 'ENV_ELOSS') group by 1 order by 1;
