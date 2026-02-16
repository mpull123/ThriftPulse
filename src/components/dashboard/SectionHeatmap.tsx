"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Zap, TrendingUp, Activity, MousePointerClick } from "lucide-react";

// Updated to accept onTrendClick
export default function SectionHeatmap({ onTrendClick }: any) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHeatmap() {
      const { data: results } = await supabase.from('brand_momentum_analysis').select('*');
      setData(results || []);
      setLoading(false);
    }
    loadHeatmap();
  }, []);

  if (loading) return <div className="p-8 text-slate-500 animate-pulse">Generating Heatmap...</div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      
      {/* LEGEND */}
      <div className="flex items-center justify-between bg-white/[0.02] border border-slate-200 dark:border-white/5 p-6 rounded-3xl">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2"><div className="h-3 w-3 rounded bg-emerald-500" /><span className="text-[10px] font-black uppercase text-slate-500">90%+ (Hot)</span></div>
          <div className="flex items-center space-x-2"><div className="h-3 w-3 rounded bg-emerald-500/40" /><span className="text-[10px] font-black uppercase text-slate-500">70% (Warm)</span></div>
        </div>
        <div className="flex items-center space-x-2 text-emerald-500">
          <Activity size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Real-Time Pulse</span>
        </div>
      </div>

      {/* GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {data.map((item) => (
          <div key={item.trend_name} onClick={() => onTrendClick(item.trend_name)} className="cursor-pointer">
             <HeatmapTile item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapTile({ item }: { item: any }) {
  const intensity = item.heat_score / 100;
  const isHot = item.heat_score >= 90;

  return (
    <div 
      className={`relative aspect-square rounded-2xl border transition-all duration-300 p-4 flex flex-col justify-between overflow-hidden group hover:scale-105 hover:shadow-xl
        ${isHot ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/10' : 'border-slate-200 dark:border-white/5'}
      `}
      style={{ backgroundColor: `rgba(16, 185, 129, ${intensity * 0.15})` }}
    >
      {isHot && <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />}
      
      <div className="flex justify-between items-start relative z-10">
        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${isHot ? 'bg-emerald-500 text-black' : 'bg-black/10 dark:bg-white/10 text-slate-500'}`}>{item.heat_score}%</span>
        {isHot && <Zap size={12} className="text-emerald-500 fill-current" />}
      </div>

      <div className="relative z-10">
        <h4 className="text-[10px] font-black dark:text-white uppercase italic leading-tight truncate mb-1 group-hover:text-emerald-500 transition-colors">{item.trend_name}</h4>
        <div className="flex items-center space-x-1">
          <TrendingUp size={10} className={isHot ? 'text-emerald-500' : 'text-slate-600'} />
          <span className="text-[8px] font-bold text-slate-500 uppercase">Vol: {item.momentum_index}</span>
        </div>
      </div>
    </div>
  );
}