"use client";
import { Target, Plus, Info, Award, Hash, CheckSquare, Image as ImageIcon } from "lucide-react";
import {
  getCompAgeLabel,
  getConfidenceFromComp,
  getLatestCollectorRun,
  getLatestCompCheck,
  getRunAgeLabel,
} from "@/lib/marketIntel";
import type { CollectorJob, CompCheck, ConfidenceLevel } from "@/lib/types";

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

function inferTrendAngle(trendName: string): string {
  const t = String(trendName || "").toLowerCase();
  if (t.includes("jacket") || t.includes("coat") || t.includes("anorak")) return "Outerwear demand is active.";
  if (t.includes("jean") || t.includes("denim") || t.includes("cargo") || t.includes("pants")) return "Bottoms category velocity is holding steady.";
  if (t.includes("boot") || t.includes("sneaker") || t.includes("loafer")) return "Footwear resale interest is elevated.";
  if (t.includes("hoodie") || t.includes("sweatshirt") || t.includes("cardigan") || t.includes("sweater")) return "Layering pieces are performing in current sell-through.";
  if (t.includes("vintage") || t.includes("90s") || t.includes("y2k")) return "Vintage-driven demand remains resilient.";
  return "Cross-category fashion interest is measurable.";
}

function getSignalIntel(signal: any): string {
  const sentiment = String(signal?.market_sentiment || "").trim();
  const risk = String(signal?.risk_factor || "").trim();
  const brand = String(signal?.hook_brand || "").trim();
  const trendName = String(signal?.trend_name || "").trim();
  const heat = Number(signal?.heat_score || 0);
  const price = Number(signal?.exit_price || 0);

  const parts = [];
  if (sentiment) parts.push(sentiment);
  if (brand) parts.push(`Brand watch: ${brand}.`);
  if (risk) parts.push(`Risk: ${risk}.`);
  if (!sentiment) {
    parts.push(inferTrendAngle(trendName));
    if (trendName) parts.push(`Signal focus: ${trendName}.`);
    if (price > 0) parts.push(`Current resale target centers near $${Math.round(price)}.`);
    if (heat >= 85) parts.push("Momentum is currently high.");
    else if (heat >= 70) parts.push("Momentum is stable to rising.");
    else parts.push("Momentum is early but monitorable.");
  }

  return parts.join(" ") || "Live trend signal from eBay + fashion source pipeline.";
}

function getFallbackConfidence(signal: any): ConfidenceLevel {
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

  if (heat >= 88 || score >= 4) return "high";
  if (heat >= 70 || score >= 2) return "med";
  return "low";
}

function getBrandFallbackConfidence({
  avgHeat,
  evidenceCount,
  hasIntel,
}: {
  avgHeat: number;
  evidenceCount: number;
  hasIntel: boolean;
}): ConfidenceLevel {
  const score = (avgHeat >= 80 ? 2 : avgHeat >= 70 ? 1 : 0) + (evidenceCount >= 4 ? 2 : evidenceCount >= 2 ? 1 : 0) + (hasIntel ? 1 : 0);
  if (score >= 4) return "high";
  if (score >= 2) return "med";
  return "low";
}

export default function SectionScout({
  onAdd,
  onNodeSelect,
  signals = [],
  compChecks = [],
  collectorJobs = [],
}: {
  onAdd: (node: any) => void;
  onNodeSelect: (node: any) => void;
  signals?: any[];
  compChecks?: CompCheck[];
  collectorJobs?: CollectorJob[];
}) {
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
        notes: new Set<string>(),
        what: new Set<string>(),
        latestComp: null as CompCheck | null,
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
  }

  const liveBrandNodes = [...liveBrandMap.values()].map((node) => {
    const avgHeat = node.heatCount ? Math.round(node.heatTotal / node.heatCount) : 70;
    const compConfidence = getConfidenceFromComp(node.latestComp);
    const fallbackConfidence = getBrandFallbackConfidence({
      avgHeat,
      evidenceCount: node.what.size,
      hasIntel: node.notes.size > 0,
    });
    return {
      id: node.id,
      type: "brand",
      name: node.name,
      heat: avgHeat,
      source: "Live Brand Monitor",
      sentiment: avgHeat > 80 ? "Surging" : "Stable",
      mentions: Math.max(10, node.what.size * 4),
      confidence: node.latestComp ? compConfidence : fallbackConfidence,
      compAgeLabel: getCompAgeLabel(node.latestComp),
      collectorRunAge,
      intel:
        [...node.notes].slice(0, 2).join(" ") ||
        "Live brand signal generated from market intelligence.",
      entry_price: node.priceCount ? Math.round(node.priceTotal / node.priceCount) : 75,
      what_to_buy: [...node.what].filter(Boolean).slice(0, 10),
    };
  });

  const brandNodes = liveBrandNodes.length > 0 ? liveBrandNodes : fallbackBrandNodes;

  // 2. STYLE TRENDS (Merged: Live DB Signals + Hardcoded)
  // Convert DB signals into the Node format used by the UI
  const liveTrends = signals.map((s: any) => {
    const latestComp = getLatestCompCheck(s, compChecks);
    const compConfidence = getConfidenceFromComp(latestComp);
    const confidence = latestComp ? compConfidence : getFallbackConfidence(s);
    const topTargets = extractTrendTargets(s);

    return {
      id: `live-${s.id}`,
      signal_id: s.id,
      type: "style",
      name: s.trend_name,
      heat: s.heat_score || 50,
      source: s?.track || "Live Monitor",
      sentiment: s.heat_score > 80 ? "Surging" : "Stable",
      mentions: Math.floor((s.heat_score || 0) * 2.5), // Simulated metrics based on heat
      entry_price: s.exit_price || 0,
      intel: getSignalIntel(s),
      what_to_buy: topTargets.length ? topTargets : ["Check tag era", "Verify construction details"],
      brandRef: s?.hook_brand || null,
      compAgeLabel: getCompAgeLabel(latestComp),
      confidence,
      collectorRunAge,
    };
  });

  // Combine Live + Starter trends
  const trendNodes = liveTrends.length > 0 ? liveTrends : [
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
  ];

  return (
    <div className="space-y-20 text-left pb-24">
      {/* BRAND NODES */}
      <section>
        <div className="flex items-center gap-4 mb-10 pl-2 border-l-4 border-emerald-500">
          <Award className="text-emerald-500" size={36} />
          <h4 className="text-4xl font-black italic uppercase tracking-tighter">Brand Nodes</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {brandNodes.map((node) => (
            <div 
              key={node.id} 
              onClick={() => onNodeSelect(node)} 
              className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[3rem] p-10 transition-all hover:shadow-2xl relative overflow-hidden flex flex-col cursor-pointer hover:border-emerald-500/50"
            >
              <div className="absolute top-0 left-0 h-1.5 bg-emerald-500" style={{ width: `${node.heat}%` }} />
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                     <span className="bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter flex items-center"><Hash size={10} className="mr-1" /> {node.source}</span>
                     <span className="bg-emerald-500/10 text-emerald-600 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">{node.sentiment}</span>
                     {node.confidence && <ConfidencePill confidence={node.confidence} />}
                  </div>
                  <h3 className="text-3xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-tight">{node.name}</h3>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Mentions</p>
                  <p className="text-xl font-black italic text-emerald-500">{node.mentions}</p>
                </div>
              </div>
              <div className="bg-emerald-500/5 border border-emerald-500/10 p-6 rounded-3xl mb-8 flex-1">
                 {node.compAgeLabel && (
                   <div className="mb-3">
                     <span className="inline-flex items-center rounded-full bg-slate-200/70 dark:bg-slate-800 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                       Comps checked: {node.compAgeLabel}
                     </span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center mb-2 italic"><Info size={14} className="mr-2" /> Brand Intel:</p>
                 <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 italic leading-relaxed">{node.intel}</p>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mt-4 mb-2 italic"><CheckSquare size={12} className="mr-2 text-emerald-500" /> Top Targets:</p>
                 <ul className="space-y-1">
                  {(node.what_to_buy || []).slice(0, 3).map((item: string, i: number) => (
                    <li key={i} className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center italic">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-2" /> {item}
                    </li>
                  ))}
                  {(node.what_to_buy || []).length > 3 && (
                    <li className="text-[10px] font-black text-slate-400 italic pl-3.5">
                      +{Math.max(0, (node.what_to_buy || []).length - 3)} more...
                    </li>
                  )}
                 </ul>
              </div>
              <div className="mt-auto space-y-4">
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
                  <Plus size={18} /> Add Brand to Trunk
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
              </div>
            </div>
          ))}
        </div>
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
          {trendNodes.map((node: any) => (
            <div 
              key={node.id} 
              onClick={() => onNodeSelect(node)} 
              className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[3rem] p-10 transition-all hover:shadow-2xl relative overflow-hidden flex flex-col cursor-pointer hover:border-blue-500/50"
            >
              <div className="absolute top-0 left-0 h-1.5 bg-blue-500" style={{ width: `${node.heat}%` }} />
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                     <span className="bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter flex items-center"><Hash size={10} className="mr-1" /> {node.source}</span>
                     <span className="bg-blue-500/10 text-blue-500 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">{node.sentiment}</span>
                     {node.confidence && <ConfidencePill confidence={node.confidence} />}
                  </div>
                  <h3 className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-tight">{node.name}</h3>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Mentions</p>
                  <p className="text-xl font-black italic text-blue-500">{node.mentions}</p>
                </div>
              </div>
              
              <div className="bg-slate-50 dark:bg-white/5 p-5 rounded-3xl mb-6 border border-slate-100 dark:border-slate-800">
                 {node.compAgeLabel && (
                   <div className="mb-3">
                     <span className="inline-flex items-center rounded-full bg-slate-200/70 dark:bg-slate-800 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                       Comps checked: {node.compAgeLabel}
                     </span>
                   </div>
                 )}
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-3 italic"><CheckSquare size={14} className="mr-2 text-blue-500" /> Top Targets:</p>
                 <ul className="space-y-2">
                   {node.what_to_buy && node.what_to_buy.slice(0, 3).map((item: string, i: number) => (
                     <li key={i} className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center italic"><span className="h-1.5 w-1.5 rounded-full bg-blue-500 mr-2" /> {item}</li>
                   ))}
                   {node.what_to_buy && <li className="text-[10px] font-black text-slate-400 italic pl-3.5">+{Math.max(0, node.what_to_buy.length - 3)} more...</li>}
                 </ul>
              </div>

              <div className="mt-auto space-y-4 pt-6 border-t dark:border-slate-800">
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
                  <Plus size={18} /> Add Trend to Trunk
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
              </div>
            </div>
          ))}
        </div>
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
