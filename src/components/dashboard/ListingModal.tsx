"use client";

interface ListingModalProps {
  item: any;
  isOpen: boolean;
  onClose: () => void;
}

export function ListingModal({ item, isOpen, onClose }: ListingModalProps) {
  if (!isOpen) return null;

  const copyToClipboard = () => {
    if (item?.ai_description) {
      navigator.clipboard.writeText(item.ai_description);
      alert("✅ Description Copied!");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] max-w-2xl w-full p-10 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex justify-between items-start mb-8 text-left">
          <div>
            <h3 className="text-3xl font-black italic uppercase tracking-tighter">{item.trend_name}</h3>
            <p className="text-emerald-500 font-bold text-xs uppercase tracking-widest mt-1 italic">Generated eBay Draft</p>
          </div>
          <button onClick={onClose} className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-500 hover:text-red-500 transition-all">✕</button>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-950 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 whitespace-pre-wrap text-sm leading-relaxed mb-8 max-h-[40vh] overflow-y-auto text-left font-medium text-slate-600 dark:text-slate-300">
          {item.ai_description || "⚠️ AI is still writing this listing. Run your GitHub Action to generate text!"}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={copyToClipboard}
            disabled={!item.ai_description}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-slate-950 font-black py-5 rounded-2xl transition-all uppercase italic tracking-tighter"
          >
            📋 Copy for eBay
          </button>
          <button onClick={onClose} className="px-10 py-5 border border-slate-200 dark:border-slate-700 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-500 transition-all">Close</button>
        </div>
      </div>
    </div>
  );
}