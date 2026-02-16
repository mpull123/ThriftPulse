import { createClient } from '@supabase/supabase-js';

// 1. Pull the keys from your Environment Variables (Vercel/GitHub)
// We provide fallback strings so the build process doesn't fail if they are missing for a second.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// 2. Safety Check: If the site is running but keys are missing, log a warning
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "⚠️ Supabase Error: Missing environment variables. " +
    "Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in Vercel."
  );
}

// 3. Initialize the Client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);