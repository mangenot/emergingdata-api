-- EmergingData: series_status view, read by /api/status. Run once in the Supabase SQL Editor (re-run after a change).
-- Tolerance before a series is called stale depends on the indicator's stated frequency. An observation is dated
-- the first day of its period and sources publish one to three months after the period (Bangladesh Bank's
-- commodity import tables are the slowest), so a monthly series normally sits 80 to 150 days behind today;
-- it is stale when it falls beyond that.
-- Two adjustments from the country's source row in the registry: a series marked not applicable for the country
-- (collection 'none', for example the parallel market premium where there is no parallel market) is never stale,
-- and a hand-entered series (collection 'manual') gets at least the monthly tolerance, since hand entries are
-- reviewed monthly whatever the indicator's nominal frequency. A source row can also carry its own tolerance_days
-- (for example 300 for a quarterly balance of payments series published a quarter late), which wins when set.
-- Needs the column: alter table source add column if not exists tolerance_days integer;
alter table source add column if not exists tolerance_days integer;

create or replace view series_status as
with s as (
  select o.iso3, o.indicator_code,
         min(o.obs_date) as first_obs, max(o.obs_date) as last_obs,
         count(distinct o.obs_date) as n_obs, max(o.vintage_date) as last_vintage
  from observation o
  group by 1, 2
),
src as (
  select distinct on (indicator_code, iso3) indicator_code, iso3, collection, status, tolerance_days
  from source
  order by indicator_code, iso3, id
)
select s.iso3, s.indicator_code, i.name, i.section_code, i.frequency,
       s.first_obs, s.last_obs, s.n_obs, s.last_vintage,
       (current_date - s.last_obs) as days_since_last,
       t.tolerance_days,
       case when t.tolerance_days is null then false else (current_date - s.last_obs) > t.tolerance_days end as stale
from s
join indicator i on i.code = s.indicator_code
left join src on src.indicator_code = s.indicator_code and src.iso3 = s.iso3
cross join lateral (
  select case
    when src.collection = 'none' or src.status = 'not applicable' then null
    when i.frequency ilike '%event%'       then null
    when i.frequency ilike '%biennial%'    then 900
    when i.frequency ilike '%semi-annual%' then 300
    when i.frequency ilike '%annual%'      then 540
    when i.frequency ilike '%quarterly%'   then 200
    when i.frequency ilike '%monthly%'     then 150
    when i.frequency ilike '%weekly%'      then 28
    when i.frequency ilike '%daily%'       then 14
    else 120 end as base_days
) b
cross join lateral (
  select case when b.base_days is null then null
              when src.tolerance_days is not null then src.tolerance_days
              when src.collection = 'manual' and b.base_days < 150 then 150
              else b.base_days end as tolerance_days
) t;

grant select on series_status to service_role;
