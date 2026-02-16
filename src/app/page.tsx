import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white selection:bg-emerald-500 selection:text-black">
      <div className="text-center space-y-6">
        <div className="flex justify-center mb-4">
          <div className="h-20 w-20 bg-emerald-500 rounded-3xl flex items-center justify-center text-slate-950 font-black italic shadow-2xl shadow-emerald-500/20 text-4xl">T</div>
        </div>
        <h1 className="text-6xl md:text-8xl font-black italic uppercase tracking-tighter leading-none">ThriftPulse</h1>
        <p className="text-emerald-500 font-bold tracking-[0.3em] uppercase text-xs md:text-sm">Cloud Resell Engine v1.0</p>
        
        <div className="pt-8">
          <Link href="/dashboard" className="group relative inline-flex items-center gap-3 bg-white text-black px-12 py-5 rounded-full font-black uppercase italic hover:bg-emerald-500 hover:text-white transition-all duration-300">
            <Sparkles size={20} className="group-hover:animate-pulse" />
            Launch Dashboard
          </Link>
        </div>
      </div>
      <footer className="absolute bottom-8 text-slate-600 text-[10px] uppercase font-bold tracking-widest">
        Secured by Supabase & OpenAI
      </footer>
    </div>
  );
}