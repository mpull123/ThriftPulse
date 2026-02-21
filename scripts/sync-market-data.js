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
const STYLE_PRODUCT_NOUNS = [
  'jacket', 'coat', 'hoodie', 'sweatshirt', 'sweater', 'cardigan', 'tee',
  't-shirt', 'shirt', 'pants', 'jeans', 'trousers', 'skirt', 'dress',
  'boot', 'boots', 'sneaker', 'sneakers', 'loafer', 'loafers', 'bag', 'bags',
  'vest', 'parka', 'anorak'
];
const BRAND_LEXICON = [
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
  { label: 'Supreme', patterns: [/\bsupreme\b/] },
  { label: 'Missguided', patterns: [/\bmissguided\b/] },
  { label: 'Forever 21', patterns: [/\bforever\s*21\b/] },
  { label: 'ASOS', patterns: [/\basos\b/] },
  { label: 'Mango', patterns: [/\bmango\b/] },
  { label: 'Reformation', patterns: [/\breformation\b/] },
  { label: 'Urban Outfitters', patterns: [/\burban\s+outfitters\b/] },
  { label: 'PacSun', patterns: [/\bpacsun\b/] },
  { label: 'Old Navy', patterns: [/\bold\s+navy\b/] },
  { label: 'Banana Republic', patterns: [/\bbanana\s+republic\b/] },
  { label: 'Dr. Martens', patterns: [/\bdr\.?\s*martens\b/, /\bdoc\s+martens\b/] },
  { label: 'Timberland', patterns: [/\btimberland\b/] },
  { label: 'Vans', patterns: [/\bvans\b/] },
  { label: 'Puma', patterns: [/\bpuma\b/] },
  { label: 'Sorel', patterns: [/\bsorel\b/] },
  { label: 'Goyard', patterns: [/\bgoyard\b/] },
  { label: "Béis", patterns: [/\bb[ée]is\b/] },
  { label: 'Gucci', patterns: [/\bgucci\b/] },
  { label: 'Prada', patterns: [/\bprada\b/] },
  { label: 'Bottega Veneta', patterns: [/\bbottega\b/, /\bbottega\s+veneta\b/] }
];
const GENERIC_STYLE_ONLY_TERMS = new Set([
  'cargo pants',
  'wide-leg pants',
  'leather jacket',
  'denim jeans',
  'denim skirt',
  'wool coat',
  'suede jacket',
  'ankle boots',
  'combat boots',
  'chelsea boots',
  'platform sneakers',
  'track pants',
  'graphic hoodies',
  'vintage t-shirt',
  'vintage tee'
]);

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

let rejectionLogTableMissing = false;
async function writeTrendRejectionLogs(rows) {
  const payload = (rows || [])
    .map((row) => ({
      collector_source: String(row?.collector_source || '').trim().toLowerCase(),
      raw_title: row?.raw_title ? String(row.raw_title).slice(0, 400) : null,
      candidate_term: row?.candidate_term ? String(row.candidate_term).slice(0, 120) : null,
      rejection_reason: String(row?.rejection_reason || 'unknown').slice(0, 80),
      metadata: row?.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    }))
    .filter((row) => row.collector_source && row.candidate_term);

  if (!payload.length || rejectionLogTableMissing) return 0;
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    try {
      const { error } = await supabase.from('trend_rejection_log').insert(chunk);
      if (error) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('relation') || msg.includes('does not exist')) {
          rejectionLogTableMissing = true;
          console.warn('trend_rejection_log table missing. Run setup SQL to enable rejection logging.');
          return inserted;
        }
        console.warn('trend_rejection_log insert failed:', error.message);
        return inserted;
      }
      inserted += chunk.length;
    } catch (err) {
      console.warn('trend_rejection_log insert threw:', err.message);
      return inserted;
    }
  }
  return inserted;
}

async function fetchEbayStats(term, fallbackPrice) {
  const maxPages = Math.max(1, Number(process.env.EBAY_MAX_PAGES || 3));
  const maxSamples = Math.max(30, Number(process.env.EBAY_MAX_SAMPLES || 180));
  const prices = [];
  const seenListings = new Set();

  const parsePriceText = (text) => {
    const parsed = String(text || '').replace(/[^0-9.]/g, '');
    const p = parseFloat(parsed);
    return Number.isFinite(p) && p > 5 && p < 5000 ? p : null;
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const ebayUrl =
      `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(term)}&_sacat=0&rt=nc&LH_Sold=1&LH_Complete=1&_pgn=${page}`;
    let html = '';
    let responseOk = false;
    try {
      const response = await fetch(ebayUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      responseOk = response.ok;
      html = await response.text();
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    if (!responseOk && page > 1) break;

    const $ = cheerio.load(html);
    const pagePrices = [];
    $('.s-item').each((_, el) => {
      const card = $(el);
      const href = String(card.find('.s-item__link').attr('href') || '').trim();
      const listingKey = href ? href.replace(/[?#].*$/, '') : '';
      if (listingKey && seenListings.has(listingKey)) return;

      const priceRaw = card.find('.s-item__price').first().text();
      const price = parsePriceText(priceRaw);
      if (price === null) return;
      if (listingKey) seenListings.add(listingKey);
      pagePrices.push(price);
    });

    if (!pagePrices.length) {
      // Fallback parse: some responses miss selector structure but still contain price spans.
      const roughMatches = [...html.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)/g)]
        .map((m) => parseFloat(m[1]))
        .filter((n) => Number.isFinite(n) && n > 5 && n < 5000)
        .slice(0, 60);
      prices.push(...roughMatches);
    } else {
      prices.push(...pagePrices);
    }

    if (prices.length >= maxSamples) break;
  }

  if (prices.length > maxSamples) prices.length = maxSamples;

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
    .replace(/<!\[cdata\[/gi, '')
    .replace(/\]\]>/g, '')
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

function parseRssOrAtomTitles(xmlText) {
  const xml = String(xmlText || '');
  if (!xml) return [];
  const itemTitles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/gi)]
    .map((m) => stripFeedTitleSource(decodeXmlEntities(m[1])))
    .filter(Boolean);
  if (itemTitles.length > 0) return itemTitles;
  return [...xml.matchAll(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/entry>/gi)]
    .map((m) => stripFeedTitleSource(decodeXmlEntities(m[1])))
    .filter(Boolean);
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

async function callOpenAIJsonCompletion({ systemPrompt, userPrompt, temperature = 0, retries = 2, model: explicitModel = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('openai_key_missing');

  const model = explicitModel || process.env.TREND_CLASSIFIER_MODEL || 'gpt-4o-mini';
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

const STYLE_PROFILE_VERSION = 'v1';
let styleProfileGeneratedThisRun = 0;

function inferStyleItemTypeForAI(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(jacket|coat|anorak|parka|shell|windbreaker|blazer|trench|fleece)\b/.test(t)) return 'outerwear';
  if (/\b(boot|boots|sneaker|sneakers|shoe|shoes|loafer|clog|sandal)\b/.test(t)) return 'footwear';
  if (/\b(dress|maxi|midi|slip dress|gown)\b/.test(t)) return 'dress';
  if (/\b(hoodie|sweatshirt|sweater|cardigan|knit|crewneck)\b/.test(t)) return 'knitwear';
  if (/\b(bag|tote|crossbody|backpack|handbag|purse)\b/.test(t)) return 'bags';
  if (/\b(pants|trouser|trousers|jean|jeans|cargo|shorts|skirt|culotte|chino|double knee|carpenter)\b/.test(t)) return 'bottoms';
  if (/\b(shirt|tee|t-shirt|top|blouse|tank)\b/.test(t)) return 'top';
  return 'mixed';
}

const STYLE_NOUNS_BY_TYPE = {
  outerwear: ['jacket', 'coat', 'anorak', 'parka', 'blazer', 'trench', 'windbreaker', 'shell'],
  bottoms: ['pants', 'jeans', 'trousers', 'cargo', 'chino', 'skirt', 'shorts', 'culotte'],
  footwear: ['boots', 'boot', 'sneakers', 'sneaker', 'shoe', 'shoes', 'loafer', 'loafers', 'clog'],
  knitwear: ['hoodie', 'sweater', 'cardigan', 'knit', 'crewneck', 'sweatshirt'],
  bags: ['bag', 'tote', 'crossbody', 'handbag', 'backpack', 'satchel', 'messenger'],
  dress: ['dress', 'maxi', 'midi', 'slip dress', 'gown'],
  top: ['shirt', 'tee', 't-shirt', 'top', 'blouse', 'tank'],
  mixed: [],
};

const MAINSTREAM_STYLE_BRANDS = [
  'converse',
  'adidas',
  'nike',
  'new balance',
  'vans',
  'reebok',
  'dr martens',
  'timberland',
  'carhartt',
  "levi's",
  'levis',
  'patagonia',
  'north face',
  'the north face',
  'coach',
  'sorel',
  'salomon',
  'puma',
];

function normalizeProfileLine(line) {
  return compactWhitespace(String(line || '').replace(/^[-*•]\s*/, '').trim());
}

function tokenizeForOverlap(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['with', 'from', 'that', 'this', 'your', 'look', 'find'].includes(w));
}

function isNearDuplicate(a, b) {
  const at = new Set(tokenizeForOverlap(a));
  const bt = new Set(tokenizeForOverlap(b));
  if (!at.size || !bt.size) return false;
  let intersect = 0;
  for (const t of at) if (bt.has(t)) intersect += 1;
  const ratio = intersect / Math.max(at.size, bt.size);
  return ratio >= 0.65;
}

function normalizeCompareText(value) {
  return compactWhitespace(String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' '));
}

function inferLineItemTypes(line) {
  const normalized = normalizeCompareText(line);
  const out = new Set();
  for (const [type, nouns] of Object.entries(STYLE_NOUNS_BY_TYPE)) {
    if (type === 'mixed') continue;
    if (nouns.some((noun) => normalized.includes(noun))) out.add(type);
  }
  return out;
}

function isLineCompatibleWithTitleType(line, titleType) {
  if (!titleType || titleType === 'mixed') return true;
  const lineTypes = inferLineItemTypes(line);
  if (!lineTypes.size) return true;
  return lineTypes.has(titleType);
}

function lineHasStyleCue(line) {
  const normalized = normalizeCompareText(line);
  const cueTokens = [
    'cropped', 'oversized', 'wide leg', 'high waisted', 'high rise', 'straight leg', 'chunky',
    'platform', 'colorblock', '90s', 'vintage', 'distressed', 'washed', 'raw hem', 'double knee',
    'chelsea', 'tabi', 'lug sole', 'east west', 'crossbody', 'mini', 'maxi', 'midi', 'cargo',
    'pleated', 'low rise', 'mid rise'
  ];
  return cueTokens.some((cue) => normalized.includes(cue)) || inferLineItemTypes(line).size > 0;
}

function looksGenericStyleLine(line, title, { allowGeneric = false } = {}) {
  if (allowGeneric) return false;
  const n = normalizeCompareText(line);
  const t = normalizeCompareText(title);
  if (!n) return true;
  if (n === t) return true;
  if (t && n.includes(t)) {
    const extra = n.replace(t, '').trim().split(/\s+/).filter(Boolean);
    if (extra.length <= 2) return true;
  }
  if (
    n.includes('quality piece') ||
    n.includes('check condition') ||
    n.includes('strong comps') ||
    n.includes('good fabric') ||
    n.includes('recognizable silhouette') ||
    n.includes('quality construction') ||
    n.includes('strong construction') ||
    n.includes('clean condition over hype') ||
    n.includes('match the core silhouette first')
  ) return true;
  return !lineHasStyleCue(line);
}

function countMainstreamBrands(line) {
  const n = normalizeCompareText(line);
  return MAINSTREAM_STYLE_BRANDS.filter((brand) => n.includes(normalizeCompareText(brand))).length;
}

function sanitizeList(list, maxItems, { allowGeneric = false, title = '', titleType = 'mixed' } = {}) {
  const out = [];
  const seen = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const line = normalizeProfileLine(raw);
    if (!line) continue;
    if (line.length < 6 || line.length > 120) continue;
    if (!isLineCompatibleWithTitleType(line, titleType)) continue;
    if (looksGenericStyleLine(line, title, { allowGeneric })) continue;
    if (seen.some((s) => isNearDuplicate(s, line))) continue;
    seen.push(line);
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
}

function dedupeAcrossStyleSections(profile, title = '') {
  const titleType = inferStyleItemTypeForAI(title);
  const styles = sanitizeList(profile?.styles_to_find, 3, { title, titleType });
  const findFirstRaw = sanitizeList(profile?.find_these_first, 3, { title, titleType });
  const where = sanitizeList(profile?.where_to_check_first, 2, { title, titleType });
  const passIf = sanitizeList(profile?.pass_if, 2, { title, titleType });

  const findFirst = [];
  for (const line of findFirstRaw) {
    const overlapsStyles = styles.some((s) => isNearDuplicate(s, line));
    if (!overlapsStyles) findFirst.push(line);
    if (findFirst.length >= 3) break;
  }

  let normalized = {
    item_type: ['outerwear', 'bottoms', 'footwear', 'knitwear', 'bags', 'dress', 'top', 'mixed'].includes(profile?.item_type)
      ? profile.item_type
      : titleType,
    styles_to_find: styles,
    find_these_first: findFirst,
    where_to_check_first: where,
    pass_if: passIf,
    confidence_note: compactWhitespace(String(profile?.confidence_note || '')),
  };

  const titleHasBrand = MAINSTREAM_STYLE_BRANDS.some((brand) =>
    normalizeCompareText(title).includes(normalizeCompareText(brand))
  );
  const maxBrandLines = titleHasBrand ? 1 : 2;
  let consumedBrands = 0;
  const pruneBrandHeavy = (items, max) =>
    items
      .filter((line) => {
        const hits = countMainstreamBrands(line);
        if (!hits) return true;
        if (consumedBrands >= maxBrandLines) return false;
        consumedBrands += 1;
        return true;
      })
      .slice(0, max);

  normalized = {
    ...normalized,
    styles_to_find: pruneBrandHeavy(normalized.styles_to_find, 3),
    find_these_first: pruneBrandHeavy(normalized.find_these_first, 3),
    where_to_check_first: pruneBrandHeavy(normalized.where_to_check_first, 2),
    pass_if: pruneBrandHeavy(normalized.pass_if, 2),
  };
  return normalized;
}

function isStyleProfileValid(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (!Array.isArray(profile.styles_to_find) || profile.styles_to_find.length === 0) return false;
  if (!Array.isArray(profile.find_these_first) || profile.find_these_first.length === 0) return false;
  if (!Array.isArray(profile.where_to_check_first) || profile.where_to_check_first.length === 0) return false;
  if (!Array.isArray(profile.pass_if) || profile.pass_if.length === 0) return false;
  return true;
}

function shouldRefreshStyleProfile(signal) {
  const ttlDays = Math.max(1, Number(process.env.STYLE_PROFILE_TTL_DAYS || 14));
  const status = String(signal?.style_profile_status || '').toLowerCase();
  const json = signal?.style_profile_json;
  if (!json) return true;
  if (status && status !== 'ok') return true;
  const updatedAt = signal?.style_profile_updated_at;
  if (!updatedAt) return true;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(ageMs) ? ageMs > ttlDays * 24 * 60 * 60 * 1000 : true;
}

async function generateStyleProfileForTitle(title, context = {}) {
  const cleanTitle = compactWhitespace(String(title || ''));
  if (!cleanTitle) {
    return { status: 'missing', error: 'missing_title', profile: null };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { status: 'missing', error: 'openai_key_missing', profile: null };
  }

  const model = process.env.STYLE_PROFILE_MODEL || process.env.TREND_CLASSIFIER_MODEL || 'gpt-4o-mini';
  const systemPrompt =
    'You are a thrift sourcing operator for used fashion. Return JSON only. Output should tell a buyer what to look for in-store, not generic quality/construction advice.';
  const userPrompt = JSON.stringify({
    task: 'Generate structured style sourcing profile for a node card',
    title: cleanTitle,
    inferred_item_type: inferStyleItemTypeForAI(cleanTitle),
    context,
    schema: {
      item_type: 'outerwear|bottoms|footwear|knitwear|bags|dress|top|mixed',
      styles_to_find: 'array (1-3, each 6-120 chars)',
      find_these_first: 'array (1-3, each 6-120 chars, should not duplicate styles_to_find)',
      where_to_check_first: 'array (1-2, each 6-120 chars)',
      pass_if: 'array (1-2, each 6-120 chars)',
      confidence_note: 'string optional, <= 140 chars',
    },
    constraints: [
      'No exact or near-duplicate items across sections',
      'No generic quality/construction filler',
      'Use silhouettes, variants, era cues, rack zones, and pass conditions',
      'At most 2 mainstream brand examples total, only when category-fit',
      'If title already includes a brand, do not force extra brand lines',
      'Use concise, direct language',
    ],
  });

  try {
    const payload = await callOpenAIJsonCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0.15,
      retries: 2,
      model,
    });
    const normalized = dedupeAcrossStyleSections(payload || {}, cleanTitle);
    if (!isStyleProfileValid(normalized)) {
      return { status: 'invalid', error: 'style_profile_invalid_schema', profile: null };
    }
    styleProfileGeneratedThisRun += 1;
    return { status: 'ok', error: null, profile: normalized };
  } catch (err) {
    return { status: 'error', error: `style_profile_ai_error ${err.message}`, profile: null };
  }
}

function extractTermsFromTrendTitle(title) {
  const cleaned = decodeXmlEntities(String(title || '')).trim();
  if (!cleaned) return [];

  const lowered = cleaned.toLowerCase();
  const candidates = new Set();
  const apparelNounPattern = /(jacket|coat|hoodie|sweatshirt|sweater|cardigan|tee|t-shirt|shirt|pants|jeans|trousers|skirt|dress|boots?|sneakers?|loafers?|bag|vest|parka|anorak)/g;
  const qualifierPattern = /(vintage|oversized|cropped|wide-leg|high-waisted|double knee|cargo|graphic|leather|suede|wool|mohair|denim|selvedge|chunky|platform|chelsea|tabi|retro|boxy|distressed|washed|faded|tailored|raw|ripstop|nylon|corduroy|cashmere|knit|quilted|puffer|barn|moto|trench|track|parachute)/g;

  const nounMatches = [...lowered.matchAll(apparelNounPattern)].map((m) => m[1]).filter(Boolean);
  const qualifierMatches = [...lowered.matchAll(qualifierPattern)].map((m) => m[1]).filter(Boolean);
  for (const noun of nounMatches.slice(0, 4)) {
    for (const qualifier of qualifierMatches.slice(0, 4)) {
      candidates.add(normalizeTrendTerm(`${qualifier} ${noun}`));
    }
  }

  // Google trend titles are often "A vs B" or "A, B, C".
  const parts = cleaned
    .split(/\s+vs\.?\s+|,/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const combined = [
    ...parts,
    ...candidates,
    cleaned,
  ].map((v) => compactWhitespace(v)).filter(Boolean);
  return [...new Set(combined)];
}

function extractFashionEntityTermsFromTitle(title) {
  const cleaned = decodeXmlEntities(String(title || '')).toLowerCase();
  if (!cleaned) return [];

  const nouns = [
    'jacket', 'coat', 'hoodie', 'sweatshirt', 'sweater', 'cardigan', 'tee',
    't-shirt', 'shirt', 'pants', 'jeans', 'trousers', 'skirt', 'dress',
    'boot', 'boots', 'sneaker', 'sneakers', 'loafer', 'loafers', 'bag', 'vest', 'parka', 'anorak'
  ];
  const qualifiers = [
    'vintage', 'oversized', 'cropped', 'wide-leg', 'high-waisted', 'double knee', 'cargo',
    'graphic', 'leather', 'suede', 'wool', 'mohair', 'denim', 'selvedge', 'chunky', 'platform',
    'chelsea', 'tabi', 'retro', 'boxy', 'distressed', 'washed', 'faded', 'tailored', 'raw',
    'ripstop', 'nylon', 'corduroy', 'cashmere', 'knit', 'quilted', 'puffer', 'barn', 'moto', 'trench'
  ];
  const brands = [
    "arc'teryx", 'arcteryx', 'carhartt', 'salomon', 'nike', 'adidas', 'new balance',
    'patagonia', 'north face', 'levis', 'levi', 'wrangler', 'dickies', 'coach',
    'gucci', 'prada', 'bottega', 'margiela'
  ];

  const hits = new Set();
  const has = (phrase) => cleaned.includes(phrase);
  for (const noun of nouns) {
    if (!has(noun)) continue;
    for (const q of qualifiers) {
      if (has(q)) hits.add(normalizeTrendTerm(`${q} ${noun}`));
    }
    for (const b of brands) {
      if (has(b)) hits.add(normalizeTrendTerm(`${b} ${noun}`));
    }
  }

  return [...hits]
    .map((v) => compactWhitespace(v))
    .filter(Boolean)
    .slice(0, 8);
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

  const apparelNouns = STYLE_PRODUCT_NOUNS;
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

function hasStructuredFashionPattern(term) {
  const t = String(term || '').toLowerCase();
  const apparelNounPattern = /\b(jacket|coat|hoodie|sweatshirt|sweater|cardigan|tee|t-shirt|shirt|pants|jeans|trousers|skirt|dress|boots?|sneakers?|loafers?|bag|vest|parka|anorak)\b/;
  const qualifierPattern = /\b(vintage|oversized|cropped|wide-leg|high-waisted|double knee|cargo|graphic|leather|suede|wool|mohair|denim|selvedge|chunky|platform|chelsea|tabi|retro|boxy|distressed|washed|faded|tailored|raw|ripstop|nylon|corduroy|cashmere|knit|quilted|puffer|barn|moto|trench|track|parachute)\b/;
  const brandPattern = /\b(arc'?teryx|arcteryx|carhartt|salomon|nike|adidas|new balance|patagonia|north face|levis?|wrangler|dickies|coach|gucci|prada|bottega|margiela|missguided|forever\s*21|asos|mango|reformation|urban outfitters|pacsun|old navy|banana republic)\b/;
  const hasNoun = apparelNounPattern.test(t);
  const hasQualifier = qualifierPattern.test(t);
  const hasBrand = brandPattern.test(t);
  return (hasNoun && hasQualifier) || (hasNoun && hasBrand);
}

function hasStrongTrendSpecificity(term) {
  const t = String(term || '').toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  const hasNoun = /\b(jacket|coat|hoodie|sweatshirt|sweater|cardigan|tee|t-shirt|shirt|pants|jeans|trousers|skirt|dress|boots?|sneakers?|loafers?|bag|vest|parka|anorak)\b/.test(t);
  if (!hasNoun) return false;

  const brand = inferBrandFromTerm(term);
  if (brand) return true;

  const strongSignals = [
    'double knee', 'carpenter', 'selvedge', 'gore-tex', 'tabi', 'mohair',
    'colorblock', 'shearling', 'mesh', 'drkshdw', 'beta lt', 'xt-6',
    'ultraboost', 'samba', 'air force 1', 'air max', 'joan of arctic'
  ];
  if (strongSignals.some((s) => t.includes(s))) return true;

  const qualifierPattern = /\b(vintage|oversized|cropped|wide-leg|high-waisted|cargo|graphic|leather|suede|wool|denim|chunky|platform|chelsea|retro|boxy|distressed|washed|faded|tailored|raw|ripstop|nylon|corduroy|cashmere|knit|quilted|puffer|barn|moto|trench)\b/g;
  const qualifierHits = [...t.matchAll(qualifierPattern)].length;
  if (qualifierHits >= 2 && words.length >= 3) return true;

  return false;
}

function hasStyleProductNoun(term) {
  const t = String(term || '').toLowerCase();
  return STYLE_PRODUCT_NOUNS.some((noun) => t.includes(noun));
}

function isGenericStyleOnlyTerm(term) {
  const normalized = normalizeTrendTerm(term).toLowerCase();
  return GENERIC_STYLE_ONLY_TERMS.has(normalized);
}

function isEditorialNoiseTerm(term) {
  const t = String(term || '').toLowerCase();
  const blockedPhrases = [
    'how to wear',
    'what to wear',
    'editors pick',
    "editor's pick",
    'best dressed',
    'street style stars',
    'fashion week recap',
    'trend report',
    'shopping guide',
    'must have',
    'lookbook',
    'outfit ideas',
    'celebrity style',
    'watch now',
    'podcast',
    'interview',
    'runway show',
    'red carpet',
    'met gala',
    'best ',
    ' top ',
    'trends',
    ' trend',
    'guide',
    'gift',
    'gifting',
    'collaboration',
    'collab',
    'look to',
    'lookbook',
    'must-have',
    'must have',
    'spring 20',
    'summer 20',
    'fall 20',
    'winter 20',
    "everyone's",
    "here's",
    'we tested',
    'our favorite',
    'our favorites',
    'ways to wear',
    'ways to style',
    'why ',
    'what ',
    'need to know',
    'are here to stay',
    'is cozy',
    'is timeless',
    'is the new',
    'fashion editors'
  ];
  if (blockedPhrases.some((p) => t.includes(p))) return true;
  if (/\b20\d{2}\b/.test(t)) return true;
  if (/[?!:]/.test(t) && t.split(/\s+/).length > 5) return true;
  return false;
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

function evaluateTrendTerm(term) {
  const verdict = classifyTrendTerm(term);
  return { ok: verdict.ok, reason: verdict.reason };
}

function classifyTrendTerm(term) {
  const cleaned = String(term || '').trim();
  if (!cleaned) return { ok: false, reason: 'empty', type: 'rejected', brand: null };
  if (cleaned.length < 4) return { ok: false, reason: 'too_short', type: 'rejected', brand: null };
  if (cleaned.length > 60) return { ok: false, reason: 'too_long', type: 'rejected', brand: null };
  if (isEditorialNoiseTerm(cleaned)) return { ok: false, reason: 'editorial_noise', type: 'rejected', brand: null };
  if (/\b(from|to|for|with|and|or|vs)\b/i.test(cleaned) && cleaned.split(/\s+/).length >= 4) {
    return { ok: false, reason: 'headline_phrase', type: 'rejected', brand: null };
  }
  if (cleaned.split(/\s+/).length > 6) return { ok: false, reason: 'too_many_words', type: 'rejected', brand: null };
  if (isBlockedNonFashionTerm(cleaned)) return { ok: false, reason: 'blocked_non_fashion', type: 'rejected', brand: null };
  if (!isFashionTerm(cleaned)) return { ok: false, reason: 'no_fashion_keyword', type: 'rejected', brand: null };
  const brand = inferBrandFromTerm(cleaned);
  if (brand && !hasStyleProductNoun(cleaned)) {
    return { ok: true, reason: 'accepted_brand_only', type: 'brand', brand };
  }
  if (!hasStyleProductNoun(cleaned)) return { ok: false, reason: 'no_product_noun', type: 'rejected', brand: null };
  if (!isSpecificFashionTerm(cleaned)) return { ok: false, reason: 'not_specific_enough', type: 'rejected', brand: null };
  if (!hasStructuredFashionPattern(cleaned)) return { ok: false, reason: 'not_structured_entity', type: 'rejected', brand: null };
  if (!hasStrongTrendSpecificity(cleaned)) return { ok: false, reason: 'too_generic_for_trend', type: 'rejected', brand: null };
  if (!brand && isGenericStyleOnlyTerm(cleaned)) {
    return { ok: false, reason: 'generic_style_only', type: 'rejected', brand: null };
  }

  const trendType = brand ? 'brand_style' : 'style';
  return { ok: true, reason: 'accepted', type: trendType, brand };
}

function classifyTrendTermDiscovery(term) {
  const cleaned = String(term || '').trim();
  if (!cleaned) return { ok: false, reason: 'empty', type: 'rejected', brand: null };
  if (cleaned.length < 4) return { ok: false, reason: 'too_short', type: 'rejected', brand: null };
  if (cleaned.length > 70) return { ok: false, reason: 'too_long', type: 'rejected', brand: null };
  if (isBlockedNonFashionTerm(cleaned)) return { ok: false, reason: 'blocked_non_fashion', type: 'rejected', brand: null };
  if (isEditorialNoiseTerm(cleaned)) return { ok: false, reason: 'editorial_noise', type: 'rejected', brand: null };
  if (cleaned.split(/\s+/).length > 7) return { ok: false, reason: 'too_many_words', type: 'rejected', brand: null };

  const brand = inferBrandFromTerm(cleaned);
  const hasNoun = hasStyleProductNoun(cleaned);
  const fashionish = isFashionTerm(cleaned);

  if (!brand && !hasNoun) return { ok: false, reason: 'no_product_noun', type: 'rejected', brand: null };
  if (!brand && !fashionish) return { ok: false, reason: 'no_fashion_keyword', type: 'rejected', brand: null };
  if (!brand && isGenericStyleOnlyTerm(cleaned)) {
    return { ok: false, reason: 'generic_style_only', type: 'rejected', brand: null };
  }

  if (brand && !hasNoun) return { ok: true, reason: 'accepted_brand_only_relaxed', type: 'brand', brand };
  return { ok: true, reason: 'accepted_relaxed', type: brand ? 'brand_style' : 'style', brand };
}

function shouldUseTrendTerm(term) {
  return evaluateTrendTerm(term).ok;
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
  for (const matcher of BRAND_LEXICON) {
    if (matcher.patterns.some((pattern) => pattern.test(t))) return matcher.label;
  }
  return null;
}

function inferTrack(term, brandName) {
  const verdict = classifyTrendTerm(term);
  if (verdict.ok && verdict.type === 'brand_style') return 'Brand + Style';
  if (verdict.ok && verdict.type === 'brand') return 'Brand';
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
  const seedLimit = Math.max(10, Number(process.env.EBAY_DISCOVERY_SEED_LIMIT || 48));
  const seeds = [...new Set((seedTerms || []).map((s) => compactWhitespace(String(s))).filter(Boolean))].slice(0, seedLimit);
  const discoveredStrict = [];
  const discoveredRelaxed = [];

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
      let titles = $('.s-item__title')
        .map((_, el) => compactWhitespace($(el).text()))
        .get()
        .filter(Boolean)
        .slice(0, 80);

      if (titles.length < 10) {
        const rssUrl =
          `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(seed)}&_sacat=0&rt=nc&LH_Sold=1&LH_Complete=1&_rss=1`;
        try {
          const rssRes = await fetch(rssUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          const rssXml = await rssRes.text();
          if (rssRes.ok) {
            const rssTitles = parseRssOrAtomTitles(rssXml).slice(0, 80);
            if (rssTitles.length > 0) {
              titles = [...new Set([...titles, ...rssTitles])].slice(0, 90);
            }
          }
        } catch (_rssErr) {
          // Keep HTML titles when RSS fallback fails.
        }
      }

      for (const title of titles) {
        const candidate = titleToDiscoveryCandidate(title);
        if (shouldUseTrendTerm(candidate)) {
          discoveredStrict.push(candidate);
        } else {
          const relaxedVerdict = classifyTrendTermDiscovery(candidate);
          if (relaxedVerdict.ok) discoveredRelaxed.push(candidate);
        }
      }
    } catch (err) {
      console.warn(`ebay discovery failed for seed "${seed}":`, err.message);
    }
  }

  const deduped = [];
  const seen = new Set();
  const mergedDiscovered = discoveredStrict.length > 0
    ? discoveredStrict
    : discoveredRelaxed;
  for (const term of mergedDiscovered) {
    const key = getDedupeKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(term);
  }
  if (deduped.length === 0) {
    const seedFallback = [];
    for (const seed of seeds) {
      const normalizedSeed = normalizeTrendTerm(seed);
      const verdict = classifyTrendTermDiscovery(normalizedSeed);
      if (!verdict.ok) continue;
      if (!verdict.brand && !hasStyleProductNoun(normalizedSeed)) continue;
      const key = getDedupeKey(normalizedSeed);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      seedFallback.push(normalizedSeed);
      if (seedFallback.length >= 40) break;
    }
    deduped.push(...seedFallback);
  }
  const kept = applyDiversityCaps(
    deduped,
    Number(process.env.EBAY_DISCOVERY_BUCKET_CAP || 8)
  ).slice(0, Number(process.env.MAX_EBAY_DISCOVERY_TERMS || 250));

  console.log(
    `📊 eBay discovery stats: seeds=${seeds.length} strict=${discoveredStrict.length} relaxed=${discoveredRelaxed.length} deduped=${deduped.length} kept=${kept.length}`
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
  const rejectionRows = [];
  for (const title of headlines) {
    const entityTerms = extractFashionEntityTermsFromTitle(title);
    if (!entityTerms.length) {
      rejectionRows.push({
        collector_source: 'fashion_rss',
        raw_title: title,
        candidate_term: title,
        rejection_reason: 'no_entity_extracted',
        metadata: { stage: 'entity_extract' },
      });
    }
    for (const term of entityTerms) {
      rawTerms.push(term);
      if (isFashionTerm(term)) filteredTerms.push(term);
      const verdict = evaluateTrendTerm(term);
      if (!verdict.ok) {
        rejectionRows.push({
          collector_source: 'fashion_rss',
          raw_title: title,
          candidate_term: term,
          rejection_reason: verdict.reason,
          metadata: { stage: 'rss_term_filter' },
        });
      }
    }
  }

  const uniqueRaw = [...new Set(rawTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const keywordFiltered = [...new Set(filteredTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const strict = applyDiversityCaps(
    keywordFiltered.filter(shouldUseTrendTerm).map(normalizeTrendTerm),
    Number(process.env.FASHION_RSS_BUCKET_CAP || 12)
  ).slice(0, Number(process.env.MAX_FASHION_RSS_TERMS || 320));
  const rejectedLogged = await writeTrendRejectionLogs(
    rejectionRows.slice(0, Number(process.env.MAX_REJECTION_LOG_ROWS_PER_SOURCE || 1500))
  );

  return {
    rawTerms: uniqueRaw,
    filteredTerms: strict,
    feedCount,
    successFeeds,
    failedFeeds,
    headlineCount: headlines.length,
    rejectedLogged,
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
  const rejectionRows = [];
  for (const title of headlines) {
    const entityTerms = extractFashionEntityTermsFromTitle(title);
    if (!entityTerms.length) {
      rejectionRows.push({
        collector_source: 'google_news_rss',
        raw_title: title,
        candidate_term: title,
        rejection_reason: 'no_entity_extracted',
        metadata: { stage: 'entity_extract' },
      });
    }
    for (const term of entityTerms) {
      rawTerms.push(term);
      if (isFashionTerm(term)) filteredTerms.push(term);
      const verdict = evaluateTrendTerm(term);
      if (!verdict.ok) {
        rejectionRows.push({
          collector_source: 'google_news_rss',
          raw_title: title,
          candidate_term: term,
          rejection_reason: verdict.reason,
          metadata: { stage: 'rss_term_filter' },
        });
      }
    }
  }

  const uniqueRaw = [...new Set(rawTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const keywordFiltered = [...new Set(filteredTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const strict = applyDiversityCaps(
    keywordFiltered.filter(shouldUseTrendTerm).map(normalizeTrendTerm),
    Number(process.env.GOOGLE_NEWS_BUCKET_CAP || 14)
  ).slice(0, Number(process.env.MAX_GOOGLE_NEWS_TERMS || 380));
  const rejectedLogged = await writeTrendRejectionLogs(
    rejectionRows.slice(0, Number(process.env.MAX_REJECTION_LOG_ROWS_PER_SOURCE || 1500))
  );

  return {
    rawTerms: uniqueRaw,
    filteredTerms: strict,
    feedCount,
    successFeeds,
    failedFeeds,
    headlineCount: headlines.length,
    rejectedLogged,
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
  const geos = String(process.env.GOOGLE_TRENDS_GEOS || 'US,GB,CA,AU')
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10);
  const urls = geos.flatMap((geo) => [
    `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`,
    `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${encodeURIComponent(geo)}`,
  ]);

  const aggregatedTitles = [];
  const failures = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'thriftpulse-sync/1.0',
          Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
        }
      });
      const xml = await res.text();
      if (!res.ok) {
        const snippet = xml.slice(0, 120).replace(/\s+/g, ' ');
        failures.push(`status=${res.status} url=${url} body="${snippet}"`);
        continue;
      }
      const titles = parseRssOrAtomTitles(xml).slice(0, 80);
      if (!titles.length) {
        failures.push(`status=ok_but_empty url=${url}`);
        continue;
      }
      aggregatedTitles.push(...titles);
    } catch (err) {
      failures.push(`fetch_error url=${url} err=${String(err?.message || 'unknown')}`);
    }
  }

  const rawTitles = [...new Set(aggregatedTitles.map((t) => compactWhitespace(t)).filter(Boolean))];
  if (!rawTitles.length) {
    throw new Error(`google_trends_failed ${failures[0] || 'no_titles_returned'}`);
  }

  const rawTerms = [];
  const filteredTerms = [];
  const titleBrandTerms = [];
  for (const title of rawTitles) {
    const extracted = [
      ...extractTermsFromTrendTitle(title),
      ...extractFashionEntityTermsFromTitle(title),
    ];
    const brand = inferBrandFromTerm(title);
    if (brand) titleBrandTerms.push(normalizeTrendTerm(brand));
    for (const term of extracted) {
      rawTerms.push(term);
      if (isFashionTerm(term)) filteredTerms.push(term);
    }
  }

  const uniqueRaw = [...new Set(rawTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const keywordFiltered = [...new Set(filteredTerms.map((t) => compactWhitespace(t)).filter(Boolean))];
  const strictFiltered = [...new Set(keywordFiltered.filter(shouldUseTrendTerm).map(normalizeTrendTerm))];
  const relaxedFiltered = [...new Set(
    keywordFiltered
      .filter((term) => {
        const verdict = classifyTrendTermDiscovery(term);
        return verdict.ok && (!!verdict.brand || hasStyleProductNoun(term));
      })
      .map(normalizeTrendTerm)
  )];
  const brandFallback = [...new Set(
    titleBrandTerms.filter((term) => {
      const verdict = classifyTrendTermDiscovery(term);
      return verdict.ok;
    })
  )];

  let uniqueFiltered = strictFiltered.length > 0 ? strictFiltered : relaxedFiltered;
  if (!uniqueFiltered.length && brandFallback.length) {
    uniqueFiltered = brandFallback;
  }
  uniqueFiltered = applyDiversityCaps(
    uniqueFiltered,
    Number(process.env.GOOGLE_TRENDS_BUCKET_CAP || 8)
  ).slice(0, Number(process.env.MAX_GOOGLE_TRENDS_TERMS || 120));
  console.log(
    `📊 Google Trends filter stats: geos=${geos.length} titles=${rawTitles.length} raw=${uniqueRaw.length} keywordFiltered=${keywordFiltered.length} strict=${strictFiltered.length} relaxed=${relaxedFiltered.length} brandFallback=${brandFallback.length} kept=${uniqueFiltered.length}`
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
  // Keep this as an evidence count (not weighted "popularity points"):
  // eBay sold sample count + distinct non-eBay signal hits.
  const ebay = Math.max(0, Math.round(safeNumber(ebaySampleCount, 0)));
  const nonEbaySignals =
    (fashionRssHit ? 1 : 0) +
    (googleNewsHit ? 1 : 0) +
    (googleTrendHit ? 1 : 0) +
    (corpusHit ? 1 : 0) +
    (discoveryHit ? 1 : 0);
  const compBoost = safeNumber(compSampleSize, 0) >= 10 ? 1 : 0;
  return ebay + nonEbaySignals + compBoost;
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

function clampInt(value, min, max) {
  const v = Math.round(Number(value || 0));
  return Math.max(min, Math.min(max, v));
}

function gradeFromScore(score) {
  if (score >= 85) return 'A';
  if (score >= 72) return 'B';
  if (score >= 58) return 'C';
  return 'D';
}

function buildBaseRating({
  term,
  heatScore,
  ebaySampleCount,
  sourceSignalCount,
  priceLow,
  priceHigh,
  avgPrice,
  googleTrendHit,
  corpusHit,
  discoveryHit,
}) {
  const heat = safeNumber(heatScore, 50);
  const sample = safeNumber(ebaySampleCount, 0);
  const sources = safeNumber(sourceSignalCount, 0);
  const low = safeNumber(priceLow, 0);
  const high = safeNumber(priceHigh, 0);
  const avg = safeNumber(avgPrice, 0);
  const spreadPct = low > 0 && high > 0 ? ((high - low) / low) * 100 : 0;
  const sourceDiversityBoost =
    (googleTrendHit ? 1 : 0) +
    (corpusHit ? 1 : 0) +
    (discoveryHit ? 1 : 0);

  let confidenceScore =
    26 +
    Math.round(heat * 0.32) +
    Math.min(28, sample) +
    Math.min(18, sources * 6) +
    sourceDiversityBoost * 3;

  // Penalize very volatile comp ranges.
  if (spreadPct > 220) confidenceScore -= 12;
  else if (spreadPct > 150) confidenceScore -= 8;
  else if (spreadPct > 95) confidenceScore -= 4;

  let sourcingScore =
    22 +
    Math.round(heat * 0.28) +
    Math.min(24, sample) +
    Math.min(14, sources * 4);

  // Better resale midpoint increases sourcing attractiveness.
  if (avg >= 180) sourcingScore += 8;
  else if (avg >= 90) sourcingScore += 4;
  else if (avg <= 28) sourcingScore -= 4;

  // Hard evidence caps for reliability.
  if (sample === 0) confidenceScore = Math.min(confidenceScore, 55);
  else if (sample < 6) confidenceScore = Math.min(confidenceScore, 68);
  if (sources < 2) confidenceScore = Math.min(confidenceScore, 72);

  confidenceScore = clampInt(confidenceScore, 10, 99);
  sourcingScore = clampInt(sourcingScore, 10, 99);
  const grade = gradeFromScore(Math.round((confidenceScore + sourcingScore) / 2));

  const explanation = [
    `${term}: base model scored from heat, sold-comp depth, and source diversity.`,
    `Evidence depth: eBay ${sample} comps, ${sources} source signal(s).`,
    low > 0 && high > 0
      ? `Comp range: $${Math.round(low)}-$${Math.round(high)} (${Math.round(spreadPct)}% spread).`
      : 'Comp range: pending stronger sold-comp spread.',
  ];

  const riskFlags = [];
  if (sample < 6) riskFlags.push('low_comp_depth');
  if (sources < 2) riskFlags.push('single_source_bias');
  if (spreadPct > 150) riskFlags.push('high_price_volatility');

  return {
    confidenceScore,
    sourcingScore,
    grade,
    explanation,
    riskFlags,
    spreadPct: Math.round(spreadPct),
  };
}

async function scoreWithAIAdjustments({
  term,
  track,
  baseRating,
  sampleCount,
  sourceSignalCount,
  heatScore,
  priceLow,
  priceHigh,
  avgPrice,
}) {
  const aiEnabled = String(process.env.ENABLE_AI_RATING || '1') !== '0';
  if (!aiEnabled || !process.env.OPENAI_API_KEY) {
    return {
      ...baseRating,
      model: 'base_only',
    };
  }

  const ratingModel = process.env.TREND_RATING_MODEL || process.env.TREND_CLASSIFIER_MODEL || 'gpt-4o-mini';
  const systemPrompt =
    'You are a resale scoring assistant. Return strict JSON only with: confidence_adjust (-10..10 int), sourcing_adjust (-10..10 int), explanation (string), risk_flags (string[]). Keep adjustments conservative and evidence-driven.';
  const userPrompt = JSON.stringify({
    term,
    track,
    evidence: {
      sample_count: sampleCount,
      source_signal_count: sourceSignalCount,
      heat_score: heatScore,
      price_low: priceLow,
      price_high: priceHigh,
      avg_price: avgPrice,
    },
    base: {
      confidence_score: baseRating.confidenceScore,
      sourcing_score: baseRating.sourcingScore,
      grade: baseRating.grade,
      spread_pct: baseRating.spreadPct,
    },
    instruction: 'Recommend small score adjustments only when clearly justified by evidence quality or risk.',
  });

  try {
    const payload = await callOpenAIJsonCompletion({
      systemPrompt,
      userPrompt,
      temperature: 0,
      retries: 1,
      model: ratingModel,
    });
    const cAdj = clampInt(payload?.confidence_adjust, -10, 10);
    const sAdj = clampInt(payload?.sourcing_adjust, -10, 10);
    let confidenceScore = clampInt(baseRating.confidenceScore + cAdj, 10, 99);
    let sourcingScore = clampInt(baseRating.sourcingScore + sAdj, 10, 99);

    // Preserve deterministic caps for low evidence.
    if (sampleCount === 0) confidenceScore = Math.min(confidenceScore, 55);
    else if (sampleCount < 6) confidenceScore = Math.min(confidenceScore, 68);
    if (sourceSignalCount < 2) confidenceScore = Math.min(confidenceScore, 72);

    const grade = gradeFromScore(Math.round((confidenceScore + sourcingScore) / 2));
    const aiExplanation = String(payload?.explanation || '').trim();
    const aiRiskFlags = Array.isArray(payload?.risk_flags)
      ? payload.risk_flags.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 5)
      : [];

    return {
      confidenceScore,
      sourcingScore,
      grade,
      explanation: aiExplanation
        ? [...baseRating.explanation, `AI: ${aiExplanation}`]
        : baseRating.explanation,
      riskFlags: [...new Set([...baseRating.riskFlags, ...aiRiskFlags])],
      spreadPct: baseRating.spreadPct,
      model: ratingModel,
    };
  } catch (err) {
    console.warn(`AI rating adjustment failed (${term}):`, err.message);
    return {
      ...baseRating,
      model: 'base_only_fallback',
    };
  }
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

async function seedSignalsFromSources(existingSignals, discoveredTerms, sourceSets = {}) {
  const existingNames = new Set(
    (existingSignals || []).map((s) => String(s.trend_name || '').trim().toLowerCase())
  );
  const newTerms = discoveredTerms.filter((term) => !existingNames.has(term.toLowerCase()));

  if (!newTerms.length) return 0;

  let created = 0;
  for (const term of newTerms) {
    try {
      const strictVerdict = classifyTrendTerm(term);
      const termVerdict = strictVerdict.ok ? strictVerdict : classifyTrendTermDiscovery(term);
      if (!termVerdict.ok) {
        await writeTrendRejectionLogs([{
          collector_source: 'seed_merge',
          raw_title: term,
          candidate_term: term,
          rejection_reason: termVerdict.reason,
          metadata: { stage: 'seed_discovery_gate' },
        }]);
        continue;
      }
      const key = String(term || '').toLowerCase().trim();
      const fashionRssHit = Boolean(sourceSets?.fashionRssSet?.has(key));
      const googleNewsHit = Boolean(sourceSets?.googleNewsSet?.has(key));
      const googleTrendHit = Boolean(sourceSets?.googleSet?.has(key));
      const corpusHit = Boolean(sourceSets?.corpusSet?.has(key));
      const discoveryHit = Boolean(sourceSets?.discoverySet?.has(key));
      const nonEbaySignalCount =
        (fashionRssHit ? 1 : 0) +
        (googleNewsHit ? 1 : 0) +
        (googleTrendHit ? 1 : 0) +
        (corpusHit ? 1 : 0) +
        (discoveryHit ? 1 : 0);

      const { avgPrice, sampleCount } = await fetchEbayStats(term, 60);
      if (sampleCount < 3 || (sampleCount < 8 && nonEbaySignalCount < 2)) {
        await writeTrendRejectionLogs([{
          collector_source: 'seed_merge',
          raw_title: term,
          candidate_term: term,
          rejection_reason: 'weak_evidence_threshold',
          metadata: { stage: 'seed_discovery_gate', ebay_sample_count: sampleCount, non_ebay_signal_count: nonEbaySignalCount },
        }]);
        console.log(`⏭️ Skipping low-signal discovery: ${term} (eBay sample ${sampleCount}, source hints ${nonEbaySignalCount})`);
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
      const sourceSignalCount = (sampleCount > 0 ? 1 : 0) + nonEbaySignalCount;
      const compLow = Math.max(1, Math.floor(avgPrice * 0.85));
      const compHigh = Math.max(1, Math.floor(avgPrice * 1.15));
      const mentionCount = calculateMentionCount({
        ebaySampleCount: sampleCount,
        fashionRssHit,
        googleNewsHit,
        googleTrendHit,
        corpusHit,
        discoveryHit,
      });
      const baseRating = buildBaseRating({
        term,
        heatScore,
        ebaySampleCount: sampleCount,
        sourceSignalCount,
        priceLow: compLow,
        priceHigh: compHigh,
        avgPrice,
        googleTrendHit,
        corpusHit,
        discoveryHit,
      });
      const scored = await scoreWithAIAdjustments({
        term,
        track: termVerdict.type === 'brand'
          ? 'Brand'
          : termVerdict.type === 'brand_style'
            ? 'Brand + Style'
            : 'Style Category',
        baseRating,
        sampleCount,
        sourceSignalCount,
        heatScore,
        priceLow: compLow,
        priceHigh: compHigh,
        avgPrice,
      });
      const isStyleLike = termVerdict.type !== 'brand';
      const maxStyleProfilesPerRun = Math.max(0, Number(process.env.STYLE_PROFILE_MAX_PER_RUN || 120));
      let styleProfileResult = { status: 'missing', error: 'not_style_track', profile: null };
      if (isStyleLike && styleProfileGeneratedThisRun < maxStyleProfilesPerRun) {
        styleProfileResult = await generateStyleProfileForTitle(term, {
          track: termVerdict.type === 'brand_style' ? 'Brand + Style' : 'Style Category',
          hook_brand: termVerdict.brand || null,
          market_sentiment: scored.explanation.slice(0, 2).join(' '),
          risk_factor: scored.riskFlags.slice(0, 2).join(', ') || null,
        });
      } else if (isStyleLike && styleProfileGeneratedThisRun >= maxStyleProfilesPerRun) {
        styleProfileResult = { status: 'missing', error: 'style_profile_run_cap_reached', profile: null };
      }

      const { error } = await supabase
        .from('market_signals')
        .upsert(
          [{
            trend_name: term,
            track: termVerdict.type === 'brand'
              ? 'Brand'
              : termVerdict.type === 'brand_style'
                ? 'Brand + Style'
                : 'Style Category',
            hook_brand: termVerdict.brand,
            market_sentiment: scored.explanation.slice(0, 3).join(' '),
            risk_factor: scored.riskFlags.join(', ') || null,
            ebay_sample_count: sampleCount,
            google_trend_hits: googleTrendHit ? 1 : 0,
            ai_corpus_hits: corpusHit ? 1 : 0,
            ebay_discovery_hits: discoveryHit ? 1 : 0,
            source_signal_count: sourceSignalCount,
            mention_count: mentionCount,
            confidence_score: scored.confidenceScore,
            liquidity_score: scored.sourcingScore,
            heat_score: heatScore,
            exit_price: Math.max(10, avgPrice),
            style_profile_json: styleProfileResult.profile,
            style_profile_version: STYLE_PROFILE_VERSION,
            style_profile_updated_at: styleProfileResult.profile ? new Date().toISOString() : null,
            style_profile_status: styleProfileResult.status,
            style_profile_error: styleProfileResult.error,
            updated_at: new Date().toISOString()
          }],
          { onConflict: 'trend_name' }
        );

      if (!error) {
        await writeCompCheck({
          signalId: null,
          trendName: term,
          sampleSize: sampleCount,
          priceLow: compLow,
          priceHigh: compHigh,
          notes: 'Discovery-mode sold comps snapshot.',
        });
        created += 1;
        console.log(`🆕 Discovered trend: ${term} | Heat: ${heatScore} | $${avgPrice} | Sample: ${sampleCount} | C:${scored.confidenceScore} S:${scored.sourcingScore} (${scored.grade}, ${scored.model})`);
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
        `Scanned ${rss.feedCount} fashion RSS feeds (${rss.successFeeds} ok, ${rss.failedFeeds} failed) and captured ${fashionRssTerms.length} terms from ${rss.headlineCount} headlines. Logged ${Number(rss.rejectedLogged || 0)} rejected candidates.`
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
        `Scanned ${news.feedCount} Google News fashion RSS queries (${news.successFeeds} ok, ${news.failedFeeds} failed) and captured ${googleNewsTerms.length} terms from ${news.headlineCount} headlines. Logged ${Number(news.rejectedLogged || 0)} rejected candidates.`
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
    const fashionRssSet = new Set(fashionRssTerms.map((t) => t.toLowerCase()));
    const googleNewsSet = new Set(googleNewsTerms.map((t) => t.toLowerCase()));
    const googleSet = new Set(googleTrendsTerms.map((t) => t.toLowerCase()));
    const corpusSet = new Set(corpusAiTerms.map((t) => String(t || '').toLowerCase()));
    const discoverySet = new Set(ebayDiscoveryTerms.map((t) => String(t || '').toLowerCase()));

    // 1. Pull existing signals from database
    const { data: initialSignals, error: sigError } = await supabase.from('market_signals').select('*');
    
    if (sigError) throw sigError;
    const discoveredCount = await seedSignalsFromSources(initialSignals || [], discoveredTerms, {
      fashionRssSet,
      googleNewsSet,
      googleSet,
      corpusSet,
      discoverySet,
    });
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

    for (const signal of signals) {
      console.log(`🔍 Syncing: ${signal.trend_name}`);
      const strictVerdict = classifyTrendTerm(signal.trend_name);
      const trendVerdict = strictVerdict.ok ? strictVerdict : classifyTrendTermDiscovery(signal.trend_name);
      if (!trendVerdict.ok) {
        await writeTrendRejectionLogs([{
          collector_source: 'market_signal_update',
          raw_title: signal.trend_name,
          candidate_term: signal.trend_name,
          rejection_reason: trendVerdict.reason,
          metadata: { stage: 'update_gate', signal_id: signal.id },
        }]);
        try {
          await supabase
            .from('market_signals')
            .update({
              pipeline_stage: 'archived',
              archived_at: new Date().toISOString(),
              stage_updated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', signal.id);
        } catch (_err) {
          // Stage columns may not exist in every environment; ignore hard-fail.
        }
        console.log(`⏭️ Skipping non-structured trend row: ${signal.trend_name} (${trendVerdict.reason})`);
        continue;
      }

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
      const baseConfidenceScore = calculateSignalScore({
        heatScore: newHeat,
        ebaySampleCount: sampleCount,
        sourceSignalCount,
      });
      const baseRating = buildBaseRating({
        term: signal.trend_name,
        heatScore: newHeat,
        ebaySampleCount: sampleCount,
        sourceSignalCount,
        priceLow,
        priceHigh,
        avgPrice,
        googleTrendHit,
        corpusHit,
        discoveryHit,
      });
      baseRating.confidenceScore = clampInt(
        Math.round((baseRating.confidenceScore + baseConfidenceScore) / 2),
        10,
        99
      );
      const scored = await scoreWithAIAdjustments({
        term: signal.trend_name,
        track: trendVerdict.type === 'brand'
          ? 'Brand'
          : trendVerdict.type === 'brand_style'
            ? 'Brand + Style'
            : 'Style Category',
        baseRating,
        sampleCount,
        sourceSignalCount,
        heatScore: newHeat,
        priceLow,
        priceHigh,
        avgPrice,
      });
      const isStyleLike = trendVerdict.type !== 'brand';
      const maxStyleProfilesPerRun = Math.max(0, Number(process.env.STYLE_PROFILE_MAX_PER_RUN || 120));
      let styleProfileResult = {
        status: signal?.style_profile_status || 'missing',
        error: signal?.style_profile_error || null,
        profile: signal?.style_profile_json || null,
      };
      if (isStyleLike && shouldRefreshStyleProfile(signal)) {
        if (styleProfileGeneratedThisRun < maxStyleProfilesPerRun) {
          styleProfileResult = await generateStyleProfileForTitle(signal.trend_name, {
            track: trendVerdict.type === 'brand_style' ? 'Brand + Style' : 'Style Category',
            hook_brand: trendVerdict.brand || signal.hook_brand || null,
            market_sentiment: scored.explanation.slice(0, 2).join(' '),
            risk_factor: scored.riskFlags.slice(0, 2).join(', ') || signal.risk_factor || null,
            visual_cues: Array.isArray(signal.visual_cues) ? signal.visual_cues.slice(0, 4) : [],
          });
        } else {
          styleProfileResult = { status: 'missing', error: 'style_profile_run_cap_reached', profile: null };
        }
      } else if (!isStyleLike) {
        styleProfileResult = { status: 'missing', error: 'not_style_track', profile: null };
      }
      if (sampleCount < 5 && sourceSignalCount < 3) {
        await writeTrendRejectionLogs([{
          collector_source: 'market_signal_update',
          raw_title: signal.trend_name,
          candidate_term: signal.trend_name,
          rejection_reason: 'weak_update_evidence',
          metadata: { stage: 'update_gate', signal_id: signal.id, ebay_sample_count: sampleCount, source_signal_count: sourceSignalCount },
        }]);
        console.log(`⏭️ Skipping weak update evidence: ${signal.trend_name} (sample=${sampleCount}, sources=${sourceSignalCount})`);
        continue;
      }

      // 2. UPDATE SUPABASE
      const { error: upError } = await supabase
        .from('market_signals')
        .update({ 
          track: trendVerdict.type === 'brand'
            ? 'Brand'
            : trendVerdict.type === 'brand_style'
              ? 'Brand + Style'
              : 'Style Category',
          hook_brand: trendVerdict.brand || signal.hook_brand || null,
          ebay_sample_count: sampleCount,
          google_trend_hits: googleTrendHit ? 1 : 0,
          ai_corpus_hits: corpusHit ? 1 : 0,
          ebay_discovery_hits: discoveryHit ? 1 : 0,
          source_signal_count: sourceSignalCount,
          mention_count: mentionCount,
          confidence_score: scored.confidenceScore,
          liquidity_score: scored.sourcingScore,
          market_sentiment: scored.explanation.slice(0, 3).join(' '),
          risk_factor: scored.riskFlags.join(', ') || signal.risk_factor || null,
          exit_price: avgPrice, 
          heat_score: newHeat,
          style_profile_json: styleProfileResult.profile,
          style_profile_version: STYLE_PROFILE_VERSION,
          style_profile_updated_at: styleProfileResult.profile ? new Date().toISOString() : signal.style_profile_updated_at || null,
          style_profile_status: styleProfileResult.status || signal.style_profile_status || 'missing',
          style_profile_error: styleProfileResult.error || null,
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
          `✅ ${signal.trend_name} updated: $${avgPrice} | Heat: ${newHeat} | Evidence: ${mentionCount} | C:${scored.confidenceScore} S:${scored.sourcingScore} (${scored.grade}, ${scored.model})`
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
