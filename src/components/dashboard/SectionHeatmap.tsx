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
type DecisionLabel = "Buy" | "Maybe" | "Skip" | "Watchlist";
const HEATMAP_PRESET_STORAGE_KEY = "thriftpulse_trends_preset_v1";
const HEATMAP_PRESET_LIST_STORAGE_KEY = "thriftpulse_trends_presets_v1";
type HeatmapPresetPayload = {
  searchTerm: string;
  confidenceFilter: "all" | "high" | "med" | "low";
  sourceFilter: "all" | "brand" | "style";
  sortMode: "heat" | "mentions" | "signal";
  viewMode: "compact" | "detailed";
  verifiedOnly: boolean;
  freshOnly: boolean;
  lowBuyInOnly: boolean;
};
type HeatmapSavedPreset = {
  id: string;
  name: string;
  isDefault?: boolean;
  payload: HeatmapPresetPayload;
};

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

function toDollar(value: number): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function getConfidenceReason({
  latestComp,
  confidence,
  mentions,
}: {
  latestComp: CompCheck | null;
  confidence: ConfidenceLevel;
  mentions: number;
}): string {
  const sample = Number(latestComp?.sample_size || 0);
  if (!latestComp) {
    if (mentions >= 120) return "No comps yet, but strong mentions support monitoring.";
    return "No recent comp checks, so confidence stays lower.";
  }
  if (sample >= 8 && confidence === "high") return "Fresh comp sample supports high confidence.";
  if (sample >= 4 && confidence !== "low") return "Comp sample is moderate and usable.";
  return "Comp sample is limited, so confidence is capped.";
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildPriceSnapshot({
  exitPrice,
  confidence,
  mentions,
  latestComp,
}: {
  exitPrice: number;
  confidence: ConfidenceLevel;
  mentions: number;
  latestComp: CompCheck | null;
}) {
  const baseSale = Math.max(15, toDollar(exitPrice));
  const rangePct = confidence === "high" ? 0.08 : confidence === "med" ? 0.12 : 0.18;
  const saleLow = Math.max(10, toDollar(baseSale * (1 - rangePct)));
  const saleHigh = Math.max(saleLow, toDollar(baseSale * (1 + rangePct)));

  const feeRate = 0.13;
  const shippingCost = 7;
  const prepCost = 3;
  const netAfterFixed = Math.max(0, baseSale * (1 - feeRate) - shippingCost - prepCost);
  const targetBuy = Math.max(4, Math.min(60, toDollar(netAfterFixed * 0.65)));
  const expectedProfit = Math.max(0, toDollar(netAfterFixed - targetBuy));
  const weakEvidence = !latestComp && mentions < 80;

  let decision: DecisionLabel = "Maybe";
  if (weakEvidence) decision = "Watchlist";
  else if (expectedProfit >= 20) decision = "Buy";
  else if (expectedProfit < 10) decision = "Skip";

  return { saleLow, saleHigh, targetBuy, expectedProfit, decision };
}

export default function SectionHeatmap({
  onTrendClick,
  onAddTrend,
  signals = [],
  compChecks = [],
  focusTerm = "",
}: {
  onTrendClick: (trendName: string, signalId?: string) => void;
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
  const [viewMode, setViewMode] = useState<"compact" | "detailed">("detailed");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<"profit" | "risk" | "velocity">("velocity");
  const [savedPresets, setSavedPresets] = useState<HeatmapSavedPreset[]>([]);
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    const term = String(focusTerm || "").trim();
    if (term) setSearchTerm(term);
  }, [focusTerm]);

  useEffect(() => {
    try {
      const listRaw = localStorage.getItem(HEATMAP_PRESET_LIST_STORAGE_KEY);
      let defaultPresetPayload: HeatmapPresetPayload | null = null;
      if (listRaw) {
        const list = JSON.parse(listRaw) as HeatmapSavedPreset[];
        const safeList = Array.isArray(list) ? list : [];
        setSavedPresets(safeList);
        const defaultPreset = safeList.find((p) => p.isDefault && p.payload);
        defaultPresetPayload = defaultPreset?.payload || null;
      }

      const raw = localStorage.getItem(HEATMAP_PRESET_STORAGE_KEY);
      if (defaultPresetPayload) {
        applyPresetPayload(defaultPresetPayload);
      } else if (raw) {
        const preset = JSON.parse(raw);
        applyPresetPayload(preset);
      } else {
        setConfidenceFilter("high");
      }
    } catch {
      setConfidenceFilter("high");
    }
  }, []);

  const applyPresetPayload = (payload: HeatmapPresetPayload) => {
    setSearchTerm(String(payload.searchTerm || ""));
    setConfidenceFilter(payload.confidenceFilter || "all");
    setSourceFilter(payload.sourceFilter || "all");
    setSortMode(payload.sortMode || "signal");
    setViewMode(payload.viewMode || "detailed");
    setVerifiedOnly(Boolean(payload.verifiedOnly));
    setFreshOnly(Boolean(payload.freshOnly));
    setLowBuyInOnly(Boolean(payload.lowBuyInOnly));
    setCompareIds([]);
  };

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
    const pricing = buildPriceSnapshot({
      exitPrice: Number(item?.exit_price || 0),
      confidence,
      mentions,
      latestComp,
    });
    return {
      ...item,
      mentions,
      signalScore,
      confidence,
      confidenceReason: getConfidenceReason({ latestComp, confidence, mentions }),
      pricing,
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
  const comparedItems = visibleData.filter((item) => compareIds.includes(String(item.id || item.trend_name)));
  const confidenceToScore = (confidence: ConfidenceLevel | string | undefined) =>
    confidence === "high" ? 3 : confidence === "med" ? 2 : 1;
  const recommendation = useMemo(() => {
    if (!comparedItems.length) return "";
    const ranked = [...comparedItems]
      .map((item) => {
        const profitScore = Number(item?.pricing?.expectedProfit || 0) + (60 - Number(item?.pricing?.targetBuy || 60));
        const riskScore = confidenceToScore(item?.confidence) * 20 + (item?.compStatus === "fresh" ? 15 : item?.compStatus === "stale" ? 5 : 0);
        const velocityScore = Number(item?.heat_score || 0) + Number(item?.mentions || 0) * 0.15 + Number(item?.signalScore || 0) * 0.4;
        const total = compareMode === "profit" ? profitScore : compareMode === "risk" ? riskScore : velocityScore;
        return { item, total };
      })
      .sort((a, b) => b.total - a.total);
    return ranked[0]?.item?.trend_name ? `Best ${compareMode} pick: ${ranked[0].item.trend_name}` : "";
  }, [comparedItems, compareMode]);

  const toggleCompare = (item: any) => {
    const id = String(item.id || item.trend_name);
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((v) => v !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const applyPreset = (preset: "high_confidence" | "low_buy_in" | "quick_flips" | "vintage") => {
    setCompareIds([]);
    if (preset === "high_confidence") {
      setSearchTerm("");
      setConfidenceFilter("high");
      setSourceFilter("all");
      setSortMode("signal");
      setVerifiedOnly(true);
      setFreshOnly(false);
      setLowBuyInOnly(false);
      return;
    }
    if (preset === "low_buy_in") {
      setSearchTerm("");
      setConfidenceFilter("all");
      setSourceFilter("style");
      setSortMode("signal");
      setVerifiedOnly(false);
      setFreshOnly(false);
      setLowBuyInOnly(true);
      return;
    }
    if (preset === "quick_flips") {
      setSearchTerm("");
      setConfidenceFilter("med");
      setSourceFilter("style");
      setSortMode("mentions");
      setVerifiedOnly(true);
      setFreshOnly(false);
      setLowBuyInOnly(true);
      return;
    }
    setSearchTerm("vintage 90s y2k");
    setConfidenceFilter("all");
    setSourceFilter("all");
    setSortMode("heat");
    setVerifiedOnly(false);
    setFreshOnly(false);
    setLowBuyInOnly(false);
  };

  const saveCurrentPreset = () => {
    const payload: HeatmapPresetPayload = {
      searchTerm,
      confidenceFilter,
      sourceFilter,
      sortMode,
      viewMode,
      verifiedOnly,
      freshOnly,
      lowBuyInOnly,
    };
    localStorage.setItem(HEATMAP_PRESET_STORAGE_KEY, JSON.stringify(payload));
  };

  const persistPresetList = (next: HeatmapSavedPreset[]) => {
    setSavedPresets(next);
    localStorage.setItem(HEATMAP_PRESET_LIST_STORAGE_KEY, JSON.stringify(next));
  };

  const saveNamedPreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const payload: HeatmapPresetPayload = {
      searchTerm,
      confidenceFilter,
      sourceFilter,
      sortMode,
      viewMode,
      verifiedOnly,
      freshOnly,
      lowBuyInOnly,
    };
    const next = [
      ...savedPresets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()),
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, payload, isDefault: false },
    ];
    persistPresetList(next);
    setPresetName("");
  };

  const applyNamedPreset = (preset: HeatmapSavedPreset) => {
    applyPresetPayload(preset.payload);
    localStorage.setItem(HEATMAP_PRESET_STORAGE_KEY, JSON.stringify(preset.payload));
  };

  const deleteNamedPreset = (id: string) => {
    persistPresetList(savedPresets.filter((p) => p.id !== id));
  };

  const setDefaultPreset = (id: string) => {
    const next = savedPresets.map((p) => ({ ...p, isDefault: p.id === id }));
    persistPresetList(next);
  };

  const resetToSystemDefault = () => {
    localStorage.removeItem(HEATMAP_PRESET_STORAGE_KEY);
    localStorage.removeItem(HEATMAP_PRESET_LIST_STORAGE_KEY);
    setSavedPresets([]);
    setPresetName("");
    applyPresetPayload({
      searchTerm: "",
      confidenceFilter: "high",
      sourceFilter: "all",
      sortMode: "signal",
      viewMode: "detailed",
      verifiedOnly: false,
      freshOnly: false,
      lowBuyInOnly: false,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">Radar</p>
        <p className="text-sm font-bold italic text-slate-600 dark:text-slate-300 mt-1">
          Scan what is emerging, rising, or cooling before promoting it into Decision Lab.
        </p>
      </div>
      
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
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as "compact" | "detailed")}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
          >
            <option value="detailed">Detailed</option>
            <option value="compact">Compact</option>
          </select>
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
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        Compare selected: {compareIds.length}/4
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => applyPreset("high_confidence")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600">High Confidence</button>
        <button onClick={() => applyPreset("low_buy_in")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-blue-500/10 text-blue-500">Low Buy-In</button>
        <button onClick={() => applyPreset("quick_flips")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-amber-500/10 text-amber-600">Quick Flips</button>
        <button onClick={() => applyPreset("vintage")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-purple-500/10 text-purple-500">Vintage</button>
        <button onClick={saveCurrentPreset} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 text-white dark:bg-white dark:text-slate-900">Save Current Preset</button>
        <button onClick={() => setShowPresetManager(true)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Manage Presets</button>
      </div>

      {showPresetManager && (
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h5 className="text-xs font-black uppercase tracking-widest text-slate-500">Trends Preset Manager</h5>
            <button onClick={() => setShowPresetManager(false)} className="text-[10px] font-black uppercase text-rose-500">Close</button>
          </div>
          <div className="flex gap-2 mb-4">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase"
            />
            <button onClick={saveNamedPreset} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 text-white dark:bg-white dark:text-slate-900">Save As</button>
            <button onClick={resetToSystemDefault} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-rose-500/10 text-rose-500">Reset to System Default</button>
          </div>
          <div className="space-y-2">
            {savedPresets.length === 0 && <p className="text-[10px] font-black uppercase text-slate-400">No saved presets yet.</p>}
            {savedPresets.map((preset) => (
              <div key={preset.id} className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
                <p className="text-xs font-black uppercase text-slate-700 dark:text-slate-200">
                  {preset.name} {preset.isDefault ? "(Default)" : ""}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => applyNamedPreset(preset)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600">Apply</button>
                  <button onClick={() => setDefaultPreset(preset.id)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-blue-500/10 text-blue-500">Default</button>
                  <button onClick={() => deleteNamedPreset(preset.id)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-rose-500/10 text-rose-500">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {comparedItems.length > 0 && (
        <div className="rounded-3xl border border-blue-500/30 bg-blue-500/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Trend Compare ({comparedItems.length})</p>
            <div className="flex items-center gap-2">
              <select
                value={compareMode}
                onChange={(e) => setCompareMode(e.target.value as "profit" | "risk" | "velocity")}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
              >
                <option value="velocity">Velocity</option>
                <option value="risk">Risk</option>
                <option value="profit">Profit</option>
              </select>
              <button onClick={() => setCompareIds([])} className="text-[10px] font-black uppercase text-rose-500">Clear</button>
            </div>
          </div>
          {recommendation && <p className="mb-3 text-[11px] font-black uppercase tracking-widest text-blue-600">{recommendation}</p>}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-slate-500 uppercase">Metric</th>
                  {comparedItems.map((item) => (
                    <th key={`h-${item.id || item.trend_name}`} className="px-3 py-2 text-slate-700 dark:text-slate-200 uppercase">{item.trend_name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "confidence", label: "Confidence", higher: true, value: (n: any) => confidenceToScore(n.confidence), format: (n: any) => String(n.confidence || "low").toUpperCase() },
                  { key: "heat", label: "Heat", higher: true, value: (n: any) => Number(n.heat_score || 0), format: (n: any) => `${Number(n.heat_score || 0)}` },
                  { key: "mentions", label: "Mentions", higher: true, value: (n: any) => Number(n.mentions || 0), format: (n: any) => `${Number(n.mentions || 0)}` },
                  { key: "buy", label: "Target Buy", higher: false, value: (n: any) => Number(n.pricing?.targetBuy || 0), format: (n: any) => `$${Number(n.pricing?.targetBuy || 0)}` },
                  { key: "net", label: "Expected Net", higher: true, value: (n: any) => Number(n.pricing?.expectedProfit || 0), format: (n: any) => `$${Number(n.pricing?.expectedProfit || 0)}` },
                ].map((row) => {
                  const values = comparedItems.map((n: any) => row.value(n));
                  const best = row.higher ? Math.max(...values) : Math.min(...values);
                  return (
                    <tr key={row.key} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-3 py-2 font-black uppercase text-slate-500">{row.label}</td>
                      {comparedItems.map((item) => {
                        const val = row.value(item);
                        const delta = row.higher ? val - best : best - val;
                        return (
                          <td key={`${row.key}-${item.id || item.trend_name}`} className={`px-3 py-2 font-bold ${val === best ? "text-emerald-500" : "text-slate-600 dark:text-slate-300"}`}>
                            {row.format(item)} {delta !== 0 ? <span className="text-[10px] text-slate-400">({row.higher ? "-" : "+"}{Math.abs(delta)})</span> : ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HEATMAP GRID */}
      <div className={`grid ${viewMode === "compact" ? "grid-cols-2 md:grid-cols-4 lg:grid-cols-6" : "grid-cols-1 md:grid-cols-3 lg:grid-cols-4"} gap-3`}>
        {visibleData.map((item) => (
          <div key={item.trend_name}>
             <HeatmapTile
               item={item}
               viewMode={viewMode}
               isCompared={compareIds.includes(String(item.id || item.trend_name))}
               onToggleCompare={() => toggleCompare(item)}
               onOpenResearch={() => onTrendClick(item.trend_name, String(item.id || ""))}
               onAddTrend={() =>
                 onAddTrend?.({
                   id: `trend-${item.id || item.trend_name}`,
                   type: "style",
                   name: item.trend_name,
                   entry_price: Number(item.exit_price || 0),
                   target_buy: Number(item.pricing?.targetBuy || 0),
                   expected_sale: Number(item.exit_price || 0),
                   expected_sale_low: Number(item.pricing?.saleLow || 0),
                   expected_sale_high: Number(item.pricing?.saleHigh || 0),
                   expected_profit: Number(item.pricing?.expectedProfit || 0),
                   heat: Number(item.heat_score || 0),
                   decision: item.pricing?.decision,
                   confidence: item.confidence,
                   confidence_reason: item.confidenceReason,
                   source_counts: {
                     ebay: Number(item?.ebay_sample_count || 0),
                     google: Number(item?.google_trend_hits || 0),
                     ai: Number(item?.ai_corpus_hits || 0),
                   },
                   pricing_assumptions: "Assumes 13% fees, $7 shipping, $3 prep, used-condition pricing.",
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
  viewMode,
  isCompared,
  onToggleCompare,
  onOpenResearch,
  onAddTrend,
}: {
  item: any;
  viewMode: "compact" | "detailed";
  isCompared: boolean;
  onToggleCompare: () => void;
  onOpenResearch: () => void;
  onAddTrend: () => void;
}) {
  const intensity = (item.heat_score || 0) / 100;
  const isHot = (item.heat_score || 0) >= 90;

  return (
    <div 
      className={`relative ${viewMode === "compact" ? "aspect-square" : "aspect-auto min-h-[280px]"} rounded-2xl border transition-all duration-300 p-5 flex flex-col justify-between overflow-hidden group hover:scale-105 hover:shadow-xl
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
        <div className="mb-1">
          <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-rose-500/10 text-rose-500">
            Radar
          </span>
        </div>
        <div className="mb-1">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
            item.pricing?.decision === "Buy"
              ? "bg-emerald-500/10 text-emerald-500"
              : item.pricing?.decision === "Watchlist"
                ? "bg-blue-500/10 text-blue-500"
                : item.pricing?.decision === "Skip"
                  ? "bg-rose-500/10 text-rose-500"
                  : "bg-amber-500/10 text-amber-500"
          }`}>
            {item.pricing?.decision || "Maybe"}
          </span>
        </div>
        <div className="mb-1 flex flex-wrap gap-1">
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">eBay {item.ebay_sample_count || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">Google {item.google_trend_hits || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">AI {item.ai_corpus_hits || 0}</span>
        </div>
        <div className="flex items-center space-x-1">
          <TrendingUp size={10} className={isHot ? 'text-emerald-500' : 'text-slate-600'} />
          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Mentions: {item.mentions || 0}</span>
        </div>
        <p className="mt-1 text-[8px] font-black uppercase tracking-wider text-slate-500">
          Buy ≤ ${item.pricing?.targetBuy || 0} • Sale ${item.pricing?.saleLow || 0}-${item.pricing?.saleHigh || 0}
        </p>
        {viewMode === "detailed" && (
          <p className="mt-1 text-[8px] font-bold text-slate-500 line-clamp-2">
            {item.confidenceReason}
          </p>
        )}
        <div className="mt-1">
          <span className="inline-flex px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            Signal {item.signalScore || 0}
          </span>
          <span className="ml-1 inline-flex px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            Updated {formatDateLabel(item.updated_at)}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
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
            Promote
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCompare();
            }}
            className={`rounded-md text-[8px] font-black uppercase py-1 ${
              isCompared ? "bg-blue-500/15 text-blue-500" : "bg-slate-900/10 dark:bg-white/10 text-slate-600 dark:text-slate-300"
            }`}
          >
            {isCompared ? "Compared" : "Compare"}
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
