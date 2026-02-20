"use client";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabase";

import SectionOverview from "@/components/dashboard/SectionOverview"; 
import SectionScout from "@/components/dashboard/SectionScout";
import SectionMissions from "@/components/dashboard/SectionMissions"; 
import SectionLedger from "@/components/dashboard/SectionLedger";
import SectionHeatmap from "@/components/dashboard/SectionHeatmap";
import SectionHunt from "@/components/dashboard/SectionHunt";
import SectionHistory from "@/components/dashboard/SectionHistory"; 
import SubredditFilter from "@/components/dashboard/SubredditFilter";
import { ListingModal } from "@/components/dashboard/ListingModal"; 

import { 
  Radar, LayoutDashboard, Wallet, Activity, 
  LogOut, Map, LayoutGrid, Hash, Package, X, Briefcase, Sun, Moon, Monitor, CheckSquare, Info, ChevronLeft, ChevronRight
} from "lucide-react";
import Link from "next/link";
import type { CollectorJob, CompCheck } from "@/lib/types";

const NULL_WARNING_THRESHOLD = 0.5;
const TRUNK_COLLAPSED_STORAGE_KEY = "thriftpulse_trunk_collapsed_v1";

function splitIntelToBullets(intel: string): string[] {
  return String(intel || "")
    .split(/[.?!]\s+/)
    .map((part) => part.trim().replace(/[.?!]$/, ""))
    .filter(Boolean);
}

function normalizeLabel(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildNodeSuggestions(node: any): string[] {
  const nodeName = String(node?.name || "").trim();
  const lowerName = nodeName.toLowerCase();
  const rawList = Array.isArray(node?.what_to_buy) ? node.what_to_buy : [];

  const mapped = rawList
    .map((item: string) => String(item || "").trim())
    .filter(Boolean)
    .map((item: string) => {
      if (normalizeLabel(item) !== normalizeLabel(nodeName)) return item;

      if (lowerName.includes("cardigan")) {
        return "Look for cardigan variants: chunky knit, cable knit, and wool-blend versions with strong condition.";
      }
      if (lowerName.includes("jacket")) {
        return "Look for jacket variants: cropped cuts, heavyweight fabric, and clean hardware with low wear.";
      }
      if (lowerName.includes("jean") || lowerName.includes("denim")) {
        return "Look for denim variants: high-rise, straight-leg, and faded-wash pairs with minimal damage.";
      }
      if (lowerName.includes("boot") || lowerName.includes("sneaker")) {
        return "Look for footwear variants: premium materials, clean soles, and high-demand colorways.";
      }
      return `Look for variations of ${nodeName}: stronger materials, cleaner condition, and distinctive silhouettes.`;
    });

  if (mapped.length > 0) return mapped;
  if (!nodeName) return [];
  return [`Look for variations of ${nodeName}: prioritize quality construction and clean condition.`];
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function buildNodeSnapshotBullets(node: any): string[] {
  const name = String(node?.name || "").trim();
  const t = name.toLowerCase();
  const targetBuy = Number(node?.target_buy ?? node?.entry_price ?? 0);
  const compLow = Number(node?.comp_low || 0);
  const compHigh = Number(node?.comp_high || 0);
  const sources = node?.source_counts || {};
  const sourceTypes =
    (Number(sources?.ebay || 0) > 0 ? 1 : 0) +
    (Number(sources?.google || 0) > 0 ? 1 : 0) +
    (Number(sources?.ai || 0) > 0 ? 1 : 0);

  const bullets: string[] = [];
  if (t.includes("jacket") || t.includes("coat") || t.includes("anorak")) {
    bullets.push(`${name}: prioritize zipper track, lining integrity, and cuff wear first.`);
  } else if (t.includes("jean") || t.includes("denim") || t.includes("cargo") || t.includes("pants")) {
    bullets.push(`${name}: inspect inseam/crotch/knee wear before considering style details.`);
  } else if (t.includes("boot") || t.includes("sneaker") || t.includes("shoe")) {
    bullets.push(`${name}: inspect outsole wear, heel drag, and upper structure.`);
  } else if (t.includes("hoodie") || t.includes("sweatshirt") || t.includes("cardigan") || t.includes("sweater")) {
    bullets.push(`${name}: check cuffs, collar shape, pilling, and shrinkage signs.`);
  } else {
    bullets.push(`${name}: prioritize clean condition and strong construction over trend hype.`);
  }

  if (Number.isFinite(targetBuy) && targetBuy > 0) {
    bullets.push(`Hard buy cap: $${Math.round(targetBuy)} unless condition/tags are exceptional.`);
  }
  if (compLow > 0 || compHigh > 0) {
    bullets.push(`Comp spread: $${Math.round(compLow)}-$${Math.round(compHigh)}. Favor pieces that can land near the upper third.`);
  }
  if (sourceTypes <= 1) {
    bullets.push("Evidence is narrow-source right now. Prioritize conservative buys.");
  } else {
    bullets.push(`Evidence spans ${sourceTypes} source types, which strengthens confidence.`);
  }

  return uniqStrings(bullets).slice(0, 4);
}

function logSchemaHealth(
  tableName: string,
  rows: Record<string, unknown>[] = [],
  requiredFields: string[]
) {
  if (!rows.length) {
    console.info(`[Schema Health] ${tableName}: no rows returned.`);
    return;
  }

  for (const field of requiredFields) {
    const nullishCount = rows.reduce((count, row) => {
      const value = row[field];
      return value === null || value === undefined ? count + 1 : count;
    }, 0);

    const nullRate = nullishCount / rows.length;
    if (nullRate >= NULL_WARNING_THRESHOLD) {
      console.warn(
        `[Schema Health] ${tableName}.${field} is ${Math.round(
          nullRate * 100
        )}% null in sampled data (${nullishCount}/${rows.length}).`
      );
    }
  }
}

export default function DashboardPage() {
  const { theme, setTheme } = useTheme();
  
  // --- HYDRATION FIX ---
  const [mounted, setMounted] = useState(false);
  
  const [activeView, setActiveView] = useState("overview");
  const [isDemoMode, setIsDemoMode] = useState(false); 
  const [selectedItem, setSelectedItem] = useState<any>(null); 
  const [selectedNode, setSelectedNode] = useState<any>(null); 
  const [trunk, setTrunk] = useState<any[]>([]);
  const [crossPageFocus, setCrossPageFocus] = useState("");
  const [isTrunkCollapsed, setIsTrunkCollapsed] = useState(true);

  // --- REAL DATA STATE ---
  const [realInventory, setRealInventory] = useState<any[]>([]);
  const [realStores, setRealStores] = useState<any[]>([]);
  const [realSignals, setRealSignals] = useState<any[]>([]); 
  const [realCompChecks, setRealCompChecks] = useState<CompCheck[]>([]);
  const [realCollectorJobs, setRealCollectorJobs] = useState<CollectorJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Header Mapping
  const viewLabels: Record<string, string> = {
    overview: "Overview",
    scout: "Decision Lab",
    hunt: "Store Map",
    missions: "Inventory",
    ledger: "Financials",
    analysis: "Radar",
    sources: "Sources"
  };
  const flowOrder = ["overview", "sources", "analysis", "scout", "hunt", "missions", "ledger"];
  const currentFlowIndex = Math.max(0, flowOrder.indexOf(activeView));
  const nextView = flowOrder[currentFlowIndex + 1] || null;
  const prevView = flowOrder[currentFlowIndex - 1] || null;

  useEffect(() => {
    setMounted(true);
    fetchRealData();
    try {
      const raw = localStorage.getItem(TRUNK_COLLAPSED_STORAGE_KEY);
      setIsTrunkCollapsed(raw === null ? true : raw === "1");
    } catch {
      setIsTrunkCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(TRUNK_COLLAPSED_STORAGE_KEY, isTrunkCollapsed ? "1" : "0");
  }, [isTrunkCollapsed, mounted]);

  // --- FETCH REAL SUPABASE DATA ---
  async function fetchRealData() {
    try {
      // 1. Fetch Inventory
      const { data: invData } = await supabase.from('inventory').select('*');
      if (invData) setRealInventory(invData);

      // 2. Fetch Stores
      const { data: storeData } = await supabase.from('stores').select('*');
      if (storeData) setRealStores(storeData);

      // 3. Fetch Market Signals (Reddit Trends) - SORTED BY HEAT
      const { data: signalData } = await supabase
        .from('market_signals')
        .select('*')
        .order('heat_score', { ascending: false });
        
      if (signalData) {
        setRealSignals(signalData);
        logSchemaHealth("market_signals", signalData, [
          "id",
          "trend_name",
          "heat_score",
          "exit_price",
        ]);
      }

      // 4. Fetch Comp Checks (optional table during rollout)
      const { data: compData, error: compError } = await supabase
        .from("comp_checks")
        .select(
          "id,signal_id,trend_name,sample_size,checked_at,price_low,price_high,notes,created_at,updated_at"
        )
        .order("checked_at", { ascending: false });
      if (compError) {
        console.warn("comp_checks unavailable or errored:", compError.message);
      } else if (compData) {
        setRealCompChecks(compData);
        logSchemaHealth("comp_checks", compData, [
          "signal_id",
          "sample_size",
          "checked_at",
        ]);
      }

      // 5. Fetch Collector Jobs (optional table during rollout)
      const { data: jobData, error: jobError } = await supabase
        .from("collector_jobs")
        .select(
          "id,source_name,status,started_at,completed_at,error_message,created_at,updated_at"
        )
        .order("completed_at", { ascending: false });
      if (jobError) {
        console.warn("collector_jobs unavailable or errored:", jobError.message);
      } else if (jobData) {
        setRealCollectorJobs(jobData);
        logSchemaHealth("collector_jobs", jobData, [
          "source_name",
          "status",
          "completed_at",
        ]);
      }
      
      setLoading(false);
    } catch (error) {
      console.error("Data Fetch Error:", error);
    }
  }

  const addToTrunk = (node: any) => {
    if (!trunk.find(item => item.id === node.id)) {
      setTrunk([...trunk, node]);
    }
  };

  const removeFromTrunk = (id: any) => setTrunk(trunk.filter(item => item.id !== id));
  const clearTrunk = () => setTrunk([]);
  const openViewWithFocus = (view: string, focus?: string) => {
    if (focus && String(focus).trim()) setCrossPageFocus(String(focus).trim());
    else setCrossPageFocus("");
    setActiveView(view);
  };
  const navigateView = (view: string) => {
    setCrossPageFocus("");
    setActiveView(view);
  };
  const updateSignalStage = async (signalIds: string[], stage: "radar" | "decision" | "archived") => {
    const ids = signalIds.map((v) => String(v || "").trim()).filter(Boolean);
    if (!ids.length) return;
    const nowIso = new Date().toISOString();

    setRealSignals((prev) =>
      prev.map((s: any) =>
        ids.includes(String(s?.id || ""))
          ? {
              ...s,
              pipeline_stage: stage,
              promoted_at: stage === "decision" ? s?.promoted_at || nowIso : s?.promoted_at,
              archived_at: stage === "archived" ? nowIso : s?.archived_at,
              stage_updated_at: nowIso,
            }
          : s
      )
    );

    const { error } = await supabase
      .from("market_signals")
      .update({
        pipeline_stage: stage,
        promoted_at: stage === "decision" ? nowIso : undefined,
        archived_at: stage === "archived" ? nowIso : undefined,
        stage_updated_at: nowIso,
      })
      .in("id", ids);

    if (error) {
      console.error(`Failed to set stage=${stage}:`, error.message);
      fetchRealData();
    }
  };
  const promoteSignalToDecisionLab = async (signalId?: string) => {
    const id = String(signalId || "").trim();
    if (!id) return;
    await updateSignalStage([id], "decision");
  };
  const demoteSignalToRadar = async (signalId?: string) => {
    const id = String(signalId || "").trim();
    if (!id) return;
    await updateSignalStage([id], "radar");
  };
  const archiveSignal = async (signalId?: string) => {
    const id = String(signalId || "").trim();
    if (!id) return;
    await updateSignalStage([id], "archived");
  };
  const reclassifySignalTrack = async (
    signalId: string,
    nextTrack: "Brand" | "Style Category",
    hookBrand?: string | null
  ) => {
    const id = String(signalId || "").trim();
    if (!id) return;
    const nowIso = new Date().toISOString();
    const normalizedHookBrand = String(hookBrand || "").trim();

    setRealSignals((prev) =>
      prev.map((s: any) =>
        String(s?.id || "") === id
          ? {
              ...s,
              track: nextTrack,
              hook_brand: nextTrack === "Brand" ? normalizedHookBrand || s?.hook_brand || s?.trend_name || "" : null,
              stage_updated_at: nowIso,
            }
          : s
      )
    );

    const updatePayload: Record<string, unknown> = {
      track: nextTrack,
      stage_updated_at: nowIso,
      hook_brand:
        nextTrack === "Brand"
          ? normalizedHookBrand || undefined
          : null,
    };
    const { error } = await supabase.from("market_signals").update(updatePayload).eq("id", id);
    if (error) {
      console.error("Failed to reclassify signal track:", error.message);
      fetchRealData();
    }
  };

  // --- CONFIRM FOUND ITEM (Trunk -> Database) ---
  const confirmFoundItem = async (trunkItem: any, storeName: string) => {
    const { error } = await supabase.from('inventory').insert([{
      name: trunkItem.name,
      status: 'washing', 
      buy_price: trunkItem.entry_price, 
      est_sell: trunkItem.entry_price * 2, 
      notes: `Sourced from ${storeName}`
    }]);

    if (!error) {
      alert(`✅ Secured: ${trunkItem.name} added to Inventory!`);
      removeFromTrunk(trunkItem.id);
      fetchRealData(); // Refresh to show in Inventory tab
    } else {
      alert("Error adding to inventory. Check console.");
      console.error(error);
    }
  };

  const hotSignalCount = realSignals.filter((s) => Number(s?.heat_score || 0) >= 85).length;
  const decisionLabSignals = realSignals.filter((s: any) => String(s?.pipeline_stage || "radar").toLowerCase() === "decision");
  const radarSignals = realSignals.filter((s: any) => String(s?.pipeline_stage || "radar").toLowerCase() === "radar");
  const activeSignals = realSignals.filter((s: any) => String(s?.pipeline_stage || "radar").toLowerCase() !== "archived");
  const healthyCollectorRuns = realCollectorJobs.filter((j) => {
    const status = String(j?.status || "").toLowerCase();
    return status === "success" || status === "completed" || status === "ok";
  }).length;

  if (!mounted) return null;

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-500">
      
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-72 h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-8">
        <div className="flex items-center space-x-3 mb-10 pl-2">
            <div className="h-10 w-10 bg-emerald-500 rounded-xl flex items-center justify-center text-slate-900 font-black italic shadow-lg shrink-0 text-xl">T</div>
            <h1 className="text-xl font-black italic uppercase tracking-tighter">ThriftPulse</h1>
        </div>
        
        <button onClick={() => setIsDemoMode(!isDemoMode)} className={`w-full flex items-center justify-between p-4 mb-8 rounded-2xl border transition-all ${isDemoMode ? 'bg-amber-500/10 border-amber-500 text-amber-600' : 'bg-emerald-500/10 border-emerald-500 text-emerald-600'}`}>
            <span className="text-[10px] font-black uppercase tracking-widest">{isDemoMode ? "DEMO ACTIVE" : "LIVE DATA"}</span>
            <div className={`h-4 w-8 rounded-full relative ${isDemoMode ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                <div className={`absolute top-1 h-2 w-2 bg-white rounded-full transition-all ${isDemoMode ? 'left-1' : 'left-5'}`} />
            </div>
        </button>

        <nav className="space-y-1.5 flex-1">
          <NavButton label="Overview" id="overview" icon={LayoutGrid} active={activeView} set={navigateView} color="emerald" />
          <NavButton label="Sources" id="sources" icon={Hash} active={activeView} set={navigateView} color="emerald" />
          <NavButton label="Radar" id="analysis" icon={Activity} active={activeView} set={navigateView} color="rose" />
          <NavButton label="Decision Lab" id="scout" icon={Radar} active={activeView} set={navigateView} color="emerald" />
          <NavButton label="Store Map" id="hunt" icon={Map} active={activeView} set={navigateView} color="blue" />
          <NavButton label="Inventory" id="missions" icon={LayoutDashboard} active={activeView} set={navigateView} color="purple" />
          <NavButton label="Financials" id="ledger" icon={Wallet} active={activeView} set={navigateView} color="amber" />
        </nav>

        <div className="pt-8 mt-auto border-t dark:border-slate-800 space-y-4">
           <div className="flex items-center justify-center p-2 bg-slate-100 dark:bg-slate-800 rounded-2xl space-x-2 border dark:border-slate-700">
              <ThemeIcon icon={Sun} active={theme === 'light'} onClick={() => setTheme('light')} />
              <ThemeIcon icon={Moon} active={theme === 'dark'} onClick={() => setTheme('dark')} />
              <ThemeIcon icon={Monitor} active={theme === 'system'} onClick={() => setTheme('system')} />
           </div>
           <Link href="/" className="flex items-center space-x-3 p-4 text-slate-500 hover:text-red-500 font-bold text-sm transition-all"><LogOut size={20} /><span>Exit Hub</span></Link>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 h-full overflow-y-auto p-16 relative">
        <header className="mb-12 text-left">
          <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500 mb-2 italic">Sector: 30064 // {activeView.toUpperCase()}</h2>
          <h3 className="text-5xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">
             {viewLabels[activeView]}
          </h3>
          <div className="mt-6 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-2">
            <button
              onClick={() => fetchRealData()}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
            >
              Refresh Data
            </button>
            <button
              onClick={() => navigateView("sources")}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
            >
              Open Sources
            </button>
            <button
              onClick={() => navigateView("analysis")}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
            >
              Open Radar
            </button>
            <button
              onClick={() => navigateView("scout")}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-rose-500/10 text-rose-500 border border-rose-500/30 hover:bg-rose-500/20 transition-colors"
            >
              Open Decision Lab
            </button>
            {prevView && (
              <button
                onClick={() => navigateView(prevView)}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300/50 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Previous: {viewLabels[prevView]}
              </button>
            )}
            {nextView && (
              <button
                onClick={() => navigateView(nextView)}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
              >
                Next: {viewLabels[nextView]}
              </button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Radar: {radarSignals.length}
              </span>
              <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Decision: {decisionLabSignals.length}
              </span>
              <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Hot: {hotSignalCount}
              </span>
              <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Stores: {realStores.length}
              </span>
              <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Trunk: {trunk.length}
              </span>
              <span className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Healthy Runs: {healthyCollectorRuns}
              </span>
            </div>
          </div>
        </header>

        <div className="animate-in fade-in duration-500">
          {activeView === "overview" && (
            <SectionOverview
              missions={realInventory}
              signals={realSignals}
              stores={realStores}
              compChecks={realCompChecks}
              collectorJobs={realCollectorJobs}
              onNavigate={setActiveView}
            />
          )}
          
          {/* RESEARCH: Now receives real Reddit Trends */}
          {activeView === "scout" && (
            <SectionScout
              signals={decisionLabSignals}
              compChecks={realCompChecks}
              collectorJobs={realCollectorJobs}
              onAdd={addToTrunk}
              onNodeSelect={setSelectedNode}
              onOpenTrend={(term) => openViewWithFocus("analysis", term)}
              onDemoteTrend={(signalId) => demoteSignalToRadar(signalId)}
              onArchiveTrend={(signalId) => archiveSignal(signalId)}
              onReclassifySignal={(signalId, nextTrack, hookBrand) =>
                reclassifySignalTrack(signalId, nextTrack, hookBrand)
              }
              focusTerm={crossPageFocus}
              allowFallback={false}
            />
          )}
          
          {/* STORE MAP: Now receives real Trunk data and real Stores */}
          {activeView === "hunt" && (
            <SectionHunt 
              location="30064" 
              stores={realStores} 
              trunk={trunk} 
              onConfirmFound={confirmFoundItem} 
            />
          )}
          
          {/* INVENTORY: Now receives real Inventory */}
          {activeView === "missions" && (
            <div className="space-y-16">
              <SectionMissions activeMissions={realInventory} onAddMission={() => fetchRealData()} />
              <SectionHistory currency="USD" />
            </div>
          )}

          {activeView === "ledger" && <SectionLedger missions={realInventory} />}
          
          {/* HEATMAP: Now receives real Reddit Trends */}
          {activeView === "analysis" && (
            <SectionHeatmap
              signals={activeSignals}
              compChecks={realCompChecks}
              onAddTrend={addToTrunk}
              onTrendClick={(_, signalId) => {
                promoteSignalToDecisionLab(signalId);
              }}
              onPromoteTrend={(signalId) => promoteSignalToDecisionLab(signalId)}
              focusTerm={crossPageFocus}
            />
          )}
          
          {activeView === "sources" && <SubredditFilter />}
        </div>

        {/* --- RESEARCH NODE POP-UP MODAL --- */}
        {selectedNode && (
          <>
          <div
            className="fixed inset-0 bg-slate-950/45 backdrop-blur-[1px] z-40"
            onClick={() => setSelectedNode(null)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[88vh] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-3xl p-8 overflow-y-auto animate-in zoom-in-95 duration-200">
            <button onClick={() => setSelectedNode(null)} className="mb-8 flex items-center text-xs font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors">
              <X size={16} className="mr-2" /> Close
            </button>
            
            <div className="mb-8">
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${selectedNode.type === 'brand' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'}`}>
                {selectedNode.type === 'brand' ? 'Brand Node' : 'Style Trend'}
              </span>
              <h2 className="text-4xl font-black italic uppercase tracking-tighter mt-4 leading-tight">{selectedNode.name}</h2>
              {selectedNode.brandRef && <p className="text-lg font-bold text-slate-400 italic">via {selectedNode.brandRef}</p>}
            </div>

            <div className="space-y-6">
              {(selectedNode.decision || selectedNode.decision_reason) && (
                <div className="bg-slate-50 dark:bg-white/5 p-6 rounded-3xl border border-slate-200 dark:border-slate-700">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Buy Decision</h4>
                  <div className="flex items-center gap-3 mb-3">
                    {selectedNode.decision && (
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        selectedNode.decision === "Buy"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : selectedNode.decision === "Maybe"
                            ? "bg-amber-500/10 text-amber-500"
                            : selectedNode.decision === "Watchlist"
                              ? "bg-blue-500/10 text-blue-500"
                            : "bg-rose-500/10 text-rose-500"
                      }`}>
                        {selectedNode.decision}
                      </span>
                    )}
                  </div>
                  {selectedNode.decision_reason && (
                    <p className="text-sm font-medium italic text-slate-600 dark:text-slate-300 leading-relaxed">
                      {selectedNode.decision_reason}
                    </p>
                  )}
                </div>
              )}

              <div className="bg-slate-50 dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-slate-700">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Used Pricing (Card View)</h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400">Target Buy</p>
                    <p className="text-xl font-black text-slate-900 dark:text-white">${selectedNode.target_buy ?? selectedNode.entry_price}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400">Expected Sale</p>
                    <p className="text-xl font-black text-slate-900 dark:text-white">${selectedNode.expected_sale ?? selectedNode.entry_price}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400">Expected Profit</p>
                    <p className="text-xl font-black text-emerald-500">${selectedNode.expected_profit ?? 0}</p>
                  </div>
                </div>
                {(selectedNode.comp_low || selectedNode.comp_high) && (
                  <p className="mt-3 text-[11px] font-black uppercase tracking-widest text-slate-500">
                    Comp Range: ${selectedNode.comp_low || 0} - ${selectedNode.comp_high || 0}
                  </p>
                )}
                {(selectedNode.expected_sale_low || selectedNode.expected_sale_high) && (
                  <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                    Likely Sale: ${selectedNode.expected_sale_low || selectedNode.expected_sale || 0} - ${selectedNode.expected_sale_high || selectedNode.expected_sale || 0}
                  </p>
                )}
                {selectedNode.pricing_assumptions && (
                  <p className="mt-2 text-xs font-bold italic text-slate-500">{selectedNode.pricing_assumptions}</p>
                )}
              </div>

              {(selectedNode.confidence_reason || selectedNode.last_updated_at || selectedNode.source_counts) && (
                <div className="bg-slate-50 dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-slate-700">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Why This Score</h4>
                  {selectedNode.confidence_reason && (
                    <p className="text-sm font-bold italic text-slate-600 dark:text-slate-300">{selectedNode.confidence_reason}</p>
                  )}
                  {selectedNode.source_counts && (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Sources: eBay {selectedNode.source_counts.ebay || 0} • Google {selectedNode.source_counts.google || 0} • AI {selectedNode.source_counts.ai || 0}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Updated: {selectedNode.last_updated_at ? new Date(selectedNode.last_updated_at).toLocaleDateString() : "Unknown"} • Comps: {selectedNode.compAgeLabel || "Unknown"}
                  </p>
                </div>
              )}

              <div className="bg-slate-50 dark:bg-white/5 p-5 rounded-3xl border border-slate-200 dark:border-slate-700">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Node Snapshot</h4>
                <ul className="list-disc pl-5 space-y-2">
                  {buildNodeSnapshotBullets(selectedNode).map((line, i) => (
                    <li key={i} className="text-sm font-medium italic text-slate-600 dark:text-slate-300 leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              {splitIntelToBullets(selectedNode.intel).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center">
                    <Info size={14} className="mr-2" /> Sourcing Intelligence
                  </h4>
                  <ul className="list-disc pl-5 space-y-1.5">
                    {splitIntelToBullets(selectedNode.intel).slice(0, 3).map((line: string, i: number) => (
                      <li key={i} className="text-xs font-bold text-slate-700 dark:text-slate-200 italic">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {buildNodeSuggestions(selectedNode).length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center">
                    <CheckSquare size={14} className="mr-2" /> Top Targets (Same As Card)
                  </h4>
                  <ul className="space-y-2">
                    {buildNodeSuggestions(selectedNode).slice(0, 4).map((item: string, i: number) => (
                      <li key={i} className="flex items-start text-sm font-bold text-slate-700 dark:text-slate-200">
                        <span className="mr-2 leading-5 text-blue-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {Array.isArray(selectedNode.brands_to_watch) && selectedNode.brands_to_watch.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center">
                    <Hash size={14} className="mr-2" /> Brands to Watch
                  </h4>
                  <ul className="space-y-2">
                    {selectedNode.brands_to_watch.map((brand: string, i: number) => (
                      <li key={i} className="flex items-start text-sm font-bold text-slate-700 dark:text-slate-200">
                        <span className="mr-2 leading-5 text-blue-500">•</span>
                        <span>{brand}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-8 border-t dark:border-slate-800 space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Target Entry</span>
                  <span className="text-3xl font-black text-slate-900 dark:text-white">${selectedNode.entry_price}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button 
                    onClick={() => { addToTrunk(selectedNode); setSelectedNode(null); }}
                    className="w-full py-5 bg-emerald-500 text-white rounded-2xl font-black uppercase italic text-sm tracking-widest hover:bg-emerald-600 transition-all shadow-xl"
                  >
                    Add to Sourcing Trunk
                  </button>
                  <button
                    onClick={() => {
                      addToTrunk(selectedNode);
                      openViewWithFocus("hunt", selectedNode?.name);
                      setSelectedNode(null);
                    }}
                    className="w-full py-5 bg-blue-500 text-white rounded-2xl font-black uppercase italic text-sm tracking-widest hover:bg-blue-600 transition-all shadow-xl"
                  >
                    Add + Open Store Map
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>
          </>
        )}
      </main>

      {/* RIGHT SIDEBAR */}
      <aside className={`${isTrunkCollapsed ? "w-16" : "w-96"} h-full bg-slate-100 dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 flex flex-col z-40 relative transition-all duration-200`}>
        <button
          onClick={() => setIsTrunkCollapsed((v) => !v)}
          className="absolute -left-3 top-6 h-7 w-7 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center z-50 shadow"
          title={isTrunkCollapsed ? "Expand Sourcing Trunk" : "Collapse Sourcing Trunk"}
        >
          {isTrunkCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
        {isTrunkCollapsed ? (
          <div className="h-full flex flex-col items-center pt-12">
            <Briefcase size={18} className="text-slate-500" />
            <p className="mt-3 [writing-mode:vertical-rl] rotate-180 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Sourcing Trunk ({trunk.length})
            </p>
          </div>
        ) : (
        <div className="flex flex-col h-full p-8">
          {crossPageFocus && (
            <div className="mb-4 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-blue-500">Shared Focus</p>
              <p className="text-xs font-black italic text-slate-700 dark:text-slate-200 mt-1">{crossPageFocus}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => openViewWithFocus("scout")} className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-900 text-[9px] font-black uppercase">Research</button>
                <button onClick={() => openViewWithFocus("analysis")} className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-900 text-[9px] font-black uppercase">Trends</button>
                <button onClick={() => setCrossPageFocus("")} className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-900 text-[9px] font-black uppercase text-rose-500">Clear</button>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 italic flex items-center gap-2">
              <Briefcase size={14} /> Sourcing Trunk (Confirmation Panel)
            </h3>
            {trunk.length > 0 && <button onClick={clearTrunk} className="text-[10px] font-black uppercase text-red-500 hover:underline">Clear All</button>}
          </div>

          <div className="flex-1 overflow-y-auto space-y-4">
            {trunk.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-30 text-slate-400">
                <Package size={48} className="mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest">Trunk Empty</p>
              </div>
            ) : (
              trunk.map((item) => (
                <div key={item.id} className="p-6 bg-white dark:bg-slate-900 rounded-[2rem] border dark:border-slate-800 shadow-sm relative group animate-in slide-in-from-right">
                  <button onClick={() => removeFromTrunk(item.id)} className="absolute top-5 right-5 text-slate-300 hover:text-red-500 transition-colors"><X size={14} /></button>
                  
                  <h4 className="text-xl font-black italic uppercase tracking-tighter dark:text-white leading-none mb-3 pr-6">{item.name}</h4>
                  
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${item.type === 'brand' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                      {item.type === 'brand' ? 'Brand' : 'Trend'}
                    </span>
                    <span className="text-sm font-black text-slate-900 dark:text-white">Target: ${item.entry_price}</span>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center">
                        <Info size={10} className="mr-1" /> Sourcing Intel
                      </p>
                      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 italic leading-relaxed">
                        "{item.intel}"
                      </p>
                    </div>

                    {item.what_to_buy && item.what_to_buy.length > 0 && (
                      <div className="bg-blue-50/50 dark:bg-blue-500/10 p-4 rounded-2xl border border-blue-100 dark:border-blue-500/20">
                        <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-2 flex items-center">
                          <CheckSquare size={10} className="mr-1" /> Checklist:
                        </p>
                        <ul className="space-y-1.5">
                          {item.what_to_buy.map((tip: string, i: number) => (
                            <li key={i} className="flex items-start text-[10px] font-bold text-slate-700 dark:text-slate-300 italic">
                              <span className="h-1 w-1 rounded-full bg-blue-500 mt-1.5 mr-2 shrink-0" /> {tip}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {trunk.length > 0 && (
            <button onClick={() => setActiveView("hunt")} className="w-full mt-8 py-5 bg-emerald-500 text-slate-900 font-black uppercase italic text-xs tracking-widest rounded-2xl shadow-xl hover:scale-[1.02] transition-all">Generate Route ({trunk.length})</button>
          )}
        </div>
        )}
      </aside>

      <ListingModal item={selectedItem} isOpen={!!selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}

function NavButton({ label, id, icon: Icon, active, set, color }: any) {
  const isActive = active === id;
  const colorMap: any = { emerald: "text-emerald-500", blue: "text-blue-500", purple: "text-purple-500", amber: "text-amber-500", rose: "text-rose-500" };
  return (
    <button onClick={() => set(id)} className={`w-full flex items-center p-4 rounded-2xl transition-all ${isActive ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 shadow-xl' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      <Icon size={20} className={isActive ? "" : colorMap[color]} />
      <span className="ml-4 text-xs font-black uppercase tracking-tight">{label}</span>
    </button>
  );
}

function ThemeIcon({ icon: Icon, active, onClick }: any) {
  return (
    <button onClick={onClick} className={`p-2.5 rounded-xl transition-all ${active ? 'bg-white dark:bg-slate-700 text-emerald-500 shadow-md border dark:border-slate-600' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'}`}><Icon size={18} /></button>
  );
}
