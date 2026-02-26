-- TITLE: ONE-TIME MIGRATION - Add RSS Source Hit Columns To market_signals
-- RUN ONCE in Supabase SQL Editor before deploying the Sources page exact-count UI.

alter table public.market_signals
  add column if not exists fashion_rss_hits integer not null default 0;

alter table public.market_signals
  add column if not exists google_news_rss_hits integer not null default 0;

update public.market_signals
set
  fashion_rss_hits = coalesce(fashion_rss_hits, 0),
  google_news_rss_hits = coalesce(google_news_rss_hits, 0)
where fashion_rss_hits is null
   or google_news_rss_hits is null;
