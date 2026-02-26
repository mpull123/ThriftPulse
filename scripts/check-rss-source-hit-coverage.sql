-- TITLE: READ ONLY CHECK - RSS/News Source Hit Coverage (post-sync)
-- Safe to run any time. Best run after the migration and one sync cycle.

-- 1) Schema check (columns present)
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'market_signals'
  and column_name in ('fashion_rss_hits', 'google_news_rss_hits')
order by column_name;

-- 2) Active signal coverage by source-hit column
select
  count(*) filter (where archived_at is null) as active_total,
  count(*) filter (where archived_at is null and coalesce(fashion_rss_hits, 0) > 0) as fashion_rss_active,
  count(*) filter (where archived_at is null and coalesce(google_news_rss_hits, 0) > 0) as google_news_rss_active,
  count(*) filter (where archived_at is null and coalesce(google_trend_hits, 0) > 0) as google_trends_active,
  count(*) filter (where archived_at is null and coalesce(ai_corpus_hits, 0) > 0) as fashion_corpus_ai_active,
  count(*) filter (where archived_at is null and coalesce(ebay_discovery_hits, 0) > 0) as ebay_discovery_active,
  count(*) filter (where archived_at is null and coalesce(ebay_sample_count, 0) > 0) as ebay_comp_signals_active
from public.market_signals;

-- 3) Spot check recent rows to confirm writes are landing
select
  trend_name,
  track,
  fashion_rss_hits,
  google_news_rss_hits,
  google_trend_hits,
  ai_corpus_hits,
  ebay_discovery_hits,
  ebay_sample_count,
  updated_at
from public.market_signals
where archived_at is null
order by updated_at desc
limit 50;
