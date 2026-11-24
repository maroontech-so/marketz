/**
 * FinCapita — Kenya Capital Markets Intelligence Platform
 * Multi-source RSS aggregation with full-text extraction, SQLite persistence,
 * copyright-aware rewriting via Groq, and per-feed health tracking.
 */
const net = require('net');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

require('dotenv').config();
const express = require('express');
const Parser = require('rss-parser');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const sanitizeHtml = require('sanitize-html');
const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const {
  TICKERS,
  INSTITUTIONS,
  extractTickers,
  extractInstitutions,
  extractPublisherName,
  decodeGoogleNewsUrl,
  extractFullArticle,
  extractImageFromHtml,
  resolveUrl,
  isUsableImage,
  SANITIZE_OPTIONS,
  BROWSER_HEADERS,
} = require('./lib/extract');

const {
  buildVectorIndex,
  retrieveContext,
  answerQuestion,
  analyzeTrends,
  getMarketPosition,
  getInstitutionCoverage,
  getStats,
  initVectorTable,
} = require('./lib/cleo-rag');

const { chatCompletion, discoverBestModel, getSelectedModel, resetModelCache } = require('./lib/groq-client');

// ---------------------------------------------------------------------------
// DATABASE
// ---------------------------------------------------------------------------
const db = new Database(path.join(__dirname, 'fincapita.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    feed_url TEXT,
    tier INTEGER NOT NULL,
    rights TEXT NOT NULL,
    default_category TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    source_slug TEXT NOT NULL,
    source_name TEXT NOT NULL,
    tier INTEGER NOT NULL,
    rights TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,
    published_at TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    original_url TEXT NOT NULL UNIQUE,
    tickers TEXT NOT NULL DEFAULT '[]',
    institutions TEXT NOT NULL DEFAULT '[]',
    image_url TEXT,
    content_hash TEXT NOT NULL,
    FOREIGN KEY (source_slug) REFERENCES sources(slug)
  );

  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
`);

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('articles', 'content_html', 'TEXT');
addColumnIfMissing('articles', 'byline', 'TEXT');
addColumnIfMissing('articles', 'word_count', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('articles', 'reading_time_minutes', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('articles', 'full_text_status', "TEXT NOT NULL DEFAULT 'pending'");
addColumnIfMissing('articles', 'rewritten_html', 'TEXT');
addColumnIfMissing('articles', 'rewrite_method', 'TEXT');
addColumnIfMissing('articles', 'resolved_url', 'TEXT');
addColumnIfMissing('articles', 'actual_source_name', 'TEXT');
addColumnIfMissing('articles', 'compiled_sources', 'TEXT');
addColumnIfMissing('articles', 'fallback_url', 'TEXT');
addColumnIfMissing('articles', 'fallback_source_name', 'TEXT');

// Publishers routinely ship malformed CSS; jsdom logs a "Could not parse CSS
// stylesheet" jsdomError for each one. That floods the terminal without
// affecting extraction. Filter them out entirely.
const extractionConsole = new VirtualConsole();
extractionConsole.on('jsdomError', (err) => {
  if (/Could not parse CSS stylesheet/i.test(err?.message || '')) return;
});

const CATEGORY_KEYWORDS = {
  fixed_income: ['treasury', 't-bill', 'tbill', 'bond', 'auction', 'yield', 'coupon', 'infrastructure bond', 'fixed income'],
  regulation_policy: ['cma', 'cbk', 'regulator', 'circular', 'licence', 'license', 'enforcement', 'capital markets authority', 'policy'],
  corporate_developments: ['dividend', 'profit', 'results', 'earnings', 'rights issue', 'ipo', 'acquisition', 'merger', 'board', 'appointment'],
  equity_markets: ['nse', 'stock', 'share', 'equity', 'index', 'nasi', 'trading', 'investor'],
  private_markets: ['private equity', 'venture capital', 'fundraising', 'pe fund'],
};

// ---------------------------------------------------------------------------
// CAPITAL-MARKETS GATE
// ---------------------------------------------------------------------------
const CAPITAL_MARKETS_TERMS = [
  'nairobi securities exchange', 'nse', 'nasi', 'nse 20', 'nse all share',
  'capital markets authority', 'cma', 'cdsc', 'central depository',
  'capital markets', 'capital market',
  'central bank of kenya', 'cbk', 'monetary policy', 'central bank rate',
  'treasury bill', 'treasury bills', 't-bill', 't-bills', 'tbill', 'tbills',
  'treasury bond', 'treasury bonds', 'infrastructure bond', 'corporate bond',
  'fixed income', 'commercial paper', 'money market fund',
  'collective investment scheme', 'unit trust',
  'dividend', 'dividends', 'interim dividend', 'final dividend',
  'book closure', 'ex-dividend', 'rights issue', 'profit warning',
  'trading statement', 'earnings release', 'earnings call',
  'initial public offering', 'ipo', 'listing on nse', 'delisting',
  'takeover bid', 'share buyback', 'share split', 'bonus issue',
  'financial results', 'half year results', 'full year results',
  'annual results', 'interim results', 'profit after tax', 'net profit',
  'profit before tax', 'gross profit',
  'market capitalisation', 'market capitalization', 'nse turnover',
  'foreign investor', 'market turnover', 'share price', 'stock price',
  'bull market', 'bear market', 'equity market', 'bond market',
  'stock exchange', 'stock market',
  'stockbroker', 'stockbroking', 'fund manager', 'fund management',
  'pension fund', 'pension scheme',
];

const CAPITAL_MARKETS_TERMS_RE = new RegExp(
  '\\b(?:' + CAPITAL_MARKETS_TERMS
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') + ')\\b',
  'i'
);

const TICKER_RE = /\b(?:SCOM|KCB|EQTY|COOP|EABL|KEGN|CTUM|KPLC|NCBA|ABSA|SCBK|BAMB|SASN|KUKZ|BAT|KQ)\b/;

function isCapitalMarketsArticle(title, summary, sourceSlug) {
  if (sourceSlug && sourceSlug.startsWith('gnews-')) return true;
  const text = `${title || ''} ${summary || ''}`;
  if (!text.trim()) return false;
  return (
    CAPITAL_MARKETS_TERMS_RE.test(text) ||
    TICKER_RE.test(text) ||
    extractTickers(text).length > 0 ||
    extractInstitutions(text).length > 0
  );
}

// ---------------------------------------------------------------------------
// SOURCES
// ---------------------------------------------------------------------------
const SOURCES = [
  { slug: 'cbk', name: 'Central Bank of Kenya', feedUrl: 'https://www.centralbank.go.ke/feed/', tier: 1, rights: 'official_disclosure', defaultCategory: 'fixed_income' },
  { slug: 'cma', name: 'Capital Markets Authority', feedUrl: 'https://www.cma.or.ke/feed/', tier: 1, rights: 'official_disclosure', defaultCategory: 'regulation_policy' },
  { slug: 'nse-african-markets', name: 'NSE Announcements (via African Markets)', feedUrl: 'https://staging.african-markets.com/en/stock-markets/nse/publications?format=feed&type=rss', tier: 1, rights: 'official_disclosure', defaultCategory: 'equity_markets' },
  { slug: 'kenyan-wall-street', name: 'The Kenyan Wall Street', feedUrl: 'https://kenyanwallstreet.com/feed/', tier: 2, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'business-daily', name: 'Business Daily', feedUrl: 'https://www.businessdailyafrica.com/bd/rss.xml', tier: 2, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'business-today', name: 'Business Today Kenya', feedUrl: 'https://businesstoday.co.ke/feed/', tier: 2, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'soko-directory', name: 'Soko Directory', feedUrl: 'https://sokodirectory.com/feed/', tier: 3, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'khusoko', name: 'Khusoko', feedUrl: 'https://khusoko.com/feed/', tier: 3, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'money254', name: 'Money254', feedUrl: 'https://money254.co.ke/feed/', tier: 3, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'gnews-capital-markets', name: 'Google News · NSE & Capital Markets', feedUrl: 'https://news.google.com/rss/search?q=%22Nairobi+Securities+Exchange%22+OR+%22NSE+Kenya%22+when:14d&hl=en-KE&gl=KE&ceid=KE:en', tier: 2, rights: 'summary_permitted', defaultCategory: 'equity_markets' },
  { slug: 'gnews-dividends', name: 'Google News · NSE Dividends', feedUrl: 'https://news.google.com/rss/search?q=%22interim+dividend%22+OR+%22final+dividend%22+OR+%22profit+warning%22+OR+%22trading+statement%22+Kenya+when:14d&hl=en-KE&gl=KE&ceid=KE:en', tier: 2, rights: 'summary_permitted', defaultCategory: 'corporate_developments' },
  { slug: 'gnews-ipo', name: 'Google News · Kenya IPO & Listing', feedUrl: 'https://news.google.com/rss/search?q=Kenya+%22IPO%22+OR+%22rights+issue%22+OR+%22new+listing%22+NSE+when:30d&hl=en-KE&gl=KE&ceid=KE:en', tier: 2, rights: 'summary_permitted', defaultCategory: 'corporate_developments' },
  { slug: 'gnews-treasury', name: 'Google News · Kenya Treasury', feedUrl: 'https://news.google.com/rss/search?q=%22treasury+bill%22+Kenya+OR+%22treasury+bond%22+Kenya+OR+%22CBK+auction%22+when:14d&hl=en-KE&gl=KE&ceid=KE:en', tier: 2, rights: 'summary_permitted', defaultCategory: 'fixed_income' },
  { slug: 'gnews-regulation', name: 'Google News · CMA Kenya', feedUrl: 'https://news.google.com/rss/search?q=%22Capital+Markets+Authority%22+Kenya+OR+%22CMA+Kenya%22+when:30d&hl=en-KE&gl=KE&ceid=KE:en', tier: 2, rights: 'summary_permitted', defaultCategory: 'regulation_policy' },
  { slug: 'gnews-private-equity', name: 'Google News · Kenya PE/VC', feedUrl: 'https://news.google.com/rss/search?q=%22private+equity%22+Kenya+OR+%22venture+capital%22+Kenya+when:30d&hl=en-KE&gl=KE&ceid=KE:en', tier: 3, rights: 'summary_permitted', defaultCategory: 'private_markets' },
];

// ---------------------------------------------------------------------------
// RSS PARSER
// ---------------------------------------------------------------------------
const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; FinCapita/1.0; +https://fincapita.local)',
    'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'fullContent'],
    ],
  },
});

// ---------------------------------------------------------------------------
// CONCURRENCY LIMITER (p-limit replacement)
// ---------------------------------------------------------------------------
function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];
  function next() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  }
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

// ---------------------------------------------------------------------------
// GROQ CLIENT — token-bucket + retry with backoff
// ---------------------------------------------------------------------------
const GROQ_LIMITS = { rpm: 30, tpm: 8000, dailyTokens: 200000, dailyRequests: 1000 };

const groqState = {
  windowStart: Date.now(),
  tokensInWindow: 0,
  requestsInWindow: 0,
  dayStart: new Date().setHours(0, 0, 0, 0),
  tokensToday: 0,
  requestsToday: 0,
};

function groqEstimateTokens(text) {
  return Math.ceil((text || '').length / 3.5);
}

async function groqWaitForCapacity(estimatedTokens) {
  const now = Date.now();
  if (now - groqState.dayStart > 24 * 60 * 60 * 1000) {
    groqState.dayStart = new Date().setHours(0, 0, 0, 0);
    groqState.tokensToday = 0;
    groqState.requestsToday = 0;
  }
  if (now - groqState.windowStart >= 60_000) {
    groqState.windowStart = now;
    groqState.tokensInWindow = 0;
    groqState.requestsInWindow = 0;
  }
  if (groqState.requestsToday >= GROQ_LIMITS.dailyRequests ||
      groqState.tokensToday >= GROQ_LIMITS.dailyTokens) {
    throw new Error('GROQ_DAILY_CAP');
  }
  const wouldOverflowTokens = groqState.tokensInWindow + estimatedTokens > GROQ_LIMITS.tpm;
  const wouldOverflowRequests = groqState.requestsInWindow + 1 > GROQ_LIMITS.rpm;
  if (wouldOverflowTokens || wouldOverflowRequests) {
    const waitMs = 60_000 - (now - groqState.windowStart) + 250;
    console.log(`[groq] throttling ${waitMs}ms (${groqState.tokensInWindow}/${GROQ_LIMITS.tpm} TPM used)`);
    await new Promise((r) => setTimeout(r, waitMs));
    return groqWaitForCapacity(estimatedTokens);
  }
}

function groqRecordUsage(estimatedTokens) {
  groqState.tokensInWindow += estimatedTokens;
  groqState.requestsInWindow += 1;
  groqState.tokensToday += estimatedTokens;
  groqState.requestsToday += 1;
}

async function withGroqRetry(operation, maxAttempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const status = err.status || 0;
      const isRetryable = status === 429 || status >= 500 || status === 0;
      if (!isRetryable) throw err;
      if (attempt === maxAttempts - 1) throw err;
      let delayMs;
      if (err.retryAfterMs) delayMs = Math.min(err.retryAfterMs, 5000);
      else delayMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 5000);
      console.log(`[groq] retry ${attempt + 1}/${maxAttempts} in ${Math.round(delayMs)}ms (status ${status})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function classify(title, summary, fallback) {
  const text = `${title} ${summary}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => text.includes(k))) return cat;
  }
  return fallback || 'equity_markets';
}

function heuristicImportance(tier, title) {
  let score = tier === 1 ? 70 : 50;
  const t = title.toLowerCase();
  if (/dividend|profit warning|results|rights issue|ipo|takeover/.test(t)) score += 15;
  if (/auction|t-bill|yield|circular/.test(t)) score += 10;
  return Math.min(score, 95);
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function extractImage(item, articleUrl, feedUrl) {
  const base = articleUrl || feedUrl || undefined;
  const candidates = [];

  const mediaNodes = Array.isArray(item.mediaContent) ? item.mediaContent : item.mediaContent ? [item.mediaContent] : [];
  for (const node of mediaNodes) {
    const attrs = node?.$ || node || {};
    const url = resolveUrl(attrs.url || attrs.href, base);
    const width = Number(attrs.width) || 0;
    const height = Number(attrs.height) || 0;
    if (isUsableImage(url, width, height)) candidates.push({ url, area: width * height });
  }

  const thumbNodes = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : item.mediaThumbnail ? [item.mediaThumbnail] : [];
  for (const node of thumbNodes) {
    const attrs = node?.$ || node || {};
    const url = resolveUrl(attrs.url || attrs.href, base);
    if (isUsableImage(url, Number(attrs.width) || 0, Number(attrs.height) || 0)) candidates.push({ url, area: 0 });
  }

  if (item.enclosure?.url) {
    const url = resolveUrl(item.enclosure.url, base);
    const type = (item.enclosure.type || '').toLowerCase();
    if (url && (type.startsWith('image/') || isUsableImage(url))) candidates.push({ url, area: 0 });
  }

  const htmlSources = [item.fullContent, item['content:encoded'], item.content, item.summary, item.description]
    .filter((s) => typeof s === 'string' && s.length > 0);
  for (const html of htmlSources) {
    const imgRe = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRe.exec(html)) !== null) {
      const url = resolveUrl(match[1], base);
      if (isUsableImage(url)) candidates.push({ url, area: 0 });
    }
    if (candidates.length) break;
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0].url;
}

// ---------------------------------------------------------------------------
// TEXT HELPERS FOR REWRITE
// ---------------------------------------------------------------------------
const REWRITE_KEYWORDS = [
  'market', 'investor', 'dividend', 'bond', 'stock', 'share', 'equity',
  'nse', 'cma', 'cbk', 'capital', 'auction', 'yield', 'profit', 'earnings',
  'percent', 'billion', 'million', 'listing', 'ipo', 'rights issue',
];

function extractiveSummary(article, maxSentences = 6) {
  const raw = (article.textContent || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const sentences = raw.match(/[^.!?]+[.!?]+/g) || [raw];
  if (sentences.length <= maxSentences) return sentences.join(' ').trim();
  const scored = sentences.map((s, i) => {
    const lower = s.toLowerCase();
    const hits = REWRITE_KEYWORDS.filter((k) => lower.includes(k)).length;
    const position = i < 3 ? 2 : i < 6 ? 1 : 0;
    const length = s.trim().length > 40 && s.trim().length < 320 ? 1 : 0;
    return { text: s.trim(), index: i, score: hits * 2 + position + length };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, maxSentences);
  top.sort((a, b) => a.index - b.index);
  return top.map((x) => x.text).join(' ');
}

function plainTextToSafeHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => {
      const safe = p.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
      return safe ? `<p>${safe}</p>` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function llmRewrite(text, sourceName) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GROQ_MODEL || 'mixtral-8x7b-32768';
  const reasoningEffort = process.env.GROQ_REASONING_EFFORT || 'low';
  const baseUrl = 'https://api.groq.com/openai/v1';

  const system = `You are a wire-service editor. Rewrite the article below in 3-5 short factual paragraphs of neutral prose. Preserve every name, number, date, and quoted phrase exactly. Do not add facts not present in the original. Output plain text only.`;

  const userPrompt = `Source: ${sourceName}\n\n${text.slice(0, 3000)}`;
  const estimated = groqEstimateTokens(system) + groqEstimateTokens(userPrompt) + 600;

  try {
    await groqWaitForCapacity(estimated);
    const data = await withGroqRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.2,
            max_completion_tokens: 600,
            reasoning_effort: reasoningEffort,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const err = new Error(`groq ${res.status}: ${errText.slice(0, 160)}`);
          err.status = res.status;
          const ra = res.headers.get('retry-after');
          if (ra) err.retryAfterMs = parseInt(ra, 10) * 1000;
          throw err;
        }
        return res.json();
      } catch (e) {
        if (e.name === 'AbortError') {
          const err = new Error('groq timeout');
          err.status = 0;
          throw err;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    });
    groqRecordUsage(estimated);
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
    if (!content || content.trim().length < 80) return null;
    return { html: plainTextToSafeHtml(content.trim()), method: `llm:${model}` };
  } catch (err) {
    if (err.message === 'GROQ_DAILY_CAP') {
      console.warn('[groq] daily cap reached — falling back to extractive for the rest of this run');
    } else {
      console.warn('[groq]', err.message);
    }
    return null;
  }
}

async function rewriteContent(article, rights, sourceName) {
  if (rights === 'official_disclosure' || rights === 'licensed_full_text') {
    return { html: null, method: null };
  }
  if (rights === 'metadata_only' || rights === 'blocked' || rights === 'paywalled') {
    return { html: null, method: null };
  }
  const plain = (article.textContent || '').trim();
  if (plain.length < 250) return { html: null, method: null };
  const llm = await llmRewrite(plain, sourceName);
  if (llm) return llm;
  const summary = extractiveSummary(article, 6);
  if (!summary) return { html: null, method: null };
  return { html: plainTextToSafeHtml(summary), method: 'extractive' };
}

// ---------------------------------------------------------------------------
// EXTRACTION PIPELINE & PERSISTENT QUEUE
// ---------------------------------------------------------------------------
const EXTRACT_CONCURRENCY = createLimiter(4);

async function extractAndStore(row) {
  const sourceSlug = row.source_slug;
  const source = SOURCES.find((s) => s.slug === sourceSlug) || { rights: row.rights, name: row.source_name };
  const tickers = (row.tickers && row.tickers !== '[]')
    ? JSON.parse(row.tickers)
    : extractTickers(`${row.title} ${row.summary || ''}`);
  const institutions = (row.institutions && row.institutions !== '[]')
    ? JSON.parse(row.institutions)
    : extractInstitutions(`${row.title} ${row.summary || ''}`);

  const extracted = await extractFullArticle(row.original_url, {
    title: row.title,
    summary: row.summary,
    category: row.category,
    tickers,
    institutions,
  });

  let rewrite = { html: null, method: null };
  if (extracted.textContent && source.rights === 'summary_permitted') {
    try {
      rewrite = await rewriteContent(
        { textContent: extracted.textContent },
        source.rights,
        extracted.actualSourceName || source.name
      );
    } catch {
      // keep null
    }
  }

  const finalImg = extracted.imageUrl || row.image_url || null;
  const finalSummary = (extracted.metaDescription && (!row.summary || row.summary.length < 50))
    ? extracted.metaDescription
    : row.summary;

  // Guarantee content_html is never null: fall back to the verified summary/excerpt
  const finalHtml = extracted.contentHtml || (finalSummary ? `<p class="lead">${sanitizeHtml(finalSummary)}</p>` : null);

  const compiledSources = extracted.sources ? JSON.stringify(extracted.sources) : null;

  db.prepare(`
    UPDATE articles
       SET content_html = ?,
           rewritten_html = ?,
           rewrite_method = ?,
           byline = ?,
           word_count = ?,
           reading_time_minutes = ?,
           full_text_status = ?,
           image_url = ?,
           resolved_url = ?,
           actual_source_name = ?,
           summary = COALESCE(?, summary),
           tickers = ?,
           institutions = ?,
           compiled_sources = ?,
           fallback_url = ?,
           fallback_source_name = ?
     WHERE id = ?
  `).run(
    finalHtml,
    rewrite.html,
    rewrite.method,
    extracted.byline,
    extracted.wordCount,
    extracted.readingTimeMinutes,
    extracted.status,
    finalImg,
    extracted.resolvedUrl || row.original_url,
    extracted.actualSourceName || row.source_name,
    finalSummary,
    JSON.stringify(tickers),
    JSON.stringify(institutions),
    compiledSources,
    extracted.fallbackUrl || null,
    extracted.fallbackSourceName || null,
    row.id
  );
}

let isExtracting = false;
async function processExtractionQueue(batchSize = 25) {
  if (isExtracting) return;
  isExtracting = true;
  try {
    const rows = db.prepare(`
      SELECT * FROM articles
       WHERE full_text_status = 'pending'
          OR content_html IS NULL
          OR image_url IS NULL
          OR image_url = ''
       ORDER BY published_at DESC
       LIMIT ?
    `).all(batchSize);

    if (rows.length === 0) return;
    console.log(`[queue] Processing ${rows.length} articles for full extraction & image resolution...`);

    await Promise.allSettled(
      rows.map((row) =>
        EXTRACT_CONCURRENCY(async () => {
          try {
            await extractAndStore(row);
          } catch (e) {
            console.warn(`[queue] ${row.source_slug} (${row.id}): ${e.message}`);
          }
        })
      )
    );
  } catch (err) {
    console.warn(`[queue] error: ${err.message}`);
  } finally {
    isExtracting = false;
  }
}

// ---------------------------------------------------------------------------
// API SHAPE
// ---------------------------------------------------------------------------
function rowToApi(row) {
  const category = row.category || 'equity_markets';
  const tickers = (row.tickers && row.tickers !== '[]')
    ? JSON.parse(row.tickers)
    : extractTickers(`${row.title} ${row.summary || ''}`);
  const institutions = (row.institutions && row.institutions !== '[]')
    ? JSON.parse(row.institutions)
    : extractInstitutions(`${row.title} ${row.summary || ''}`);
  const imageUrl = row.image_url || null;
  const realUrl = row.resolved_url || row.original_url;
  const compiledSources = row.compiled_sources ? JSON.parse(row.compiled_sources) : null;
  const isFallback = row.full_text_status === 'fallback';
  const displayUrl = isFallback && row.fallback_url ? row.fallback_url : realUrl;
  const displaySourceName = isFallback && row.fallback_source_name ? row.fallback_source_name : (row.actual_source_name || row.source_name);

  return {
    id: row.id,
    title: row.title,
    sourceName: displaySourceName,
    sourceTier: row.tier,
    category: row.category,
    publishedAt: row.published_at,
    collectedAt: row.collected_at,
    relativeTime: relativeTime(row.published_at),
    summary: row.summary,
    contentHtml: row.content_html || null,
    rewrittenHtml: row.rewritten_html || null,
    rewriteMethod: row.rewrite_method || null,
    byline: row.byline || null,
    wordCount: row.word_count || 0,
    readingTimeMinutes: row.reading_time_minutes || 0,
    fullTextStatus: row.full_text_status || 'pending',
    tickers,
    institutions,
    imageUrl,
    originalUrl: realUrl,
    resolvedUrl: realUrl,
    sourceUrl: displayUrl,
    feedUrl: row.original_url,
    importance: heuristicImportance(row.tier, row.title),
    contentAccess: row.rights,
    sources: compiledSources,
    fallbackUrl: row.fallback_url || null,
    fallbackSourceName: row.fallback_source_name || null,
  };
}

// ---------------------------------------------------------------------------
// SOURCE HEALTH
// ---------------------------------------------------------------------------
function upsertSource(source, feedUrl, enabled) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT slug FROM sources WHERE slug = ?').get(source.slug);
  if (!existing) {
    db.prepare(`INSERT INTO sources (slug, name, feed_url, tier, rights, default_category, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(source.slug, source.name, feedUrl, source.tier, source.rights, source.defaultCategory, enabled ? 1 : 0, now);
  } else {
    db.prepare(`UPDATE sources SET feed_url = ?, enabled = ?, updated_at = ? WHERE slug = ?`).run(feedUrl, enabled ? 1 : 0, now, source.slug);
  }
}

function recordSuccess(slug) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE sources SET last_success_at = ?, last_error = NULL, consecutive_failures = 0, updated_at = ? WHERE slug = ?`).run(now, now, slug);
}

function recordFailure(slug, message) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE sources SET last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ? WHERE slug = ?`).run(message.slice(0, 400), now, slug);
}

// ---------------------------------------------------------------------------
// INGESTION
// ---------------------------------------------------------------------------
async function ingestSource(source) {
  let feed;
  try {
    feed = await parser.parseURL(source.feedUrl);
  } catch (err) {
    upsertSource(source, source.feedUrl, false);
    recordFailure(source.slug, err.message || '(no message)');
    return { slug: source.slug, ingested: 0, ok: false, error: err.message || '(no message)' };
  }

  if (!feed.items || feed.items.length === 0) {
    recordFailure(source.slug, 'feed returned zero items');
    return { slug: source.slug, ingested: 0, ok: false, error: 'zero items' };
  }

  upsertSource(source, source.feedUrl, true);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles (
      id, source_slug, source_name, tier, rights, title, summary, category,
      published_at, collected_at, original_url, tickers, institutions, image_url, content_hash,
      resolved_url, actual_source_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const collectedAt = new Date().toISOString();
  let inserted = 0;

  for (const item of feed.items) {
    const title = (item.title || '').trim();
    const rawUrl = item.link || '';
    if (!title || !rawUrl) continue;

    const isGNews = /news\.google\.com\/(?:rss\/)?(?:articles|read)/.test(rawUrl);
    const cleanTitle = isGNews ? title.replace(/\s+-\s+[^-]+$/, '').trim() : title;

    const rssSummary = (item.contentSnippet || item.summary || item.description || '')
      .replace(/<[^>]+>/g, '').trim().slice(0, 1500);

    if (!isCapitalMarketsArticle(cleanTitle, rssSummary, source.slug)) continue;

    const publishedAt = item.isoDate || item.pubDate || collectedAt;
    const category = classify(cleanTitle, rssSummary, source.defaultCategory);
    const tickers = extractTickers(`${cleanTitle} ${rssSummary}`);
    const institutions = extractInstitutions(`${cleanTitle} ${rssSummary}`);
    const contentHash = sha256(rawUrl);

    // Initial image from feed extraction only — no fallbacks
    const initialImg = extractImage(item, rawUrl, source.feedUrl);
    const initialPublisher = extractPublisherName(rawUrl, title, rssSummary) || source.name;

    const result = insert.run(
      crypto.randomUUID(), source.slug, source.name, source.tier, source.rights,
      cleanTitle, rssSummary || null, category,
      new Date(publishedAt).toISOString(), collectedAt, rawUrl,
      JSON.stringify(tickers), JSON.stringify(institutions),
      initialImg, contentHash,
      rawUrl, initialPublisher
    );

    if (result.changes === 1) {
      inserted += 1;
    }
  }

  recordSuccess(source.slug);

  // Trigger background extraction queue (non-blocking)
  processExtractionQueue().catch((e) => console.warn(`[queue] trigger error: ${e.message}`));

  return { slug: source.slug, ingested: inserted, ok: true };
}

async function ingestAll() {
  const results = [];
  for (const source of SOURCES) {
    results.push(await ingestSource(source));
  }
  return results;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function handleNews(req, res) {
  const limit = Math.min(Number(req.query.limit) || 24, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { category, ticker, institution, q } = req.query;
  const clauses = ['1=1'];
  const params = [];

  if (category && category !== 'all') { clauses.push('category = ?'); params.push(category); }
  if (ticker) { clauses.push('tickers LIKE ?'); params.push(`%"${ticker.toUpperCase()}"%`); }
  if (institution) { clauses.push('institutions LIKE ?'); params.push(`%"${institution.toUpperCase()}"%`); }
  if (q) {
    clauses.push('(title LIKE ? OR summary LIKE ? OR source_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE ${clauses.join(' AND ')}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM articles WHERE ${clauses.join(' AND ')} ORDER BY published_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ total, returned: rows.length, limit, offset, generatedAt: new Date().toISOString(), articles: rows.map(rowToApi) });
}
app.get('/api/news', handleNews);
app.get('/api/v1/news', handleNews);

function handleCompany(req, res) {
  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!TICKERS[ticker]) return res.status(404).json({ error: 'Unknown ticker', ticker });
  const rows = db.prepare(`SELECT * FROM articles WHERE tickers LIKE ? ORDER BY published_at DESC LIMIT 100`).all(`%"${ticker}"%`);
  res.json({ ticker, name: TICKERS[ticker], articleCount: rows.length, articles: rows.map(rowToApi) });
}
app.get('/api/companies/:ticker', handleCompany);
app.get('/api/v1/companies/:ticker', handleCompany);

function handleInstitution(req, res) {
  const code = String(req.params.code || '').toUpperCase();
  if (!INSTITUTIONS[code]) return res.status(404).json({ error: 'Unknown institution', code });
  const rows = db.prepare(`SELECT * FROM articles WHERE institutions LIKE ? ORDER BY published_at DESC LIMIT 100`).all(`%"${code}"%`);
  res.json({ code, name: INSTITUTIONS[code], articleCount: rows.length, articles: rows.map(rowToApi) });
}
app.get('/api/institutions/:code', handleInstitution);
app.get('/api/v1/institutions/:code', handleInstitution);

function handleSources(req, res) {
  const rows = db.prepare('SELECT * FROM sources ORDER BY tier, name').all();
  res.json({
    sources: rows.map((r) => ({
      slug: r.slug, name: r.name, tier: r.tier, rights: r.rights,
      enabled: r.enabled === 1, feedUrl: r.feed_url,
      lastSuccessAt: r.last_success_at, lastError: r.last_error,
      consecutiveFailures: r.consecutive_failures,
    })),
  });
}
app.get('/api/sources', handleSources);
app.get('/api/v1/sources', handleSources);

// ---------------------------------------------------------------------------
// SINGLE ARTICLE ENDPOINT — dedicated article page data source
// ---------------------------------------------------------------------------
function handleArticle(req, res) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Missing article id' });
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Article not found', id });
  res.json({ article: rowToApi(row) });
}
app.get('/api/article/:id', handleArticle);
app.get('/api/v1/article/:id', handleArticle);

function handleHealth(req, res) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM articles').get().c;
  const latest = db.prepare('SELECT MAX(published_at) AS p FROM articles').get().p;
  const enabled = db.prepare('SELECT COUNT(*) AS c FROM sources WHERE enabled = 1').get().c;
  const withFullText = db.prepare("SELECT COUNT(*) AS c FROM articles WHERE full_text_status = 'extracted'").get().c;
  const withRewrite = db.prepare("SELECT COUNT(*) AS c FROM articles WHERE rewritten_html IS NOT NULL").get().c;
  res.json({ ok: true, articleCount: total, latestArticleAt: latest, enabledSources: enabled, fullTextArticles: withFullText, rewrittenArticles: withRewrite });
}
app.get('/api/health', handleHealth);
app.get('/api/v1/health', handleHealth);

function handleMarkets(req, res) {
  res.status(501).json({
    available: false,
    reason: 'No licensed market-data feed is configured. NSE prices and CBK auction yields require a data licence or a maintained scraper against the official pages.',
    officialSources: [
      { name: 'Nairobi Securities Exchange', url: 'https://www.nse.co.ke' },
      { name: 'Central Bank of Kenya — Bills & Bonds', url: 'https://www.centralbank.go.ke/bills-bonds/' },
      { name: 'Capital Markets Authority', url: 'https://www.cma.or.ke' },
    ],
  });
}
app.get('/api/markets', handleMarkets);
app.get('/api/v1/markets', handleMarkets);

app.post('/api/v1/ingest', async (_req, res) => {
  const results = await ingestAll();
  res.json({ ranAt: new Date().toISOString(), results });
});

// ---------------------------------------------------------------------------
// CLEO AI CHATBOT ENDPOINTS
// ---------------------------------------------------------------------------
let cleoIndexBuilt = false;

async function ensureCleoIndex() {
  if (!cleoIndexBuilt) {
    await buildVectorIndex();
    cleoIndexBuilt = true;
  }
}

function handleCleoChat(req, res) {
  const { question, options = {} } = req.body;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  (async () => {
    try {
      await ensureCleoIndex();
      const { prompt, sources, scores, context } = await answerQuestion(question.trim(), {
        topK: options.topK || 8,
        category: options.category,
        ticker: options.ticker?.toUpperCase(),
        institution: options.institution?.toUpperCase(),
        since: options.since,
        until: options.until,
      });

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AI service not configured', context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name, url: s.resolved_url || s.original_url, score: scores.shift() })) });
      }

      try {
        const answer = await chatCompletion(apiKey, [
          { role: 'system', content: 'You are Cleo, an expert Kenya capital markets intelligence analyst. Answer questions using ONLY the provided context. Cite sources inline like [Source 1]. Be precise with KES, NSE, CBK, CMA terminology.' },
          { role: 'user', content: prompt },
        ], { temperature: 0.2, maxTokens: 1500 });

        res.json({
          answer,
          model: getSelectedModel() || 'auto',
          sources: sources.map((s, i) => ({
            id: s.id,
            title: s.title,
            source: s.source_name,
            category: s.category,
            publishedAt: s.published_at,
            url: s.resolved_url || s.original_url,
            relevanceScore: Math.round((scores[i] || 0) * 100),
          })),
          question,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[cleo] Chat error:', err.message);
        // If API key is invalid or no working model, return context and sources so user can still read relevant articles
        if (err.message.includes('401') || err.message.includes('Invalid API Key') || err.message.includes('invalid_api_key') || err.message.includes('No working model')) {
          return res.json({
            answer: 'AI service unavailable. Here are the most relevant articles I found for your question:',
            model: 'fallback',
            sources: sources.map((s, i) => ({
              id: s.id,
              title: s.title,
              source: s.source_name,
              category: s.category,
              publishedAt: s.published_at,
              url: s.resolved_url || s.original_url,
              relevanceScore: Math.round((scores[i] || 0) * 100),
            })),
            question,
            timestamp: new Date().toISOString(),
            fallback: true,
          });
        }
        res.status(500).json({ error: 'Failed to generate answer', details: err.message, context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }
    } catch (err) {
      console.error('[cleo] Retrieval error:', err.message);
      res.status(500).json({ error: 'Failed to retrieve context', details: err.message });
    }
  })();
}

function handleCleoTrends(req, res) {
  const { days = 30, category, ticker, institution } = req.query;

  (async () => {
    try {
      await ensureCleoIndex();
      const { prompt, sources, context } = await analyzeTrends({
        days: Number(days),
        category,
        ticker: ticker?.toUpperCase(),
        institution: institution?.toUpperCase(),
      });

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AI service not configured', context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }

      try {
        const analysis = await chatCompletion(apiKey, [
          { role: 'system', content: 'You are Cleo, a Kenya capital markets analyst. Provide structured trend analysis with cited sources.' },
          { role: 'user', content: prompt },
        ], { temperature: 0.3, maxTokens: 2000 });

        res.json({
          analysis,
          periodDays: Number(days),
          filters: { category, ticker, institution },
          sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name, url: s.resolved_url || s.original_url })),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to generate trends', details: err.message, context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve trends context', details: err.message });
    }
  })();
}

function handleCleoCompany(req, res) {
  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!TICKERS[ticker]) return res.status(404).json({ error: 'Unknown ticker', ticker });

  (async () => {
    try {
      await ensureCleoIndex();
      const { prompt, sources, context } = await getMarketPosition(ticker);

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AI service not configured', context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }

      try {
        const analysis = await chatCompletion(apiKey, [
          { role: 'system', content: `You are Cleo, analyzing ${TICKERS[ticker]} (${ticker}) market position. Provide structured analysis with cited sources.` },
          { role: 'user', content: prompt },
        ], { temperature: 0.3, maxTokens: 2000 });

        res.json({
          ticker,
          name: TICKERS[ticker],
          analysis,
          sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name, url: s.resolved_url || s.original_url })),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to generate company analysis', details: err.message, context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve company context', details: err.message });
    }
  })();
}

function handleCleoInstitution(req, res) {
  const code = String(req.params.code || '').toUpperCase();
  if (!INSTITUTIONS[code]) return res.status(404).json({ error: 'Unknown institution', code });

  (async () => {
    try {
      await ensureCleoIndex();
      const { prompt, sources, context } = await getInstitutionCoverage(code);

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AI service not configured', context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }

      try {
        const analysis = await chatCompletion(apiKey, [
          { role: 'system', content: `You are Cleo, summarizing ${INSTITUTIONS[code]} (${code}) recent actions. Provide structured summary with cited sources.` },
          { role: 'user', content: prompt },
        ], { temperature: 0.3, maxTokens: 2000 });

        res.json({
          code,
          name: INSTITUTIONS[code],
          analysis,
          sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name, url: s.resolved_url || s.original_url })),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to generate institution analysis', details: err.message, context, sources: sources.map(s => ({ id: s.id, title: s.title, source: s.source_name })) });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve institution context', details: err.message });
    }
  })();
}

function handleCleoStats(req, res) {
  try {
    const stats = getStats();
    res.json({ ...stats, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
}

function handleCleoRebuildIndex(req, res) {
  (async () => {
    try {
      cleoIndexBuilt = false;
      const count = await buildVectorIndex();
      res.json({ success: true, articlesIndexed: count, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to rebuild index', details: err.message });
    }
  })();
}

app.post('/api/cleo/chat', handleCleoChat);
app.post('/api/v1/cleo/chat', handleCleoChat);
app.get('/api/cleo/trends', handleCleoTrends);
app.get('/api/v1/cleo/trends', handleCleoTrends);
app.get('/api/cleo/company/:ticker', handleCleoCompany);
app.get('/api/v1/cleo/company/:ticker', handleCleoCompany);
app.get('/api/cleo/institution/:code', handleCleoInstitution);
app.get('/api/v1/cleo/institution/:code', handleCleoInstitution);
app.get('/api/cleo/stats', handleCleoStats);
app.get('/api/v1/cleo/stats', handleCleoStats);
app.post('/api/cleo/rebuild-index', handleCleoRebuildIndex);
app.post('/api/v1/cleo/rebuild-index', handleCleoRebuildIndex);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// BOOT & PROCESS LIFECYCLE
// ---------------------------------------------------------------------------
(async () => {
  // One-shot cleanup: purge anything in the existing DB that fails the
  // capital-markets gate. Idempotent — no-op once the DB is clean.
  {
    const allRows = db.prepare('SELECT id, title, summary, source_slug FROM articles').all();
    const toDelete = allRows.filter((r) => !isCapitalMarketsArticle(r.title, r.summary, r.source_slug));
    if (toDelete.length) {
      const del = db.prepare('DELETE FROM articles WHERE id = ?');
      const tx = db.transaction((rows) => { for (const r of rows) del.run(r.id); });
      tx(toDelete);
      console.log(`[cleanup] purged ${toDelete.length} non-capital-markets rows`);
    }
  }

  console.log('[boot] running initial ingest...');
  const results = await ingestAll();
  for (const r of results) {
    if (r.ok) console.log(`[boot] ${r.slug}: ${r.ingested} new`);
    else console.warn(`[boot] ${r.slug}: DISABLED — ${r.error}`);
  }

  // Immediately start processing any pending / unextracted articles in background
  processExtractionQueue().catch((e) => console.warn(`[boot-queue] ${e.message}`));

  // Build Cleo vector index in background
  buildVectorIndex().then(() => { cleoIndexBuilt = true; console.log('[cleo] Vector index ready'); }).catch((e) => console.warn(`[cleo] Index build failed: ${e.message}`));

  // Ingest RSS feeds every 10 minutes
  setInterval(() => {
    ingestAll().catch((e) => console.error('[cron]', e.message));
  }, 10 * 60 * 1000);

  // Background queue worker runs every 45 seconds to continuously process pending/unextracted articles
  setInterval(() => {
    processExtractionQueue().catch((e) => console.error('[queue-cron]', e.message));
  }, 45 * 1000);

  const server = app.listen(PORT, () => {
    console.log(`FinCapita listening on :${PORT}`);
  });

  function gracefulShutdown() {
    console.log('[shutdown] shutting down gracefully...');
    server.close(() => {
      try { db.close(); } catch {}
      process.exit(0);
    });
  }
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
})();
