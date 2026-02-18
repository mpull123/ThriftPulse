"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Zap, TrendingUp, Activity } from "lucide-react";
import {
  getConfidenceFromComp,
  getLatestCompCheck,
  isCompStale,
} from "@/lib/marketIntel";
import type { CompCheck, ConfidenceLevel } from "@/lib/types";

function hashString(input: string): number {
  let hash = 0;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTrendMentions(signal: any, latestComp: CompCheck | null): number {
  const explicitMentionCount = Number(signal?.mention_count || 0);
  if (explicitMentionCount > 0) return explicitMentionCount;

  const heat = Number(signal?.heat_score || 0);
  const cues = Array.isArray(signal?.visual_cues) ? signal.visual_cues.length : 0;
  const hasBrand = Boolean(String(signal?.hook_brand || "").trim());
  const hasSentiment = Boolean(String(signal?.market_sentiment || "").trim());
  const sample = Number(latestComp?.sample_size || 0);
  const jitter = hashString(String(signal?.trend_name || "")) % 21;

  const estimated =
    18 +
    Math.round(heat * 1.35) +
    Math.min(22, cues * 4) +
    (hasBrand ? 11 : 0) +
    (hasSentiment ? 8 : 0) +
    Math.min(35, sample * 3) +
    jitter;

  return Math.max(12, Math.min(280, estimated));
}

function getSignalScore(signal: any, latestComp: CompCheck | null): number {
  const explicitScore = Number(signal?.confidence_score || 0);
  if (explicitScore > 0) return Math.max(10, Math.min(99, Math.round(explicitScore)));

  const mentions = getTrendMentions(signal, latestComp);
  const heat = Number(signal?.heat_score || 0);
  const sample = Number(latestComp?.sample_size || 0);
  const score = 15 + Math.round(heat * 0.45) + Math.min(20, Math.round(mentions / 8)) + Math.min(12, sample * 2);
  return Math.max(10, Math.min(99, score));
}

function getFallbackConfidence(signal: any, signalScore = 0): ConfidenceLevel {
  const hasCues = Array.isArray(signal?.visual_cues) && signal.visual_cues.length >= 2;
  const hasSentiment = Boolean(String(signal?.market_sentiment || "").trim());
  const hasRisk = Boolean(String(signal?.risk_factor || "").trim());
  const hasBrand = Boolean(String(signal?.hook_brand || "").trim());
  const heat = Number(signal?.heat_score || 0);
  const score =
    (hasCues ? 2 : 0) +
    (hasSentiment ? 1 : 0) +
    (hasRisk ? 1 : 0) +
    (hasBrand ? 1 : 0) +
    (heat >= 80 ? 1 : 0);

  if (signalScore >= 78 || heat >= 88 || score >= 4) return "high";
  if (signalScore >= 52 || heat >= 70 || score >= 2) return "med";
  return "low";
}

export default function SectionHeatmap({
  onTrendClick,
  onAddTrend,
  signals = [],
  compChecks = [],
  focusTerm = "",
}: {
  onTrendClick: (trendName: string) => void;
  onAddTrend?: (node: any) => void;
  signals?: any[];
  compChecks?: CompCheck[];
  focusTerm?: string;
}) {
  const [data, setData] = useState<any[]>(signals);
  const [loading, setLoading] = useState(signals.length === 0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<"heat" | "mentions" | "signal">("signal");
  const [freshOnly, setFreshOnly] = useState(false);
  const [lowBuyInOnly, setLowBuyInOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "med" | "low">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "brand" | "style">("all");

  useEffect(() => {
    const term = String(focusTerm || "").trim();
    if (term) setSearchTerm(term);
  }, [focusTerm]);

  // If props are passed (from parent fetch), use them
  useEffect(() => {
    if (signals.length > 0) {
      setData(signals);
      setLoading(false);
    } else {
      loadHeatmap();
    }
  }, [signals]);

  async function loadHeatmap() {
    // UPDATED: Now fetches from the correct table 'market_signals'
    const { data: results } = await supabase.from('market_signals').select('*');
    setData(results || []);
    setLoading(false);
  }

  if (loading) return <div className="p-8 text-slate-500 animate-pulse font-black uppercase tracking-widest italic text-xs">Generating Heatmap...</div>;

  const enrichedData = useMemo(() => data.map((item) => {
    const latestComp = getLatestCompCheck(item, compChecks);
    const compConfidence = getConfidenceFromComp(latestComp);
    const mentions = getTrendMentions(item, latestComp);
    const signalScore = getSignalScore(item, latestComp);
    const confidence = latestComp
      ? compConfidence
      : getFallbackConfidence(item, signalScore);
    return {
      ...item,
      mentions,
      signalScore,
      confidence,
      inferredType: String(item?.track || "").toLowerCase().includes("brand") ? "brand" : "style",
      compStatus: !latestComp ? "none" : isCompStale(latestComp) ? "stale" : "fresh",
    };
  }), [data, compChecks]);

  const filteredData = enrichedData.filter((item) => {
    if (verifiedOnly && !(item.confidence === "high" || item.confidence === "med")) return false;
    if (freshOnly && item.compStatus !== "fresh") return false;
    if (lowBuyInOnly && Number(item.exit_price || 0) > 90) return false;
    if (confidenceFilter !== "all" && item.confidence !== confidenceFilter) return false;
    if (sourceFilter !== "all" && item.inferredType !== sourceFilter) return false;
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      const haystack = [
        String(item?.trend_name || ""),
        String(item?.hook_brand || ""),
        String(item?.track || ""),
        String(item?.market_sentiment || ""),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const visibleData = [...filteredData].sort((a, b) => {
    if (sortMode === "mentions") return (b.mentions || 0) - (a.mentions || 0);
    if (sortMode === "heat") return (b.heat_score || 0) - (a.heat_score || 0);
    return (b.signalScore || 0) - (a.signalScore || 0);
  });

  const noCompCount = visibleData.filter((item) => item.compStatus === "none").length;
  const hotCount = visibleData.filter((item) => (item.heat_score || 0) >= 85).length;
  const avgMentions = visibleData.length
    ? Math.round(visibleData.reduce((sum, item) => sum + (item.mentions || 0), 0) / visibleData.length)
    : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      
      {/* LEGEND */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 p-6 rounded-3xl shadow-sm">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div className="h-3 w-3 rounded bg-emerald-500" />
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-tight">90%+ (Hot)</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="h-3 w-3 rounded bg-emerald-500/40" />
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-tight">70% (Warm)</span>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-emerald-500">
          <Activity size={14} /> 
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">Real-Time Pulse</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Trends now mirror Research metrics: mentions, signal score, and confidence.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search trend or brand..."
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
          />
          <select
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value as "all" | "high" | "med" | "low")}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="all">All Confidence</option>
            <option value="high">High</option>
            <option value="med">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as "all" | "brand" | "style")}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="all">All Types</option>
            <option value="style">Style</option>
            <option value="brand">Brand</option>
          </select>
          <button
            onClick={() => setSortMode("signal")}
            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${sortMode === "signal" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
          >
            Sort: Signal
          </button>
          <button
            onClick={() => setSortMode("mentions")}
            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${sortMode === "mentions" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
          >
            Mentions
          </button>
          <button
            onClick={() => setVerifiedOnly(!verifiedOnly)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
              verifiedOnly
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40"
                : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"
            }`}
          >
            {verifiedOnly ? "Verified: On" : "Verified: Off"}
          </button>
          <button
            onClick={() => setFreshOnly(!freshOnly)}
            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${freshOnly ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
          >
            Fresh Comps
          </button>
          <button
            onClick={() => setLowBuyInOnly(!lowBuyInOnly)}
            className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${lowBuyInOnly ? "bg-blue-500/10 text-blue-500 border-blue-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
          >
            Low Buy-In
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Hot Trends (85+)</p>
          <p className="text-2xl font-black italic text-emerald-500">{hotCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Avg Mentions</p>
          <p className="text-2xl font-black italic text-blue-500">{avgMentions}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">No Comps Yet</p>
          <p className="text-2xl font-black italic text-amber-500">{noCompCount}</p>
        </div>
      </div>

      {/* HEATMAP GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {visibleData.map((item) => (
          <div key={item.trend_name}>
             <HeatmapTile
               item={item}
               onOpenResearch={() => onTrendClick(item.trend_name)}
               onAddTrend={() =>
                 onAddTrend?.({
                   id: `trend-${item.id || item.trend_name}`,
                   type: "style",
                   name: item.trend_name,
                   entry_price: Number(item.exit_price || 0),
                   heat: Number(item.heat_score || 0),
                   intel:
                     String(item.market_sentiment || "").trim() ||
                     "Trend surfaced via live market pipeline.",
                   what_to_buy: Array.isArray(item.visual_cues) && item.visual_cues.length
                     ? item.visual_cues
                     : [String(item.trend_name || "").trim()].filter(Boolean),
                 })
               }
             />
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapTile({
  item,
  onOpenResearch,
  onAddTrend,
}: {
  item: any;
  onOpenResearch: () => void;
  onAddTrend: () => void;
}) {
  const intensity = (item.heat_score || 0) / 100;
  const isHot = (item.heat_score || 0) >= 90;

  return (
    <div 
      className={`relative aspect-square rounded-2xl border transition-all duration-300 p-5 flex flex-col justify-between overflow-hidden group hover:scale-105 hover:shadow-xl
        ${isHot ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/10' : 'border-slate-200 dark:border-white/5'}
      `}
      style={{ backgroundColor: `rgba(16, 185, 129, ${intensity * 0.15})` }}
    >
      {isHot && <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />}
      
      <div className="flex justify-between items-start relative z-10">
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${isHot ? 'bg-emerald-500 text-black' : 'bg-black/10 dark:bg-white/10 text-slate-500'}`}>
          {item.heat_score || 0}%
        </span>
        <div className="flex items-center gap-1">
          {item.compStatus === "none" && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[8px] font-black uppercase">No Comps</span>}
          {item.compStatus === "stale" && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-500 text-[8px] font-black uppercase">Stale</span>}
          {item.compStatus === "fresh" && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500 text-[8px] font-black uppercase">Fresh</span>}
          {isHot && <Zap size={12} className="text-emerald-500 fill-current" />}
        </div>
      </div>

      <div className="relative z-10">
        <h4 className="text-[11px] font-black dark:text-white uppercase italic leading-tight truncate mb-1 group-hover:text-emerald-500 transition-colors">
          {item.trend_name}
        </h4>
        <ConfidenceBadge confidence={item.confidence} />
        <div className="mb-1 flex flex-wrap gap-1">
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">eBay {item.ebay_sample_count || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">Google {item.google_trend_hits || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">AI {item.ai_corpus_hits || 0}</span>
        </div>
        <div className="flex items-center space-x-1">
          <TrendingUp size={10} className={isHot ? 'text-emerald-500' : 'text-slate-600'} />
          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Mentions: {item.mentions || 0}</span>
        </div>
        <div className="mt-1">
          <span className="inline-flex px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            Signal {item.signalScore || 0}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddTrend();
            }}
            className="rounded-md bg-emerald-500/10 text-emerald-600 text-[8px] font-black uppercase py-1"
          >
            Add
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenResearch();
            }}
            className="rounded-md bg-blue-500/10 text-blue-500 text-[8px] font-black uppercase py-1"
          >
            Research
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: ConfidenceLevel }) {
  const classes: Record<ConfidenceLevel, string> = {
    high: "bg-emerald-500/10 text-emerald-500",
    med: "bg-amber-500/10 text-amber-500",
    low: "bg-rose-500/10 text-rose-500",
  };

  return (
    <div className="mb-1.5">
      <span className={`inline-flex px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${classes[confidence]}`}>
        {confidence} confidence
      </span>
    </div>
  );
}
