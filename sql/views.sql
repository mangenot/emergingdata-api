-- EmergingData: series_status view, read by /api/status. Run once in the Supabase SQL Editor.
-- Tolerance before a series is called stale depends on the indicator's stated frequency. An observation is dated
-- the first day of its period and sources publish one to two months after the period, so a monthly series
-- normally sits 75 to 110 days behind today; it is stale when more than about a month late.
create or replace view series_status as
with s as (
  select o.iso3, o.indicator_code,
         min(o.obs_date) as first_obs, max(o.obs_date) as last_obs,
         count(distinct o.obs_date) as n_obs, max(o.vintage_date) as last_vintage
  from observation o
  group by 1, 2
)
select s.iso3, s.indicator_code, i.name, i.section_code, i.frequency,
       s.first_obs, s.last_obs, s.n_obs, s.last_vintage,
       (current_date - s.last_obs) as days_since_last,
       t.tolerance_days,
       case when t.tolerance_days is null then false else (current_date - s.last_obs) > t.tolerance_days end as stale
from s
join indicator i on i.code = s.indicator_code
cross join lateral (
  select case
    when i.frequency ilike '%event%'       then null
    when i.frequency ilike '%biennial%'    then 900
    when i.frequency ilike '%semi-annual%' then 300
    when i.frequency ilike '%annual%'      then 540
    when i.frequency ilike '%quarterly%'   then 200
    when i.frequency ilike '%monthly%'     then 120
    when i.frequency ilike '%weekly%'      then 28
    when i.frequency ilike '%daily%'       then 14
    else 120 end as tolerance_days
) t;

grant select on series_status to service_role;
