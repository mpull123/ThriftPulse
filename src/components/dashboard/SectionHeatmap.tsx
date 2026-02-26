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
type ActionBand = "Green" | "Yellow" | "Red";
const HEATMAP_PRESET_STORAGE_KEY = "thriftpulse_trends_preset_v1";
const HEATMAP_PRESET_LIST_STORAGE_KEY = "thriftpulse_trends_presets_v1";
type HeatmapPresetPayload = {
  searchTerm: string;
  confidenceFilter: "all" | "high" | "med" | "low";
  sourceFilter: "all" | "brand" | "style";
  styleTierFilter: "all" | "core" | "niche";
  sortMode: "heat" | "mentions" | "signal";
  viewMode: "compact" | "detailed";
  verifiedOnly: boolean;
  freshOnly: boolean;
  lowBuyInOnly: boolean;
  cardLimit: 40 | 80 | 120 | 200;
};
type HeatmapSavedPreset = {
  id: string;
  name: string;
  isDefault?: boolean;
  payload: HeatmapPresetPayload;
};

const RADAR_SIMILARITY_STOP_WORDS = new Set([
  "a",
  "all",
  "and",
  "anti",
  "are",
  "bag",
  "best",
  "but",
  "by",
  "celeb",
  "celebs",
  "circuit",
  "cool",
  "editor",
  "editors",
  "everyone",
  "exactly",
  "favorite",
  "favorites",
  "fashion",
  "found",
  "from",
  "get",
  "guys",
  "here",
  "how",
  "in",
  "is",
  "it",
  "its",
  "look",
  "looks",
  "most",
  "new",
  "obsession",
  "of",
  "on",
  "our",
  "outfit",
  "outfits",
  "pair",
  "pairs",
  "popularity",
  "rise",
  "shopping",
  "spring",
  "still",
  "street",
  "style",
  "styling",
  "summer",
  "that",
  "the",
  "these",
  "this",
  "to",
  "top",
  "trend",
  "trends",
  "ways",
  "wear",
  "wearing",
  "why",
  "winter",
  "with",
  "worth",
  "year",
]);

const RADAR_ITEM_FAMILY_TOKENS = [
  "jacket",
  "coat",
  "pants",
  "trouser",
  "jean",
  "skirt",
  "dress",
  "hoodie",
  "sweatshirt",
  "sweater",
  "cardigan",
  "boot",
  "sneaker",
  "shoe",
  "bag",
  "tote",
  "backpack",
  "vest",
  "shirt",
  "tee",
];

function tokenizeRadarSimilarity(text: string): string[] {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bt[\s-]?shirt\b/g, " tshirt ")
    .replace(/\btee\b/g, " tshirt ")
    .replace(/\bhigh[\s-]?waisted\b/g, " highwaisted ")
    .replace(/\bwide[\s-]?leg\b/g, " wideleg ")
    .replace(/\bdouble[\s-]?knee\b/g, " doubleknee ")
    .replace(/\bslip[\s-]?on\b/g, " slipon ")
    .replace(/\b90'?s\b/g, " 90s ")
    .replace(/[^a-z0-9\s]/g, " ");

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^(19|20)\d{2}$/.test(token))
    .filter((token) => !RADAR_SIMILARITY_STOP_WORDS.has(token))
    .map((token) => {
      if (token === "sneakers") return "sneaker";
      if (token === "boots") return "boot";
      if (token === "shoes") return "shoe";
      if (token === "pants") return "pant";
      if (token === "trousers") return "trouser";
      if (token === "jeans") return "jean";
      if (token === "bags") return "bag";
      if (token === "dresses") return "dress";
      if (token.endsWith("s") && token.length > 4 && !token.endsWith("ss")) return token.slice(0, -1);
      return token;
    })
    .filter((token) => token.length > 1);

  return [...new Set(tokens)];
}

function getRadarBrandKey(item: any): string {
  const hookBrand = tokenizeRadarSimilarity(String(item?.hook_brand || "")).join(" ");
  if (hookBrand) return hookBrand;
  const titleTokens = tokenizeRadarSimilarity(String(item?.trend_name || ""));
  const candidate = titleTokens.filter((token) =>
    [
      "nike",
      "adidas",
      "reebok",
      "puma",
      "carhartt",
      "patagonia",
      "salomon",
      "new",
      "balance",
      "gucci",
      "bottega",
      "veneta",
      "forever",
      "missguided",
      "levi",
      "levis",
      "north",
      "face",
    ].includes(token)
  );
  return candidate.join(" ");
}

function getRadarSimilarityTokens(item: any): string[] {
  const titleTokens = tokenizeRadarSimilarity(String(item?.trend_name || ""));
  const hookTokens = tokenizeRadarSimilarity(String(item?.hook_brand || ""));
  return [...new Set([...hookTokens, ...titleTokens])];
}

function getRadarItemFamily(item: any): string {
  const tokens = getRadarSimilarityTokens(item);
  const family = RADAR_ITEM_FAMILY_TOKENS.find((token) => tokens.includes(token) || (token === "pants" && tokens.includes("pant")));
  if (family === "pants") return "pant";
  return family || "";
}

function areRadarItemsSimilar(a: any, b: any): boolean {
  if (String(a?.inferredType || "") !== String(b?.inferredType || "")) return false;

  const brandA = getRadarBrandKey(a);
  const brandB = getRadarBrandKey(b);
  if (brandA && brandB && brandA !== brandB) return false;

  const familyA = getRadarItemFamily(a);
  const familyB = getRadarItemFamily(b);
  if (familyA && familyB && familyA !== familyB) return false;

  const tokensA = getRadarSimilarityTokens(a);
  const tokensB = getRadarSimilarityTokens(b);
  if (tokensA.length < 2 || tokensB.length < 2) return false;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }

  const smaller = Math.max(1, Math.min(setA.size, setB.size));
  const overlapRatio = overlap / smaller;
  return overlapRatio >= 0.8;
}

function dedupeSimilarRadarItems(items: any[]): { items: any[]; hiddenCount: number } {
  const kept: any[] = [];
  let hiddenCount = 0;
  for (const item of items) {
    const isSimilar = kept.some((existing) => areRadarItemsSimilar(existing, item));
    if (isSimilar) {
      hiddenCount += 1;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, hiddenCount };
}

function getStoredMentionCount(signal: any): number | null {
  const raw = signal?.mention_count;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function getStoredSignalScore(signal: any): number | null {
  const raw = signal?.confidence_score;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(10, Math.min(99, Math.round(n)));
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

function getCompDepthScore(ebayCount: number): number {
  const n = Number(ebayCount || 0);
  if (n >= 160) return 5;
  if (n >= 90) return 4;
  if (n >= 40) return 3;
  if (n >= 12) return 2;
  if (n > 0) return 1;
  return 0;
}

function getCompDepthLabel(ebayCount: number): string {
  const score = getCompDepthScore(ebayCount);
  if (score === 5) return "Deep";
  if (score === 4) return "Strong";
  if (score === 3) return "Usable";
  if (score === 2) return "Light";
  if (score === 1) return "Thin";
  return "None";
}

function getSourceTypeCount(item: any): number {
  return (
    (Number(item?.ebay_sample_count || 0) > 0 ? 1 : 0) +
    (Number(item?.google_trend_hits || 0) > 0 ? 1 : 0) +
    (Number(item?.ai_corpus_hits || 0) > 0 ? 1 : 0) +
    (Number(item?.ebay_discovery_hits || 0) > 0 ? 1 : 0)
  );
}

function getSourceMixLabel(item: any): string {
  const types = getSourceTypeCount(item);
  if (types >= 3) return "Broad";
  if (types === 2) return "Multi";
  if (types === 1) return "Single";
  return "None";
}

function getActionBand(score: number): ActionBand {
  if (score >= 75) return "Green";
  if (score >= 55) return "Yellow";
  return "Red";
}

function getActionRecommendation(score: number): "Buy Now" | "Buy If Cheap" | "Watch" | "Pass" {
  if (score >= 85) return "Buy Now";
  if (score >= 70) return "Buy If Cheap";
  if (score >= 50) return "Watch";
  return "Pass";
}

function getActionBandClasses(band: ActionBand): string {
  if (band === "Green") return "bg-emerald-500/10 text-emerald-500";
  if (band === "Yellow") return "bg-amber-500/10 text-amber-500";
  return "bg-rose-500/10 text-rose-500";
}

function buildActionRating({
  confidence,
  compStatus,
  compDepthScore,
  sourceTypeCount,
  expectedProfit,
  expectedSale,
  targetBuy,
  heat,
  riskText,
}: {
  confidence: ConfidenceLevel;
  compStatus: "fresh" | "stale" | "none";
  compDepthScore: number;
  sourceTypeCount: number;
  expectedProfit: number;
  expectedSale: number;
  targetBuy: number;
  heat: number;
  riskText: string;
}) {
  const compFreshnessPoints = compStatus === "fresh" ? 12 : compStatus === "stale" ? 6 : 2;
  const sourceConfidence = Math.min(30, compFreshnessPoints + compDepthScore * 3 + Math.min(3, sourceTypeCount) * 3);

  const marginPct = expectedSale > 0 ? expectedProfit / expectedSale : 0;
  const marginStrength =
    Math.max(0, Math.min(30, Math.round(marginPct * 60) + Math.min(12, Math.round(expectedProfit / 2)) + (targetBuy <= 25 ? 4 : 0)));

  const confidenceBonus = confidence === "high" ? 4 : confidence === "med" ? 2 : 0;
  const sellSpeed = Math.max(0, Math.min(20, Math.round(heat * 0.14) + confidenceBonus));

  const riskTerms = String(riskText || "").toLowerCase();
  const risky =
    riskTerms.includes("replica") ||
    riskTerms.includes("auth") ||
    riskTerms.includes("counterfeit") ||
    riskTerms.includes("fake");
  const riskPenalty = Math.max(0, Math.min(20, (risky ? 10 : 0) + (confidence === "low" ? 6 : 0) + (compStatus === "none" ? 4 : 0)));

  const score = Math.max(0, Math.min(100, sourceConfidence + marginStrength + sellSpeed - riskPenalty));
  const band = getActionBand(score);
  const recommendation = getActionRecommendation(score);

  const reasons = [
    compStatus === "fresh" ? "Fresh comps" : compStatus === "stale" ? "Stale comps" : "No comps",
    marginStrength >= 20 ? "Strong margin" : marginStrength >= 12 ? "Fair margin" : "Thin margin",
    riskPenalty <= 6 ? "Lower risk" : "Higher risk",
  ];

  return { score, band, recommendation, reasons };
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
  mentions: number | null;
  latestComp: CompCheck | null;
}) {
  const compLow = Number(latestComp?.price_low || 0);
  const compHigh = Number(latestComp?.price_high || 0);
  const compMid =
    compLow > 0 && compHigh > 0
      ? (compLow + compHigh) / 2
      : compHigh > 0
        ? compHigh
        : compLow > 0
          ? compLow
          : 0;
  const baseSale = Math.max(15, toDollar(compMid > 0 ? compMid : exitPrice));
  const rangePct = confidence === "high" ? 0.08 : confidence === "med" ? 0.12 : 0.18;
  const saleLow = Math.max(10, toDollar(baseSale * (1 - rangePct)));
  const saleHigh = Math.max(saleLow, toDollar(baseSale * (1 + rangePct)));

  const feeRate = 0.13;
  const shippingCost = 7;
  const prepCost = 3;
  const netAfterFixed = Math.max(0, baseSale * (1 - feeRate) - shippingCost - prepCost);
  const targetBuy = Math.max(4, Math.min(60, toDollar(netAfterFixed * 0.65)));
  const expectedProfit = Math.max(0, toDollar(netAfterFixed - targetBuy));
  const weakEvidence = !latestComp && (mentions === null || mentions < 80);

  let decision: DecisionLabel = "Maybe";
  if (weakEvidence) decision = "Watchlist";
  else if (expectedProfit >= 20) decision = "Buy";
  else if (expectedProfit < 10) decision = "Skip";

  return { saleLow, saleHigh, targetBuy, expectedProfit, decision };
}

export default function SectionHeatmap({
  onTrendClick,
  onAddTrend,
  onPromoteTrend,
  signals = [],
  compChecks = [],
  focusTerm = "",
}: {
  onTrendClick: (trendName: string, signalId?: string) => void;
  onAddTrend?: (node: any) => void;
  onPromoteTrend?: (signalId?: string) => void;
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
  const [styleTierFilter, setStyleTierFilter] = useState<"all" | "core" | "niche">("all");
  const [viewMode, setViewMode] = useState<"compact" | "detailed">("detailed");
  const [cardLimit, setCardLimit] = useState<40 | 80 | 120 | 200>(80);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<"profit" | "risk" | "velocity">("velocity");
  const [savedPresets, setSavedPresets] = useState<HeatmapSavedPreset[]>([]);
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [hideSimilarCards, setHideSimilarCards] = useState(true);

  useEffect(() => {
    const term = String(focusTerm || "").trim();
    setSearchTerm(term);
  }, [focusTerm]);

  useEffect(() => {
    setCompareIds([]);
    setActionNotice("");
  }, [hideSimilarCards]);

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
    setStyleTierFilter(payload.styleTierFilter || "all");
    setSortMode(payload.sortMode || "signal");
    setViewMode(payload.viewMode || "detailed");
    setVerifiedOnly(Boolean(payload.verifiedOnly));
    setFreshOnly(Boolean(payload.freshOnly));
    setLowBuyInOnly(Boolean(payload.lowBuyInOnly));
    setCardLimit(payload.cardLimit || 80);
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
    const mentions = getStoredMentionCount(item);
    const signalScore = getStoredSignalScore(item);
    const confidence = latestComp
      ? compConfidence
      : signalScore !== null
        ? getFallbackConfidence(item, signalScore)
        : "low";
    const pricing = buildPriceSnapshot({
      exitPrice: Number(item?.exit_price || 0),
      confidence,
      mentions,
      latestComp,
    });
    const compStatus = !latestComp ? "none" : isCompStale(latestComp) ? "stale" : "fresh";
    const compDepthScore = getCompDepthScore(Number(item?.ebay_sample_count || 0));
    const sourceTypeCount = getSourceTypeCount(item);
    const actionRating = buildActionRating({
      confidence,
      compStatus,
      compDepthScore,
      sourceTypeCount,
      expectedProfit: Number(pricing?.expectedProfit || 0),
      expectedSale: Number(pricing?.saleHigh || pricing?.saleLow || 0),
      targetBuy: Number(pricing?.targetBuy || 0),
      heat: Number(item?.heat_score || 0),
      riskText: String(item?.risk_factor || ""),
    });
    return {
      ...item,
      mentions,
      signalScore,
      confidence,
      confidenceReason: getConfidenceReason({ latestComp, confidence, mentions: mentions ?? 0 }),
      pricing,
      actionRating,
      inferredType: String(item?.track || "").toLowerCase().includes("brand") ? "brand" : "style",
      styleTier: String(item?.style_tier || "").toLowerCase() === "core"
        ? "core"
        : String(item?.style_tier || "").toLowerCase() === "niche"
          ? "niche"
          : "unknown",
      compStatus,
    };
  }), [data, compChecks]);

  const filteredData = enrichedData.filter((item) => {
    if (verifiedOnly && !(item.confidence === "high" || item.confidence === "med")) return false;
    if (freshOnly && item.compStatus !== "fresh") return false;
    if (lowBuyInOnly) {
      const targetBuy = Number(item?.pricing?.targetBuy ?? 0);
      if (!Number.isFinite(targetBuy) || targetBuy <= 0 || targetBuy > 35) return false;
    }
    if (confidenceFilter !== "all" && item.confidence !== confidenceFilter) return false;
    if (sourceFilter !== "all" && item.inferredType !== sourceFilter) return false;
    if (styleTierFilter !== "all" && item.inferredType === "style" && item.styleTier !== styleTierFilter) return false;
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

  const sortedData = [...filteredData].sort((a, b) => {
    if (sortMode === "mentions") return Number(b.mentions ?? -1) - Number(a.mentions ?? -1);
    if (sortMode === "heat") return (b.heat_score || 0) - (a.heat_score || 0);
    return Number(b.signalScore ?? -1) - Number(a.signalScore ?? -1);
  });
  const dedupedRadarResult = useMemo(
    () => (hideSimilarCards ? dedupeSimilarRadarItems(sortedData) : { items: sortedData, hiddenCount: 0 }),
    [sortedData, hideSimilarCards]
  );
  const displayData = dedupedRadarResult.items;
  const hiddenSimilarCount = dedupedRadarResult.hiddenCount;
  const visibleData = displayData.slice(0, cardLimit);

  useEffect(() => {
    const visibleIds = new Set(visibleData.map((item) => String(item.id || item.trend_name)));
    setCompareIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(String(id)));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleData]);

  const missingCompCount = visibleData.filter((item) => item.compStatus === "none").length;
  const freshCompCount = visibleData.filter((item) => item.compStatus === "fresh").length;
  const staleCompCount = visibleData.filter((item) => item.compStatus === "stale").length;
  const compCoverageCount = freshCompCount + staleCompCount;
  const compCoveragePct = visibleData.length ? Math.round((compCoverageCount / visibleData.length) * 100) : 0;
  const hotCount = visibleData.filter((item) => (item.heat_score || 0) >= 85).length;
  const avgCompDepthScore = visibleData.length
    ? Number((visibleData.reduce((sum, item) => sum + getCompDepthScore(Number(item?.ebay_sample_count || 0)), 0) / visibleData.length).toFixed(1))
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

  const promoteSelected = async () => {
    if (!onPromoteTrend) return;
    if (comparedItems.length === 0) {
      setActionNotice("Select at least one radar node before promoting.");
      return;
    }
    for (const item of comparedItems) {
      const id = String(item?.id || "").trim();
      if (id) await onPromoteTrend(id);
    }
    setActionNotice(`Promoted ${comparedItems.length} node(s) to Decision Lab.`);
    setCompareIds([]);
  };

  const applyPreset = (preset: "high_confidence" | "low_buy_in" | "quick_flips" | "vintage") => {
    setCompareIds([]);
    setActionNotice("");
    if (preset === "high_confidence") {
      setSearchTerm("");
      setConfidenceFilter("high");
      setSourceFilter("all");
      setStyleTierFilter("all");
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
      setStyleTierFilter("all");
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
      setStyleTierFilter("all");
      setSortMode("mentions");
      setVerifiedOnly(true);
      setFreshOnly(false);
      setLowBuyInOnly(true);
      return;
    }
    setSearchTerm("vintage 90s y2k");
    setConfidenceFilter("all");
    setSourceFilter("all");
    setStyleTierFilter("all");
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
      styleTierFilter,
      sortMode,
      viewMode,
      verifiedOnly,
      freshOnly,
      lowBuyInOnly,
      cardLimit,
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
      styleTierFilter,
      sortMode,
      viewMode,
      verifiedOnly,
      freshOnly,
      lowBuyInOnly,
      cardLimit,
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
      styleTierFilter: "all",
      sortMode: "signal",
      viewMode: "detailed",
      verifiedOnly: false,
      freshOnly: false,
      lowBuyInOnly: false,
      cardLimit: 80,
    });
  };

  const resetRadarFilters = () => {
    applyPresetPayload({
      searchTerm: "",
      confidenceFilter: "all",
      sourceFilter: "all",
      styleTierFilter: "all",
      sortMode: "signal",
      viewMode: "detailed",
      verifiedOnly: false,
      freshOnly: false,
      lowBuyInOnly: false,
      cardLimit: 80,
    });
    setHideSimilarCards(true);
    setActionNotice("Reset Radar filters to the default view.");
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

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Radar Controls</p>
            <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              Search, filter, and compare radar cards before promoting them into Decision Lab.
            </p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Uses current evidence metrics (comps, mentions, confidence, and source mix).
            </p>
          </div>
          <button
            onClick={resetRadarFilters}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
            title="Reset search, filters, sorting, and view settings"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950 p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Search</p>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search trend or brand..."
              className="w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950 p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Filters</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                <option value="all">All Node Types</option>
                <option value="style">Style</option>
                <option value="brand">Brand</option>
              </select>
              <select
                value={styleTierFilter}
                onChange={(e) => setStyleTierFilter(e.target.value as "all" | "core" | "niche")}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
              >
                <option value="all">All Style Tiers</option>
                <option value="core">Style Core</option>
                <option value="niche">Style Niche</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950 p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">View & Sort</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setSortMode("signal")}
                  className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${sortMode === "signal" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
                >
                  Signal
                </button>
                <button
                  onClick={() => setSortMode("mentions")}
                  className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${sortMode === "mentions" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
                >
                  Mentions
                </button>
              </div>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as "compact" | "detailed")}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
              >
                <option value="detailed">View: Detailed</option>
                <option value="compact">View: Compact</option>
              </select>
              <select
                value={cardLimit}
                onChange={(e) => setCardLimit(Number(e.target.value) as 40 | 80 | 120 | 200)}
                className="sm:col-span-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 outline-none focus:border-emerald-500"
              >
                <option value={40}>Show up to 40 cards</option>
                <option value={80}>Show up to 80 cards</option>
                <option value={120}>Show up to 120 cards</option>
                <option value={200}>Show up to 200 cards</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950 p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Quality Filters</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setVerifiedOnly(!verifiedOnly)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                  verifiedOnly
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40"
                    : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"
                }`}
              >
                {verifiedOnly ? "Verified Only: On" : "Verified Only: Off"}
              </button>
              <button
                onClick={() => setFreshOnly(!freshOnly)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${freshOnly ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
              >
                {freshOnly ? "Fresh Comps Only: On" : "Fresh Comps Only: Off"}
              </button>
              <button
                onClick={() => setLowBuyInOnly(!lowBuyInOnly)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${lowBuyInOnly ? "bg-blue-500/10 text-blue-500 border-blue-500/40" : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"}`}
              >
                {lowBuyInOnly ? "Low Buy-In Only: On" : "Low Buy-In Only: Off"}
              </button>
              <button
                onClick={() => setHideSimilarCards((prev) => !prev)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                  hideSimilarCards
                    ? "bg-violet-500/10 text-violet-500 border-violet-500/40"
                    : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"
                }`}
                title="Collapse near-duplicate radar headlines into one card"
              >
                {hideSimilarCards ? "Hide Similar: On" : "Hide Similar: Off"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950 p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Batch Actions</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void promoteSelected()}
                disabled={comparedItems.length === 0}
                className="px-4 py-2 rounded-xl text-[11px] font-black uppercase bg-blue-500 text-white disabled:opacity-40"
              >
                Promote Selected ({comparedItems.length})
              </button>
              <button
                onClick={() => {
                  setCompareIds([]);
                  setActionNotice("Cleared selected radar nodes.");
                }}
                disabled={comparedItems.length === 0}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                Clear Selected
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Quick Presets</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={saveCurrentPreset} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 text-white dark:bg-white dark:text-slate-900">Save Current Preset</button>
              <button onClick={() => setShowPresetManager(true)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Manage Radar Presets</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => applyPreset("high_confidence")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600">High Confidence</button>
            <button onClick={() => applyPreset("low_buy_in")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-blue-500/10 text-blue-500">Low Buy-In</button>
            <button onClick={() => applyPreset("quick_flips")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-amber-500/10 text-amber-600">Quick Flips</button>
            <button onClick={() => applyPreset("vintage")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-purple-500/10 text-purple-500">Vintage</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            Showing {visibleData.length} of {displayData.length} cards
          </span>
          <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            Compare Selected: {compareIds.length}/4
          </span>
          {hideSimilarCards && hiddenSimilarCount > 0 && (
            <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-violet-500/10 text-violet-600">
              Hidden Similar: {hiddenSimilarCount}
            </span>
          )}
        </div>

        {actionNotice && (
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">
            {actionNotice}
          </p>
        )}
      </section>

      {showPresetManager && (
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h5 className="text-xs font-black uppercase tracking-widest text-slate-500">Radar Preset Manager</h5>
            <button onClick={() => setShowPresetManager(false)} className="text-[10px] font-black uppercase text-rose-500">Close Presets</button>
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
                  <button onClick={() => setDefaultPreset(preset.id)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-blue-500/10 text-blue-500">Set Default</button>
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
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Avg Comp Depth</p>
          <p className="text-2xl font-black italic text-blue-500">{avgCompDepthScore}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Comp Coverage (Visible)</p>
          <p className={`text-2xl font-black italic ${compCoveragePct >= 90 ? "text-emerald-500" : compCoveragePct >= 70 ? "text-amber-500" : "text-rose-500"}`}>
            {compCoveragePct}%
          </p>
          <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
            Fresh {freshCompCount} • Stale {staleCompCount} • Missing {missingCompCount}
          </p>
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
              <button
                onClick={() => {
                  setCompareIds([]);
                  setActionNotice("Cleared radar compare tray.");
                }}
                className="text-[10px] font-black uppercase text-rose-500"
              >
                Clear Compare
              </button>
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
                  { key: "action", label: "Action Score", higher: true, value: (n: any) => Number(n?.actionRating?.score || 0), format: (n: any) => `${Number(n?.actionRating?.score || 0)}` },
                  { key: "heat", label: "Heat", higher: true, value: (n: any) => Number(n.heat_score || 0), format: (n: any) => `${Number(n.heat_score || 0)}` },
                  {
                    key: "mentions",
                    label: "Comp Depth",
                    higher: true,
                    value: (n: any) => getCompDepthScore(Number(n?.ebay_sample_count || 0)),
                    format: (n: any) => `${getCompDepthLabel(Number(n?.ebay_sample_count || 0))}`,
                  },
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
      className={`relative ${viewMode === "compact" ? "aspect-auto min-h-[235px]" : "aspect-auto min-h-[300px]"} rounded-2xl border transition-all duration-300 p-5 flex flex-col justify-between overflow-hidden group hover:scale-105 hover:shadow-xl
        ${isHot ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/10' : 'border-slate-200 dark:border-white/5'}
      `}
      style={{ backgroundColor: `rgba(16, 185, 129, ${intensity * 0.15})` }}
    >
      {isHot && <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />}
      
      <div className="flex justify-between items-start gap-2 relative z-10">
        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${isHot ? 'bg-emerald-500 text-black' : 'bg-black/10 dark:bg-white/10 text-slate-500'}`}>
          {item.heat_score || 0}%
        </span>
        <div className="flex flex-wrap items-center justify-end gap-1 max-w-[70%]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCompare();
            }}
            className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
              isCompared ? "bg-blue-500 text-white" : "bg-slate-900/10 dark:bg-white/10 text-slate-700 dark:text-slate-200"
            }`}
          >
            {isCompared ? "Selected" : "Select"}
          </button>
          {item.compStatus === "none" && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[8px] font-black uppercase">No Comps</span>}
          {item.compStatus === "stale" && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-500 text-[8px] font-black uppercase">Stale</span>}
          {item.compStatus === "fresh" && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500 text-[8px] font-black uppercase">Fresh</span>}
          {isHot && <Zap size={12} className="text-emerald-500 fill-current" />}
        </div>
      </div>

      <div className="relative z-10">
        <h4 className="text-[11px] font-black dark:text-white uppercase italic leading-tight line-clamp-2 mb-1 group-hover:text-emerald-500 transition-colors">
          {item.trend_name}
        </h4>
        <div className="mb-1.5 flex flex-wrap gap-1">
          <span className="inline-flex px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-500">
            Action {Number(item?.actionRating?.score || 0)}
          </span>
          <span className={`inline-flex px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${getActionBandClasses(item?.actionRating?.band || "Red")}`}>
            {item?.actionRating?.band || "Red"}
          </span>
        </div>
        <div className="mb-1">
          <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-rose-500/10 text-rose-500">
            Radar
          </span>
        </div>
        <div className="mb-1">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${getActionBandClasses(item?.actionRating?.band || "Red")}`}>
            {item?.actionRating?.recommendation || "Watch"}
          </span>
        </div>
        <div className="mb-1 flex flex-wrap gap-1">
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">{`Comp ${getCompDepthLabel(Number(item?.ebay_sample_count || 0))}`}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">{`Mix ${getSourceMixLabel(item)}`}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase text-slate-600 dark:text-slate-300">{`Coverage ${getSourceTypeCount(item)} type${getSourceTypeCount(item) === 1 ? "" : "s"}`}</span>
        </div>
        <div className="flex items-center space-x-1">
          <TrendingUp size={10} className={isHot ? 'text-emerald-500' : 'text-slate-600'} />
          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">
            {typeof item.signalScore === "number" ? `Signal strength ${item.signalScore}` : "Signal score unavailable"}
          </span>
        </div>
        <p className="mt-1 text-[8px] font-black uppercase tracking-wider text-slate-500">
          Buy ≤ ${item.pricing?.targetBuy || 0} • Sale ${item.pricing?.saleLow || 0}-${item.pricing?.saleHigh || 0}
        </p>
        {viewMode === "detailed" && (
          <div className="mt-1 space-y-1">
            <p className="text-[8px] font-bold text-slate-500 line-clamp-2">
              {item.confidenceReason}
            </p>
            <div className="flex flex-wrap gap-1">
              {(item?.actionRating?.reasons || []).slice(0, 3).map((reason: string, idx: number) => (
                <span
                  key={`${reason}-${idx}`}
                  className="inline-flex px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300"
                >
                  {reason}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="mt-1">
          <span className="ml-1 inline-flex px-1.5 py-0.5 rounded bg-slate-900/10 dark:bg-white/10 text-[8px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            Updated {formatDateLabel(item.updated_at)}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddTrend();
            }}
            title="Add to Sourcing Trunk"
            className="rounded-md bg-emerald-500/10 text-emerald-600 text-[8px] font-black uppercase leading-tight py-1 px-1"
          >
            Add to Trunk
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenResearch();
            }}
            title="Promote to Decision Lab"
            className="rounded-md bg-blue-500/10 text-blue-500 text-[8px] font-black uppercase leading-tight py-1 px-1"
          >
            Promote to Decision Lab
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
