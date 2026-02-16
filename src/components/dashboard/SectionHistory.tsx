"use client";
import { History, Package, Target } from "lucide-react";

export default function SectionHistory({ currency }: any) {
  const symbols: any = { USD: "$", EUR: "€", GBP: "£" };

  const historyNodes = [
    { 
      asset: "Arc'teryx Beta LT", 
      yield: 312.00, 
      roi: "2.4x", 
      suggestions: ["Alpha Shells", "Zeta SL", "Gamma MX"]
    },
    { 
      asset: "Carhartt Detroit J01", 
      yield: 245.50, 
      roi: "4.1x", 
      suggestions: ["Santa Fe", "Arctic Coat", "Active J130"]
    }
  ];

  return (
    <div className="space-y-10 animate-in fade-in duration-1000 text-left">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 pb-6">
        <h3 className="text-xl font-black italic uppercase tracking-tighter text-emerald-500 flex items-center">
          <History size={18} className="mr-3" /> Liquidation Archive
        </h3>
        <span className="px-4 py-2 bg-emerald-500/10 text-emerald-500 text-[8px] font-black uppercase rounded-full border border-emerald-500/20">Fulfillment Engine Active</span>
      </div>

      <div className="bg-white dark:bg-[#0D0F14] border border-slate-200 dark:border-white/5 rounded-[3.5rem] overflow-hidden shadow-2xl">
        <table className="w-full text-[11px] font-bold uppercase tracking-wider border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-white/5 text-slate-400 border-b border-slate-100 dark:border-white/5">
              <th className="px-10 py-6 text-left font-black tracking-widest">Asset Node & Restock Guide</th>
              <th className="px-10 py-6 text-right font-black tracking-widest">Net Yield</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {historyNodes.map((node, i) => (
              <tr key={i} className="group hover:bg-slate-50 dark:hover:bg-white/[0.01] transition-colors">
                <td className="px-10 py-10">
                  <div className="flex items-start space-x-6">
                    <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center border border-slate-200 dark:border-white/10 shrink-0">
                       <Package size={20} className="text-slate-400" />
                    </div>
                    <div className="space-y-4">
                       <div className="text-left">
                          <span className="text-2xl font-black italic dark:text-white tracking-tighter leading-none">{node.asset}</span>
                          <span className="ml-3 px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[8px] font-black border border-emerald-500/20">{node.roi} ROI</span>
                       </div>
                       <div className="space-y-2">
                          <p className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.3em] flex items-center"><Target size={10} className="mr-2" /> RESTOCK BLUEPRINT:</p>
                          <div className="flex flex-wrap gap-2">
                             {node.suggestions.map((item, idx) => (
                                <span key={idx} className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-300 rounded-lg text-[10px] font-black uppercase tracking-tight border border-transparent group-hover:border-emerald-500/30 transition-all">• {item}</span>
                             ))}
                          </div>
                       </div>
                    </div>
                  </div>
                </td>
                <td className="px-10 py-10 text-right align-top">
                  <span className="text-3xl font-black italic text-emerald-500 tracking-tighter tabular-nums leading-none">
                    {symbols[currency] || "$"}{node.yield.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}