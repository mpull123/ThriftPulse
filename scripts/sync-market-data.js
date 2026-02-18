const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// INITIALIZE SUPABASE
// Using the exact names from your GitHub Secrets
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const DEFAULT_SUBREDDITS = [
  'malefashionadvice',
  'femalefashionadvice',
  'fashion',
  'PetiteFashionAdvice',
  'mensfashion',
  'streetwear',
  'OUTFITS',
  'Sneakers',
  'frugalmalefashion',
  'FrugalFemaleFashion',
  'rawdenim',
  'VintageFashion',
  'thrifting',
  'ThriftStoreHauls',
  'Goodwill_Finds',
  'SecondHandFinds'
];

const FASHION_CORPUS_SOURCES = [
  'https://www.highsnobiety.com/feed/',
  'https://hypebeast.com/feed',
  'https://www.gq.com/feed/rss',
  'https://www.vogue.com/feed/rss',
  'https://www.whowhatwear.com/rss',
  'https://www.thecut.com/rss',
  'https://www.complex.com/style/rss',
  'https://www.refinery29.com/en-us/fashion/rss.xml',
  'https://www.instyle.com/feed',
  'https://www.harpersbazaar.com/rss/all.xml',
  'https://www.elle.com/rss/all.xml',
  'https://www.glamour.com/feed/rss',
  'https://www.depop.com/blog/feed/'
];

function getTargetSubreddits() {
  const fromEnv = String(process.env.REDDIT_SUBREDDITS || '')
    .split(',')
    .map((v) => v.replace(/^r\//i, '').trim())
    .filter(Boolean);

  const list = fromEnv.length ? fromEnv : DEFAULT_SUBREDDITS;
  return [...new Set(list)];
}

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

async function fetchEbayStats(term, fallbackPrice) {
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

  // Fallback parse: some responses miss selector structure but still contain price spans.
  if (!prices.length) {
    const roughMatches = [...html.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)/g)]
      .map((m) => parseFloat(m[1]))
      .filter((n) => Number.isFinite(n) && n > 5 && n < 5000)
      .slice(0, 50);
    prices.push(...roughMatches);
  }

  if (!prices.length) {
    return {
      avgPrice: safeNumber(fallbackPrice, 0),
      sampleCount: 0
    };
  }

  return {
    avgPrice: Math.floor(prices.reduce((a, b) => a + b, 0) / prices.length),
    sampleCount: prices.length
  };
}

async function fetchRedditMentionCount(term) {
  const subreddits = getTargetSubreddits();
  let oauthError = null;
  try {
    const oauthCount = await fetchRedditMentionCountOAuth(term);
    if (oauthCount !== null) return oauthCount;
  } catch (err) {
    oauthError = err.message;
  }

  const encodedTerm = encodeURIComponent(`"${term}"`);
  const candidates = subreddits.flatMap((subreddit) => ([
    `https://www.reddit.com/r/${subreddit}/search.json?restrict_sr=1&sort=new&t=week&limit=50&q=${encodedTerm}`,
    `https://www.reddit.com/r/${subreddit}/search.json?raw_json=1&restrict_sr=1&sort=relevance&t=week&limit=50&q=${encodedTerm}`
  ]));
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

  let lastError = oauthError || 'Unknown reddit error';
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

async function fetchRedditMentionCountOAuth(term) {
  const subreddits = getTargetSubreddits();
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT || 'thriftpulse-sync/1.0';

  if (!clientId || !clientSecret) return null;

  const authToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authToken}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    const snippet = tokenText.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`oauth_token_failed status=${tokenRes.status} body="${snippet}"`);
  }

  let tokenJson = null;
  try {
    tokenJson = JSON.parse(tokenText);
  } catch (err) {
    throw new Error(`oauth_token_parse_failed ${err.message}`);
  }

  const accessToken = tokenJson?.access_token;
  if (!accessToken) throw new Error('oauth_token_missing_access_token');

  const termRegex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  let totalMentions = 0;
  let totalPosts = 0;
  let lastError = null;

  for (const subreddit of subreddits) {
    const url = `https://oauth.reddit.com/r/${subreddit}/search?restrict_sr=1&q=${encodeURIComponent(`"${term}"`)}&sort=new&t=week&limit=50`;
    const searchRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': userAgent,
        Accept: 'application/json'
      }
    });

    const bodyText = await searchRes.text();
    if (!searchRes.ok) {
      const snippet = bodyText.slice(0, 120).replace(/\s+/g, ' ');
      lastError = `oauth_search_failed status=${searchRes.status} subreddit=${subreddit} body="${snippet}"`;
      continue;
    }

    let searchJson = null;
    try {
      searchJson = JSON.parse(bodyText);
    } catch (err) {
      lastError = `oauth_search_parse_failed subreddit=${subreddit} ${err.message}`;
      continue;
    }

    const posts = searchJson?.data?.children || [];
    if (!Array.isArray(posts)) continue;
    totalPosts += posts.length;

    for (const post of posts) {
      const title = post?.data?.title || '';
      const selfText = post?.data?.selftext || '';
      totalMentions += (title.match(termRegex) || []).length;
      totalMentions += (selfText.match(termRegex) || []).length;
    }
  }

  if (totalPosts > 0) return Math.max(totalMentions, totalPosts);
  if (lastError) throw new Error(lastError);
  return 0;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function compactWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractTermsFromTrendTitle(title) {
  const cleaned = decodeXmlEntities(String(title || '')).trim();
  if (!cleaned) return [];

  // Google trend titles are often "A vs B" or "A, B, C".
  const parts = cleaned
    .split(/\s+vs\.?\s+|,/i)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.length ? parts : [cleaned];
}

function isFashionTerm(term) {
  const t = term.toLowerCase();
  const keywords = [
    'fashion', 'streetwear', 'outfit', 'sneaker', 'shoe', 'boot', 'jacket',
    'hoodie', 'cardigan', 'denim', 'jean', 'vintage', 'thrift', 'goodwill',
    'carhartt', 'gore-tex', 'depop', 'grailed', 'nike', 'adidas', 'bag',
    'coat', 'pants', 'workwear', 'raw denim', 'mohair', 'tabi', 'salomon'
  ];
  return keywords.some((kw) => t.includes(kw));
}

function isBlockedNonFashionTerm(term) {
  const t = String(term || '').toLowerCase();
  const blocked = [
    'wrexham', 'vix', 'psg', 'dortmund', 'champions league', 'schedule',
    'weather', 'watch', 'curling', 'olympics', 'fire weather',
    'stock', 'nasdaq', 'dow', 'bitcoin', 'election', 'hurricane'
  ];
  return blocked.some((kw) => t.includes(kw));
}

function shouldUseTrendTerm(term) {
  const cleaned = String(term || '').trim();
  if (!cleaned) return false;
  if (cleaned.length < 4 || cleaned.length > 60) return false;
  if (isBlockedNonFashionTerm(cleaned)) return false;
  return isFashionTerm(cleaned);
}

function normalizeTrendTerm(term) {
  let t = compactWhitespace(term);
  if (!t) return '';

  // Strip AI filler prefixes that don't add resale meaning.
  t = t.replace(/^(chic|luxe|elevated|trendy|stylish)\s+/i, '');

  // Normalize common apparel variants.
  t = t
    .replace(/\btee shirt\b/gi, 't-shirt')
    .replace(/\bt shirt\b/gi, 't-shirt')
    .replace(/\bgraphic tee\b/gi, 'graphic t-shirt')
    .replace(/\bhigh waisted\b/gi, 'high-waisted');

  // Normalize repeated "vintage 90s" style prefixes.
  t = t.replace(/^vintage\s+90s\s+/i, 'Vintage 90s ');

  // Title-case for cleaner display.
  t = t
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOf\b/g, 'of')
    .replace(/\bWith\b/g, 'with');

  return compactWhitespace(t);
}

function getDedupeKey(term) {
  return normalizeTrendTerm(term)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPrefixBucket(term) {
  const normalized = normalizeTrendTerm(term).toLowerCase();
  if (normalized.startsWith('vintage 90s')) return 'vintage-90s';
  if (normalized.startsWith('vintage')) return 'vintage';
  if (normalized.includes('jacket')) return 'jacket';
  if (normalized.includes('boots') || normalized.includes('boot')) return 'boots';
  if (normalized.includes('cardigan')) return 'cardigan';
  if (normalized.includes('denim') || normalized.includes('jean')) return 'denim';
  return normalized.split(' ').slice(0, 2).join('-');
}

function applyDiversityCaps(terms, capPerBucket = 6) {
  const counts = new Map();
  const kept = [];

  for (const term of terms) {
    const bucket = getPrefixBucket(term);
    const current = counts.get(bucket) || 0;
    if (current >= capPerBucket) continue;
    counts.set(bucket, current + 1);
    kept.push(term);
  }

  return kept;
}

function titleToDiscoveryCandidate(title) {
  let t = compactWhitespace(decodeXmlEntities(title || ''));
  if (!t) return '';

  t = t
    .replace(/^new listing[:\s-]*/i, '')
    .replace(/\b(men'?s|women'?s|unisex)\b/gi, '')
    .replace(/\b(size|sz)\s*[a-z0-9.-]+\b/gi, '')
    .replace(/\bnwt\b|\bnwot\b|\bpre-?owned\b|\bused\b/gi, '')
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Keep concise phrase window for trend intent.
  const words = t.split(' ').filter(Boolean).slice(0, 6);
  return normalizeTrendTerm(words.join(' '));
}

async function fetchEbayDiscoveryTerms(seedTerms) {
  const seeds = [...new Set((seedTerms || []).map((s) => compactWhitespace(String(s))).filter(Boolean))].slice(0, 14);
  const discovered = [];

  for (const seed of seeds) {
    try {
      const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(seed)}&_sacat=0&rt=nc&LH_Sold=1&LH_Complete=1`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = await res.text();
      if (!res.ok) continue;

      const $ = cheerio.load(html);
      const titles = $('.s-item__title')
        .map((_, el) => compactWhitespace($(el).text()))
        .get()
        .filter(Boolean)
        .slice(0, 80);

      for (const title of titles) {
        const candidate = titleToDiscoveryCandidate(title);
        if (shouldUseTrendTerm(candidate)) discovered.push(candidate);
      }
    } catch (err) {
      console.warn(`ebay discovery failed for seed "${seed}":`, err.message);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const term of discovered) {
    const key = getDedupeKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(term);
  }
  return applyDiversityCaps(deduped, Number(process.env.EBAY_DISCOVERY_BUCKET_CAP || 4)).slice(0, Number(process.env.MAX_EBAY_DISCOVERY_TERMS || 120));
}

async function classifyFashionTermsWithAI(rawTerms) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !Array.isArray(rawTerms) || rawTerms.length === 0) return null;

  const inputTerms = rawTerms.slice(0, 40);
  const systemPrompt =
    'You are a fashion resale trend classifier. Return only strict JSON with keys: selected_terms (string[]), dropped_terms (string[]). Select terms relevant to clothing, footwear, accessories, styling, thrifting, vintage, or resale fashion.';
  const userPrompt = `Classify these Google trend terms for fashion relevance:\n${JSON.stringify(inputTerms)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.TREND_CLASSIFIER_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  const bodyText = await res.text();
  if (!res.ok) {
    const snippet = bodyText.slice(0, 140).replace(/\s+/g, ' ');
    throw new Error(`ai_classify_failed status=${res.status} body="${snippet}"`);
  }

  let payload = null;
  try {
    const parsed = JSON.parse(bodyText);
    payload = JSON.parse(parsed?.choices?.[0]?.message?.content || '{}');
  } catch (err) {
    throw new Error(`ai_classify_parse_failed ${err.message}`);
  }

  const selected = Array.isArray(payload?.selected_terms)
    ? payload.selected_terms.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  return [...new Set(selected)].filter(shouldUseTrendTerm);
}

async function fetchFashionCorpusHeadlines() {
  const headlines = [];

  for (const url of FASHION_CORPUS_SOURCES) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'thriftpulse-sync/1.0',
          Accept: 'application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8'
        }
      });
      const body = await res.text();
      if (!res.ok) continue;

      if (/<item>/i.test(body)) {
        const rssTitles = [...body.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/gi)]
          .map((m) => compactWhitespace(decodeXmlEntities(m[1])))
          .filter(Boolean);
        headlines.push(...rssTitles);
        continue;
      }

      const $ = cheerio.load(body);
      const htmlTitles = [
        ...$('h1,h2,h3,a[title]').map((_, el) => compactWhitespace($(el).text() || $(el).attr('title'))).get()
      ].filter(Boolean);
      headlines.push(...htmlTitles);
    } catch (err) {
      console.warn(`fashion corpus fetch failed (${url}):`, err.message);
    }
  }

  return [...new Set(headlines)].filter((h) => h.length >= 8 && h.length <= 120).slice(0, 200);
}

async function generateFashionCandidatesFromCorpusAI(corpusHeadlines, existingTerms) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !Array.isArray(corpusHeadlines) || corpusHeadlines.length === 0) return [];

  const seedTerms = (existingTerms || []).slice(0, 120);
  const headlineSample = corpusHeadlines.slice(0, 120);
  const maxCandidates = Math.max(50, Math.min(500, Number(process.env.MAX_AI_CANDIDATES || 250)));
  const systemPrompt =
    'You are a fashion trend researcher for resale markets. Return JSON only with key "candidates" as an array of concise fashion keyword phrases. Include garments, styles, aesthetics, materials, and brand-item combinations relevant to resale.';
  const userPrompt = `Generate up to ${maxCandidates} fashion trend candidates.\nCurrent trend seeds:\n${JSON.stringify(seedTerms)}\n\nFashion headlines corpus:\n${JSON.stringify(headlineSample)}\n\nOutput JSON: {"candidates":["..."]}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.TREND_CLASSIFIER_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  const bodyText = await res.text();
  if (!res.ok) {
    const snippet = bodyText.slice(0, 140).replace(/\s+/g, ' ');
    throw new Error(`ai_candidate_gen_failed status=${res.status} body="${snippet}"`);
  }

  let payload = null;
  try {
    const parsed = JSON.parse(bodyText);
    payload = JSON.parse(parsed?.choices?.[0]?.message?.content || '{}');
  } catch (err) {
    throw new Error(`ai_candidate_gen_parse_failed ${err.message}`);
  }

  const candidates = Array.isArray(payload?.candidates)
    ? payload.candidates.map((t) => compactWhitespace(t)).filter(Boolean)
    : [];

  return [...new Set(candidates)].filter(shouldUseTrendTerm).slice(0, maxCandidates);
}

async function fetchGoogleTrendsTerms() {
  const urls = [
    'https://trends.google.com/trending/rss?geo=US',
    'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US',
    'https://trends.google.com/trends/hottrends/atom/feed?pn=p1'
  ];

  let xml = '';
  let lastError = 'google_trends_failed_unknown';
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'thriftpulse-sync/1.0',
        Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
      }
    });

    xml = await res.text();
    if (res.ok && /<item>/i.test(xml)) {
      lastError = '';
      break;
    }

    const snippet = xml.slice(0, 120).replace(/\s+/g, ' ');
    lastError = `google_trends_failed status=${res.status} url=${url} body="${snippet}"`;
  }

  if (lastError) throw new Error(lastError);

  const titleMatches = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/gi)];
  const rawTitles = titleMatches.map((m) => m[1]).filter(Boolean);

  const rawTerms = [];
  const filteredTerms = [];
  for (const title of rawTitles) {
    for (const term of extractTermsFromTrendTitle(title)) {
      rawTerms.push(term);
      if (isFashionTerm(term)) filteredTerms.push(term);
    }
  }

  const uniqueRaw = [...new Set(rawTerms.map((t) => t.trim()))].filter(Boolean);
  const uniqueFiltered = [...new Set(filteredTerms.map((t) => t.trim()))].filter(shouldUseTrendTerm);
  return { rawTerms: uniqueRaw, filteredTerms: uniqueFiltered };
}

function hasRedditCredentials() {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

function calculateHeatScoreFromFreeSignals({
  previousHeat,
  ebaySampleCount,
  previousPrice,
  currentPrice,
  googleTrendBoost,
  redditMentions
}) {
  const prevHeat = safeNumber(previousHeat, 50);
  const prev = safeNumber(previousPrice, 0);
  const curr = safeNumber(currentPrice, prev);
  const sampleScore = Math.min(40, safeNumber(ebaySampleCount, 0) * 2);

  let priceDeltaScore = 0;
  if (prev > 0 && curr > 0) {
    const deltaPct = ((curr - prev) / prev) * 100;
    priceDeltaScore = Math.max(-12, Math.min(20, Math.round(deltaPct / 2)));
  }

  const redditScore = redditMentions > 0 ? Math.min(25, redditMentions) : 0;
  const trendBoostScore = googleTrendBoost ? 15 : 0;

  if (sampleScore === 0 && !googleTrendBoost && redditScore === 0) {
    return prevHeat;
  }

  const blended = 35 + sampleScore + priceDeltaScore + trendBoostScore + redditScore;
  return Math.max(20, Math.min(99, blended));
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

function mergeDiscoveredTerms(activeQueryPacks, googleTrendsTerms) {
  const merged = [...activeQueryPacks, ...googleTrendsTerms]
    .map((v) => normalizeTrendTerm(String(v || '').trim()))
    .filter(shouldUseTrendTerm);

  const deduped = [];
  const seen = new Set();
  for (const term of merged) {
    const key = getDedupeKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(term);
  }

  return applyDiversityCaps(deduped, Number(process.env.TERM_BUCKET_CAP || 6));
}

async function seedSignalsFromSources(existingSignals, discoveredTerms) {
  const existingNames = new Set(
    (existingSignals || []).map((s) => String(s.trend_name || '').trim().toLowerCase())
  );
  const newTerms = discoveredTerms.filter((term) => !existingNames.has(term.toLowerCase()));

  if (!newTerms.length) return 0;

  let created = 0;
  for (const term of newTerms) {
    try {
      const { avgPrice, sampleCount } = await fetchEbayStats(term, 60);
      if (sampleCount < 3) {
        console.log(`⏭️ Skipping low-signal discovery: ${term} (eBay sample ${sampleCount})`);
        continue;
      }
      const heatScore = calculateHeatScoreFromFreeSignals({
        previousHeat: 50,
        ebaySampleCount: sampleCount,
        previousPrice: 60,
        currentPrice: avgPrice,
        googleTrendBoost: true,
        redditMentions: 0
      });

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
        console.log(`🆕 Discovered trend: ${term} | Heat: ${heatScore} | $${avgPrice} | Sample: ${sampleCount}`);
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
  const googleJobId = await startCollectorJob('google_trends');
  const corpusJobId = await startCollectorJob('fashion_corpus_ai');
  const ebayDiscoveryJobId = await startCollectorJob('ebay_discovery');
  const ebayJobId = await startCollectorJob('ebay');
  const redditJobId = await startCollectorJob('reddit');
  let ebayFailures = 0;
  let ebayNoSampleCount = 0;
  let googleFailures = 0;
  let corpusFailures = 0;
  let ebayDiscoveryFailures = 0;
  let redditFailures = 0;
  const redditFailureDetails = [];

  try {
    let googleTrendsTerms = [];
    let corpusAiTerms = [];
    let ebayDiscoveryTerms = [];
    try {
      const { rawTerms, filteredTerms } = await fetchGoogleTrendsTerms();
      let aiTerms = null;
      try {
        aiTerms = await classifyFashionTermsWithAI(rawTerms);
      } catch (err) {
        console.warn('AI classifier unavailable, falling back to keyword filter:', err.message);
      }

      // If AI returns nothing, fallback to keyword-filtered terms only.
      googleTrendsTerms =
        (aiTerms && aiTerms.length > 0)
          ? aiTerms
          : filteredTerms;

      await finishCollectorJob(
        googleJobId,
        'success',
        `Captured ${googleTrendsTerms.length} Google Trends terms for trend discovery.`
      );
    } catch (err) {
      googleFailures += 1;
      await finishCollectorJob(googleJobId, 'degraded', err.message);
      console.error('❌ Google Trends fetch failed:', err.message);
    }

    try {
      const { data: currentSignalsData } = await supabase
        .from('market_signals')
        .select('trend_name')
        .order('updated_at', { ascending: false })
        .limit(300);

      const signalTerms = (currentSignalsData || [])
        .map((r) => String(r.trend_name || '').trim())
        .filter(Boolean);

      const corpusHeadlines = await fetchFashionCorpusHeadlines();
      corpusAiTerms = await generateFashionCandidatesFromCorpusAI(
        corpusHeadlines,
        signalTerms
      );

      await finishCollectorJob(
        corpusJobId,
        'success',
        `Captured ${corpusHeadlines.length} headlines and generated ${corpusAiTerms.length} AI candidates.`
      );
    } catch (err) {
      corpusFailures += 1;
      await finishCollectorJob(corpusJobId, 'degraded', err.message);
      console.error('❌ Fashion corpus AI generation failed:', err.message);
    }

    const activeQueryPacks = await getActiveQueryPacks();
    try {
      const { data: seedSignalRows } = await supabase
        .from('market_signals')
        .select('trend_name')
        .order('heat_score', { ascending: false })
        .limit(60);
      const seedSignalTerms = (seedSignalRows || []).map((r) => String(r.trend_name || '').trim()).filter(Boolean);
      const discoverySeeds = [...activeQueryPacks, ...seedSignalTerms];
      ebayDiscoveryTerms = await fetchEbayDiscoveryTerms(discoverySeeds);
      await finishCollectorJob(
        ebayDiscoveryJobId,
        'success',
        `Generated ${ebayDiscoveryTerms.length} eBay-derived candidate terms.`
      );
    } catch (err) {
      ebayDiscoveryFailures += 1;
      await finishCollectorJob(ebayDiscoveryJobId, 'degraded', err.message);
      console.error('❌ eBay discovery generation failed:', err.message);
    }

    const discoveredTerms = mergeDiscoveredTerms(
      activeQueryPacks,
      [...googleTrendsTerms, ...corpusAiTerms, ...ebayDiscoveryTerms]
    );

    // 1. Pull existing signals from database
    const { data: initialSignals, error: sigError } = await supabase.from('market_signals').select('*');
    
    if (sigError) throw sigError;
    const discoveredCount = await seedSignalsFromSources(initialSignals || [], discoveredTerms);
    if (discoveredCount > 0) {
      console.log(`✅ Added ${discoveredCount} discovered trend(s) from free sources.`);
    }

    // Refresh signal list after discovery.
    const { data: signals, error: refetchError } = await supabase.from('market_signals').select('*');
    if (refetchError) throw refetchError;
    if (!signals || signals.length === 0) {
      console.log("⚠️ No signals found in database to sync.");
      await finishCollectorJob(redditJobId, 'skipped_no_signals', 'No signals found to sync.');
      await finishCollectorJob(ebayJobId, 'failed', 'No signals found to sync.');
      return;
    }

    const redditEnabled = hasRedditCredentials();
    if (!redditEnabled) {
      await finishCollectorJob(
        redditJobId,
        'skipped_no_api',
        'Reddit credentials not configured; using Google Trends + eBay only.'
      );
    }

    const googleSet = new Set(googleTrendsTerms.map((t) => t.toLowerCase()));

    for (const signal of signals) {
      console.log(`🔍 Syncing: ${signal.trend_name}`);

      let avgPrice = safeNumber(signal.exit_price, 0);
      let sampleCount = 0;
      let mentionCount = 0;
      const googleTrendBoost = googleSet.has(String(signal.trend_name || '').toLowerCase());

      try {
        const ebayStats = await fetchEbayStats(signal.trend_name, signal.exit_price);
        avgPrice = ebayStats.avgPrice;
        sampleCount = ebayStats.sampleCount;
        if (sampleCount === 0) ebayNoSampleCount += 1;
      } catch (err) {
        ebayFailures += 1;
        console.error(`❌ eBay fetch failed for ${signal.trend_name}:`, err.message);
      }

      if (redditEnabled) {
        try {
          mentionCount = await fetchRedditMentionCount(signal.trend_name);
        } catch (err) {
          redditFailures += 1;
          if (redditFailureDetails.length < 5) {
            redditFailureDetails.push(`${signal.trend_name}: ${err.message}`);
          }
          console.error(`❌ Reddit fetch failed for ${signal.trend_name}:`, err.message);
        }
      }

      const newHeat = calculateHeatScoreFromFreeSignals({
        previousHeat: signal.heat_score,
        ebaySampleCount: sampleCount,
        previousPrice: signal.exit_price,
        currentPrice: avgPrice,
        googleTrendBoost,
        redditMentions: mentionCount
      });

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
      else {
        console.log(
          `✅ ${signal.trend_name} updated: $${avgPrice} | Heat: ${newHeat} | eBay Sample: ${sampleCount} | GoogleBoost: ${googleTrendBoost ? 'yes' : 'no'} | RedditMentions: ${mentionCount}`
        );
      }
    }

    await finishCollectorJob(
      ebayJobId,
      ebayFailures > 0 || ebayNoSampleCount === signals.length ? 'degraded' : 'success',
      ebayFailures > 0
        ? `${ebayFailures} item(s) failed eBay fetch.`
        : ebayNoSampleCount === signals.length
          ? `No eBay sold-price samples detected for all ${signals.length} signals.`
          : null
    );
    if (redditEnabled) {
      await finishCollectorJob(
        redditJobId,
        redditFailures > 0 ? 'degraded' : 'success',
        redditFailures > 0
          ? `${redditFailures} item(s) failed Reddit fetch. ${redditFailureDetails.join(' | ')}`
          : null
      );
    }

    console.log("🏁 Sync process finished successfully.");

  } catch (err) {
    if (googleFailures > 0) {
      await finishCollectorJob(googleJobId, 'degraded', err.message);
    } else {
      await finishCollectorJob(googleJobId, 'failed', err.message);
    }
    if (corpusFailures > 0) {
      await finishCollectorJob(corpusJobId, 'degraded', err.message);
    } else {
      await finishCollectorJob(corpusJobId, 'failed', err.message);
    }
    if (ebayDiscoveryFailures > 0) {
      await finishCollectorJob(ebayDiscoveryJobId, 'degraded', err.message);
    } else {
      await finishCollectorJob(ebayDiscoveryJobId, 'failed', err.message);
    }
    await finishCollectorJob(redditJobId, 'failed', err.message);
    await finishCollectorJob(ebayJobId, 'failed', err.message);
    console.error("❌ Critical Sync Error:", err.message);
  }
}

syncMarketPulse();
