-- EmergingData, 16 November 2026: the exports headline comes from the first official release, the central bank
-- series becomes a second indicator.
-- Bangladesh: the Export Promotion Bureau publishes total and apparel exports within a week of month end; Bangladesh
-- Bank's shipment-basis figure follows about six weeks later in the Monthly Economic Trends (October edition: data
-- to September) and differs from the EPB figure by under one per cent (September 2026: 3,909 against 3,937).
-- TRD_EXP for Bangladesh becomes the EPB total (all products); the Bangladesh Bank series continues as TRD_EXP_CB,
-- which keeps the trade balance TRD_BAL consistent with TRD_IMP. Earlier vintages of TRD_EXP are kept, so a report
-- frozen before this date still reads the Bangladesh Bank values it was written on.
-- Run once in the Supabase SQL Editor, then change the push list in the Bangladesh sheet (Supabase.gs).

insert into indicator (code, name, section_code, sector_code, type, unit, frequency, side, derivation, trend_short, trend_long, benchmark, phase, default_source, source_type, collection, notes) values
  ('TRD_EXP_CB', 'Goods exports, central bank series', 'TRD', null, 'flow', 'USD million', 'monthly', 'context',
   'Goods exports as compiled by the central bank for its trade and balance of payments tables, where that series differs from the first official release held in TRD_EXP',
   'latest 3 months vs previous 3 months', '5-year change', false, 'pilot', 'Central bank monthly bulletin', 'national', 'download',
   'Published later than TRD_EXP and on a different cut-off; the counterpart of TRD_IMP in TRD_BAL. Bangladesh: Bangladesh Bank, merchandise exports on shipment basis, Monthly Economic Trends Table IB')
on conflict (code) do update set name = excluded.name, derivation = excluded.derivation, default_source = excluded.default_source, notes = excluded.notes;

update indicator
   set default_source = 'First official release: export promotion body or statistics office; the central bank series is TRD_EXP_CB where it differs',
       notes = 'Bangladesh: Export Promotion Bureau monthly summary sheet, all products, from July 2024 (Bangladesh Bank shipment basis before, when the EPB figures were overstated); published in the first week of the following month'
 where code = 'TRD_EXP';

update indicator
   set derivation = 'Trade balance as published or computed by the central bank or statistics office: TRD_EXP minus TRD_IMP, or TRD_EXP_CB minus TRD_IMP where the central bank compiles its own exports series'
 where code = 'TRD_BAL';

update source
   set institution = 'Export Promotion Bureau', publication = 'Monthly summary sheet, export performance for the month, all products',
       url = 'https://epb.gov.bd/views/epb-export-data', publication_delay = 'first week of the following month',
       collection = 'download', status = 'confirmed', tolerance_days = 45
 where indicator_code = 'TRD_EXP' and iso3 = 'BGD';

insert into source (indicator_code, iso3, institution, publication, url, publication_delay, collection, status, tolerance_days) values
  ('TRD_EXP_CB', 'BGD', 'Bangladesh Bank', 'Monthly Economic Trends, Table IB, merchandise exports on shipment basis', 'https://www.bb.org.bd', 'about 6 weeks after the month', 'download', 'confirmed', 90)
on conflict (indicator_code, iso3) do update set institution = excluded.institution, publication = excluded.publication, url = excluded.url,
       publication_delay = excluded.publication_delay, collection = excluded.collection, status = excluded.status, tolerance_days = excluded.tolerance_days;

select indicator_code, institution, publication_delay, tolerance_days
  from source where iso3 = 'BGD' and indicator_code in ('TRD_EXP', 'TRD_EXP_CB', 'TRD_IMP', 'TRD_BAL', 'TRD_APP_EXP') order by 1;
