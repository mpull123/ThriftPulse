"use client";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabase";

// --- FIXED PATHS ---
import SectionOverview from "../components/dashboard/SectionOverview"; 
import SectionScout from "../components/dashboard/SectionScout";
import SectionMissions from "../components/dashboard/SectionMissions"; 
import SectionLedger from "../components/dashboard/SectionLedger";
import SectionHeatmap from "../components/dashboard/SectionHeatmap";
import SectionHunt from "../components/dashboard/SectionHunt";
import SubredditFilter from "../components/dashboard/SubredditFilter";

// --- NEW IMPORT ---
import { ListingModal } from "../components/dashboard/ListingModal"; 

import { 
  Radar, LayoutDashboard, Wallet, Activity, 
  LogOut, Menu, Map, Info, Sparkles, LayoutGrid, Hash,
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
  
  // --- NEW STATE FOR AI MODAL ---
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const [notification, setNotification] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);

  const loadLiveContent = async () => {
    const [inv, sig, str] = await Promise.all([
      supabase.from('inventory').select('*').order('created_at', { ascending: false }),
      // UPDATED: Added ai_description to the select string below
      supabase.from('market_signals').select('*, ai_description').order('heat_score', { ascending: false }),
      supabase.from('stores').select('*').eq('zip_code', '30064').order('power_rank', { ascending: false })
    ]);
    
    setMissions(inv.data || []);
    setSignals(sig.data || []);
    setStores(str.data || []);
  };

  useEffect(() => {
    setMounted(true);
    loadLiveContent();
  }, []);

  // ... (keeping your existing handlers: handleAddMission, handleTaskAction, etc.)
  const handleAddMission = async (node: any) => {
    const newItem = {
      name: node.trend_name,
      status: 'in_trunk',
      buy_price: node.manualBuyPrice ?? (node.exit_price * 0.4), 
      est_sell: node.exit_price,
      date: new Date().toLocaleDateString()
    };
    const { data, error } = await supabase.from('inventory').insert([newItem]).select();
    if (!error && data) {
      setMissions([data[0], ...missions]);
      setNotification(`Asset Secured: ${node.trend_name}`);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleTaskAction = async (taskType: string) => {
    if (taskType === 'list_all') {
      const { error } = await supabase.from('inventory').update({ status: 'listed' }).eq('status', 'in_trunk');
      if (!error) {
        setMissions(missions.filter(m => m.status === 'listed'));
        setNotification("Inventory Successfully Listed");
        setTimeout(() => setNotification(null), 3000);
      }
    }
  };

  const handleTrendClick = (trendName: string) => {
    setGlobalSearch(trendName); 
    setActiveView("scout");     
    setNotification(`Targeting: ${trendName}`);
    setTimeout(() => setNotification(null), 3000);
  };

  if (!mounted) return null;

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-500">
      
      {/* Sidebar (Keeping your existing sidebar exactly as is) */}
      <aside className={`fixed md:relative z-[70] h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex flex-col justify-between p-6 ${isDesktopSidebarCollapsed ? 'md:w-24' : 'md:w-72'}`}>
        <div>
          <div className="flex items-center space-x-3 mb-10 pl-2">
            <div className="h-10 w-10 bg-emerald-500 rounded-xl flex items-center justify-center text-slate-900 font-black shadow-lg shrink-0 text-xl italic">T</div>
            {(!isDesktopSidebarCollapsed || isMobileMenuOpen) && (
              <div className="animate-in fade-in">
                <h1 className="text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-none">ThriftPulse</h1>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mt-1">Resell Engine</p>
              </div>
            )}
          </div>
          <nav className="space-y-2">
            <NavButton label="Overview" id="overview" icon={LayoutGrid} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} color="emerald" />
            <div className="h-px bg-slate-100 dark:bg-slate-800 my-4" />
            <NavButton label="Research" id="scout" icon={Radar} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} color="emerald" />
            <NavButton label="Store Map" id="hunt" icon={Map} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} color="blue" />
            <NavButton label="Inventory" id="missions" icon={LayoutDashboard} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} badge={missions.filter(m => m.status === 'in_trunk').length} color="purple" />
            <NavButton label="Financials" id="ledger" icon={Wallet} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} color="amber" />
            <NavButton label="Market Trends" id="analysis" icon={Activity} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} color="rose" />
            <NavButton label="Data Sources" id="sources" icon={Hash} active={activeView} set={setActiveView} collapsed={isDesktopSidebarCollapsed && !isMobileMenuOpen} color="emerald" />
          </nav>
        </div>
        <div className="space-y-4">
           <div className={`flex items-center justify-center p-2 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 ${isDesktopSidebarCollapsed ? 'flex-col space-y-2' : 'space-x-2'}`}>
              <ThemeIcon icon={Sun} active={theme === 'light'} onClick={() => setTheme('light')} />
              <ThemeIcon icon={Moon} active={theme === 'dark'} onClick={() => setTheme('dark')} />
              <ThemeIcon icon={Monitor} active={theme === 'system'} onClick={() => setTheme('system')} />
           </div>
           <button onClick={() => setIsDesktopSidebarCollapsed(!isDesktopSidebarCollapsed)} className="hidden md:flex w-full items-center justify-center p-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-black dark:hover:text-white transition-all"><Menu size={20} /></button>
           <Link href="/" className="flex items-center space-x-3 p-4 rounded-xl text-slate-500 hover:text-red-500 transition-all font-bold text-sm shrink-0">
             <LogOut size={20} className="shrink-0" />
             {(!isDesktopSidebarCollapsed || isMobileMenuOpen) && <span>Log Out</span>}
           </Link>
        </div>
      </aside>

      <main className="flex-1 h-full overflow-y-auto relative w-full scroll-smooth">
        {notification && (
          <div className="fixed top-6 right-6 z-[100] bg-emerald-500 text-slate-950 px-8 py-5 rounded-2xl font-black text-sm shadow-2xl flex items-center animate-in slide-in-from-right-4 border border-emerald-300">
            <Sparkles size={18} className="mr-3 animate-pulse" /> {notification}
          </div>
        )}

        <div className="p-6 md:p-12 max-w-[1600px] mx-auto min-h-full pb-32 text-left">
          {/* Header section remains identical */}
          <header className="mb-12">
             <h2 className="text-5xl md:text-7xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white mb-8 leading-none">
               {activeView === 'overview' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-blue-500">Business Summary</span>}
               {activeView === 'scout' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-cyan-400">Market Research</span>}
               {activeView === 'hunt' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-indigo-400">Sourcing Map</span>}
               {activeView === 'missions' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-pink-400">Inventory Log</span>}
               {activeView === 'ledger' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-400">Profit & Loss</span>}
               {activeView === 'analysis' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-red-400">Buyer Trends</span>}
               {activeView === 'sources' && <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-400">Data Sources</span>}
             </h2>
             
             <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-8 rounded-[2.5rem] shadow-sm max-w-4xl relative overflow-hidden flex items-start gap-6">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500" />
                <Info className="text-emerald-500 shrink-0 mt-1" size={24} />
                <p className="text-lg md:text-xl text-slate-600 dark:text-slate-300 leading-relaxed font-medium italic">
                   {activeView === 'overview' && "Check your daily performance stats and get recommendations on where to focus your effort next."}
                   {activeView === 'scout' && "Research specific brands to determine their demand and profit potential."}
                   {activeView === 'hunt' && "This map highlights the most profitable stores in your area."}
                   {activeView === 'missions' && "View every item you currently own. Track items from trunk to market."}
                   {activeView === 'ledger' && "A professional view of your earnings and business expenses."}
                   {activeView === 'analysis' && "Spot aesthetic spikes early so you can find them in stores."}
                   {activeView === 'sources' && "Manage the communities that ThriftPulse scans for market data."}
                </p>
             </div>
          </header>

          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* Added a special prop for SectionScout so it can trigger the Modal */}
            {activeView === "overview" && <SectionOverview missions={missions} signals={signals} stores={stores} onNavigate={setActiveView} onTaskExecute={handleTaskAction} />}
            {activeView === "scout" && <SectionScout searchTerm={globalSearch} onAddMission={handleAddMission} onViewAI={(item: any) => setSelectedItem(item)} />}
            {activeView === "hunt" && <SectionHunt location="30064" signals={signals} />} 
            {activeView === "missions" && <SectionMissions activeMissions={missions} onAddMission={handleAddMission} />}
            {activeView === "ledger" && <SectionLedger missions={missions} />}
            {activeView === "analysis" && <SectionHeatmap onTrendClick={handleTrendClick} />}
            {activeView === "sources" && <SubredditFilter />}
          </div>
        </div>

        {/* --- NEW MODAL COMPONENT PLACEMENT --- */}
        <ListingModal 
          item={selectedItem} 
          isOpen={!!selectedItem} 
          onClose={() => setSelectedItem(null)} 
        />
      </main>
    </div>
  );
}

// Helpers (NavButton and ThemeIcon remain the same)
function NavButton({ label, id, icon: Icon, active, set, collapsed, badge, color }: any) {
  const isActive = active === id;
  const colorMap: any = { emerald: "text-emerald-500", blue: "text-blue-500", purple: "text-purple-500", amber: "text-amber-500", rose: "text-rose-500" };
  return (
    <button onClick={() => set(id)} className={`w-full flex items-center p-4 rounded-2xl transition-all duration-300 group relative ${isActive ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 shadow-xl scale-[1.02]' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      <div className="flex items-center justify-center shrink-0"><Icon size={24} className={isActive ? "" : colorMap[color]} /></div>
      {!collapsed && <span className="ml-4 text-sm font-black uppercase tracking-tight whitespace-nowrap">{label}</span>}
      {badge > 0 && <div className="absolute right-4 bg-red-500 text-white text-[10px] font-black h-6 min-w-[1.5rem] px-1.5 rounded-full flex items-center justify-center shadow-lg animate-bounce">{badge}</div>}
    </button>
  );
}

function ThemeIcon({ icon: Icon, active, onClick }: any) {
  return (
    <button onClick={onClick} className={`p-2.5 rounded-xl transition-all ${active ? 'bg-white dark:bg-slate-700 text-emerald-500 shadow-md border dark:border-slate-600' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'}`}><Icon size={18} /></button>
  );
}