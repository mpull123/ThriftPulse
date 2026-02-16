"use client";

// Define the "shape" of the data the component expects
interface ListingModalProps {
  item: any;           // The brand data (price, hype, description)
  isOpen: boolean;     // Is the pop-up visible?
  onClose: () => void; // The function to close the pop-up
}

export function ListingModal({ item, isOpen, onClose }: ListingModalProps) {
  if (!isOpen) return null;

  const copyToClipboard = () => {
    if (item?.ai_description) {
      navigator.clipboard.writeText(item.ai_description);
      alert("✅ Copied to clipboard!");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-8 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6 text-left">
          <div>
            <h3 className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">
              {item.trend_name}
            </h3>
            <p className="text-emerald-500 font-bold text-xs uppercase tracking-widest mt-1">AI Listing Draft</p>
          </div>
          <button 
            onClick={onClose} 
            className="h-10 w-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-red-500 transition-all"
          >
            ✕
          </button>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-xl border border-slate-200 dark:border-slate-800 whitespace-pre-wrap text-sm leading-relaxed mb-8 max-h-[50vh] overflow-y-auto text-left text-slate-600 dark:text-slate-300 font-medium">
          {item.ai_description || "⚠️ AI hasn't written this listing yet. Run the GitHub Action to generate it!"}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={copyToClipboard}
            disabled={!item.ai_description}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-black py-4 rounded-xl transition-all shadow-lg shadow-emerald-500/20 uppercase italic tracking-tighter"
          >
            📋 Copy for eBay
          </button>
          <button 
            onClick={onClose}
            className="px-8 py-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-slate-500 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}