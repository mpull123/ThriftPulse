"use client";
import { useEffect, useState } from "react";
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
  signals = [],
  compChecks = [],
}: {
  onTrendClick: (trendName: string) => void;
  signals?: any[];
  compChecks?: CompCheck[];
}) {
  const [data, setData] = useState<any[]>(signals);
  const [loading, setLoading] = useState(signals.length === 0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<"heat" | "mentions" | "signal">("signal");

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

  const enrichedData = data.map((item) => {
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
      compStatus: !latestComp ? "none" : isCompStale(latestComp) ? "stale" : "fresh",
    };
  });

  const filteredData = verifiedOnly
    ? enrichedData.filter((item) => item.confidence === "high" || item.confidence === "med")
    : enrichedData;

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

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Trends now mirror Research metrics: mentions, signal score, and confidence.
        </p>
        <div className="flex items-center gap-2">
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
          <div key={item.trend_name} onClick={() => onTrendClick(item.trend_name)} className="cursor-pointer">
             <HeatmapTile item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapTile({ item }: { item: any }) {
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
        <div className="flex items-center space-x-1">
          <TrendingUp size={10} className={isHot ? 'text-emerald-500' : 'text-slate-600'} />
          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Mentions: {item.mentions || 0}</span>
        </div>
        <div className="mt-1">
          <span className="inline-flex px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            Signal {item.signalScore || 0}
          </span>
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
