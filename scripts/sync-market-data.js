const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const feedConfig = require('./config/fashion-rss-feeds.json');

// INITIALIZE SUPABASE
// Using the exact names from your GitHub Secrets
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
const EXTRA_PUBLICATION_FEEDS = Array.isArray(feedConfig?.publication_feeds) ? feedConfig.publication_feeds : [];
const FASHION_RSS_FEEDS = [...new Set([...FASHION_CORPUS_SOURCES, ...EXTRA_PUBLICATION_FEEDS])];
const GOOGLE_NEWS_QUERY_TERMS = Array.isArray(feedConfig?.google_news_queries) ? feedConfig.google_news_queries : [];

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
      sampleCount: 0,
      priceLow: 0,
      priceHigh: 0,
      priceMedian: safeNumber(fallbackPrice, 0)
    };
  }

  prices.sort((a, b) => a - b);
  const at = (ratio) => {
    const idx = Math.max(0, Math.min(prices.length - 1, Math.floor((prices.length - 1) * ratio)));
    return prices[idx];
  };
  const priceLow = at(0.25);
  const priceMedian = at(0.5);
  const priceHigh = at(0.75);

  return {
    avgPrice: Math.floor(prices.reduce((a, b) => a + b, 0) / prices.length),
    sampleCount: prices.length,
    priceLow: Math.floor(priceLow),
    priceHigh: Math.floor(priceHigh),
    priceMedian: Math.floor(priceMedian)
  };
}

async function writeCompCheck({
  signalId,
  trendName,
  sampleSize,
  priceLow,
  priceHigh,
  notes,
}) {
  try {
    const { error } = await supabase.from('comp_checks').insert([{
      signal_id: signalId || null,
      trend_name: trendName || null,
      sample_size: safeNumber(sampleSize, 0),
      checked_at: new Date().toISOString(),
      price_low: safeNumber(priceLow, 0),
      price_high: safeNumber(priceHigh, 0),
      notes: notes || null,
    }]);
    if (error) {
      console.warn(`comp_checks insert failed (${trendName}):`, error.message);
    }
  } catch (err) {
    console.warn(`comp_checks insert threw (${trendName}):`, err.message);
  }
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

function stripFeedTitleSource(text) {
  return compactWhitespace(String(text || '').replace(/\s+[-|]\s+[^-|]{2,40}$/, ''));
}

function toGoogleNewsRssUrl(query) {
  const q = compactWhitespace(query);
  if (!q) return '';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchRssHeadlinesFromUrls(urls, {
  maxPerFeed = 25,
  maxTotal = 1200,
  timeoutMs = 14000,
} = {}) {
  const feedUrls = [...new Set((urls || []).map((u) => compactWhitespace(u)).filter(Boolean))];
  const headlines = [];
  let successFeeds = 0;
  let failedFeeds = 0;

  for (const url of feedUrls) {
    if (headlines.length >= maxTotal) break;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'thriftpulse-sync/1.0',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);
      const body = await res.text();
      if (!res.ok) {
        failedFeeds += 1;
        continue;
      }

      const matches = [...body.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/gi)];
      if (matches.length > 0) {
        const feedTitles = matches
          .map((m) => stripFeedTitleSource(decodeXmlEntities(m[1])))
          .filter(Boolean)
          .slice(0, maxPerFeed);
        if (feedTitles.length > 0) successFeeds += 1;
        headlines.push(...feedTitles);
        continue;
      }

      const atomMatches = [...body.matchAll(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/entry>/gi)];
      const atomTitles = atomMatches
        .map((m) => stripFeedTitleSource(decodeXmlEntities(m[1])))
        .filter(Boolean)
        .slice(0, maxPerFeed);
      if (atomTitles.length > 0) successFeeds += 1;
      else failedFeeds += 1;
      headlines.push(...atomTitles);
    } catch (_err) {
      failedFeeds += 1;
    }
  }

  return {
    headlines: [...new Set(headlines)].slice(0, maxTotal),
    feedCount: feedUrls.length,
    successFeeds,
    failedFeeds,
  };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const withoutFences = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return withoutFences.slice(start, end + 1);
}

function parseOpenAIJsonResponse(bodyText) {
  const parsed = JSON.parse(bodyText || '{}');
  const content = parsed?.choices?.[0]?.message?.content || '';
  const jsonBlock = extractJsonObject(content);
  if (!jsonBlock) return {};
  return JSON.parse(jsonBlock);
}

async function callOpenAIJsonCompletion({ systemPrompt, userPrompt, temperature = 0, retries = 2 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('openai_key_missing');

  const model = process.env.TREND_CLASSIFIER_MODEL || 'gpt-4o-mini';
  let lastError = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      const bodyText = await res.text();
      if (!res.ok) {
        const snippet = bodyText.slice(0, 160).replace(/\s+/g, ' ');
        throw new Error(`status=${res.status} body="${snippet}"`);
      }

      return parseOpenAIJsonResponse(bodyText);
    } catch (err) {
      lastError = err;
      if (attempt > retries) break;
    }
  }

  throw lastError || new Error('openai_json_call_failed');
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

function isSpecificFashionTerm(term) {
  const t = String(term || '').toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  const apparelNouns = [
    'jacket', 'coat', 'hoodie', 'sweatshirt', 'sweater', 'cardigan', 'tee',
    't-shirt', 'shirt', 'pants', 'jeans', 'trousers', 'skirt', 'dress',
    'boots', 'sneakers', 'loafer', 'bag', 'vest', 'parka', 'anorak'
  ];
  const hasApparelNoun = apparelNouns.some((n) => t.includes(n));
  if (!hasApparelNoun) return false;

  const brandSignals = [
    'carhartt', 'arc', 'arcteryx', 'nike', 'adidas', 'salomon', 'new balance',
    'patagonia', 'north face', 'stussy', 'supreme', 'levis', 'levi'
  ];
  const materialSignals = [
    'gore-tex', 'leather', 'suede', 'wool', 'cashmere', 'mohair', 'denim',
    'selvedge', 'ripstop', 'fleece', 'corduroy', 'nylon', 'canvas'
  ];
  const styleSignals = [
    'double knee', 'carpenter', 'workwear', 'utility', 'vintage', '90s', 'y2k',
    'cargo', 'distressed', 'wide-leg', 'high-waisted', 'graphic', 'oversized',
    'boxy', 'tabi', 'chelsea'
  ];

  let specificity = 0;
  if (brandSignals.some((s) => t.includes(s))) specificity += 2;
  if (materialSignals.some((s) => t.includes(s))) specificity += 2;
  if (styleSignals.some((s) => t.includes(s))) specificity += 1;
  if (words.length >= 3) specificity += 1;
  if (/\d/.test(t) || /-/.test(t)) specificity += 1;

  if (words.length >= 2 && specificity >= 1) return true;
  return specificity >= 2;
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
  if (!isFashionTerm(cleaned)) return false;
  return isSpecificFashionTerm(cleaned);
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

function inferBrandFromTerm(term) {
  const t = String(term || '').toLowerCase();
  const brandMatchers = [
    { label: "Arc'teryx", patterns: [/\barc['’]?teryx\b/, /\barcteryx\b/] },
    { label: 'Carhartt', patterns: [/\bcarhartt\b/] },
    { label: 'Salomon', patterns: [/\bsalomon\b/] },
    { label: 'Nike', patterns: [/\bnike\b/] },
    { label: 'Adidas', patterns: [/\badidas\b/] },
    { label: 'New Balance', patterns: [/\bnew\s+balance\b/] },
    { label: 'Patagonia', patterns: [/\bpatagonia\b/] },
    { label: 'The North Face', patterns: [/\bnorth\s+face\b/] },
    { label: "Levi's", patterns: [/\blevi['’]?s?\b/] },
    { label: 'Stussy', patterns: [/\bstussy\b/] },
    { label: 'Supreme', patterns: [/\bsupreme\b/] }
  ];

  for (const matcher of brandMatchers) {
    if (matcher.patterns.some((pattern) => pattern.test(t))) return matcher.label;
  }
  return null;
}

function inferTrack(term, brandName) {
  if (brandName) return 'Brand';
  const t = String(term || '').toLowerCase();
  const styleHints = [
    'vintage', 'y2k', '90s', 'workwear', 'utility', 'double knee',
    'wide-leg', 'high-waisted', 'graphic', 'oversized', 'cargo', 'distressed'
  ];
  if (styleHints.some((hint) => t.includes(hint))) return 'Style Category';
  return 'Style Category';
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
  const seeds = [...new Set((seedTerms || []).map((s) => compactWhitespace(String(s))).filter(Boolean))].slice(0, 28);
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
  const kept = applyDiversityCaps(
    deduped,
    Number(process.env.EBAY_DISCOVERY_BUCKET_CAP || 8)
  ).slice(0, Number(process.env.MAX_EBAY_DISCOVERY_TERMS || 250));

  console.log(
    `📊 eBay discovery stats: seeds=${seeds.length} raw=${discovered.length} deduped=${deduped.length} kept=${kept.length}`
  );

  return kept;
}

async function classifyFashionTermsWithAI(rawTerms) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !Array.isArray(rawTerms) || rawTerms.length === 0) return null;

  const inputTerms = rawTerms.slice(0, 40);
  const systemPrompt =
    'You are a fashion resale trend classifier. Return only strict JSON with keys: selected_terms (string[]), dropped_terms (string[]). Select terms relevant to clothing, footwear, accessories, styling, thrifting, vintage, or resale fashion.';
  const userPrompt = `Classify these Google trend terms for fashion relevance:\n${JSON.stringify(inputTerms)}`;

  let payload = null;
  try {
    payload = await callOpenAIJsonCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0,
      retries: 2
    });
  } catch (err) {
    throw new Error(`ai_classify_failed ${err.message}`);
  }

  const selected = Array.isArray(payload?.selected_terms)
    ? payload.selected_terms.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  return [...new Set(selected)].filter(shouldUseTrendTerm);
}

async function fetchFashionCorpusHeadlines() {
  const { headlines } = await fetchRssHeadlinesFromUrls(FASHION_CORPUS_SOURCES, {
    maxPerFeed: 28,
    maxTotal: 350,
  });
  return headlines.filter((h) => h.length >= 8 && h.length <= 120).slice(0, 220);
}

async function fetchFashionRssTerms() {
  const { headlines, feedCount, successFeeds, failedFeeds } = await fetchRssHeadlinesFromUrls(FASHION_RSS_FEEDS, {
    maxPerFeed: Number(process.env.MAX_FASHION_RSS_ITEMS_PER_FEED || 20),
    maxTotal: Number(process.env.MAX_FASHION_RSS_HEADLINES || 1400),
  });
  const rawTerms = [];
  const filteredTerms = [];
  for (const title of headlines) {
    for (const term of extractTermsFromTrendTitle(title)) {
      rawTerms.push(term);
      if (isFashionTerm(term)) filteredTerms.push(term);
    }
  }

  const uniqueRaw = [...new Set(rawTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const keywordFiltered = [...new Set(filteredTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const strict = applyDiversityCaps(
    keywordFiltered.filter(shouldUseTrendTerm).map(normalizeTrendTerm),
    Number(process.env.FASHION_RSS_BUCKET_CAP || 12)
  ).slice(0, Number(process.env.MAX_FASHION_RSS_TERMS || 320));

  return {
    rawTerms: uniqueRaw,
    filteredTerms: strict,
    feedCount,
    successFeeds,
    failedFeeds,
    headlineCount: headlines.length,
  };
}

async function fetchGoogleNewsRssTerms() {
  const queryLimit = Math.max(1, Number(process.env.GOOGLE_NEWS_QUERY_LIMIT || 120));
  const urls = GOOGLE_NEWS_QUERY_TERMS.slice(0, queryLimit).map(toGoogleNewsRssUrl).filter(Boolean);
  const { headlines, feedCount, successFeeds, failedFeeds } = await fetchRssHeadlinesFromUrls(urls, {
    maxPerFeed: Number(process.env.MAX_GOOGLE_NEWS_ITEMS_PER_FEED || 12),
    maxTotal: Number(process.env.MAX_GOOGLE_NEWS_HEADLINES || 1600),
  });

  const rawTerms = [];
  const filteredTerms = [];
  for (const title of headlines) {
    for (const term of extractTermsFromTrendTitle(title)) {
      rawTerms.push(term);
      if (isFashionTerm(term)) filteredTerms.push(term);
    }
  }

  const uniqueRaw = [...new Set(rawTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const keywordFiltered = [...new Set(filteredTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const strict = applyDiversityCaps(
    keywordFiltered.filter(shouldUseTrendTerm).map(normalizeTrendTerm),
    Number(process.env.GOOGLE_NEWS_BUCKET_CAP || 14)
  ).slice(0, Number(process.env.MAX_GOOGLE_NEWS_TERMS || 380));

  return {
    rawTerms: uniqueRaw,
    filteredTerms: strict,
    feedCount,
    successFeeds,
    failedFeeds,
    headlineCount: headlines.length,
  };
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

  let payload = null;
  try {
    payload = await callOpenAIJsonCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      retries: 2
    });
  } catch (err) {
    throw new Error(`ai_candidate_gen_failed ${err.message}`);
  }

  const rawCandidates = Array.isArray(payload?.candidates)
    ? payload.candidates.map((t) => compactWhitespace(t)).filter(Boolean)
    : [];

  const candidates = [...new Set(rawCandidates)].filter(shouldUseTrendTerm);
  const minAccepted = Math.max(8, Number(process.env.MIN_AI_ACCEPTED_CANDIDATES || 12));
  const minAcceptanceRate = Math.max(0.08, Math.min(1, Number(process.env.MIN_AI_ACCEPTANCE_RATE || 0.1)));
  const acceptanceRate = rawCandidates.length ? candidates.length / rawCandidates.length : 0;

  console.log(
    `📊 Corpus AI filter stats: raw=${rawCandidates.length} strictFiltered=${candidates.length} acceptance=${acceptanceRate.toFixed(2)}`
  );

  if (candidates.length < minAccepted || acceptanceRate < minAcceptanceRate) {
    throw new Error(
      `ai_candidate_gen_quality_failed accepted=${candidates.length} raw=${rawCandidates.length} rate=${acceptanceRate.toFixed(2)}`
    );
  }

  return candidates.slice(0, maxCandidates);
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
  const keywordFiltered = [...new Set(filteredTerms.map((t) => t.trim()))];
  const uniqueFiltered = keywordFiltered.filter(shouldUseTrendTerm);
  console.log(
    `📊 Google Trends filter stats: raw=${uniqueRaw.length} keywordFiltered=${keywordFiltered.length} strictFiltered=${uniqueFiltered.length}`
  );
  return { rawTerms: uniqueRaw, filteredTerms: uniqueFiltered };
}

function calculateHeatScoreFromFreeSignals({
  previousHeat,
  ebaySampleCount,
  previousPrice,
  currentPrice,
  googleTrendBoost
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

  const trendBoostScore = googleTrendBoost ? 15 : 0;

  if (sampleScore === 0 && !googleTrendBoost) {
    return prevHeat;
  }

  const blended = 35 + sampleScore + priceDeltaScore + trendBoostScore;
  return Math.max(20, Math.min(99, blended));
}

function calculateMentionCount({
  ebaySampleCount,
  fashionRssHit,
  googleNewsHit,
  googleTrendHit,
  corpusHit,
  discoveryHit,
  compSampleSize = 0
}) {
  const ebay = safeNumber(ebaySampleCount, 0);
  const fashionRss = fashionRssHit ? 9 : 0;
  const googleNews = googleNewsHit ? 9 : 0;
  const google = googleTrendHit ? 10 : 0;
  const corpus = corpusHit ? 7 : 0;
  const discovery = discoveryHit ? 5 : 0;
  const comp = Math.min(20, safeNumber(compSampleSize, 0) * 2);
  return Math.max(0, Math.round(ebay + fashionRss + googleNews + google + corpus + discovery + comp));
}

function calculateSignalScore({
  heatScore,
  ebaySampleCount,
  sourceSignalCount
}) {
  const heat = safeNumber(heatScore, 50);
  const ebay = safeNumber(ebaySampleCount, 0);
  const sourceCount = safeNumber(sourceSignalCount, 0);
  const score = 18 + Math.round(heat * 0.42) + Math.min(28, ebay) + sourceCount * 9;
  return Math.max(10, Math.min(99, score));
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

  const kept = applyDiversityCaps(deduped, Number(process.env.TERM_BUCKET_CAP || 10));
  console.log(
    `📊 Merge stats: activePacks=${activeQueryPacks.length} input=${googleTrendsTerms.length} deduped=${deduped.length} kept=${kept.length}`
  );
  return kept;
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
            track: inferTrack(term, inferBrandFromTerm(term)),
            hook_brand: inferBrandFromTerm(term),
            market_sentiment: 'AI + eBay validated trend candidate.',
            ebay_sample_count: sampleCount,
            google_trend_hits: 1,
            ai_corpus_hits: 0,
            ebay_discovery_hits: 0,
            source_signal_count: 2,
            mention_count: calculateMentionCount({
              ebaySampleCount: sampleCount,
              fashionRssHit: false,
              googleNewsHit: false,
              googleTrendHit: true,
              corpusHit: false,
              discoveryHit: false,
            }),
            confidence_score: calculateSignalScore({
              heatScore,
              ebaySampleCount: sampleCount,
              sourceSignalCount: 2,
            }),
            heat_score: heatScore,
            exit_price: Math.max(10, avgPrice),
            updated_at: new Date().toISOString()
          }],
          { onConflict: 'trend_name' }
        );

      if (!error) {
        await writeCompCheck({
          signalId: null,
          trendName: term,
          sampleSize: sampleCount,
          priceLow: Math.max(1, Math.floor(avgPrice * 0.85)),
          priceHigh: Math.max(1, Math.floor(avgPrice * 1.15)),
          notes: 'Discovery-mode sold comps snapshot.',
        });
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
  const fashionRssJobId = await startCollectorJob('fashion_rss');
  const googleNewsJobId = await startCollectorJob('google_news_rss');
  const googleJobId = await startCollectorJob('google_trends');
  const corpusJobId = await startCollectorJob('fashion_corpus_ai');
  const ebayDiscoveryJobId = await startCollectorJob('ebay_discovery');
  const ebayJobId = await startCollectorJob('ebay');
  let fashionRssFailures = 0;
  let googleNewsFailures = 0;
  let ebayFailures = 0;
  let ebayNoSampleCount = 0;
  let googleFailures = 0;
  let corpusFailures = 0;
  let ebayDiscoveryFailures = 0;

  try {
    let fashionRssTerms = [];
    let googleNewsTerms = [];
    let googleTrendsTerms = [];
    let corpusAiTerms = [];
    let ebayDiscoveryTerms = [];
    try {
      const rss = await fetchFashionRssTerms();
      let aiTerms = null;
      try {
        aiTerms = await classifyFashionTermsWithAI(rss.rawTerms);
      } catch (err) {
        console.warn('Fashion RSS AI classifier unavailable, falling back to strict keyword filter:', err.message);
      }
      fashionRssTerms = (aiTerms && aiTerms.length > 0) ? aiTerms : rss.filteredTerms;
      await finishCollectorJob(
        fashionRssJobId,
        'success',
        `Scanned ${rss.feedCount} fashion RSS feeds (${rss.successFeeds} ok, ${rss.failedFeeds} failed) and captured ${fashionRssTerms.length} terms from ${rss.headlineCount} headlines.`
      );
    } catch (err) {
      fashionRssFailures += 1;
      await finishCollectorJob(fashionRssJobId, 'degraded', err.message);
      console.error('❌ Fashion RSS fetch failed:', err.message);
    }

    try {
      const news = await fetchGoogleNewsRssTerms();
      let aiTerms = null;
      try {
        aiTerms = await classifyFashionTermsWithAI(news.rawTerms);
      } catch (err) {
        console.warn('Google News RSS AI classifier unavailable, falling back to strict keyword filter:', err.message);
      }
      googleNewsTerms = (aiTerms && aiTerms.length > 0) ? aiTerms : news.filteredTerms;
      await finishCollectorJob(
        googleNewsJobId,
        'success',
        `Scanned ${news.feedCount} Google News fashion RSS queries (${news.successFeeds} ok, ${news.failedFeeds} failed) and captured ${googleNewsTerms.length} terms from ${news.headlineCount} headlines.`
      );
    } catch (err) {
      googleNewsFailures += 1;
      await finishCollectorJob(googleNewsJobId, 'degraded', err.message);
      console.error('❌ Google News RSS fetch failed:', err.message);
    }

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
      [...fashionRssTerms, ...googleNewsTerms, ...googleTrendsTerms, ...corpusAiTerms, ...ebayDiscoveryTerms]
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
      await finishCollectorJob(ebayJobId, 'failed', 'No signals found to sync.');
      return;
    }

    const fashionRssSet = new Set(fashionRssTerms.map((t) => t.toLowerCase()));
    const googleNewsSet = new Set(googleNewsTerms.map((t) => t.toLowerCase()));
    const googleSet = new Set(googleTrendsTerms.map((t) => t.toLowerCase()));
    const corpusSet = new Set(corpusAiTerms.map((t) => String(t || '').toLowerCase()));
    const discoverySet = new Set(ebayDiscoveryTerms.map((t) => String(t || '').toLowerCase()));

    for (const signal of signals) {
      console.log(`🔍 Syncing: ${signal.trend_name}`);

      let avgPrice = safeNumber(signal.exit_price, 0);
      let sampleCount = 0;
      let priceLow = 0;
      let priceHigh = 0;
      const googleTrendBoost = googleSet.has(String(signal.trend_name || '').toLowerCase());

      try {
        const ebayStats = await fetchEbayStats(signal.trend_name, signal.exit_price);
        avgPrice = ebayStats.avgPrice;
        sampleCount = ebayStats.sampleCount;
        priceLow = ebayStats.priceLow || 0;
        priceHigh = ebayStats.priceHigh || 0;
        if (sampleCount === 0) ebayNoSampleCount += 1;
      } catch (err) {
        ebayFailures += 1;
        console.error(`❌ eBay fetch failed for ${signal.trend_name}:`, err.message);
      }

      const newHeat = calculateHeatScoreFromFreeSignals({
        previousHeat: signal.heat_score,
        ebaySampleCount: sampleCount,
        previousPrice: signal.exit_price,
        currentPrice: avgPrice,
        googleTrendBoost
      });

      const signalKey = String(signal.trend_name || '').toLowerCase().trim();
      const fashionRssHit = fashionRssSet.has(signalKey);
      const googleNewsHit = googleNewsSet.has(signalKey);
      const googleTrendHit = googleSet.has(signalKey);
      const corpusHit = corpusSet.has(signalKey);
      const discoveryHit = discoverySet.has(signalKey);
      const sourceSignalCount =
        (sampleCount > 0 ? 1 : 0) +
        (fashionRssHit ? 1 : 0) +
        (googleNewsHit ? 1 : 0) +
        (googleTrendHit ? 1 : 0) +
        (corpusHit ? 1 : 0) +
        (discoveryHit ? 1 : 0);
      const mentionCount = calculateMentionCount({
        ebaySampleCount: sampleCount,
        fashionRssHit,
        googleNewsHit,
        googleTrendHit,
        corpusHit,
        discoveryHit,
      });
      const confidenceScore = calculateSignalScore({
        heatScore: newHeat,
        ebaySampleCount: sampleCount,
        sourceSignalCount,
      });

      // 2. UPDATE SUPABASE
      const { error: upError } = await supabase
        .from('market_signals')
        .update({ 
          track: inferTrack(signal.trend_name, inferBrandFromTerm(signal.trend_name)),
          hook_brand: signal.hook_brand || inferBrandFromTerm(signal.trend_name),
          ebay_sample_count: sampleCount,
          google_trend_hits: googleTrendHit ? 1 : 0,
          ai_corpus_hits: corpusHit ? 1 : 0,
          ebay_discovery_hits: discoveryHit ? 1 : 0,
          source_signal_count: sourceSignalCount,
          mention_count: mentionCount,
          confidence_score: confidenceScore,
          exit_price: avgPrice, 
          heat_score: newHeat,
          updated_at: new Date() 
        })
        .eq('id', signal.id);

      if (upError) console.error(`❌ Update failed for ${signal.trend_name}:`, upError.message);
      else {
        if (sampleCount > 0) {
          await writeCompCheck({
            signalId: signal.id,
            trendName: signal.trend_name,
            sampleSize: sampleCount,
            priceLow,
            priceHigh,
            notes: `eBay sold comps snapshot (${sampleCount} samples).`,
          });
        }
        console.log(
          `✅ ${signal.trend_name} updated: $${avgPrice} | Heat: ${newHeat} | Mentions: ${mentionCount} | SignalScore: ${confidenceScore}`
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
    console.log("🏁 Sync process finished successfully.");

  } catch (err) {
    if (fashionRssFailures > 0) {
      await finishCollectorJob(fashionRssJobId, 'degraded', err.message);
    } else {
      await finishCollectorJob(fashionRssJobId, 'failed', err.message);
    }
    if (googleNewsFailures > 0) {
      await finishCollectorJob(googleNewsJobId, 'degraded', err.message);
    } else {
      await finishCollectorJob(googleNewsJobId, 'failed', err.message);
    }
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
    await finishCollectorJob(ebayJobId, 'failed', err.message);
    console.error("❌ Critical Sync Error:", err.message);
  }
}

syncMarketPulse();
