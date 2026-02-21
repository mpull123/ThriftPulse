export interface Mission {
  id: number;
  name: string;
  status: 'in_trunk' | 'washing' | 'listed' | 'sold';
  buy_price: number;
  est_sell: number;
  date?: string;
}

export interface Store {
  id: number;
  name: string;
  address: string;
  power_rank: number;
  type: string;
  best_time: string;
  matches: string[];
  coords: { top: string; left: string };
}

export interface TrunkItem {
  id: string;
  type: 'brand' | 'style';
  name: string;
  entry_price: number;
  heat: number;
  intel: string;
  what_to_buy?: string[];
  tags?: string[];
}

export interface TrendSignal {
  id: string;
  trend_name: string;
  heat_score: number;
  exit_price: number;
  momentum_index?: number;
}

export interface StyleProfile {
  item_type: "outerwear" | "bottoms" | "footwear" | "knitwear" | "bags" | "dress" | "top" | "mixed";
  styles_to_find: string[];
  find_these_first: string[];
  where_to_check_first: string[];
  pass_if: string[];
  confidence_note?: string;
}

export interface MarketSignal extends TrendSignal {
  track?: string | null;
  style_profile_json?: StyleProfile | null;
  style_profile_status?: "ok" | "invalid" | "missing" | "error" | null;
  style_profile_updated_at?: string | null;
  style_profile_error?: string | null;
}

export type ConfidenceLevel = "low" | "med" | "high";

export interface CompCheck {
  id: string;
  signal_id: string | null;
  trend_name: string | null;
  sample_size: number | null;
  checked_at: string | null;
  price_low: number | null;
  price_high: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CollectorJob {
  id: string;
  source_name: string;
  status: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
}
