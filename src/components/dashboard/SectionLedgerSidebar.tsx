"use client";
import { Trash2, Eraser, Target, CheckCircle2, RefreshCw, Edit3, PanelRightClose } from "lucide-react";

export default function SectionLedgerSidebar({ objectives, onRemove, onClear, onClose }: any) {
  return (
    <div className="h-full flex flex-col p-8 bg-slate-50 dark:bg-[#0D0F14] font-sans shadow-2xl overflow-hidden text-left">
      <div className="mb-10 flex justify-between items-start">
        <div className="space-y-2">
          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.4em] animate-pulse">Field Guide Active</p>
          <h3 className="text-3xl font-black italic dark:text-white uppercase leading-none tracking-tighter">Mission Hub</h3>
        </div>
        <div className="flex space-x-2">
           <button onClick={onClear} className="p-3 bg-slate-200 dark:bg-white/5 rounded-xl text-slate-400 hover:text-red-500 transition-all group shadow-inner">
              <Eraser size={20} className="group-hover:rotate-12 transition-transform" />
           </button>
           <button onClick={onClose} className="p-3 bg-emerald-500 text-black rounded-xl shadow-lg hover:scale-105 transition-all">
              <PanelRightClose size={20} />
           </button>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto no-scrollbar pb-10">
        {objectives.map((obj: any) => (
          <div key={obj.id} className="relative group p-6 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 shadow-xl transition-all hover:border-emerald-500/50">
            <div className="absolute top-6 right-6 flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-all">
               <button className="p-2 text-slate-400 hover:text-blue-500 transition-colors"><Edit3 size={14} /></button>
               <button onClick={() => onRemove(obj.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
            </div>
            
            <div className="flex items-center space-x-4 mb-6">
              <div className="h-10 w-10 bg-emerald-500 text-black rounded-xl flex items-center justify-center shadow-lg"><Target size={20} /></div>
              <h4 className="text-sm font-black uppercase italic dark:text-white leading-tight">{obj.title}</h4>
            </div>

            <div className="space-y-5 border-t border-slate-100 dark:border-white/10 pt-6">
               <ul className="space-y-2">
                {obj.guide?.map((step: string, i: number) => (
                  <li key={i} className="flex items-start space-x-3 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase italic leading-tight">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      <span>{step}</span>
                  </li>
                ))}
               </ul>
               <div className="pt-4 border-t border-dashed border-slate-200 dark:border-white/10">
                  <p className="text-[8px] font-black text-blue-500 uppercase flex items-center mb-2"><RefreshCw size={10} className="mr-2" /> Sourcing Backups</p>
                  <div className="flex flex-wrap gap-2">
                     {obj.backups?.map((back: string, i: number) => (
                       <span key={i} className="px-3 py-1 bg-blue-500/5 text-blue-500 border border-blue-500/10 rounded-lg text-[8px] font-black uppercase italic">{back}</span>
                     ))}
                  </div>
               </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}