"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Plus, X, Hash, Info, CheckCircle2, Search, Zap, Globe } from "lucide-react";

export default function SubredditFilter() {
  const [subs, setSubs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // --- STARTER PACK (PREMADE LIST) ---
  const starterPack = [
    { name: "Carhartt", category: "Workwear" },
    { name: "VintageFashion", category: "General" },
    { name: "Streetwear", category: "Style" },
    { name: "Gorpcore", category: "Outdoor" },
    { name: "Nike", category: "Athletic" },
    { name: "Grailed", category: "Resale" }
  ];

  useEffect(() => {
    loadSubs();
  }, []);

  const loadSubs = async () => {
    const { data } = await supabase.from('subreddits').select('*').order('name');
    setSubs(data || []);
  };

  const toggleSub = async (id: number, currentStatus: boolean) => {
    const { error } = await supabase
      .from('subreddits')
      .update({ is_active: !currentStatus })
      .eq('id', id);
    if (!error) loadSubs();
  };

  const addSub = async (name: string) => {
    const formatted = name.replace("r/", "").trim();
    // Prevent duplicates
    if (subs.some(s => s.name.toLowerCase() === formatted.toLowerCase())) return;

    const { error } = await supabase
      .from('subreddits')
      .insert([{ name: formatted, is_active: true }]);
    
    if (!error) {
      setSearchQuery("");
      loadSubs();
    }
  };

  return (
    <div className="space-y-12 text-left animate-in fade-in duration-1000">
      
      {/* SECTION EXPLAINER */}
      <div className="bg-emerald-500/5 border border-emerald-500/20 p-8 rounded-3xl flex items-start space-x-6 max-w-4xl shadow-sm">
         <Info className="text-emerald-500 shrink-0 mt-1" size={24} />
         <div className="space-y-1">
            <p className="text-xs font-black uppercase text-emerald-600 tracking-widest">Market Intelligence Sources</p>
            <p className="text-lg text-slate-600 dark:text-slate-300 font-medium italic leading-relaxed">
               The system monitors these communities to detect "hype spikes" before they hit the mass market. **Active** sources directly influence the Heat Scores on your Research tab.
            </p>
         </div>
      </div>

      {/* --- SEARCH & DISCOVERY --- */}
      <section className="space-y-6">
         <div className="flex items-center space-x-3 text-blue-500">
            <Search size={20} />
            <h3 className="text-xs font-black uppercase tracking-[0.3em]">Discover New Communities</h3>
         </div>
         <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1 group">
               <Hash className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={20} />
               <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Enter subreddit name (e.g. r/OldSchoolCool)..."
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl pl-14 pr-6 py-5 text-xl font-bold outline-none focus:border-emerald-500 shadow-inner transition-all"
               />
            </div>
            <button 
               onClick={() => addSub(searchQuery)}
               className="px-12 py-5 bg-emerald-500 text-slate-950 rounded-2xl font-black uppercase text-sm tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
            >
               Add to Feed
            </button>
         </div>
      </section>

      {/* --- STARTER PACK SECTION --- */}
      <section className="space-y-6">
         <div className="flex items-center space-x-3 text-amber-500">
            <Zap size={20} />
            <h3 className="text-xs font-black uppercase tracking-[0.3em]">Recommended Starter Pack</h3>
         </div>
         <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {starterPack.map((pack) => {
               const isAdded = subs.some(s => s.name.toLowerCase() === pack.name.toLowerCase());
               return (
                  <button 
                     key={pack.name}
                     disabled={isAdded}
                     onClick={() => addSub(pack.name)}
                     className={`p-6 rounded-[2rem] border transition-all flex flex-col items-center gap-2 group
                        ${isAdded 
                          ? 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-40 cursor-not-allowed' 
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-500 hover:scale-105'}
                     `}
                  >
                     <p className="text-xs font-black uppercase tracking-tighter text-slate-400 group-hover:text-amber-500">{pack.category}</p>
                     <p className="text-lg font-black italic uppercase dark:text-white">r/{pack.name}</p>
                     {!isAdded && <Plus size={16} className="mt-2 text-amber-500" />}
                  </button>
               );
            })}
         </div>
      </section>

      {/* --- ACTIVE MONITORING LIST --- */}
      <section className="space-y-6">
         <div className="flex items-center space-x-3 text-emerald-500">
            <Globe size={20} />
            <h3 className="text-xs font-black uppercase tracking-[0.3em]">Your Active Global Feed</h3>
         </div>
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {subs.length === 0 ? (
               <div className="col-span-full p-16 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[3rem]">
                  <p className="text-slate-400 font-bold uppercase tracking-widest">No active sources. Add from the starter pack above to begin monitoring.</p>
               </div>
            ) : subs.map((sub) => (
               <div 
                  key={sub.id} 
                  className={`p-8 rounded-[2.5rem] border transition-all flex items-center justify-between group
                     ${sub.is_active ? 'bg-white dark:bg-slate-900 border-emerald-500 shadow-lg shadow-emerald-500/5' : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 opacity-60'}
                  `}
               >
                  <button onClick={() => toggleSub(sub.id, sub.is_active)} className="flex items-center space-x-5 flex-1 text-left">
                     <div className={`h-10 w-10 rounded-xl border-2 flex items-center justify-center transition-all ${sub.is_active ? 'bg-emerald-500 border-emerald-500 text-slate-900 shadow-lg shadow-emerald-500/20' : 'border-slate-300 dark:border-slate-700'}`}>
                        {sub.is_active && <CheckCircle2 size={20} />}
                     </div>
                     <div>
                        <span className={`text-xl font-black italic uppercase tracking-tighter block ${sub.is_active ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>r/{sub.name}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{sub.is_active ? 'Monitoring Active' : 'Feed Paused'}</span>
                     </div>
                  </button>
                  <button 
                     onClick={() => { if(confirm(`Remove r/${sub.name}?`)) supabase.from('subreddits').delete().eq('id', sub.id).then(loadSubs); }} 
                     className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                  >
                     <X size={20} />
                  </button>
               </div>
            ))}
         </div>
      </section>
    </div>
  );
}