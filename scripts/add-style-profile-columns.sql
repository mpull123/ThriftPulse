-- One-time schema update for AI-generated style card profile sections.
alter table market_signals
  add column if not exists style_profile_json jsonb,
  add column if not exists style_profile_version text,
  add column if not exists style_profile_updated_at timestamptz,
  add column if not exists style_profile_status text,
  add column if not exists style_profile_error text;
