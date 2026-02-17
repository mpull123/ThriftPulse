const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// INITIALIZE SUPABASE
// Using the exact names from your GitHub Secrets
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function startCollectorJob(sourceName) {
  try {
    const { data, error } = await supabase
      .from('collector_jobs')
      .insert([{
        source_name: sourceName,
        status: 'running',
        started_at: new Date().toISOString()
      }])
      .select('id')
      .single();

    if (error) {
      console.error(`collector_jobs start failed (${sourceName}):`, error.message);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error(`collector_jobs start threw (${sourceName}):`, err.message);
    return null;
  }
}

async function finishCollectorJob(jobId, status, errorMessage = null) {
  if (!jobId) return;
  try {
    const payload = {
      status,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: errorMessage
    };
    const { error } = await supabase
      .from('collector_jobs')
      .update(payload)
      .eq('id', jobId);

    if (error) {
      console.error(`collector_jobs finish failed (${jobId}):`, error.message);
    }
  } catch (err) {
    console.error(`collector_jobs finish threw (${jobId}):`, err.message);
  }
}

async function fetchEbayAveragePrice(term, fallbackPrice) {
  const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(term)}&_sacat=0&rt=nc&LH_Sold=1&LH_Complete=1`;
  const response = await fetch(ebayUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const html = await response.text();
  const $ = cheerio.load(html);

  const prices = [];
  $('.s-item__price').each((i, el) => {
    const priceText = $(el).text().replace(/[^0-9.]/g, '');
    const p = parseFloat(priceText);
    if (!Number.isNaN(p) && p > 0) prices.push(p);
  });

  if (!prices.length) return safeNumber(fallbackPrice, 0);
  return Math.floor(prices.reduce((a, b) => a + b, 0) / prices.length);
}

async function fetchRedditMentionCount(term) {
  const encodedTerm = encodeURIComponent(term);
  const candidates = [
    `https://www.reddit.com/search.json?q=${encodedTerm}&sort=new&t=week&limit=100`,
    `https://www.reddit.com/search.json?raw_json=1&q=${encodedTerm}&sort=relevance&t=week&limit=100`
  ];
  const headersList = [
    {
      'User-Agent': 'thriftpulse-sync/1.0',
      Accept: 'application/json'
    },
    {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json'
    }
  ];

  let lastError = 'Unknown reddit error';
  for (const url of candidates) {
    for (const headers of headersList) {
      try {
        const redditRes = await fetch(url, { headers });
        const bodyText = await redditRes.text();

        if (!redditRes.ok) {
          const snippet = bodyText.slice(0, 120).replace(/\s+/g, ' ');
          lastError = `status=${redditRes.status} endpoint=${url} body="${snippet}"`;
          continue;
        }

        let redditJson = null;
        try {
          redditJson = JSON.parse(bodyText);
        } catch (parseErr) {
          lastError = `json_parse_failed endpoint=${url} msg=${parseErr.message}`;
          continue;
        }

        const posts = redditJson?.data?.children || [];
        if (!Array.isArray(posts)) {
          lastError = `invalid_payload endpoint=${url}`;
          continue;
        }
        if (posts.length === 0) return 0;

        const termRegex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
        let mentions = 0;

        for (const post of posts) {
          const title = post?.data?.title || '';
          const selfText = post?.data?.selftext || '';
          mentions += (title.match(termRegex) || []).length;
          mentions += (selfText.match(termRegex) || []).length;
        }

        // Use at least post count as weak signal if exact term is sparse in text.
        return Math.max(mentions, posts.length);
      } catch (err) {
        lastError = `network_error endpoint=${url} msg=${err.message}`;
      }
    }
  }

  throw new Error(lastError);
}

function calculateHeatScore(previousHeat, mentionCount) {
  if (mentionCount <= 0) {
    // Preserve prior signal when Reddit gives no reliable data.
    return safeNumber(previousHeat, 50);
  }

  const calculated = 45 + mentionCount * 2;
  return Math.max(25, Math.min(99, calculated));
}

async function getActiveQueryPacks() {
  const { data, error } = await supabase
    .from('subreddits')
    .select('name,is_active')
    .eq('is_active', true);

  if (error) {
    console.error('Query pack fetch failed:', error.message);
    return [];
  }

  return (data || [])
    .map((row) => String(row.name || '').trim())
    .filter(Boolean);
}

async function seedSignalsFromQueryPacks(existingSignals) {
  const existingNames = new Set(
    (existingSignals || []).map((s) => String(s.trend_name || '').trim().toLowerCase())
  );
  const queryPacks = await getActiveQueryPacks();
  const newTerms = queryPacks.filter((term) => !existingNames.has(term.toLowerCase()));

  if (!newTerms.length) return 0;

  let created = 0;
  for (const term of newTerms) {
    try {
      const [mentionCount, avgPrice] = await Promise.all([
        fetchRedditMentionCount(term),
        fetchEbayAveragePrice(term, 60)
      ]);
      const heatScore = calculateHeatScore(50, mentionCount);

      const { error } = await supabase
        .from('market_signals')
        .upsert(
          [{
            trend_name: term,
            heat_score: heatScore,
            exit_price: Math.max(10, avgPrice),
            updated_at: new Date().toISOString()
          }],
          { onConflict: 'trend_name' }
        );

      if (!error) {
        created += 1;
        console.log(`🆕 Discovered from Query Pack: ${term} | Heat: ${heatScore} | $${avgPrice}`);
      } else {
        console.error(`Discovery upsert failed (${term}):`, error.message);
      }
    } catch (err) {
      console.error(`Discovery failed (${term}):`, err.message);
    }
  }

  return created;
}

async function syncMarketPulse() {
  console.log("🚀 Starting Zero-API Market Sync...");
  const redditJobId = await startCollectorJob('reddit');
  const ebayJobId = await startCollectorJob('ebay');
  let ebayFailures = 0;
  let redditFailures = 0;
  const redditFailureDetails = [];

  try {
    // 1. Pull the brands/items you want to track from your database
    const { data: initialSignals, error: sigError } = await supabase.from('market_signals').select('*');
    
    if (sigError) throw sigError;
    const discoveredCount = await seedSignalsFromQueryPacks(initialSignals || []);
    if (discoveredCount > 0) {
      console.log(`✅ Added ${discoveredCount} discovered trend(s) from active Query Packs.`);
    }

    // Refresh signal list after discovery.
    const { data: signals, error: refetchError } = await supabase.from('market_signals').select('*');
    if (refetchError) throw refetchError;
    if (!signals || signals.length === 0) {
      console.log("⚠️ No signals found in database to sync.");
      await finishCollectorJob(redditJobId, 'failed', 'No signals found to sync.');
      await finishCollectorJob(ebayJobId, 'failed', 'No signals found to sync.');
      return;
    }

    for (const signal of signals) {
      console.log(`🔍 Syncing: ${signal.trend_name}`);

      let avgPrice = safeNumber(signal.exit_price, 0);
      let mentionCount = 0;

      try {
        avgPrice = await fetchEbayAveragePrice(signal.trend_name, signal.exit_price);
      } catch (err) {
        ebayFailures += 1;
        console.error(`❌ eBay fetch failed for ${signal.trend_name}:`, err.message);
      }

      try {
        mentionCount = await fetchRedditMentionCount(signal.trend_name);
      } catch (err) {
        redditFailures += 1;
        if (redditFailureDetails.length < 5) {
          redditFailureDetails.push(`${signal.trend_name}: ${err.message}`);
        }
        console.error(`❌ Reddit fetch failed for ${signal.trend_name}:`, err.message);
      }

      const newHeat = calculateHeatScore(signal.heat_score, mentionCount);

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
      else console.log(`✅ ${signal.trend_name} updated: $${avgPrice} | Heat: ${newHeat} | Mentions: ${mentionCount}`);
    }

    await finishCollectorJob(
      ebayJobId,
      ebayFailures > 0 ? 'degraded' : 'success',
      ebayFailures > 0 ? `${ebayFailures} item(s) failed eBay fetch.` : null
    );
    await finishCollectorJob(
      redditJobId,
      redditFailures > 0 ? 'degraded' : 'success',
      redditFailures > 0
        ? `${redditFailures} item(s) failed Reddit fetch. ${redditFailureDetails.join(' | ')}`
        : null
    );

    console.log("🏁 Sync process finished successfully.");

  } catch (err) {
    await finishCollectorJob(redditJobId, 'failed', err.message);
    await finishCollectorJob(ebayJobId, 'failed', err.message);
    console.error("❌ Critical Sync Error:", err.message);
  }
}

syncMarketPulse();
