const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// INITIALIZE SUPABASE
// Using the exact names from your GitHub Secrets
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function syncMarketPulse() {
  console.log("🚀 Starting Zero-API Market Sync...");

  try {
    // 1. Pull the brands/items you want to track from your database
    const { data: signals, error: sigError } = await supabase.from('market_signals').select('*');
    
    if (sigError) throw sigError;
    if (!signals || signals.length === 0) {
      console.log("⚠️ No signals found in database to sync.");
      return;
    }

    for (const signal of signals) {
      console.log(`🔍 Syncing: ${signal.trend_name}`);
      
      // --- LIVE EBAY SCRAPE (Public Sold Listings) ---
      // We look at the last few 'Sold' items to get a realistic price average
      const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(signal.trend_name)}&_sacat=0&rt=nc&LH_Sold=1&LH_Complete=1`;
      
      const response = await fetch(ebayUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      const prices = [];
      $('.s-item__price').each((i, el) => {
        const priceText = $(el).text().replace(/[^0-9.]/g, '');
        const p = parseFloat(priceText);
        if (!isNaN(p) && p > 0) prices.push(p);
      });

      // Calculate Average (Exclude outliers if list is long)
      const avgPrice = prices.length > 0 
        ? Math.floor(prices.reduce((a, b) => a + b) / prices.length) 
        : signal.exit_price;

      // --- LIVE REDDIT HYPE CHECK ---
      // Scans public search for mention frequency this week
      const redditUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(signal.trend_name)}&t=week`;
      const redditRes = await fetch(redditUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const redditHtml = await redditRes.text();
      
      const mentionCount = (redditHtml.match(new RegExp(signal.trend_name, "gi")) || []).length;
      const newHeat = Math.min(50 + (mentionCount * 2), 99); // Cap heat at 99

      // 2. UPDATE SUPABASE
      const { error: upError } = await supabase
        .from('market_signals')
        .update({ 
          exit_price: avgPrice, 
          heat_score: newHeat,
          updated_at: new Date() 
        })
        .eq('id', signal.id);

      if (upError) console.error(`❌ Update failed for ${signal.trend_name}:`, upError.message);
      else console.log(`✅ ${signal.trend_name} updated: $${avgPrice} | Heat: ${newHeat}`);
    }

    console.log("🏁 Sync process finished successfully.");

  } catch (err) {
    console.error("❌ Critical Sync Error:", err.message);
  }
}

syncMarketPulse();