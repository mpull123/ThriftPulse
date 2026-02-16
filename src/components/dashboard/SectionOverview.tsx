"use client";
import { 
  TrendingUp, Wallet, Package, MapPin, Activity, 
  BrainCircuit, ArrowUpRight, Target, ShieldCheck, Sparkles, Clock, 
  CheckCircle2, Flame, Trophy, ListChecks
} from "lucide-react";

export default function SectionOverview({ missions, signals, stores, onNavigate, onTaskExecute }: any) {
  // Logic
  const totalProfit = missions.reduce((acc: number, m: any) => acc + (m.est_sell - m.buy_price), 0);
  const activeCount = missions.length;
  const needsListing = missions.filter((m: any) => m.status === 'in_trunk').length;
  const topTrend = signals?.sort((a: any, b: any) => b.heat_score - a.heat_score)[0] || { trend_name: "Detroit Jacket", heat_score: 95 };
  const topStore = stores?.sort((a: any, b: any) => b.power_rank - a.power_rank)[0] || { name: "Goodwill Marietta", power_rank: 98 };
  
  const monthlyGoal = 5000;
  const goalPercent = Math.min((totalProfit / monthlyGoal) * 100, 100);

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left">
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* MAIN SUMMARY CARD */}
        <div className="lg:col-span-8 p-10 rounded-[3rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-10 text-emerald-500/5 pointer-events-none group-hover:scale-110 transition-transform"><BrainCircuit size={200} /></div>
           <div className="relative z-10 flex flex-col h-full justify-between">
              <div className="space-y-8">
                 <div className="flex items-center space-x-3"><div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" /><span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500">Live Business Pulse</span></div>
                 <h3 className="text-4xl md:text-5xl font-black italic uppercase text-slate-900 dark:text-white leading-[0.9] tracking-tighter text-left">Status Report: <br/> <span className="text-slate-400 dark:text-slate-500 font-bold text-3xl">Priority Sourcing Active</span></h3>
                 
                 {/* BULLET POINTS */}
                 <ul className="space-y-6">
                    <li className="flex items-start space-x-4">
                       <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] shrink-0" />
                       <p className="text-xl text-slate-600 dark:text-slate-300 font-medium italic leading-tight">**Inventory Value:** You have <span className="text-emerald-500 font-black">${totalProfit.toFixed(0)}</span> in projected profit across <span className="text-emerald-500 font-black">{activeCount} items</span>.</p>
                    </li>
                    <li className="flex items-start space-x-4">
                       <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] shrink-0" />
                       <p className="text-xl text-slate-600 dark:text-slate-300 font-medium italic leading-tight">**High-Yield Target:** Market demand for <span className="text-blue-500 font-black">{topTrend.trend_name}</span> is currently at <span className="text-blue-500 font-black">{topTrend.heat_score}%</span>. Search for this brand today.</p>
                    </li>
                    <li className="flex items-start space-x-4">
                       <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)] shrink-0" />
                       <p className="text-xl text-slate-600 dark:text-slate-300 font-medium italic leading-tight">**Location Strategy:** <span className="text-purple-500 font-black">{topStore.name}</span> is the highest-ranked stop in your current sector.</p>
                    </li>
                 </ul>
              </div>
           </div>
        </div>

        {/* PROGRESS CARD */}
        <div className="lg:col-span-4 p-8 rounded-[3rem] bg-slate-900 border border-slate-800 shadow-2xl flex flex-col justify-between overflow-hidden relative group">
           <div className="absolute -right-4 -top-4 text-emerald-500/10 group-hover:scale-110 transition-transform"><Trophy size={140} /></div>
           <div><div className="flex items-center space-x-2 mb-6"><Flame className="text-orange-500" size={20} /><p className="text-xs font-black uppercase tracking-widest text-slate-400">Monthly Profit Goal</p></div><h4 className="text-5xl font-black italic text-white leading-none mb-2">${totalProfit.toFixed(0)}</h4><p className="text-sm font-bold text-slate-500 uppercase tracking-widest">of ${monthlyGoal} Target</p></div>
           <div className="space-y-4">
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden p-1 shadow-inner border border-slate-700"><div className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-1000 shadow-[0_0_15px_rgba(16,185,129,0.4)]" style={{ width: `${goalPercent}%` }} /></div>
              <p className="text-xs font-black text-emerald-500 uppercase tracking-[0.2em]">{goalPercent.toFixed(0)}% Complete</p>
           </div>
        </div>
      </div>

      {/* ACTION CHECKLIST (LIVE) */}
      <div className="p-10 rounded-[3.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg text-left">
         <div className="flex items-center justify-between mb-8 pb-4 border-b dark:border-slate-800">
            <h4 className="text-xl font-black uppercase italic text-slate-900 dark:text-white flex items-center"><ListChecks size={20} className="mr-3 text-blue-500" /> Action Checklist</h4>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TaskItem 
              text={needsListing > 0 ? `Move ${needsListing} items to 'Listed' status` : "Inventory is fully listed"} 
              checked={needsListing === 0} 
              onClick={() => onTaskExecute('list_all')} 
            />
            <TaskItem text={`Route to ${topStore.name} (${topStore.power_rank} Power)`} checked={false} onClick={() => onNavigate('hunt')} />
            <TaskItem text={`Research ${topTrend.trend_name} pricing floor`} checked={false} onClick={() => onNavigate('scout')} />
            <TaskItem text="Update weekly business expenses" checked={false} />
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <NavTile title="Manifest" value={activeCount} unit="Items" icon={Package} color="purple" onClick={() => onNavigate('missions')} />
        <NavTile title="Portfolio" value={`$${totalProfit.toFixed(0)}`} unit="Gains" icon={Wallet} color="emerald" onClick={() => onNavigate('ledger')} />
        <NavTile title="Routes" value={topStore.power_rank} unit="Power" icon={MapPin} color="blue" onClick={() => onNavigate('hunt')} />
        <NavTile title="Demand" value={topTrend.heat_score} unit="Score" icon={Activity} color="amber" onClick={() => onNavigate('analysis')} />
      </div>
    </div>
  );
}

// Helpers
function TaskItem({ text, checked, onClick }: any) {
   return (
      <button 
        onClick={onClick}
        disabled={checked}
        className={`p-5 rounded-2xl border flex items-center space-x-4 transition-all w-full text-left ${checked ? 'bg-slate-50 dark:bg-slate-950 border-transparent opacity-50' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-blue-500 group'}`}
      >
         <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center ${checked ? 'bg-emerald-500 border-emerald-500 text-slate-900' : 'border-slate-200 dark:border-slate-600 group-hover:border-blue-500'}`}>
            {checked && <CheckCircle2 size={14} />}
         </div>
         <p className={`text-sm font-bold ${checked ? 'line-through text-slate-400' : 'text-slate-600 dark:text-slate-200 group-hover:text-blue-500'}`}>{text}</p>
      </button>
   );
}

function NavTile({ title, value, unit, icon: Icon, color, onClick }: any) {
   const colors: any = { emerald: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20", blue: "text-blue-500 bg-blue-500/10 border-blue-500/20", purple: "text-purple-500 bg-purple-500/10 border-purple-500/20", amber: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
   return (
      <button onClick={onClick} className="p-8 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left hover:border-emerald-500 transition-all shadow-sm group">
         <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-6 ${colors[color]}`}><Icon size={24} /></div>
         <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 group-hover:text-blue-500 transition-colors mb-1">{title}</p>
         <div className="flex items-baseline space-x-2"><span className="text-4xl font-black italic text-slate-900 dark:text-white tracking-tighter leading-none">{value}</span><span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{unit}</span></div>
      </button>
   );
}