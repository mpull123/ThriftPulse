"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { 
  MapPin, Navigation, Star, Info, 
  Map as MapIcon, Layers, Target, TrendingUp, LocateFixed, Car
} from "lucide-react";

export default function SectionHunt({ location, signals = [] }: any) {
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStore, setSelectedStore] = useState<any>(null);
  const [userCoords, setUserCoords] = useState<{lat: number, lng: number} | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // --- LIVE GEOLOCATION ---
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
    }

    async function loadStores() {
      const { data } = await supabase
        .from('stores')
        .select('*')
        .eq('zip_code', location)
        .order('power_rank', { ascending: false });
      setStores(data || []);
      setLoading(false);
    }
    loadStores();
  }, [location]);

  // Helper: Open multi-stop route in Google Maps
  const launchMultiStopRoute = () => {
    if (stores.length === 0) return;
    const destinations = stores.slice(0, 3).map(s => encodeURIComponent(s.address)).join('/');
    window.open(`https://www.google.com/maps/dir/Current+Location/${destinations}`, '_blank');
  };

  const getMatchedNodes = (storeSpecialties: string[]) => {
    if (!storeSpecialties) return [];
    return signals.filter((sig: any) => 
      storeSpecialties.some(spec => sig.trend_name.toLowerCase().includes(spec.toLowerCase()))
    ).slice(0, 2);
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 text-left">
      
      {/* SOURCING GUIDE */}
      <div className="bg-blue-500/5 border border-blue-500/20 p-8 rounded-3xl flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm">
         <div className="flex items-start space-x-6 max-w-2xl">
            <Info className="text-blue-500 shrink-0 mt-1" size={24} />
            <div className="space-y-1">
               <p className="text-xs font-black uppercase text-blue-600 tracking-widest">Live Route Planning</p>
               <p className="text-lg text-slate-600 dark:text-slate-300 font-medium italic leading-relaxed">
                  Your location is active. We've ranked nearby stores by their "Power Rank" and distance. Click **Optimize Route** to start a multi-stop trip.
               </p>
            </div>
         </div>
         <button 
            onClick={launchMultiStopRoute}
            className="w-full md:w-auto px-8 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase text-sm tracking-widest flex items-center justify-center space-x-3 shadow-xl hover:bg-blue-500 transition-all"
         >
            <Car size={20} /> <span>Optimize Route</span>
         </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* STORE LIST */}
        <div className="lg:col-span-1 space-y-6">
           <div className="flex items-center justify-between pb-4 border-b dark:border-slate-800">
              <h3 className="text-xl font-black uppercase italic text-slate-900 dark:text-white">Active Nodes</h3>
              <div className="flex items-center space-x-2 text-[10px] font-black uppercase text-emerald-500">
                 <LocateFixed size={12} /> <span>GPS Active</span>
              </div>
           </div>

           <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
              {loading ? (
                <div className="p-10 text-center animate-pulse text-slate-400">Syncing with satellites...</div>
              ) : stores.map((store) => (
                <StoreCard 
                  key={store.id} 
                  store={store} 
                  active={selectedStore?.id === store.id}
                  onClick={() => setSelectedStore(store)}
                  matches={getMatchedNodes(store.inventory_specialties)}
                />
              ))}
           </div>
        </div>

        {/* MAP & STRATEGY */}
        <div className="lg:col-span-2 space-y-8">
           <div className="aspect-video bg-slate-200 dark:bg-slate-900 rounded-[3rem] border border-slate-300 dark:border-slate-800 shadow-inner relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://api.mapbox.com/styles/v1/mapbox/dark-v10/static/-84.51,33.95,12,0/800x450?access_token=pk.placeholder')] opacity-40 grayscale mix-blend-overlay" />
              
              <div className="absolute top-6 right-6 flex flex-col space-y-2">
                 <MapOverlayBtn icon={Layers} />
                 <MapOverlayBtn icon={Target} />
              </div>

              {selectedStore && (
                <div className="absolute bottom-8 left-8 right-8 p-8 bg-white dark:bg-slate-900 border border-emerald-500 rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-6 flex flex-col md:flex-row justify-between items-center gap-6">
                   <div className="text-left">
                      <h4 className="text-2xl font-black uppercase italic dark:text-white leading-none mb-2">{selectedStore.name}</h4>
                      <p className="text-sm font-bold text-slate-500">{selectedStore.address}</p>
                   </div>
                   <button 
                     onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedStore.address)}`, '_blank')}
                     className="w-full md:w-auto px-8 py-4 bg-emerald-500 text-slate-950 rounded-xl font-black uppercase text-xs tracking-widest flex items-center justify-center space-x-3 shadow-lg hover:scale-105 transition-all"
                   >
                      <Navigation size={18} /> <span>Navigate Now</span>
                   </button>
                </div>
              )}
           </div>

           <div className="p-10 rounded-[3.5rem] bg-slate-900 border border-slate-800 relative overflow-hidden shadow-2xl text-left">
              <div className="absolute top-0 right-0 p-8 text-blue-500/10 pointer-events-none"><TrendingUp size={160} /></div>
              <div className="flex items-center space-x-3 mb-8">
                 <TrendingUp className="text-blue-400" size={28} />
                 <h4 className="text-2xl font-black uppercase italic text-white tracking-tight">AI Route Logic</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                 <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                    <p className="text-xs font-black uppercase text-slate-500 mb-3 tracking-widest">Recommended Path</p>
                    <p className="text-lg text-slate-200 font-medium italic leading-relaxed">
                       Start with **{stores[0]?.name || 'Primary'}**. It has the highest income-density ranking in {location}, which increases your odds of finding designer labels.
                    </p>
                 </div>
                 <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                    <p className="text-xs font-black uppercase text-slate-500 mb-3 tracking-widest">Traffic Insight</p>
                    <p className="text-lg text-slate-200 font-medium italic leading-relaxed">
                       Standard restocks occur between **9:00 AM and 11:00 AM**. Arrival within this window is critical for "First-Look" advantages.
                    </p>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

function StoreCard({ store, active, onClick, matches }: any) {
  return (
    <div 
      onClick={onClick}
      className={`p-8 rounded-[2.5rem] border transition-all cursor-pointer text-left
        ${active 
          ? 'bg-emerald-500/5 border-emerald-500 shadow-xl' 
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
        }
      `}
    >
      <div className="flex justify-between items-start mb-6">
         <div className={`h-12 w-12 rounded-2xl flex items-center justify-center ${active ? 'bg-emerald-500 text-slate-950 shadow-lg' : 'bg-slate-50 dark:bg-slate-800 text-slate-500'}`}>
            <MapPin size={24} />
         </div>
         <div className="flex items-center space-x-2 px-3 py-1.5 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <Star size={14} className="text-amber-500 fill-current" />
            <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">{store.power_rank} Power</span>
         </div>
      </div>
      
      <h4 className={`text-xl font-black uppercase italic mb-2 ${active ? 'text-emerald-500' : 'text-slate-900 dark:text-white'}`}>
         {store.name}
      </h4>
      <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6 leading-none">{store.address.split(',')[0]}</p>

      {matches.length > 0 && (
        <div className="pt-6 border-t dark:border-slate-800 flex flex-col gap-3">
           <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Target Inventory Match:</p>
           <div className="flex flex-wrap gap-2">
              {matches.map((m: any) => (
                <span key={m.id} className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-500 text-[10px] font-black uppercase rounded-lg">
                   {m.trend_name}
                </span>
              ))}
           </div>
        </div>
      )}
    </div>
  );
}

function MapOverlayBtn({ icon: Icon }: any) {
   return (
      <button className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-500 hover:text-emerald-500 shadow-xl transition-all">
         <Icon size={24} />
      </button>
   );
}