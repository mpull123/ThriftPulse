"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { 
  Package, Search, DollarSign, RefreshCw, Plus, Save, Info, ShoppingBag, 
  CheckCircle2, Trash2, Edit3
} from "lucide-react";

export default function SectionMissions({ activeMissions, onAddMission }: any) {
  const [filter, setFilter] = useState("all");
  const [isAdding, setIsAdding] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", buyPrice: "", estSell: "" });
  const [localMissions, setLocalMissions] = useState<any[]>(activeMissions || []);

  const safeMissions = Array.isArray(activeMissions) ? activeMissions : [];
  const filtered = filter === "all" ? safeMissions : safeMissions.filter((m: any) => m.status === filter);

  // --- LIVE UPDATE LOGIC ---
  const updateItemStatus = async (id: number, newStatus: string) => {
    const { error } = await supabase
      .from('inventory')
      .update({ status: newStatus })
      .eq('id', id);

    if (!error) {
       // Note: In a full app, you'd likely use a global state or re-fetch.
       // Here we rely on the parent component's re-render or local optimistic UI.
       window.location.reload(); // Quickest way to sync global state for this prototype
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm("Are you sure you want to remove this asset?")) return;
    const { error } = await supabase.from('inventory').delete().eq('id', id);
    if (!error) window.location.reload();
  };

  const handleManualSubmit = () => {
    if (!newItem.name || !newItem.buyPrice) return;
    onAddMission({
      trend_name: newItem.name,
      exit_price: parseFloat(newItem.estSell) || 0,
      heat_score: 50,
      manualBuyPrice: parseFloat(newItem.buyPrice)
    });
    setIsAdding(false);
    setNewItem({ name: "", buyPrice: "", estSell: "" });
  };

  return (
    <div className="space-y-12 text-left animate-in fade-in duration-500">
      
      {/* INVENTORY GUIDE */}
      <div className="bg-purple-500/5 dark:bg-purple-500/10 border border-purple-500/20 p-8 rounded-3xl flex items-start space-x-6 max-w-4xl shadow-sm">
         <Info className="text-purple-500 shrink-0 mt-1" size={24} />
         <div className="space-y-1">
            <p className="text-xs font-black uppercase text-purple-600 tracking-widest">Managing your stock</p>
            <p className="text-lg text-slate-600 dark:text-slate-300 font-medium italic leading-relaxed">
               Click an item's status to move it through your workflow. Updates are saved instantly to your database.
            </p>
         </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
              <div className="flex items-center space-x-3 mb-2 text-blue-500">
                  <ShoppingBag size={20} />
                  <h3 className="text-xs font-black uppercase tracking-[0.3em] dark:text-blue-400">Inventory Management</h3>
              </div>
              <h2 className="text-4xl md:text-5xl font-black italic uppercase text-slate-900 dark:text-white tracking-tighter">Inventory Log</h2>
          </div>
          <button onClick={() => setIsAdding(true)} className="px-8 py-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center space-x-3 hover:bg-emerald-500 hover:text-black dark:hover:bg-emerald-500 dark:hover:text-slate-900 transition-all shadow-xl shadow-emerald-500/10 group">
              <Plus size={20} className="group-hover:rotate-90 transition-transform" />
              <span className="text-base font-black uppercase tracking-widest">Add Item Manually</span>
          </button>
      </div>
      
      {/* MANUAL ENTRY FORM */}
      {isAdding && (
          <div className="p-10 bg-slate-100 dark:bg-slate-900 rounded-[3rem] border border-slate-200 dark:border-slate-800 animate-in slide-in-from-top-2 shadow-2xl">
              <h4 className="text-base font-black uppercase tracking-widest mb-8 text-slate-600 dark:text-slate-400 flex items-center">
                  <Save size={20} className="mr-3 text-emerald-500" /> Enter Item Details
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <EntryInput label="Item Name" placeholder="e.g. 90s Nike Windbreaker" value={newItem.name} onChange={(v: string) => setNewItem({...newItem, name: v})} />
                  <EntryInput label="Buy Cost ($)" placeholder="0.00" value={newItem.buyPrice} onChange={(v: string) => setNewItem({...newItem, buyPrice: v})} type="number" />
                  <EntryInput label="Est. Sale Price ($)" placeholder="0.00" value={newItem.estSell} onChange={(v: string) => setNewItem({...newItem, estSell: v})} type="number" />
              </div>
              <div className="flex justify-end space-x-6">
                  <button onClick={() => setIsAdding(false)} className="px-6 py-3 text-slate-500 font-black uppercase text-sm hover:text-black dark:hover:text-white transition-colors">Cancel</button>
                  <button onClick={handleManualSubmit} className="px-10 py-4 bg-emerald-500 text-slate-950 rounded-xl font-black uppercase text-sm tracking-widest shadow-lg hover:scale-105 transition-all">Confirm Asset</button>
              </div>
          </div>
      )}

      {/* METRIC CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <StatCard label="Total Portfolio Value" value={`$${safeMissions.reduce((acc: number, curr: any) => acc + (curr.est_sell || 0), 0).toFixed(0)}`} icon={DollarSign} color="text-emerald-500" />
          <StatCard label="Items in Prep" value={safeMissions.filter((m: any) => m.status === 'washing').length} icon={RefreshCw} color="text-blue-500" />
          <StatCard label="Available to List" value={safeMissions.filter((m: any) => m.status === 'in_trunk').length} icon={Package} color="text-slate-400 dark:text-slate-500" />
      </div>

      <div className="flex items-center space-x-3 overflow-x-auto pb-4 border-b border-slate-200 dark:border-slate-800">
         <FilterButton label="All Assets" id="all" active={filter} set={setFilter} />
         <FilterButton label="Needs Prep" id="washing" active={filter} set={setFilter} />
         <FilterButton label="Listed Online" id="listed" active={filter} set={setFilter} />
      </div>

      {/* ITEM LIST */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {safeMissions.length === 0 ? (
          <div className="col-span-2 p-20 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[3rem] bg-white/50 dark:bg-slate-900/20">
            <p className="text-slate-400 dark:text-slate-500 font-bold text-lg uppercase tracking-widest">Your inventory is empty.</p>
          </div>
        ) : (
          filtered.map((item: any) => (
            <div key={item.id} className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-[2.5rem] hover:border-emerald-500 transition-all shadow-sm hover:shadow-xl relative">
               
               <div className="flex justify-between items-start mb-6 text-left">
                  <div>
                     {/* INTERACTIVE STATUS BADGE */}
                     <select 
                        value={item.status} 
                        onChange={(e) => updateItemStatus(item.id, e.target.value)}
                        className={`inline-flex items-center px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest mb-4 border cursor-pointer outline-none appearance-none transition-colors
                           ${item.status === 'in_trunk' ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700' : 
                             item.status === 'listed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                             'bg-blue-500/10 text-blue-500 border-blue-500/20'}
                        `}
                     >
                        <option value="in_trunk">In Trunk</option>
                        <option value="washing">Needs Prep</option>
                        <option value="listed">Listed Online</option>
                     </select>
                     <h3 className="text-3xl font-black italic uppercase text-slate-900 dark:text-white tracking-tighter leading-tight">{item.name}</h3>
                     <p className="text-sm font-bold text-slate-400 dark:text-slate-500 mt-2 uppercase tracking-widest">Added: {item.date}</p>
                  </div>
                  <button 
                    onClick={() => deleteItem(item.id)}
                    className="p-3 text-slate-300 hover:text-red-500 transition-colors"
                    title="Delete Asset"
                  >
                    <Trash2 size={20} />
                  </button>
               </div>

               <div className="flex items-center gap-10 mb-8 p-6 bg-slate-50 dark:bg-slate-950/50 rounded-3xl border border-slate-100 dark:border-slate-800">
                  <div className="text-left">
                     <p className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Cost</p>
                     <p className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">${item.buy_price || 0}</p>
                  </div>
                  <div className="w-px h-12 bg-slate-200 dark:bg-slate-800" />
                  <div className="text-left">
                     <p className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-1">Expected Profit</p>
                     <p className="text-3xl font-black text-emerald-500 tabular-nums">+${((item.est_sell || 0) - (item.buy_price || 0)).toFixed(0)}</p>
                  </div>
               </div>

               <button 
                  onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(item.name + " vintage size tag")}&tbm=isch`, '_blank')} 
                  className="w-full py-5 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center space-x-3 shadow-inner"
               >
                  <Search size={18} /> <span>Price Comparison Check</span>
               </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Helpers...
function EntryInput({ label, placeholder, value, onChange, type = "text" }: any) {
    return (
        <div className="space-y-3 text-left">
            <label className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-1">{label}</label>
            <input type={type} placeholder={placeholder} className="w-full p-5 rounded-2xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-bold outline-none border border-slate-200 dark:border-slate-800 focus:border-emerald-500 transition-all text-lg shadow-inner" value={value} onChange={e => onChange(e.target.value)} />
        </div>
    );
}

function StatCard({ label, value, icon: Icon, color }: any) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 rounded-[3rem] shadow-lg flex items-center space-x-8 transition-all group hover:border-slate-400 dark:hover:border-slate-600">
       <div className={`p-6 rounded-2xl bg-slate-50 dark:bg-slate-800 ${color} shadow-inner`}><Icon size={32} /></div>
       <div className="text-left">
          <p className="text-sm font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{label}</p>
          <p className="text-5xl font-black italic text-slate-900 dark:text-white tracking-tighter leading-none">{value}</p>
       </div>
    </div>
  );
}

function FilterButton({ label, id, active, set }: any) {
  const isActive = active === id;
  return (
    <button onClick={() => set(id)} className={`px-8 py-4 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${isActive ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-transparent shadow-lg scale-105' : 'bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-black dark:hover:text-white'}`}>{label}</button>
  );
}