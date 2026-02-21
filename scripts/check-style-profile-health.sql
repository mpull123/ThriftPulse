-- Health check for AI-generated style profile coverage.
select
  coalesce(style_profile_status, 'missing') as style_profile_status,
  count(*) as count_rows
from market_signals
where lower(coalesce(track, '')) not like '%brand%'
group by coalesce(style_profile_status, 'missing')
order by count_rows desc;

-- Freshness snapshot.
select
  count(*) as total_style_rows,
  count(*) filter (where style_profile_json is not null) as with_profile_json,
  count(*) filter (where coalesce(style_profile_status, '') = 'ok') as status_ok,
  count(*) filter (
    where style_profile_updated_at >= now() - interval '14 days'
  ) as updated_last_14_days
from market_signals
where lower(coalesce(track, '')) not like '%brand%';

-- QA list for non-ok rows.
select
  id,
  trend_name,
  track,
  style_profile_status,
  style_profile_error,
  style_profile_updated_at
from market_signals
where lower(coalesce(track, '')) not like '%brand%'
  and coalesce(style_profile_status, 'missing') <> 'ok'
order by updated_at desc
limit 50;
