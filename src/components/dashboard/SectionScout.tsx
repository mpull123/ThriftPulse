"use client";
import { useEffect, useMemo, useState } from "react";
import { Target, Plus, Info, Award, Hash, CheckSquare, Image as ImageIcon } from "lucide-react";
import {
  getCompAgeLabel,
  getConfidenceFromComp,
  getLatestCollectorRun,
  getLatestCompCheck,
  getRunAgeLabel,
} from "@/lib/marketIntel";
import type { CollectorJob, CompCheck, ConfidenceLevel } from "@/lib/types";
type DecisionLabel = "Buy" | "Maybe" | "Skip" | "Watchlist";
const SCOUT_PRESET_STORAGE_KEY = "thriftpulse_research_preset_v1";
const SCOUT_PRESET_LIST_STORAGE_KEY = "thriftpulse_research_presets_v1";
type ScoutPresetPayload = {
  searchTerm: string;
  confidenceFilter: "all" | "high" | "med" | "low";
  decisionFilter: "all" | "Buy" | "Maybe" | "Skip" | "Watchlist";
  styleTierFilter: "all" | "core" | "niche";
  sortMode: "heat" | "mentions" | "profit";
  viewMode: "compact" | "detailed";
  lowBuyInOnly: boolean;
  maxCardsPerSection: 20 | 40 | 80 | 120;
};
type ScoutSavedPreset = {
  id: string;
  name: string;
  isDefault?: boolean;
  payload: ScoutPresetPayload;
};

function extractTrendTargets(signal: any): string[] {
  const targets = new Set<string>();
  if (Array.isArray(signal?.visual_cues)) {
    signal.visual_cues.forEach((cue: string) => {
      const v = String(cue || "").trim();
      if (v) targets.add(v);
    });
  }
  if (signal?.risk_factor) targets.add(`Risk check: ${String(signal.risk_factor).trim()}`);
  if (signal?.hook_brand) targets.add(`${String(signal.hook_brand).trim()} piece`);
  if (signal?.trend_name) targets.add(String(signal.trend_name).trim());

  return [...targets].filter(Boolean).slice(0, 10);
}

function buildPrioritizedLookFors({
  title,
  kind,
  hookBrand,
  evidence = [],
  targetBuy,
}: {
  title: string;
  kind: "brand" | "style";
  hookBrand?: string;
  evidence?: string[];
  targetBuy?: number;
}): string[] {
  const t = String(title || "").toLowerCase();
  const b = String(hookBrand || "").trim();
  const focus = inferProductFocus([title, ...evidence].join(" "));
  const [focusTop, focusSecond] = getFocusChecks(focus);
  const ranked: Array<{ priority: number; text: string }> = [];
  const add = (priority: number, text: string) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    ranked.push({ priority, text: clean });
  };

  if (kind === "brand") {
    add(100, `Authenticate ${title} labels/tags first (era, font, wash/care tags).`);
    add(98, focusTop);
    add(96, "Check hardware consistency: zippers, snaps, rivets, logo engravings.");
    add(94, focusSecond);
    add(92, "Inspect high-wear zones first: cuffs, hems, knees, collar, underarms.");
    add(88, "Prioritize clean condition over hype variants with heavy flaws.");
  } else {
    add(100, `Confirm "${title}" silhouette and cut first before brand hunting.`);
    add(98, focusTop);
    add(96, "Prioritize low-wear condition: no major stains, tears, or pilling.");
    add(92, "Verify in-demand material and construction details.");
    add(90, focusSecond);
  }

  if (b && kind !== "brand") add(88, `Prioritize stronger resale variants from ${b}.`);

  if (t.includes("jacket") || t.includes("coat") || t.includes("anorak")) {
    add(86, "Check zipper track, lining integrity, and sleeve cuff wear.");
    add(82, "Prioritize heavier fabric, intact insulation, and clean hardware.");
  }
  if (t.includes("denim") || t.includes("jean") || t.includes("double knee") || t.includes("cargo")) {
    add(86, "Check inseam/crotch reinforcement, knees, and pocket edge wear.");
    add(82, "Prioritize desirable wash/fade with minimal blowouts or repairs.");
  }
  if (t.includes("boot") || t.includes("sneaker") || t.includes("shoe")) {
    add(86, "Inspect outsole wear, heel drag, and separation/glue failure.");
    add(82, "Prioritize cleaner uppers and pairs with strong shape retention.");
  }
  if (t.includes("hoodie") || t.includes("sweatshirt") || t.includes("cardigan") || t.includes("sweater")) {
    add(86, "Inspect cuffs/collar for stretching, pilling, and shrinkage.");
    add(82, "Prioritize heavier fabric and clean graphics/knit structure.");
  }
  if (t.includes("vintage") || t.includes("90s") || t.includes("y2k")) {
    add(78, "Check era-specific tags and print quality for authenticity.");
  }
  if (Number.isFinite(Number(targetBuy)) && Number(targetBuy) > 0) {
    add(94, `Pass if buy price is above $${toDollar(Number(targetBuy))} unless condition/tags are exceptional.`);
  }

  evidence
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .slice(0, 3)
    .forEach((v, i) => add(99 - i, `Look for cue: ${v}.`));

  const deduped = new Map<string, { priority: number; text: string }>();
  for (const item of ranked) {
    const key = item.text.toLowerCase();
    const existing = deduped.get(key);
    if (!existing || item.priority > existing.priority) deduped.set(key, item);
  }

  return [...deduped.values()]
    .sort((a, b) => b.priority - a.priority)
    .map((v) => v.text)
    .slice(0, 8);
}

function inferTrendAngle(trendName: string): string {
  const t = String(trendName || "").toLowerCase();
  if (t.includes("jacket") || t.includes("coat") || t.includes("anorak")) return "Outerwear demand is active.";
  if (t.includes("jean") || t.includes("denim") || t.includes("cargo") || t.includes("pants")) return "Bottoms category velocity is holding steady.";
  if (t.includes("boot") || t.includes("sneaker") || t.includes("loafer")) return "Footwear resale interest is elevated.";
  if (t.includes("hoodie") || t.includes("sweatshirt") || t.includes("cardigan") || t.includes("sweater")) return "Layering pieces are performing in current sell-through.";
  if (t.includes("vintage") || t.includes("90s") || t.includes("y2k")) return "Vintage-driven demand remains resilient.";
  return "Cross-category fashion interest is measurable.";
}

function inferProductFocus(text: string): "outerwear" | "footwear" | "bottoms" | "knitwear" | "bags" | "mixed" {
  const t = String(text || "").toLowerCase();
  if (/(jacket|coat|anorak|parka|shell|fleece|windbreaker)/.test(t)) return "outerwear";
  if (/(boot|sneaker|shoe|loafer)/.test(t)) return "footwear";
  if (/(jean|denim|cargo|pants|trouser|skirt|shorts)/.test(t)) return "bottoms";
  if (/(hoodie|sweatshirt|sweater|cardigan|knit)/.test(t)) return "knitwear";
  if (/(bag|tote|backpack|crossbody|handbag)/.test(t)) return "bags";
  return "mixed";
}

function getFocusChecks(focus: ReturnType<typeof inferProductFocus>): string[] {
  if (focus === "outerwear") return [
    "Prioritize shell/lining integrity, zipper track condition, and cuff wear.",
    "Favor technical fabrics, intact insulation, and complete hardware."
  ];
  if (focus === "footwear") return [
    "Prioritize outsole wear, heel drag, and upper structure before cosmetics.",
    "Favor pairs with clean midsoles and minimal separation."
  ];
  if (focus === "bottoms") return [
    "Prioritize inseam/crotch reinforcement, knee wear, and pocket edge wear.",
    "Favor clean waistbands and strong fabric with limited repairs."
  ];
  if (focus === "knitwear") return [
    "Prioritize cuff/collar shape retention, pilling level, and shrinkage signs.",
    "Favor heavier fabric weight and cleaner knit/graphic condition."
  ];
  if (focus === "bags") return [
    "Prioritize strap anchors, corner wear, and zipper/hardware function.",
    "Favor clean lining and minimal edge cracking."
  ];
  return [
    "Prioritize construction quality and clean condition first.",
    "Favor pieces with the clearest resale comps and lowest defect risk."
  ];
}

function inferBrandsForTrend(trendName: string, hookBrand?: string): string[] {
  const t = String(trendName || "").toLowerCase();
  const brands = new Set<string>();
  const hooked = String(hookBrand || "").trim();
  if (hooked) brands.add(hooked);

  const add = (list: string[]) => list.forEach((b) => brands.add(b));

  if (t.includes("denim") || t.includes("jean") || t.includes("double knee")) {
    add(["Levi's", "Carhartt", "Wrangler", "Dickies", "Lee"]);
  }
  if (t.includes("jacket") || t.includes("coat") || t.includes("anorak")) {
    add(["Carhartt", "Patagonia", "Arc'teryx", "The North Face", "Columbia"]);
  }
  if (t.includes("boot")) {
    add(["Dr. Martens", "Red Wing", "Timberland", "Blundstone", "Danner"]);
  }
  if (t.includes("sneaker") || t.includes("xt-6") || t.includes("shoe")) {
    add(["Salomon", "Nike", "New Balance", "ASICS", "adidas"]);
  }
  if (t.includes("hoodie") || t.includes("sweatshirt") || t.includes("graphic")) {
    add(["Russell Athletic", "Champion", "Carhartt", "Nike", "Hanes"]);
  }
  if (t.includes("cardigan") || t.includes("mohair") || t.includes("knit") || t.includes("sweater")) {
    add(["Our Legacy", "J.Crew", "Ralph Lauren", "Pendleton", "Acne Studios"]);
  }
  if (t.includes("tabi")) {
    add(["Maison Margiela", "Camper", "Vibram", "Repetto", "MIISTA"]);
  }
  if (t.includes("vintage") || t.includes("90s") || t.includes("y2k")) {
    add(["Levi's", "Carhartt", "Ralph Lauren", "Tommy Hilfiger", "Nike"]);
  }

  if (brands.size === 0) {
    add(["Levi's", "Carhartt", "Nike", "Ralph Lauren", "The North Face"]);
  }

  return [...brands].slice(0, 5);
}

function hashString(input: string): number {
  let hash = 0;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeTrendNameForDedupe(name: string): string {
  const normalized = String(name || "")
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
  const dropWords = new Set(["chic", "luxe", "fashion", "style", "look"]);
  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !dropWords.has(t))
    .map((t) => (t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t));
  return tokens.join(" ");
}

function getTrendDedupeKey(signal: any): string {
  const nameKey = normalizeTrendNameForDedupe(String(signal?.trend_name || ""));
  const brandKey = String(signal?.hook_brand || "").trim().toLowerCase();
  return `${nameKey}::${brandKey}`;
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
  const sourceSignalCount = Number(signal?.source_signal_count || 0);
  const sourceDiversity =
    (Number(signal?.ebay_sample_count || 0) > 0 ? 1 : 0) +
    (Number(signal?.google_trend_hits || 0) > 0 ? 1 : 0) +
    (Number(signal?.ai_corpus_hits || 0) > 0 ? 1 : 0) +
    (Number(signal?.ebay_discovery_hits || 0) > 0 ? 1 : 0);
  const trendName = String(signal?.trend_name || "");
  const specificity = Math.min(12, normalizeTrendNameForDedupe(trendName).split(" ").filter(Boolean).length * 2);
  const genericPenalty =
    /\b(pants|shirt|jacket|sneaker|boots?)\b/i.test(trendName) &&
    normalizeTrendNameForDedupe(trendName).split(" ").filter(Boolean).length <= 2
      ? 10
      : 0;
  const jitter = hashString(trendName) % 7;
  const score =
    8 +
    Math.round(heat * 0.42) +
    Math.min(24, Math.round(mentions / 6)) +
    Math.min(14, Math.round(sample * 2.4)) +
    Math.min(10, Math.round(sourceSignalCount * 1.3)) +
    sourceDiversity * 4 +
    specificity +
    jitter -
    genericPenalty;
  return Math.max(10, Math.min(99, score));
}

function getSignalIntel(signal: any): string {
  const sentiment = String(signal?.market_sentiment || "").trim();
  const risk = String(signal?.risk_factor || "").trim();
  const brand = String(signal?.hook_brand || "").trim();
  const trendName = String(signal?.trend_name || "").trim();
  const heat = Number(signal?.heat_score || 0);
  const price = Number(signal?.exit_price || 0);
  const t = trendName.toLowerCase();

  const titleSpecific =
    t.includes("jacket") || t.includes("coat") || t.includes("anorak")
      ? `For ${trendName}, prioritize clean zippers, lining integrity, and low cuff wear.`
      : t.includes("denim") || t.includes("jean") || t.includes("cargo") || t.includes("double knee")
        ? `For ${trendName}, prioritize seam strength, low knee/crotch wear, and strong wash/fade.`
        : t.includes("boot") || t.includes("sneaker") || t.includes("shoe")
          ? `For ${trendName}, prioritize outsole condition, midsole integrity, and clean uppers.`
          : t.includes("hoodie") || t.includes("sweatshirt") || t.includes("cardigan") || t.includes("sweater")
            ? `For ${trendName}, prioritize fabric weight, minimal pilling, and cuff/collar condition.`
            : `For ${trendName}, prioritize construction quality, clean condition, and high-demand variants.`;

  const parts = [];
  parts.push(titleSpecific);
  if (sentiment) parts.push(`Signal read: ${sentiment}`);
  if (brand) parts.push(`Brand overlap to watch: ${brand}.`);
  if (risk) parts.push(`Risk check: ${risk}.`);
  if (price > 0) parts.push(`Current resale target centers near $${Math.round(price)}.`);
  if (heat >= 85) parts.push("Momentum is currently high.");
  else if (heat >= 70) parts.push("Momentum is stable to rising.");
  else parts.push("Momentum is early but monitorable.");

  return parts.join(" ") || "Live trend signal from eBay + fashion source pipeline.";
}

function getBrandIntel(
  brandName: string,
  notes: string[],
  avgHeat: number,
  extra?: { topSignals?: string[]; avgExitPrice?: number; sourceSignalCount?: number }
): string {
  const b = String(brandName || "").trim();
  const uniqueNotes = notes
    .filter((n) => {
      const t = String(n || "").toLowerCase();
      if (!t.trim()) return false;
      if (t.includes("ai + ebay validated trend candidate")) return false;
      return true;
    })
    .slice(0, 2);
  const focus = inferProductFocus([b, ...(extra?.topSignals || [])].join(" "));
  const [focusTop] = getFocusChecks(focus);
  const base = `For ${b}, prioritize authentic era tags, hardware consistency, and low-wear condition.`;
  const heatLine =
    avgHeat >= 85 ? "Demand is currently high with fast resale velocity."
    : avgHeat >= 70 ? "Demand is stable with reliable turnover."
    : "Demand is early-stage; buy only when margin is strong.";
  const topSignals = (extra?.topSignals || []).filter(Boolean).slice(0, 2).join(", ");
  const signalLine = topSignals ? `Current winning item types: ${topSignals}.` : "";
  const priceLine =
    Number(extra?.avgExitPrice || 0) > 0
      ? `Recent resale midpoint is about $${toDollar(Number(extra?.avgExitPrice || 0))}.`
      : "";
  const sourceLine =
    Number(extra?.sourceSignalCount || 0) > 0
      ? `Evidence observed across ${toDollar(Number(extra?.sourceSignalCount || 0))} source signal(s).`
      : "";
  return [base, focusTop, ...uniqueNotes, signalLine, priceLine, sourceLine, heatLine].filter(Boolean).join(" ");
}

function isBrandSignal(signal: any): boolean {
  const track = String(signal?.track || "").toLowerCase();
  if (track.includes("brand")) return true;
  const trendName = String(signal?.trend_name || "").trim().toLowerCase();
  const hookBrand = String(signal?.hook_brand || "").trim().toLowerCase();
  if (trendName && hookBrand && trendName === hookBrand) return true;
  return false;
}

function toTargetBullet(item: string, kind: "brand" | "style"): string {
  const text = String(item || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (/^look for cue:/i.test(text)) {
    const cuePrefix = kind === "brand" ? "Brand cue: " : "Style cue: ";
    return text.replace(/^look for cue:\s*/i, cuePrefix);
  }
  if (/^risk check:/i.test(text)) return text;
  if (/piece$/i.test(text)) return text.replace(/piece$/i, "pieces");
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function formatMentions(value: number): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function toDollar(value: number): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function formatUsd(value: number): string {
  return `$${toDollar(value)}`;
}

function formatSourceEvidence(sourceCounts: any): string {
  const ebay = Number(sourceCounts?.ebay || 0);
  const google = Number(sourceCounts?.google || 0);
  const ai = Number(sourceCounts?.ai || 0);
  const discovery = Number(sourceCounts?.discovery || 0);
  const parts: string[] = [];
  if (ebay > 0) {
    const ebayLabel = ebay >= 50 ? "eBay 50+ (sample cap)" : `eBay ${toDollar(ebay)}`;
    parts.push(ebayLabel);
  }
  if (google > 0) parts.push(`Google ${toDollar(google)}`);
  if (ai > 0) parts.push(`AI ${toDollar(ai)}`);
  if (discovery > 0) parts.push(`Discovery ${toDollar(discovery)}`);
  return parts.length ? `Sources: ${parts.join(" • ")}` : "Sources: No per-source evidence logged";
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
    if (mentions >= 120) return "No comps yet, but strong multi-source mentions support monitoring.";
    return "No recent comp checks, so this stays lower confidence.";
  }
  if (sample >= 8 && confidence === "high") return "Fresh comp sample is strong and supports high confidence.";
  if (sample >= 4 && confidence !== "low") return "Comp sample is usable; confidence is moderate.";
  return "Comp sample is light, so confidence is capped until more checks land.";
}

function buildPricePlan({
  entryPrice,
  heat,
  confidence,
  riskText,
  latestComp,
  mentions,
}: {
  entryPrice: number;
  heat: number;
  confidence: ConfidenceLevel;
  riskText?: string;
  latestComp?: CompCheck | null;
  mentions?: number;
}) {
  // Used-goods pricing model:
  // - entryPrice starts from market sold comps.
  // - expectedSale applies used-condition discount and risk adjustments.
  // - targetBuy uses a thrift cap to preserve net margin after costs.
  const compLow = Number(latestComp?.price_low || 0);
  const compHigh = Number(latestComp?.price_high || 0);
  const compMid = compLow > 0 && compHigh > 0 ? (compLow + compHigh) / 2 : 0;
  const marketCompSale = Math.max(18, toDollar(compMid > 0 ? compMid : entryPrice));
  const risk = String(riskText || "").toLowerCase();
  const highRisk = risk.includes("replica") || risk.includes("auth");
  const heatValue = Number(heat || 50);

  const feeRate = 0.13;
  const shippingCost = 7;
  const prepCost = 3;
  const riskBuffer = highRisk ? 6 : 2;
  const usedConditionFactorBase = confidence === "high" ? 0.9 : confidence === "med" ? 0.84 : 0.78;
  const heatLift = heatValue >= 85 ? 0.03 : heatValue >= 70 ? 0.01 : 0;
  const riskPenalty = highRisk ? 0.05 : 0;
  const usedConditionFactor = Math.max(0.66, Math.min(0.93, usedConditionFactorBase + heatLift - riskPenalty));
  const expectedSale = Math.max(15, toDollar(marketCompSale * usedConditionFactor));

  const netSaleAfterCosts = Math.max(
    0,
    expectedSale * (1 - feeRate) - shippingCost - prepCost - riskBuffer
  );
  const desiredProfit = Math.max(10, Math.min(55, toDollar(expectedSale * 0.24)));
  const targetBuy = Math.max(4, Math.min(60, toDollar(netSaleAfterCosts - desiredProfit)));
  const expectedProfit = Math.max(0, toDollar(netSaleAfterCosts - targetBuy));
  const profitMargin = expectedSale > 0 ? expectedProfit / expectedSale : 0;

  let decision: DecisionLabel = "Maybe";
  let decisionReason = "Used-goods upside looks fair, but confirm condition in-store.";
  const evidenceMentions = Number(mentions || 0);
  const weakEvidence = !latestComp && evidenceMentions < 80;
  if (weakEvidence) {
    decision = "Watchlist";
    decisionReason = "Early signal with limited proof. Track it before committing buy budget.";
  } else if (expectedProfit >= 20 && profitMargin >= 0.28 && !(confidence === "low" && highRisk)) {
    decision = "Buy";
    decisionReason = "Healthy used-resale spread after fees, shipping, and prep.";
  } else if (expectedProfit < 10 || profitMargin < 0.16 || (confidence === "low" && highRisk)) {
    decision = "Skip";
    decisionReason = "Used-condition margin is thin or risk-adjusted downside is too high.";
  }

  const rangePct = confidence === "high" ? 0.08 : confidence === "med" ? 0.12 : 0.18;
  const saleLow = Math.max(10, toDollar(expectedSale * (1 - rangePct)));
  const saleHigh = Math.max(saleLow, toDollar(expectedSale * (1 + rangePct)));
  const assumptions = `Assumes 13% fees, $7 shipping, $3 prep, used-condition pricing${highRisk ? ", plus risk buffer" : ""}.`;

  return {
    targetBuy,
    expectedSale,
    saleLow,
    saleHigh,
    expectedProfit,
    decision,
    decisionReason,
    compLow: toDollar(compLow),
    compHigh: toDollar(compHigh),
    assumptions,
  };
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

  if (signalScore >= 84 || (heat >= 88 && score >= 3) || score >= 5) return "high";
  if (signalScore >= 60 || heat >= 72 || score >= 2) return "med";
  return "low";
}

function getBrandFallbackConfidence({
  avgHeat,
  evidenceCount,
  hasIntel,
  mentionCount = 0,
}: {
  avgHeat: number;
  evidenceCount: number;
  hasIntel: boolean;
  mentionCount?: number;
}): ConfidenceLevel {
  const score =
    (avgHeat >= 85 ? 3 : avgHeat >= 74 ? 2 : avgHeat >= 66 ? 1 : 0) +
    (evidenceCount >= 8 ? 3 : evidenceCount >= 5 ? 2 : evidenceCount >= 3 ? 1 : 0) +
    (mentionCount >= 150 ? 3 : mentionCount >= 95 ? 2 : mentionCount >= 55 ? 1 : 0) +
    (hasIntel ? 1 : 0);
  if (score >= 8) return "high";
  if (score >= 4) return "med";
  return "low";
}

export default function SectionScout({
  onAdd,
  onNodeSelect,
  onOpenTrend,
  onDemoteTrend,
  onArchiveTrend,
  signals = [],
  compChecks = [],
  collectorJobs = [],
  focusTerm = "",
  allowFallback = true,
}: {
  onAdd: (node: any) => void;
  onNodeSelect: (node: any) => void;
  onOpenTrend?: (term: string) => void;
  onDemoteTrend?: (signalId?: string) => void;
  onArchiveTrend?: (signalId?: string) => void;
  signals?: any[];
  compChecks?: CompCheck[];
  collectorJobs?: CollectorJob[];
  focusTerm?: string;
  allowFallback?: boolean;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "med" | "low">("all");
  const [decisionFilter, setDecisionFilter] = useState<"all" | "Buy" | "Maybe" | "Skip" | "Watchlist">("all");
  const [styleTierFilter, setStyleTierFilter] = useState<"all" | "core" | "niche">("all");
  const [sortMode, setSortMode] = useState<"heat" | "mentions" | "profit">("heat");
  const [viewMode, setViewMode] = useState<"compact" | "detailed">("detailed");
  const [lowBuyInOnly, setLowBuyInOnly] = useState(false);
  const [maxCardsPerSection, setMaxCardsPerSection] = useState<20 | 40 | 80 | 120>(40);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<"profit" | "risk" | "velocity">("profit");
  const [savedPresets, setSavedPresets] = useState<ScoutSavedPreset[]>([]);
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  useEffect(() => {
    const term = String(focusTerm || "").trim();
    setSearchTerm(term);
  }, [focusTerm]);

  useEffect(() => {
    try {
      const listRaw = localStorage.getItem(SCOUT_PRESET_LIST_STORAGE_KEY);
      let defaultPresetPayload: ScoutPresetPayload | null = null;
      if (listRaw) {
        const list = JSON.parse(listRaw) as ScoutSavedPreset[];
        const safeList = Array.isArray(list) ? list : [];
        setSavedPresets(safeList);
        const defaultPreset = safeList.find((p) => p.isDefault && p.payload);
        defaultPresetPayload = defaultPreset?.payload || null;
      }

      const raw = localStorage.getItem(SCOUT_PRESET_STORAGE_KEY);
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

  const applyPresetPayload = (payload: ScoutPresetPayload) => {
    setSearchTerm(String(payload.searchTerm || ""));
    setConfidenceFilter(payload.confidenceFilter || "all");
    setDecisionFilter(payload.decisionFilter || "all");
    setStyleTierFilter(payload.styleTierFilter || "all");
    setSortMode(payload.sortMode || "heat");
    setViewMode(payload.viewMode || "detailed");
    setLowBuyInOnly(Boolean(payload.lowBuyInOnly));
    setMaxCardsPerSection(payload.maxCardsPerSection || 40);
    setCompareIds([]);
    setSelectedIds([]);
  };

  const latestCollectorRun = getLatestCollectorRun(collectorJobs);
  const collectorRunAge = getRunAgeLabel(latestCollectorRun);

  const fallbackBrandNodes = [
    { 
      id: 'b1', 
      type: 'brand', 
      name: "Arc'teryx", 
      heat: 98, 
      source: "Starter Set",
      sentiment: "High Heat",
      mentions: 220,
      confidence: "low" as ConfidenceLevel,
      compAgeLabel: "Never",
      collectorRunAge,
      intel: "Check Gore-Tex embroidery quality. Made in Canada is priority.", 
      entry_price: 350,
      what_to_buy: [
        "Beta LT Jacket", "Alpha SV Shell", "Theta AR Jacket", "Gamma MX Hoody", 
        "Atom LT Mid-layer", "Sidewinder Jacket", "Venta SV Softshell", 
        "Fission SL Insulated", "Stingray Shell", "Any 'Made in Canada' tag"
      ]
    },
    { 
      id: 'b2', 
      type: 'brand', 
      name: "Carhartt", 
      heat: 99, 
      source: "Starter Set",
      sentiment: "High Heat",
      mentions: 260,
      confidence: "low" as ConfidenceLevel,
      compAgeLabel: "Never",
      collectorRunAge,
      intel: "Focus on USA-made 90s tags and J01 product codes.", 
      entry_price: 240,
      what_to_buy: [
        "J01 Detroit Jacket", "J97 Sandstone Detroit", "C001 Chore Coat", 
        "B01 Double Knee Pant", "J130 Active Jacket", "J14 Santa Fe Jacket", 
        "R01 Duck Bib Overalls", "V01 Arctic Vest", "J140 Flannel Lined", 
        "Southwest Collection (Aztec)"
      ]
    },
  ];

  const liveBrandMap = new Map<string, any>();
  const compCheckedAt = (comp: CompCheck | null) => {
    if (!comp) return 0;
    const date = comp.checked_at || comp.updated_at;
    const parsed = date ? new Date(date).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };

  for (const signal of signals) {
    const brandName = String(signal?.hook_brand || "").trim();
    const track = String(signal?.track || "").toLowerCase();
    if (!brandName || (track && !track.includes("brand"))) continue;

    const key = brandName.toLowerCase();
    if (!liveBrandMap.has(key)) {
      liveBrandMap.set(key, {
        id: `brand-${brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        type: "brand",
        name: brandName,
        heatTotal: 0,
        heatCount: 0,
        priceTotal: 0,
        priceCount: 0,
        mentionTotal: 0,
        sourceSignalTotal: 0,
        ebaySampleTotal: 0,
        googleHitTotal: 0,
        aiHitTotal: 0,
        discoveryHitTotal: 0,
        topSignals: new Set<string>(),
        notes: new Set<string>(),
        what: new Set<string>(),
        latestComp: null as CompCheck | null,
        lastUpdatedAt: null as string | null,
      });
    }

    const node = liveBrandMap.get(key);
    const heat = Number(signal?.heat_score || 0);
    const price = Number(signal?.exit_price || 0);
    if (heat > 0) {
      node.heatTotal += heat;
      node.heatCount += 1;
    }
    if (price > 0) {
      node.priceTotal += price;
      node.priceCount += 1;
    }
    node.mentionTotal += Number(signal?.mention_count || 0);
    node.sourceSignalTotal += Number(signal?.source_signal_count || 0);
    node.ebaySampleTotal += Number(signal?.ebay_sample_count || 0);
    node.googleHitTotal += Number(signal?.google_trend_hits || 0);
    node.aiHitTotal += Number(signal?.ai_corpus_hits || 0);
    node.discoveryHitTotal += Number(signal?.ebay_discovery_hits || 0);
    if (signal?.trend_name) node.topSignals.add(String(signal.trend_name).trim());
    if (signal?.market_sentiment) node.notes.add(String(signal.market_sentiment).trim());
    if (signal?.risk_factor) node.notes.add(`Risk: ${String(signal.risk_factor).trim()}`);
    if (Array.isArray(signal?.visual_cues)) {
      signal.visual_cues.slice(0, 8).forEach((v: string) => node.what.add(String(v).trim()));
    }
    if (signal?.trend_name) node.what.add(String(signal.trend_name).trim());

    const latestCompForSignal = getLatestCompCheck(signal, compChecks);
    if (compCheckedAt(latestCompForSignal) > compCheckedAt(node.latestComp)) {
      node.latestComp = latestCompForSignal;
    }
    const signalUpdatedAt = signal?.updated_at || signal?.created_at || null;
    if (
      signalUpdatedAt &&
      (!node.lastUpdatedAt || new Date(signalUpdatedAt).getTime() > new Date(node.lastUpdatedAt).getTime())
    ) {
      node.lastUpdatedAt = signalUpdatedAt;
    }
  }

  const liveBrandNodes = [...liveBrandMap.values()].map((node) => {
    const avgHeat = node.heatCount ? Math.round(node.heatTotal / node.heatCount) : 70;
    const mentions = Math.max(
      12,
      Number(node.mentionTotal || 0),
      Math.round(node.what.size * 4)
    );
    const compConfidence = getConfidenceFromComp(node.latestComp);
    const fallbackConfidence = getBrandFallbackConfidence({
      avgHeat,
      evidenceCount: node.what.size,
      hasIntel: node.notes.size > 0,
      mentionCount: mentions,
    });
    const riskText = [...node.notes].find((n: string) => String(n).toLowerCase().includes("risk")) || "";
    const plan = buildPricePlan({
      entryPrice: node.priceCount ? Math.round(node.priceTotal / node.priceCount) : 75,
      heat: avgHeat,
      confidence: node.latestComp ? compConfidence : fallbackConfidence,
      riskText,
      latestComp: node.latestComp,
      mentions,
    });

    return {
      id: node.id,
      type: "brand",
      name: node.name,
      heat: avgHeat,
      source: "Live Brand Monitor",
      sentiment: avgHeat > 80 ? "Surging" : "Stable",
      mentions,
      confidence: node.latestComp ? compConfidence : fallbackConfidence,
      confidence_reason: getConfidenceReason({
        latestComp: node.latestComp,
        confidence: node.latestComp ? compConfidence : fallbackConfidence,
        mentions,
      }),
      compAgeLabel: getCompAgeLabel(node.latestComp),
      collectorRunAge,
      intel: getBrandIntel(node.name, [...node.notes], avgHeat, {
        topSignals: [...node.topSignals].slice(0, 3),
        avgExitPrice: node.priceCount ? Math.round(node.priceTotal / node.priceCount) : 0,
        sourceSignalCount: node.sourceSignalTotal,
      }),
      entry_price: node.priceCount ? Math.round(node.priceTotal / node.priceCount) : 75,
      target_buy: plan.targetBuy,
      expected_sale: plan.expectedSale,
      expected_sale_low: plan.saleLow,
      expected_sale_high: plan.saleHigh,
      expected_profit: plan.expectedProfit,
      pricing_assumptions: plan.assumptions,
      comp_low: plan.compLow,
      comp_high: plan.compHigh,
      decision: plan.decision,
      decision_reason: plan.decisionReason,
      what_to_buy: buildPrioritizedLookFors({
        title: node.name,
        kind: "brand",
        hookBrand: node.name,
        evidence: [...node.what].filter(Boolean).slice(0, 4),
        targetBuy: plan.targetBuy,
      }),
      last_updated_at: node.lastUpdatedAt,
      source_counts: {
        ebay: Number(node.ebaySampleTotal || 0),
        google: Number(node.googleHitTotal || 0),
        ai: Number(node.aiHitTotal || 0),
        discovery: Number(node.discoveryHitTotal || 0),
      },
      signal_ids: signals
        .filter((s: any) => String(s?.hook_brand || "").trim().toLowerCase() === String(node.name || "").trim().toLowerCase())
        .map((s: any) => String(s?.id || "").trim())
        .filter(Boolean),
    };
  });

  const brandNodes: any[] = liveBrandNodes.length > 0 ? liveBrandNodes : allowFallback ? fallbackBrandNodes : [];

  // 2. STYLE TRENDS (Merged: Live DB Signals + Hardcoded)
  // Convert DB signals into the Node format used by the UI, then dedupe near-duplicate names.
  const dedupedTrendGroups = new Map<string, any[]>();
  signals
    .filter((s: any) => !isBrandSignal(s))
    .forEach((s: any) => {
      const key = getTrendDedupeKey(s);
      const existing = dedupedTrendGroups.get(key) || [];
      existing.push(s);
      dedupedTrendGroups.set(key, existing);
    });

  const liveTrends = [...dedupedTrendGroups.values()].map((group: any[]) => {
    const representative = [...group].sort((a, b) => {
      const heatDelta = Number(b?.heat_score || 0) - Number(a?.heat_score || 0);
      if (heatDelta !== 0) return heatDelta;
      const bTime = new Date(b?.updated_at || b?.created_at || 0).getTime();
      const aTime = new Date(a?.updated_at || a?.created_at || 0).getTime();
      return bTime - aTime;
    })[0];

    const mergedSignal = {
      ...representative,
      heat_score: Math.round(group.reduce((sum, s) => sum + Number(s?.heat_score || 0), 0) / Math.max(1, group.length)),
      exit_price: Math.round(group.reduce((sum, s) => sum + Number(s?.exit_price || 0), 0) / Math.max(1, group.length)),
      mention_count: group.reduce((sum, s) => sum + Number(s?.mention_count || 0), 0),
      source_signal_count: group.reduce((sum, s) => sum + Number(s?.source_signal_count || 0), 0),
      ebay_sample_count: group.reduce((sum, s) => sum + Number(s?.ebay_sample_count || 0), 0),
      google_trend_hits: group.reduce((sum, s) => sum + Number(s?.google_trend_hits || 0), 0),
      ai_corpus_hits: group.reduce((sum, s) => sum + Number(s?.ai_corpus_hits || 0), 0),
      ebay_discovery_hits: group.reduce((sum, s) => sum + Number(s?.ebay_discovery_hits || 0), 0),
      visual_cues: Array.from(
        new Set(group.flatMap((s) => (Array.isArray(s?.visual_cues) ? s.visual_cues : [])))
      ).slice(0, 10),
    };

    const latestComp =
      group
        .map((s) => getLatestCompCheck(s, compChecks))
        .sort((a, b) => {
          const aTime = new Date(a?.checked_at || a?.updated_at || 0).getTime();
          const bTime = new Date(b?.checked_at || b?.updated_at || 0).getTime();
          return bTime - aTime;
        })[0] || null;

    const signalScore = getSignalScore(mergedSignal, latestComp);
    const confidence = getFallbackConfidence(mergedSignal, signalScore);
    const topTargets = extractTrendTargets(mergedSignal);
    const mentions = getTrendMentions(mergedSignal, latestComp);

    const plan = buildPricePlan({
      entryPrice: mergedSignal.exit_price || 0,
      heat: mergedSignal.heat_score || 50,
      confidence,
      riskText: mergedSignal.risk_factor || "",
      latestComp,
      mentions,
    });

    return {
      id: `live-${String(representative?.id || "").trim()}`,
      signal_id: String(representative?.id || "").trim(),
      signal_ids: group.map((s) => String(s?.id || "").trim()).filter(Boolean),
      type: "style",
      name: representative?.trend_name,
      heat: mergedSignal.heat_score || 50,
      source: representative?.track || "Live Monitor",
      sentiment: mergedSignal.heat_score > 80 ? "Surging" : "Stable",
      mentions,
      signalScore,
      entry_price: mergedSignal.exit_price || 0,
      target_buy: plan.targetBuy,
      expected_sale: plan.expectedSale,
      expected_sale_low: plan.saleLow,
      expected_sale_high: plan.saleHigh,
      expected_profit: plan.expectedProfit,
      pricing_assumptions: plan.assumptions,
      comp_low: plan.compLow,
      comp_high: plan.compHigh,
      decision: plan.decision,
      decision_reason: plan.decisionReason,
      intel: getSignalIntel(mergedSignal),
      what_to_buy: buildPrioritizedLookFors({
        title: representative?.trend_name || "",
        kind: "style",
        hookBrand: representative?.hook_brand || "",
        evidence: topTargets,
        targetBuy: plan.targetBuy,
      }),
      brands_to_watch: inferBrandsForTrend(representative?.trend_name, representative?.hook_brand),
      brandRef: representative?.hook_brand || null,
      style_tier: String(representative?.style_tier || "").toLowerCase() === "core"
        ? "core"
        : String(representative?.style_tier || "").toLowerCase() === "niche"
          ? "niche"
          : "unknown",
      compAgeLabel: getCompAgeLabel(latestComp),
      confidence,
      confidence_reason: getConfidenceReason({ latestComp, confidence, mentions }),
      last_updated_at: representative?.updated_at || representative?.created_at || null,
      source_counts: {
        ebay: Number(mergedSignal?.ebay_sample_count || 0),
        google: Number(mergedSignal?.google_trend_hits || 0),
        ai: Number(mergedSignal?.ai_corpus_hits || 0),
        discovery: Number(mergedSignal?.ebay_discovery_hits || 0),
      },
      collectorRunAge,
    };
  });

  // Combine Live + Starter trends
  const trendNodes = liveTrends.length > 0 ? liveTrends : allowFallback ? [
    { 
      id: 't1', type: 'style', name: "90s Gore-Tex Shells", source: "r/gorpcore", sentiment: "High Heat", mentions: 142,
      intel: "Users are praising 90s durability over modern 'thin' shells. Focus on Arc'teryx and Marmot.", heat: 98, entry_price: 220,
      what_to_buy: [
        "3-Layer Gore-Tex Fabric", "Contrast / Colorblock Panels", "Stow-away Hoods", 
        "Armpit Ventilation Zips", "Embroidered Chest Logos", "Velcro Cuff Straps", 
        "Interior Snow Skirts", "Taped Seams (Check peeling)", "Ripstop Nylon", "Vibram Zippers"
      ]
    },
    // ... (Your other hardcoded items remain as fallback if DB is empty)
  ] : [];

  const matchesCommonFilters = (node: any): boolean => {
    if (confidenceFilter !== "all" && node?.confidence !== confidenceFilter) return false;
    if (decisionFilter !== "all" && node?.decision !== decisionFilter) return false;
    if (lowBuyInOnly && Number(node?.target_buy || 0) > 35) return false;
    if (styleTierFilter !== "all" && node?.type === "style" && node?.style_tier !== styleTierFilter) return false;

    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      String(node?.name || ""),
      String(node?.source || ""),
      String(node?.intel || ""),
      String(node?.brandRef || ""),
      ...(Array.isArray(node?.what_to_buy) ? node.what_to_buy.map((v: string) => String(v || "")) : []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  };

  const sortNodes = (a: any, b: any) => {
    if (sortMode === "mentions") return Number(b?.mentions || 0) - Number(a?.mentions || 0);
    if (sortMode === "profit") return Number(b?.expected_profit || 0) - Number(a?.expected_profit || 0);
    return Number(b?.heat || 0) - Number(a?.heat || 0);
  };

  const filteredBrandNodes = useMemo(
    () => [...brandNodes].filter(matchesCommonFilters).sort(sortNodes),
    [brandNodes, confidenceFilter, decisionFilter, searchTerm, sortMode, lowBuyInOnly]
  );

  const filteredTrendNodes = useMemo(
    () => [...trendNodes].filter(matchesCommonFilters).sort(sortNodes),
    [trendNodes, confidenceFilter, decisionFilter, searchTerm, sortMode, styleTierFilter, lowBuyInOnly]
  );

  const visibleBrandNodes = useMemo(
    () => filteredBrandNodes.slice(0, maxCardsPerSection),
    [filteredBrandNodes, maxCardsPerSection]
  );

  const visibleTrendNodes = useMemo(
    () => filteredTrendNodes.slice(0, maxCardsPerSection),
    [filteredTrendNodes, maxCardsPerSection]
  );

  const comparePool = useMemo(
    () => [...visibleBrandNodes, ...visibleTrendNodes],
    [visibleBrandNodes, visibleTrendNodes]
  );

  const comparedNodes = useMemo(
    () => comparePool.filter((node: any) => compareIds.includes(String(node.id))),
    [comparePool, compareIds]
  );
  const selectedNodes = useMemo(
    () => comparePool.filter((node: any) => selectedIds.includes(String(node.id))),
    [comparePool, selectedIds]
  );

  const getSignalIdsForNode = (node: any): string[] => {
    if (Array.isArray(node?.signal_ids) && node.signal_ids.length > 0) {
      return node.signal_ids.map((id: any) => String(id || "").trim()).filter(Boolean);
    }
    const directId = String(node?.signal_id || "").trim();
    if (directId) return [directId];

    const nodeName = String(node?.name || "").trim().toLowerCase();
    if (!nodeName) return [];

    if (String(node?.type || "") === "brand") {
      return signals
        .filter((s: any) => {
          const id = String(s?.id || "").trim();
          if (!id) return false;
          const hookBrand = String(s?.hook_brand || "").trim().toLowerCase();
          const trendName = String(s?.trend_name || "").trim().toLowerCase();
          const track = String(s?.track || "").toLowerCase();
          return hookBrand === nodeName || (track.includes("brand") && trendName === nodeName);
        })
        .map((s: any) => String(s.id));
    }

    return signals
      .filter((s: any) => {
        const id = String(s?.id || "").trim();
        if (!id) return false;
        const trendName = String(s?.trend_name || "").trim().toLowerCase();
        return trendName === nodeName;
      })
      .map((s: any) => String(s.id));
  };

  const toggleCompare = (nodeId: string) => {
    setCompareIds((prev) => {
      const id = String(nodeId);
      if (prev.includes(id)) return prev.filter((v) => v !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };
  const toggleSelected = (nodeId: string) => {
    setSelectedIds((prev) => {
      const id = String(nodeId);
      if (prev.includes(id)) return prev.filter((v) => v !== id);
      return [...prev, id];
    });
  };

  const confidenceToScore = (confidence: ConfidenceLevel | string | undefined) =>
    confidence === "high" ? 3 : confidence === "med" ? 2 : 1;
  const decisionToRisk = (decision: string | undefined) =>
    decision === "Buy" ? 3 : decision === "Maybe" ? 2 : decision === "Watchlist" ? 1 : 0;

  const recommendation = useMemo(() => {
    if (!comparedNodes.length) return "";
    const ranked = [...comparedNodes]
      .map((node: any) => {
        const profitScore = Number(node?.expected_profit || 0) + (60 - Number(node?.target_buy || 60));
        const riskScore = confidenceToScore(node?.confidence) * 20 + decisionToRisk(node?.decision) * 10;
        const velocityScore =
          Number(node?.heat || 0) + Number(node?.mentions || 0) * 0.15 + Number(node?.signalScore || 0) * 0.4;
        const total = compareMode === "profit" ? profitScore : compareMode === "risk" ? riskScore : velocityScore;
        return { node, total };
      })
      .sort((a, b) => b.total - a.total);
    return ranked[0]?.node?.name ? `Best ${compareMode} pick: ${ranked[0].node.name}` : "";
  }, [comparedNodes, compareMode]);

  const demoteSelected = async () => {
    if (!onDemoteTrend) return;
    const ids = Array.from(new Set(selectedNodes.flatMap((node: any) => getSignalIdsForNode(node))));
    if (ids.length === 0) {
      setActionNotice("No linked signal records found for this selection.");
      return;
    }
    for (const id of ids) {
      if (id) await onDemoteTrend(id);
    }
    setActionNotice(`Demoted ${selectedNodes.length} node(s). Updated ${ids.length} record(s) back to Radar.`);
    setSelectedIds([]);
    setCompareIds([]);
  };

  const archiveSelected = async () => {
    if (!onArchiveTrend) return;
    const ids = Array.from(new Set(selectedNodes.flatMap((node: any) => getSignalIdsForNode(node))));
    if (ids.length === 0) {
      setActionNotice("No linked signal records found for this selection.");
      return;
    }
    for (const id of ids) {
      if (id) await onArchiveTrend(id);
    }
    setActionNotice(`Archived ${selectedNodes.length} node(s). Updated ${ids.length} record(s) to Archived.`);
    setSelectedIds([]);
    setCompareIds([]);
  };

  const applyPreset = (preset: "high_confidence" | "low_buy_in" | "quick_flips" | "vintage") => {
    setCompareIds([]);
    setSelectedIds([]);
    setActionNotice("");
    if (preset === "high_confidence") {
      setSearchTerm("");
      setConfidenceFilter("high");
      setDecisionFilter("all");
      setSortMode("heat");
      setLowBuyInOnly(false);
      return;
    }
    if (preset === "low_buy_in") {
      setSearchTerm("");
      setConfidenceFilter("all");
      setDecisionFilter("all");
      setSortMode("profit");
      setLowBuyInOnly(true);
      return;
    }
    if (preset === "quick_flips") {
      setSearchTerm("");
      setConfidenceFilter("med");
      setDecisionFilter("Buy");
      setSortMode("profit");
      setLowBuyInOnly(false);
      return;
    }
    setSearchTerm("vintage 90s y2k");
    setConfidenceFilter("all");
    setDecisionFilter("all");
    setSortMode("heat");
    setLowBuyInOnly(false);
  };

  const saveCurrentPreset = () => {
    const payload: ScoutPresetPayload = {
      searchTerm,
      confidenceFilter,
      decisionFilter,
      styleTierFilter,
      sortMode,
      viewMode,
      lowBuyInOnly,
      maxCardsPerSection,
    };
    localStorage.setItem(SCOUT_PRESET_STORAGE_KEY, JSON.stringify(payload));
  };

  const persistPresetList = (next: ScoutSavedPreset[]) => {
    setSavedPresets(next);
    localStorage.setItem(SCOUT_PRESET_LIST_STORAGE_KEY, JSON.stringify(next));
  };

  const saveNamedPreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const payload: ScoutPresetPayload = {
      searchTerm,
      confidenceFilter,
      decisionFilter,
      styleTierFilter,
      sortMode,
      viewMode,
      lowBuyInOnly,
      maxCardsPerSection,
    };
    const next = [
      ...savedPresets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()),
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, payload, isDefault: false },
    ];
    persistPresetList(next);
    setPresetName("");
  };

  const applyNamedPreset = (preset: ScoutSavedPreset) => {
    applyPresetPayload(preset.payload);
    localStorage.setItem(SCOUT_PRESET_STORAGE_KEY, JSON.stringify(preset.payload));
  };

  const deleteNamedPreset = (id: string) => {
    persistPresetList(savedPresets.filter((p) => p.id !== id));
  };

  const setDefaultPreset = (id: string) => {
    const next = savedPresets.map((p) => ({ ...p, isDefault: p.id === id }));
    persistPresetList(next);
  };

  const resetToSystemDefault = () => {
    localStorage.removeItem(SCOUT_PRESET_STORAGE_KEY);
    localStorage.removeItem(SCOUT_PRESET_LIST_STORAGE_KEY);
    setSavedPresets([]);
    setPresetName("");
    applyPresetPayload({
      searchTerm: "",
      confidenceFilter: "high",
      decisionFilter: "all",
      styleTierFilter: "all",
      sortMode: "heat",
      viewMode: "detailed",
      lowBuyInOnly: false,
      maxCardsPerSection: 40,
    });
  };

  return (
    <div className="space-y-20 text-left pb-24">
      <section className="rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Decision Lab</p>
        <p className="text-sm font-bold italic text-slate-600 dark:text-slate-300 mt-1">
          Decide what to source next using evidence, risk, and used-goods profitability.
        </p>
      </section>
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">
          Research Filters
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search trends, brands, intel..."
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          />
          <select
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value as "all" | "high" | "med" | "low")}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          >
            <option value="all">All Confidence</option>
            <option value="high">High Confidence</option>
            <option value="med">Medium Confidence</option>
            <option value="low">Low Confidence</option>
          </select>
          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value as "all" | "Buy" | "Maybe" | "Skip" | "Watchlist")}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          >
            <option value="all">All Decisions</option>
            <option value="Buy">Buy</option>
            <option value="Maybe">Maybe</option>
            <option value="Watchlist">Watchlist</option>
            <option value="Skip">Skip</option>
          </select>
          <select
            value={styleTierFilter}
            onChange={(e) => setStyleTierFilter(e.target.value as "all" | "core" | "niche")}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          >
            <option value="all">All Tiers</option>
            <option value="core">Style Core</option>
            <option value="niche">Style Niche</option>
          </select>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "heat" | "mentions" | "profit")}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          >
            <option value="heat">Sort: Heat</option>
            <option value="mentions">Sort: Mentions</option>
            <option value="profit">Sort: Profit</option>
          </select>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as "compact" | "detailed")}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          >
            <option value="detailed">View: Detailed</option>
            <option value="compact">View: Compact</option>
          </select>
          <select
            value={maxCardsPerSection}
            onChange={(e) => setMaxCardsPerSection(Number(e.target.value) as 20 | 40 | 80 | 120)}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-black uppercase tracking-wide outline-none focus:border-emerald-500"
          >
            <option value={20}>Max 20/Section</option>
            <option value={40}>Max 40/Section</option>
            <option value={80}>Max 80/Section</option>
            <option value={120}>Max 120/Section</option>
          </select>
        </div>
        <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Showing {visibleBrandNodes.length}/{filteredBrandNodes.length} brand nodes and {visibleTrendNodes.length}/{filteredTrendNodes.length} style trends
        </p>
        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Selected nodes: {selectedIds.length} • Compare selected: {compareIds.length}/4
        </p>
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <button
            onClick={() => void demoteSelected()}
            disabled={selectedNodes.length === 0}
            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-rose-500 text-white disabled:opacity-40 shadow-sm"
          >
            Demote Selected ({selectedNodes.length})
          </button>
          <button
            onClick={() => void archiveSelected()}
            disabled={selectedNodes.length === 0}
            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40 shadow-sm"
          >
            Archive Selected ({selectedNodes.length})
          </button>
          <button
            onClick={() => setSelectedIds([])}
            disabled={selectedNodes.length === 0}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"
          >
            Clear Selection
          </button>
        </div>
        {actionNotice && (
          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-emerald-600">
            {actionNotice}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => applyPreset("high_confidence")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600">High Confidence</button>
          <button onClick={() => applyPreset("low_buy_in")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-blue-500/10 text-blue-500">Low Buy-In</button>
          <button onClick={() => applyPreset("quick_flips")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-amber-500/10 text-amber-600">Quick Flips</button>
          <button onClick={() => applyPreset("vintage")} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-purple-500/10 text-purple-500">Vintage</button>
          <button onClick={saveCurrentPreset} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-900 text-white dark:bg-white dark:text-slate-900">Save Current Preset</button>
          <button onClick={() => setShowPresetManager(true)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Manage Presets</button>
        </div>
      </section>

      {showPresetManager && (
        <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h5 className="text-xs font-black uppercase tracking-widest text-slate-500">Research Preset Manager</h5>
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
                <div>
                  <p className="text-xs font-black uppercase text-slate-700 dark:text-slate-200">
                    {preset.name} {preset.isDefault ? "(Default)" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => applyNamedPreset(preset)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600">Apply</button>
                  <button onClick={() => setDefaultPreset(preset.id)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-blue-500/10 text-blue-500">Default</button>
                  <button onClick={() => deleteNamedPreset(preset.id)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-rose-500/10 text-rose-500">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {comparedNodes.length > 0 && (
        <section className="rounded-3xl border border-blue-500/30 bg-blue-500/5 p-6">
          <div className="flex items-center justify-between mb-4">
            <h5 className="text-xs font-black uppercase tracking-widest text-blue-500">Compare Tray ({comparedNodes.length})</h5>
            <div className="flex items-center gap-2">
              <select
                value={compareMode}
                onChange={(e) => setCompareMode(e.target.value as "profit" | "risk" | "velocity")}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
              >
                <option value="profit">Profit</option>
                <option value="risk">Risk</option>
                <option value="velocity">Velocity</option>
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
                  {comparedNodes.map((node: any) => (
                    <th key={`h-${node.id}`} className="px-3 py-2 text-slate-700 dark:text-slate-200 uppercase">{node.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "confidence", label: "Confidence", higher: true, value: (n: any) => confidenceToScore(n.confidence), format: (n: any) => String(n.confidence || "low").toUpperCase() },
                  { key: "heat", label: "Heat", higher: true, value: (n: any) => Number(n.heat || 0), format: (n: any) => `${Number(n.heat || 0)}` },
                  { key: "mentions", label: "Mentions", higher: true, value: (n: any) => Number(n.mentions || 0), format: (n: any) => formatMentions(n.mentions || 0) },
                  { key: "buy", label: "Target Buy", higher: false, value: (n: any) => Number(n.target_buy || 0), format: (n: any) => formatUsd(n.target_buy || 0) },
                  { key: "net", label: "Expected Net", higher: true, value: (n: any) => Number(n.expected_profit || 0), format: (n: any) => formatUsd(n.expected_profit || 0) },
                ].map((row) => {
                  const values = comparedNodes.map((n: any) => row.value(n));
                  const best = row.higher ? Math.max(...values) : Math.min(...values);
                  return (
                    <tr key={row.key} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-3 py-2 font-black uppercase text-slate-500">{row.label}</td>
                      {comparedNodes.map((node: any) => {
                        const val = row.value(node);
                        const delta = row.higher ? val - best : best - val;
                        return (
                          <td key={`${row.key}-${node.id}`} className={`px-3 py-2 font-bold ${val === best ? "text-emerald-500" : "text-slate-600 dark:text-slate-300"}`}>
                            {row.format(node)} {delta !== 0 ? <span className="text-[10px] text-slate-400">({row.higher ? "-" : "+"}{Math.abs(delta)})</span> : ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* BRAND NODES */}
      <section>
        <div className="flex items-center gap-4 mb-10 pl-2 border-l-4 border-emerald-500">
          <Award className="text-emerald-500" size={36} />
          <h4 className="text-4xl font-black italic uppercase tracking-tighter">Brand Nodes</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {visibleBrandNodes.map((node) => (
            <div 
              key={node.id} 
              onClick={() => onNodeSelect(node)} 
              className={`group bg-white dark:bg-slate-900 border rounded-[3rem] ${viewMode === "compact" ? "p-7" : "p-10"} transition-all hover:shadow-2xl relative overflow-hidden flex flex-col cursor-pointer ${
                selectedIds.includes(String(node.id))
                  ? "border-emerald-500 ring-2 ring-emerald-500/30"
                  : "border-slate-200 dark:border-slate-800 hover:border-emerald-500/50"
              }`}
            >
              <div className="absolute top-0 left-0 h-1.5 bg-emerald-500" style={{ width: `${node.heat}%` }} />
              <div className="flex justify-between items-start gap-3 mb-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                     <span className="bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter flex items-center"><Hash size={10} className="mr-1" /> {node.source}</span>
                     <span className="bg-blue-500/10 text-blue-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">Decision</span>
                     {node.confidence && <ConfidencePill confidence={node.confidence} />}
                     {node.decision && (
                       <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                         node.decision === "Buy"
                           ? "bg-emerald-500/10 text-emerald-500"
                           : node.decision === "Maybe"
                             ? "bg-amber-500/10 text-amber-500"
                             : node.decision === "Watchlist"
                               ? "bg-blue-500/10 text-blue-500"
                             : "bg-rose-500/10 text-rose-500"
                       }`}>
                         {node.decision}
                       </span>
                     )}
                  </div>
                  <h3 className="text-3xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-tight break-words line-clamp-2">{node.name}</h3>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Mentions</p>
                  <p className="text-lg font-black italic text-emerald-500 leading-none tabular-nums">{formatMentions(node.mentions)}</p>
                </div>
              </div>
              {viewMode === "detailed" && (
              <div className="bg-emerald-500/5 border border-emerald-500/10 p-6 rounded-3xl mb-8 flex-1">
                 {node.compAgeLabel && (
                   <div className="mb-3">
                     <span className="inline-flex items-center rounded-full bg-slate-200/70 dark:bg-slate-800 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                       Comps checked: {node.compAgeLabel}
                     </span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center mb-2 italic"><Info size={14} className="mr-2" /> Brand Intel:</p>
                 <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 italic leading-relaxed max-h-16 overflow-hidden">{node.intel}</p>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mt-4 mb-2 italic"><CheckSquare size={12} className="mr-2 text-emerald-500" /> Top Targets:</p>
                 <ul className="list-disc pl-5 space-y-2">
                  {(node.what_to_buy || []).slice(0, 5).map((item: string, i: number) => (
                    <li key={i} className="text-xs font-bold text-slate-700 dark:text-slate-300 italic">
                      {toTargetBullet(item, "brand")}
                    </li>
                  ))}
                 </ul>
              </div>
              )}
              <div className="mt-auto space-y-4">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Used Pricing</p>
                  <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">
                    {`Buy <= ${formatUsd(node.target_buy ?? node.entry_price)} | Sale ${formatUsd(node.expected_sale_low ?? node.expected_sale ?? node.entry_price)}-${formatUsd(node.expected_sale_high ?? node.expected_sale ?? node.entry_price)} | Net +${formatUsd(node.expected_profit ?? 0)}`}
                  </p>
                  {node.pricing_assumptions && <p className="mt-1 text-[9px] font-bold text-slate-500">{node.pricing_assumptions}</p>}
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Why This Score</p>
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    {node.confidence_reason || "Confidence is based on comp recency, sample size, and source evidence."}
                  </p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
                    Updated: {formatDateLabel(node.last_updated_at)} • Comps: {node.compAgeLabel || "Unknown"}
                  </p>
                  {node.source_counts && (
                    <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
                      {formatSourceEvidence(node.source_counts)}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                   <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Target Entry</p>
                      <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">${node.entry_price}</p>
                   </div>
                   <a 
                     href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(node.name + " vintage")}`}
                     target="_blank"
                     rel="noreferrer"
                     onClick={(e) => e.stopPropagation()} 
                     className="flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-white/5 rounded-2xl text-slate-400 hover:text-emerald-500 transition-all border border-transparent hover:border-emerald-500/10"
                   >
                      <ImageIcon size={18} />
                      <span className="text-[10px] font-black uppercase tracking-widest">View Photos</span>
                   </a>
                </div>
                {node.collectorRunAge && (
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Last scraper update: {node.collectorRunAge}
                  </p>
                )}
                <button onClick={(e) => { e.stopPropagation(); onAdd(node); }} className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black uppercase italic text-xs tracking-widest hover:bg-emerald-500 transition-all shadow-xl flex items-center justify-center gap-3">
                  <Plus size={18} /> Queue for Sourcing
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNodeSelect(node);
                  }}
                  className="w-full py-3 bg-emerald-500/10 text-emerald-600 rounded-2xl font-black uppercase italic text-[11px] tracking-widest hover:bg-emerald-500/20 transition-all"
                >
                  View Details
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelected(String(node.id));
                  }}
                  className={`w-full py-3 rounded-2xl font-black uppercase italic text-[11px] tracking-widest transition-all ${
                    selectedIds.includes(String(node.id))
                      ? "bg-emerald-500/15 text-emerald-600"
                      : "bg-emerald-500/10 text-emerald-600"
                  }`}
                >
                  {selectedIds.includes(String(node.id)) ? "Selected" : "Select"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCompare(String(node.id));
                  }}
                  className={`w-full py-3 rounded-2xl font-black uppercase italic text-[11px] tracking-widest transition-all ${
                    compareIds.includes(String(node.id))
                      ? "bg-blue-500/15 text-blue-500"
                      : "bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {compareIds.includes(String(node.id)) ? "Compared" : "Compare"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {visibleBrandNodes.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">
              No brand nodes promoted to Decision Lab yet.
            </p>
          </div>
        )}
      </section>

      {/* STYLE TRENDS */}
      <section>
        <div className="flex items-center justify-between mb-10 pl-2 border-l-4 border-blue-500">
          <div className="flex items-center gap-4">
            <Target className="text-blue-500" size={36} />
            <h4 className="text-4xl font-black italic uppercase tracking-tighter text-blue-500">Style Trends</h4>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {visibleTrendNodes.map((node: any) => (
            <div 
              key={node.id} 
              onClick={() => onNodeSelect(node)} 
              className={`group bg-white dark:bg-slate-900 border rounded-[3rem] ${viewMode === "compact" ? "p-7" : "p-10"} transition-all hover:shadow-2xl relative overflow-hidden flex flex-col cursor-pointer ${
                selectedIds.includes(String(node.id))
                  ? "border-blue-500 ring-2 ring-blue-500/30"
                  : "border-slate-200 dark:border-slate-800 hover:border-blue-500/50"
              }`}
            >
              <div className="absolute top-0 left-0 h-1.5 bg-blue-500" style={{ width: `${node.heat}%` }} />
              <div className="flex justify-between items-start gap-3 mb-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                     <span className="bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter flex items-center"><Hash size={10} className="mr-1" /> {node.source}</span>
                     <span className="bg-blue-500/10 text-blue-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">Decision</span>
                     {node.confidence && <ConfidencePill confidence={node.confidence} />}
                     {node.decision && (
                       <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                         node.decision === "Buy"
                           ? "bg-emerald-500/10 text-emerald-500"
                           : node.decision === "Maybe"
                             ? "bg-amber-500/10 text-amber-500"
                             : node.decision === "Watchlist"
                               ? "bg-blue-500/10 text-blue-500"
                             : "bg-rose-500/10 text-rose-500"
                       }`}>
                         {node.decision}
                       </span>
                     )}
                  </div>
                  <h3 className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-tight break-words line-clamp-2">{node.name}</h3>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Mentions</p>
                  <p className="text-lg font-black italic text-blue-500 leading-none tabular-nums">{formatMentions(node.mentions)}</p>
                </div>
              </div>
              
              {viewMode === "detailed" && (
              <div className="bg-slate-50 dark:bg-white/5 p-5 rounded-3xl mb-6 border border-slate-100 dark:border-slate-800">
                 {node.compAgeLabel && (
                   <div className="mb-3">
                     <span className="inline-flex items-center rounded-full bg-slate-200/70 dark:bg-slate-800 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                       Comps checked: {node.compAgeLabel}
                     </span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center mb-2 italic">
                   <Info size={14} className="mr-2" /> Trend Intel:
                 </p>
                 <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 italic leading-relaxed mb-4 max-h-16 overflow-hidden">
                   {node.intel}
                 </p>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-3 italic"><CheckSquare size={14} className="mr-2 text-blue-500" /> Top Targets:</p>
                 <ul className="list-disc pl-5 space-y-2">
                   {node.what_to_buy && node.what_to_buy.slice(0, 5).map((item: string, i: number) => (
                     <li key={i} className="text-xs font-bold text-slate-700 dark:text-slate-300 italic">
                       {toTargetBullet(item, "style")}
                     </li>
                   ))}
                 </ul>
                 {Array.isArray(node.brands_to_watch) && node.brands_to_watch.length > 0 && (
                   <>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mt-4 mb-2 italic">
                       <Hash size={12} className="mr-2 text-blue-500" /> Brands to Watch:
                     </p>
                     <ul className="list-disc pl-5 space-y-1.5">
                       {node.brands_to_watch.slice(0, 3).map((brand: string, i: number) => (
                         <li key={i} className="text-xs font-bold text-slate-700 dark:text-slate-300 italic">
                           {brand}
                         </li>
                       ))}
                     </ul>
                   </>
                 )}
              </div>
              )}

              <div className="mt-auto space-y-4 pt-6 border-t dark:border-slate-800">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Used Pricing</p>
                  <p className="text-[11px] font-black text-slate-700 dark:text-slate-200">
                    {`Buy <= ${formatUsd(node.target_buy ?? node.entry_price)} | Sale ${formatUsd(node.expected_sale_low ?? node.expected_sale ?? node.entry_price)}-${formatUsd(node.expected_sale_high ?? node.expected_sale ?? node.entry_price)} | Net +${formatUsd(node.expected_profit ?? 0)}`}
                  </p>
                  {node.pricing_assumptions && <p className="mt-1 text-[9px] font-bold text-slate-500">{node.pricing_assumptions}</p>}
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Why This Score</p>
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    {node.confidence_reason || "Confidence is based on comp recency, sample size, and source evidence."}
                  </p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
                    {formatSourceEvidence(node.source_counts)}
                  </p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
                    Updated: {formatDateLabel(node.last_updated_at)} • Comps: {node.compAgeLabel || "Unknown"}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                   <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">Target Entry</p>
                      <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">${node.entry_price}</p>
                   </div>
                   <a 
                     href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(node.name + " vintage")}`}
                     target="_blank"
                     rel="noreferrer"
                     onClick={(e) => e.stopPropagation()} 
                     className="flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-white/5 rounded-2xl text-slate-400 hover:text-blue-500 transition-all border border-transparent hover:border-blue-500/10"
                   >
                      <ImageIcon size={18} />
                      <span className="text-[10px] font-black uppercase tracking-widest">View Photos</span>
                   </a>
                </div>
                {node.collectorRunAge && (
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Last scraper update: {node.collectorRunAge}
                  </p>
                )}
                <button onClick={(e) => { e.stopPropagation(); onAdd(node); }} className="w-full py-5 bg-blue-500 text-white rounded-2xl font-black uppercase italic text-xs tracking-widest hover:bg-slate-900 transition-all shadow-xl flex items-center justify-center gap-3">
                  <Plus size={18} /> Queue for Sourcing
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNodeSelect(node);
                  }}
                  className="w-full py-3 bg-blue-500/10 text-blue-500 rounded-2xl font-black uppercase italic text-[11px] tracking-widest hover:bg-blue-500/20 transition-all"
                >
                  View Details
                </button>
                {onOpenTrend && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDemoteTrend?.(node.signal_id);
                      onOpenTrend(node.name);
                    }}
                    className="w-full py-3 bg-rose-500/10 text-rose-500 rounded-2xl font-black uppercase italic text-[11px] tracking-widest hover:bg-rose-500/20 transition-all"
                  >
                    Track in Radar
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelected(String(node.id));
                  }}
                  className={`w-full py-3 rounded-2xl font-black uppercase italic text-[11px] tracking-widest transition-all ${
                    selectedIds.includes(String(node.id))
                      ? "bg-blue-500/15 text-blue-500"
                      : "bg-blue-500/10 text-blue-500"
                  }`}
                >
                  {selectedIds.includes(String(node.id)) ? "Selected" : "Select"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCompare(String(node.id));
                  }}
                  className={`w-full py-3 rounded-2xl font-black uppercase italic text-[11px] tracking-widest transition-all ${
                    compareIds.includes(String(node.id))
                      ? "bg-blue-500/15 text-blue-500"
                      : "bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {compareIds.includes(String(node.id)) ? "Compared" : "Compare"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {visibleTrendNodes.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">
              No style trends promoted yet. Use Promote on Radar to move nodes here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ConfidencePill({ confidence }: { confidence: ConfidenceLevel }) {
  const classes: Record<ConfidenceLevel, string> = {
    high: "bg-emerald-500/10 text-emerald-500",
    med: "bg-amber-500/10 text-amber-500",
    low: "bg-rose-500/10 text-rose-500",
  };
  const label: Record<ConfidenceLevel, string> = {
    high: "High",
    med: "Med",
    low: "Low",
  };

  return (
    <span
      className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${classes[confidence]}`}
      title="Confidence is based on comp sample size and recency."
    >
      {label[confidence]} Confidence
    </span>
  );
}
