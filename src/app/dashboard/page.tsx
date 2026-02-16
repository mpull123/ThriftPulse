"use client";
export const dynamic = 'force-dynamic'; // CRITICAL FIX: Skips static build crash

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabase";

// --- IMPORTS (Adjust levels based on your folder depth) ---
import SectionOverview from "../../components/dashboard/SectionOverview"; 
import SectionScout from "../../components/dashboard/SectionScout";
import SectionMissions from "../../components/dashboard/SectionMissions"; 
import SectionLedger from "../../components/dashboard/SectionLedger";
import SectionHeatmap from "../../components/dashboard/SectionHeatmap";
import SectionHunt from "../../components/dashboard/SectionHunt";
import { ListingModal } from "../../components/dashboard/ListingModal"; 

import { 
  Radar, LayoutDashboard, Wallet, Activity, 
  LogOut, Menu, Map, Info, Sparkles, LayoutGrid,
  Sun, Moon, Monitor
} from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeView, setActiveView] = useState("overview");
  
  const [missions, setMissions] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);

  useEffect(() => {
    setMounted(true);
    const loadLiveContent = async () => {
      const [inv, sig, str] = await Promise.all([
        supabase.from('inventory').select('*').order('created_at', { ascending: false }),
        supabase.from('market_signals').select('*, ai_description').order('heat_score', { ascending: false }),
        supabase.from('stores').select('*').eq('zip_code', '30064').order('power_rank', { ascending: false })
      ]);
      setMissions(inv.data || []);
      setSignals(sig.data || []);
      setStores(str.data || []);
    };
    loadLiveContent();
  }, []);

  if (!mounted) return null;

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-500">
      <aside className={`h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex flex-col justify-between p-6 ${isDesktopSidebarCollapsed ? 'w-24' : 'w-72'}`}>
        <div>
          <div className="flex items-center space-x-3 mb-10 pl-2">
            <div className="h-10 w-10 bg-emerald-500 rounded-xl flex items-center justify-center text-slate-900 font-black italic shadow-lg shrink-0 text-xl">T</div>
            {!isDesktopSidebarCollapsed && <h1 className="text-xl font-black italic uppercase tracking-tighter">ThriftPulse</h1>}
          </div>
          <nav className="space-y-2">
            <NavButton label="Overview" id="overview" icon={LayoutGrid} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed} color="emerald" />
            <NavButton label="Research" id="scout" icon={Radar} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed} color="emerald" />
            <NavButton label="Map" id="hunt" icon={Map} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed} color="blue" />
            <NavButton label="Inventory" id="missions" icon={LayoutDashboard} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed} badge={missions.length} color="purple" />
            <NavButton label="Financials" id="ledger" icon={Wallet} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed} color="amber" />
          </nav>
        </div>
        <Link href="/" className="flex items-center space-x-3 p-4 text-slate-500 hover:text-red-500 font-bold text-sm shrink-0">
          <LogOut size={20} />
          {!isDesktopSidebarCollapsed && <span>Exit Room</span>}
        </Link>
      </aside>

      <main className="flex-1 h-full overflow-y-auto p-12 max-w-[1600px] mx-auto scroll-smooth">
        <div className="animate-in fade-in duration-700">
          {activeView === "overview" && <SectionOverview missions={missions} signals={signals} stores={stores} onNavigate={setActiveView} onTaskExecute={() => {}} />}
          {activeView === "scout" && <SectionScout searchTerm={globalSearch} onAddMission={() => {}} onViewAI={(item) => setSelectedItem(item)} />}
          {activeView === "hunt" && <SectionHunt location="30064" signals={signals} />} 
          {activeView === "missions" && <SectionMissions activeMissions={missions} onAddMission={() => {}} />}
          {activeView === "ledger" && <SectionLedger missions={missions} />}
        </div>

        <ListingModal 
          item={selectedItem} 
          isOpen={!!selectedItem} 
          onClose={() => setSelectedItem(null)} 
        />
      </main>
    </div>
  );
}

// NavButton and ThemeIcon helpers...
function NavButton({ label, id, icon: Icon, active, set, collapsed, badge, color }: any) {
  const isActive = active === id;
  const colorMap: any = { emerald: "text-emerald-500", blue: "text-blue-500", purple: "text-purple-500", amber: "text-amber-500", rose: "text-rose-500" };
  return (
    <button onClick={() => set(id)} className={`w-full flex items-center p-4 rounded-2xl transition-all duration-300 group relative ${isActive ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 shadow-xl' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      <Icon size={24} className={isActive ? "" : colorMap[color]} />
      {!collapsed && <span className="ml-4 text-sm font-black uppercase tracking-tight">{label}</span>}
      {badge > 0 && <div className="absolute right-4 bg-red-500 text-white text-[10px] font-black h-5 w-5 rounded-full flex items-center justify-center">{badge}</div>}
    </button>
  );
}