"use client";
import { Wallet, BrainCircuit, ArrowRightLeft, ShieldCheck, TrendingUp, Info, Percent } from "lucide-react";

export default function SectionLedger({ missions = [] }: any) {
  const isDemo = missions.length === 0;

  // Real-time calculations from your Supabase 'inventory' table
  const realProfit = missions.reduce((acc: number, m: any) => acc + ((m.est_sell || 0) - (m.buy_price || 0)), 0);
  const realValue = missions.reduce((acc: number, m: any) => acc + (m.est_sell || 0), 0);
  const realRisk = missions.reduce((acc: number, m: any) => acc + (m.buy_price || 0), 0);

  // ROI Logic: (Profit / Cost) * 100
  const avgROI = realRisk > 0 ? (realProfit / realRisk) * 100 : 0;

  const stats = isDemo 
    ? { profit: 4250, value: 6120, risk: 1870, roi: 227 }
    : { profit: realProfit, value: realValue, risk: realRisk, roi: avgROI };

  return (
    <div className="space-y-12 animate-in fade-in duration-1000 text-left">
      
      {/* PERFORMANCE GUIDE */}
      <div className="bg-emerald-500/5 border border-emerald-500/20 p-8 rounded-3xl flex items-start space-x-4 max-w-4xl shadow-sm">
         <Info className="text-emerald-500 shrink-0 mt-1" size={24} />
         <div className="space-y-1">
            <p className="text-xs font-black uppercase text-emerald-600 tracking-widest">Financial Performance</p>
            <p className="text-lg text-slate-600 dark:text-slate-300 font-medium italic leading-relaxed">
               This is your live ROI (Return on Investment) tracker. It shows how effectively your cash is working for you. A healthy reselling business aims for an ROI of **150% or higher**.
            </p>
         </div>
      </div>

      {/* DATA CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
         <StatCard label="Net Profit" value={`$${stats.profit.toFixed(0)}`} icon={Wallet} color="emerald" />
         <StatCard label="Inventory Value" value={`$${stats.value.toFixed(0)}`} icon={BrainCircuit} color="blue" />
         <StatCard label="Cash Invested" value={`$${stats.risk.toFixed(0)}`} icon={ArrowRightLeft} color="purple" />
         {/* NEW ROI CARD */}
         <StatCard label="Avg. ROI" value={`${stats.roi.toFixed(0)}%`} icon={Percent} color="amber" />
      </div>

      {/* ROI ANALYSIS BOX */}
      <div className="bg-slate-900 p-10 rounded-[3.5rem] border border-slate-800 relative overflow-hidden shadow-2xl">
         <div className="absolute top-0 right-0 p-10 text-emerald-500/5 pointer-events-none"><TrendingUp size={200} /></div>
         <div className="relative z-10 space-y-6">
            <h4 className="text-2xl font-black uppercase italic text-white tracking-tight">Investment Strategy</h4>
            <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 backdrop-blur-sm">
               <p className="text-xl font-medium text-slate-200 italic leading-relaxed">
                  "Your current ROI is <span className="text-emerald-400 font-black">{stats.roi.toFixed(0)}%</span>. For every $1 you spend, you are making back <span className="text-emerald-400 font-black">${(stats.roi / 100).toFixed(2)}</span>. This indicates your buying prices are well-optimized compared to current market averages."
               </p>
            </div>
         </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: any) {
  const colors: any = {
    emerald: "from-emerald-400 to-emerald-600 shadow-emerald-500/20",
    blue: "from-blue-400 to-blue-600 shadow-blue-500/20",
    purple: "from-purple-400 to-purple-600 shadow-purple-500/20",
    amber: "from-amber-400 to-amber-600 shadow-amber-500/20"
  };
  return (
    <div className="p-8 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left shadow-lg transition-all group hover:border-emerald-500/50">
       <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${colors[color]} flex items-center justify-center text-white mb-6 shadow-xl`}><Icon size={28} /></div>
       <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1 group-hover:text-emerald-500 transition-colors">{label}</p>
       <h4 className="text-4xl font-black italic text-slate-900 dark:text-white tracking-tighter tabular-nums leading-none">{value}</h4>
    </div>
  );
}