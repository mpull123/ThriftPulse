"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { 
  TrendingUp, Clock, AlertTriangle, CheckCircle2, 
  Sparkles, Globe, ExternalLink, PlusCircle, X, Eye, ShoppingBag, BrainCircuit
} from "lucide-react";

export default function SectionScout({ searchTerm, onAddMission }: any) {
  const [signals, setSignals] = useState<any[]>([]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [marketQuery, setMarketQuery] = useState("");
  const [discoveryResult, setDiscoveryResult] = useState<any>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('market_signals').select('*').order('heat_score', { ascending: false });
      setSignals(data || []);
    }
    load();
  }, []);

  const analyzeMarketFind = () => {
    if (marketQuery.length < 2) return;
    setDiscoveryResult({
      trend_name: marketQuery,
      hook_brand: "Market Discovery",
      exit_price: 145,
      heat_score: 88,
      track: 'Style',
      id: Math.floor(Math.random() * 100000)
    });
  };

  const openVisualRecon = (e: React.MouseEvent, name: string, brand: string) => {
    e.stopPropagation();
    const query = encodeURIComponent(`${brand} ${name} vintage aesthetic`);
    window.open(`https://www.google.com/search?q=${query}&tbm=isch`, '_blank');
  };

  return (
    <div className="space-y-12 text-left">
      
      {/* AI SEARCH HUB */}
      <div className="bg-slate-900 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden border border-slate-800">
         <div className="absolute top-0 right-0 p-10 text-blue-500/10 pointer-events-none rotate-12">
            <BrainCircuit size={180} />
         </div>
         <div className="flex items-center space-x-4 mb-8">
            <Sparkles className="text-emerald-500" size={28} />
            <h3 className="text-2xl font-bold text-white uppercase italic tracking-tight">Market Analysis Engine</h3>
         </div>
         <div className="flex flex-col md:flex-row gap-4 relative z-10">
            <input 
               value={marketQuery} 
               onChange={(e) => setMarketQuery(e.target.value)}
               className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-8 py-5 text-white font-bold text-xl outline-none focus:border-emerald-500 transition-all placeholder:text-slate-500" 
               placeholder="ANALYZE TREND (e.g. 90s Nike Windbreaker)..." 
            />
            <button onClick={analyzeMarketFind} className="px-12 py-5 bg-emerald-500 text-slate-950 rounded-2xl font-black uppercase text-sm tracking-widest shadow-xl hover:scale-105 transition-all">Execute Scan</button>
         </div>
      </div>

      {/* SPLIT GRID */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        <Sector title="High-Yield Brands" items={signals.filter(s => s.track === 'Brand')} onAdd={onAddMission} onVisual={openVisualRecon} onSelect={setSelectedNode} accent="emerald" />
        <Sector title="Emerging Aesthetics" items={signals.filter(s => s.track !== 'Brand')} onAdd={onAddMission} onVisual={openVisualRecon} onSelect={setSelectedNode} accent="blue" />
      </div>

      {selectedNode && <NodeModal node={selectedNode} onClose={() => setSelectedNode(null)} onAdd={onAddMission} onVisual={openVisualRecon} />}
    </div>
  );
}

function Sector({ title, items, onAdd, onVisual, onSelect, accent }: any) {
  return (
    <div className="space-y-8">
       <div className={`pb-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center`}>
          <h2 className={`text-3xl font-black italic uppercase text-${accent}-500 tracking-tighter`}>{title}</h2>
          <span className="text-xs font-black uppercase text-slate-400 tracking-widest">Live Feed</span>
       </div>
       <div className="grid grid-cols-1 gap-6">
          {items.map((s: any) => (
            <div key={s.id} onClick={() => onSelect(s)} className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-[2.5rem] hover:border-emerald-500 transition-all shadow-sm cursor-pointer relative overflow-hidden">
               {/* AI VERDICT BADGE */}
               <div className={`absolute top-6 right-8 px-4 py-1.5 rounded-full font-black text-[10px] uppercase tracking-[0.2em] border ${s.heat_score > 90 ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                  AI Verdict: {s.heat_score > 90 ? 'Strong Buy' : 'Watch'}
               </div>

               <h3 className="text-3xl font-black italic uppercase text-slate-900 dark:text-white leading-tight mb-2 group-hover:text-emerald-500 transition-colors">{s.trend_name}</h3>
               <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-8">{s.hook_brand}</p>
               
               <div className="grid grid-cols-2 gap-6 p-6 bg-slate-50 dark:bg-slate-950/50 rounded-3xl border border-slate-100 dark:border-slate-800 mb-8">
                  <div>
                     <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Net Projected Profit</p>
                     <p className="text-3xl font-black text-emerald-500 tabular-nums">${(s.exit_price * 0.82).toFixed(0)}</p>
                  </div>
                  <div>
                     <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Demand / Velocity</p>
                     <p className="text-3xl font-black text-blue-500 tabular-nums">{s.heat_score}%</p>
                  </div>
               </div>

               <div className="flex gap-4">
                  <button onClick={(e) => onVisual(e, s.trend_name, s.hook_brand)} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-black uppercase text-slate-500 dark:text-slate-400 hover:text-black dark:hover:text-white transition-all flex items-center justify-center space-x-2">
                     <ExternalLink size={16} /> <span>Verify Imagery</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onAdd(s); }} className="flex-[2] py-4 bg-emerald-500 text-slate-950 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg hover:scale-[1.02] transition-transform">
                     Secure Asset
                  </button>
               </div>
            </div>
          ))}
       </div>
    </div>
  );
}

function NodeModal({ node, onClose, onAdd, onVisual }: any) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[3.5rem] border border-slate-200 dark:border-slate-800 shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
        <div className="p-12 space-y-10">
          <div className="flex justify-between items-start">
             <div className="space-y-4">
                <div className="flex items-center space-x-3 text-emerald-500">
                   <BrainCircuit size={28} />
                   <span className="text-xs font-black uppercase tracking-[0.4em]">AI Deep Dive Intelligence</span>
                </div>
                <h2 className="text-6xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-[0.9]">{node.trend_name}</h2>
                <p className="text-xl font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{node.hook_brand}</p>
             </div>
             <button onClick={onClose} className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400 hover:text-red-500 transition-all"><X size={32} /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <InfoBox label="AI Market Verdict" value={node.heat_score > 90 ? "Immediate Buy" : "Buy if < $30"} accent="text-emerald-500" />
             <InfoBox label="Target Market" value="eBay / Grailed" accent="text-blue-500" />
          </div>

          <div className="p-8 bg-blue-500/5 rounded-[2.5rem] border border-blue-500/10">
             <h4 className="text-sm font-black uppercase text-blue-500 mb-6 flex items-center"><ShoppingBag size={18} className="mr-2" /> In-Store Tactical Guide</h4>
             <ul className="space-y-4">
                <li className="flex items-start space-x-4 text-lg font-bold text-slate-600 dark:text-slate-200 italic leading-snug">
                   <div className="h-2 w-2 rounded-full bg-blue-500 mt-3 shrink-0" />
                   <span>Scan for specific 90s-era labels and heavy-weight fabrications. Check zippers for YKK markings.</span>
                </li>
             </ul>
          </div>

          <button onClick={() => { onAdd(node); onClose(); }} className="w-full py-6 bg-emerald-500 text-slate-950 rounded-2xl font-black uppercase text-sm tracking-widest shadow-2xl hover:scale-[1.02] transition-transform">Add to Inventory Manifest</button>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value, accent }: any) {
    return (
        <div className="p-6 bg-slate-50 dark:bg-slate-950/50 rounded-3xl border border-slate-100 dark:border-slate-800 text-left">
            <p className="text-[10px] font-black uppercase text-slate-400 mb-2">{label}</p>
            <p className={`text-xl font-black italic uppercase ${accent}`}>{value}</p>
        </div>
    );
}

function CommandCard({ title, value, status, icon: Icon, accent, action, alert }: any) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-[2.5rem] shadow-sm hover:border-emerald-500/50 transition-all group relative overflow-hidden">
      <div className="flex justify-between items-start mb-6">
        <div className={`p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 ${accent} group-hover:scale-110 transition-transform`}><Icon size={24} /></div>
        <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full border ${alert ? 'bg-red-100 text-red-600 border-red-200' : 'bg-emerald-100 text-emerald-600 border-emerald-200'}`}>{status}</span>
      </div>
      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
      <h4 className="text-4xl font-black italic dark:text-white leading-none mb-6 tabular-nums">{value}</h4>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center">
        {alert ? <AlertTriangle size={16} className="text-red-500 mr-2" /> : <CheckCircle2 size={16} className="text-emerald-500 mr-2" />}
        {action}
      </p>
    </div>
  );
}