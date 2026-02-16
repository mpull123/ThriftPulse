"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Search, TrendingUp, DollarSign, Zap, Sparkles, Plus } from "lucide-react";

interface SectionScoutProps {
  searchTerm: string;
  onAddMission: (item: any) => void;
  onViewAI: (item: any) => void; // The new "bridge" to the modal
}

export default function SectionScout({ searchTerm, onAddMission, onViewAI }: SectionScoutProps) {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSignals = async () => {
      setLoading(true);
      // Ensure we pull the ai_description so it's ready when the button is clicked
      const { data } = await supabase
        .from('market_signals')
        .select('*, ai_description') 
        .order('heat_score', { ascending: false });
      
      setSignals(data || []);
      setLoading(false);
    };
    fetchSignals();
  }, []);

  const filteredSignals = signals.filter(s => 
    s.trend_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 text-left">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSignals.map((signal) => (
          <div key={signal.id} className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] p-8 transition-all hover:shadow-2xl hover:scale-[1.02] relative overflow-hidden">
            
            {/* Heat Indicator Bar */}
            <div className="absolute top-0 left-0 h-1.5 bg-emerald-500" style={{ width: `${signal.heat_score}%` }} />

            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-tight mb-1">
                  {signal.trend_name}
                </h3>
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Live Market Signal</span>
              </div>
              <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-emerald-500">
                <TrendingUp size={24} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Exit Price</p>
                <p className="text-xl font-black text-slate-900 dark:text-white">${signal.exit_price}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Heat Score</p>
                <p className="text-xl font-black text-emerald-500">{signal.heat_score}%</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {/* --- NEW AI VIEW BUTTON --- */}
              <button 
                onClick={() => onViewAI(signal)}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black py-4 rounded-xl transition-all hover:bg-emerald-500 dark:hover:bg-emerald-500 hover:text-white uppercase italic tracking-tighter text-sm"
              >
                <Sparkles size={16} /> View AI Listing
              </button>

              <button 
                onClick={() => onAddMission(signal)}
                className="w-full flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white font-bold py-3 rounded-xl transition-all text-xs uppercase tracking-widest"
              >
                <Plus size={14} /> Add to Inventory
              </button>
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="h-12 w-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-500 font-bold italic uppercase tracking-widest text-xs">Syncing Market Data...</p>
        </div>
      )}
    </div>
  );
}