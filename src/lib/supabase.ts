import { createClient } from '@supabase/supabase-js';

/**
 * 1. PULL ENVIRONMENT VARIABLES
 * We use the NEXT_PUBLIC_ prefix so these are accessible in the browser.
 * The '||' fallbacks prevent Vercel from crashing during the 'static' build phase.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

/**
 * 2. INITIALIZE THE CLIENT
 * This 'supabase' object will be the primary way your app talks to your database.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * 3. SAFETY LOGGING
 * This only runs in the browser console. If you open your live site and don't 
 * see data, check the console for this warning!
 */
if (typeof window !== 'undefined' && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
  console.warn(
    "⚠️ ThriftPulse: Supabase keys are missing. " +
    "Check your Vercel Environment Variables (NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY)."
  );
}