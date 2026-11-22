const net = require('net');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const sanitizeHtml = require('sanitize-html');

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-KE,en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const extractionConsole = new VirtualConsole();
extractionConsole.on('jsdomError', (err) => {
  if (/Could not parse CSS stylesheet/i.test(err?.message || '')) return;
});

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'blockquote', 'cite',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'a', 'img', 'figure', 'figcaption', 'picture', 'source',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'hr', 'pre', 'code', 'sup', 'sub', 'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    source: ['srcset', 'type', 'media'],
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
    }),
    img: (tagName, attribs) => ({
      tagName: 'img',
      attribs: { ...attribs, loading: 'lazy' },
    }),
  },
  disallowedTagsMode: 'discard',
};

// ---------------------------------------------------------------------------
// REFERENCE DATA & CLASSIFICATION PATTERNS
// ---------------------------------------------------------------------------
const TICKERS = {
  SCOM: 'Safaricom PLC',
  KCB: 'KCB Group PLC',
  EQTY: 'Equity Group Holdings PLC',
  COOP: 'Co-operative Bank of Kenya PLC',
  EABL: 'East African Breweries PLC',
  KEGN: 'KenGen PLC',
  CTUM: 'Centum Investment Company PLC',
  KPLC: 'Kenya Power and Lighting PLC',
  KQ: 'Kenya Airways PLC',
  NCBA: 'NCBA Group PLC',
  ABSA: 'Absa Bank Kenya PLC',
  SCBK: 'Standard Chartered Kenya PLC',
  BAMB: 'Bamburi Cement PLC',
  SASN: 'Sasini PLC',
  KUKZ: 'Kakuzi PLC',
  BAT: 'BAT Kenya PLC',
};

const INSTITUTIONS = {
  CBK: 'Central Bank of Kenya',
  CMA: 'Capital Markets Authority',
  NSE: 'Nairobi Securities Exchange',
  CDSC: 'Central Depository and Settlement Corporation',
  TREASURY: 'The National Treasury',
};

const TICKER_PATTERNS = [
  { ticker: 'SCOM', regex: /\b(?:SCOM|Safaricom|M-Pesa|MPesa|Ziidi\s+Trader)\b/i },
  { ticker: 'EQTY', regex: /\b(?:EQTY|Equity\s+Group|Equity\s+Bank|James\s+Mwangi)\b/i },
  { ticker: 'KCB', regex: /\b(?:KCB|KCB\s+Group|Kenya\s+Commercial\s+Bank)\b/i },
  { ticker: 'COOP', regex: /\b(?:COOP|Co-?operative\s+Bank|Coop\s+Bank)\b/i },
  { ticker: 'EABL', regex: /\b(?:EABL|East\s+African\s+Breweries|Tusker)\b/i },
  { ticker: 'KEGN', regex: /\b(?:KEGN|KenGen|Kenya\s+Electricity\s+Generating)\b/i },
  { ticker: 'CTUM', regex: /\b(?:CTUM|Centum|Centum\s+Investment)\b/i },
  { ticker: 'KPLC', regex: /\b(?:KPLC|Kenya\s+Power)\b/i },
  { ticker: 'KQ', regex: /\b(?:KQ|Kenya\s+Airways)\b/ },
  { ticker: 'NCBA', regex: /\b(?:NCBA|NCBA\s+Group|NCBA\s+Bank)\b/i },
  { ticker: 'ABSA', regex: /\b(?:ABSA|Absa\s+Bank|Absa\s+Kenya)\b/i },
  { ticker: 'SCBK', regex: /\b(?:SCBK|Standard\s+Chartered|StanChart)\b/i },
  { ticker: 'BAMB', regex: /\b(?:BAMB|Bamburi|Bamburi\s+Cement)\b/i },
  { ticker: 'SASN', regex: /\b(?:SASN|Sasini)\b/i },
  { ticker: 'KUKZ', regex: /\b(?:KUKZ|Kakuzi)\b/i },
  { ticker: 'BAT', regex: /\b(?:BAT\s+Kenya|British\s+American\s+Tobacco|\bBAT\b)/ },
];

const INSTITUTION_PATTERNS = [
  { code: 'CBK', regex: /\b(?:CBK|Central\s+Bank\s+of\s+Kenya|Kamau\s+Thugge|Monetary\s+Policy\s+Committee|CBR)\b/i },
  { code: 'CMA', regex: /\b(?:CMA|Capital\s+Markets\s+Authority)\b/i },
  { code: 'NSE', regex: /\b(?:NSE|Nairobi\s+Securities\s+Exchange|Nairobi\s+Stock\s+Exchange|NASI|NSE\s+20)\b/ },
  { code: 'CDSC', regex: /\b(?:CDSC|Central\s+Depository\s+(?:and|&)\s+Settlement)\b/i },
  { code: 'TREASURY', regex: /\b(?:National\s+Treasury|The\s+Treasury|Treasury\s+Cabinet\s+Secretary|Exchequer)\b/i },
];

function extractTickers(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [];
  for (const { ticker, regex } of TICKER_PATTERNS) {
    if (regex.test(text)) matches.push(ticker);
  }
  return matches;
}

function extractInstitutions(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [];
  for (const { code, regex } of INSTITUTION_PATTERNS) {
    if (regex.test(text)) matches.push(code);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// PUBLISHER NAME EXTRACTION
// ---------------------------------------------------------------------------
const KNOWN_PUBLISHERS = {
  businessdailyafrica: 'Business Daily',
  kenyanwallstreet: 'The Kenyan Wall Street',
  businesstoday: 'Business Today Kenya',
  sokodirectory: 'Soko Directory',
  dabafinance: 'Daba Finance',
  eastleighvoice: 'The Eastleigh Voice',
  reuters: 'Reuters',
  bloomberg: 'Bloomberg',
  'the-star': 'The Star Kenya',
  standardmedia: 'The Standard',
  nation: 'Daily Nation',
  capitalfm: 'Capital FM Kenya',
  techweez: 'Techweez',
  cioafrica: 'CIO Africa',
  africabusinesscommunities: 'Africa Business Communities',
  dealroom: 'Dealroom',
  frontierafricareports: 'Frontier Africa Reports',
  apanews: 'APA News',
  businessday: 'BusinessDay',
  tradingview: 'TradingView',
  money254: 'Money254',
  khusoko: 'Khusoko',
  centralbank: 'Central Bank of Kenya',
  cma: 'Capital Markets Authority',
  nse: 'Nairobi Securities Exchange',
};

function extractPublisherName(resolvedUrl, originalTitle = '', originalSummary = '') {
  // 1. Check title suffix e.g. "Title Here - The Eastleigh Voice"
  if (originalTitle && typeof originalTitle === 'string') {
    const titleMatch = originalTitle.match(/\s+-\s+([^-]+)$/);
    if (titleMatch && titleMatch[1].trim()) {
      const pub = titleMatch[1].trim();
      if (!/google|feed|rss|news/i.test(pub)) return pub;
    }
  }

  // 2. Check summary suffix (often "Title \u00a0\u00a0Publisher")
  if (originalSummary && typeof originalSummary === 'string') {
    const summaryClean = originalSummary.replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ');
    const sumMatch = summaryClean.match(/(?:\s{2,}|\s-\s)([A-Z][A-Za-z0-9\s&.]{2,30})$/);
    if (sumMatch && sumMatch[1].trim()) {
      const pub = sumMatch[1].trim();
      if (!/google|feed|rss|news/i.test(pub)) return pub;
    }
  }

  // 3. Fallback to hostname matching
  if (resolvedUrl && typeof resolvedUrl === 'string' && !resolvedUrl.includes('news.google.com')) {
    try {
      const parsed = new URL(resolvedUrl);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      for (const [k, v] of Object.entries(KNOWN_PUBLISHERS)) {
        if (host.includes(k)) return v;
      }
      const parts = host.split('.');
      if (parts.length >= 2) {
        const brand = parts[0];
        return brand.charAt(0).toUpperCase() + brand.slice(1);
      }
    } catch {}
  }

  return null;
}

// ---------------------------------------------------------------------------
// FALLBACK IMAGES — Curated, high-availability Kenya Capital Markets Imagery
// ---------------------------------------------------------------------------
const FALLBACK_IMAGES = {
  // Tickers
  SCOM: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&q=80', // Fintech & telecom
  EQTY: 'https://images.unsplash.com/photo-1541354329998-f4d9a9f9297f?auto=format&fit=crop&w=1200&q=80', // Corporate banking towers
  KCB: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80', // Modern finance hub
  COOP: 'https://images.unsplash.com/photo-1541354329998-f4d9a9f9297f?auto=format&fit=crop&w=1200&q=80',
  EABL: 'https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=1200&q=80', // Beverage manufacturing
  KEGN: 'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1200&q=80', // Green renewable energy
  KPLC: 'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1200&q=80',
  KQ: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80', // Commercial aviation
  NCBA: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  ABSA: 'https://images.unsplash.com/photo-1541354329998-f4d9a9f9297f?auto=format&fit=crop&w=1200&q=80',
  SCBK: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  CTUM: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  BAMB: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=80', // Construction & cement
  BAT: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  SASN: 'https://images.unsplash.com/photo-1594489428504-5c0c480a15fd?auto=format&fit=crop&w=1200&q=80', // Agriculture & estate
  KUKZ: 'https://images.unsplash.com/photo-1594489428504-5c0c480a15fd?auto=format&fit=crop&w=1200&q=80',

  // Institutions
  NSE: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80', // Stock exchange floor
  CBK: 'https://images.unsplash.com/photo-1621981386829-9b458a2cddde?auto=format&fit=crop&w=1200&q=80', // Central bank & treasury bonds
  CMA: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&q=80', // Legal & regulatory
  CDSC: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80',
  TREASURY: 'https://images.unsplash.com/photo-1621981386829-9b458a2cddde?auto=format&fit=crop&w=1200&q=80',

  // Categories
  equity_markets: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80',
  fixed_income: 'https://images.unsplash.com/photo-1621981386829-9b458a2cddde?auto=format&fit=crop&w=1200&q=80',
  corporate_developments: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80',
  regulation_policy: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&q=80',
  private_markets: 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80',
  default: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80',
};

function getFallbackImage({ category, tickers, institutions } = {}) {
  const tickList = Array.isArray(tickers) ? tickers : [];
  for (const t of tickList) {
    if (FALLBACK_IMAGES[t]) return FALLBACK_IMAGES[t];
  }
  const instList = Array.isArray(institutions) ? institutions : [];
  for (const i of instList) {
    if (FALLBACK_IMAGES[i]) return FALLBACK_IMAGES[i];
  }
  if (category && FALLBACK_IMAGES[category]) {
    return FALLBACK_IMAGES[category];
  }
  return FALLBACK_IMAGES.default;
}

// ---------------------------------------------------------------------------
// URL & IMAGE HELPERS
// ---------------------------------------------------------------------------
function resolveUrl(raw, base) {
  if (!raw || typeof raw !== 'string') return null;
  let url = raw.trim().replace(/^['"]|['"]$/g, '');
  if (url.startsWith('//')) url = 'https:' + url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:/i.test(url)) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function isUsableImage(url, width, height) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.svg(\?|$)/i.test(url)) return false;
  if (/(?:^|\/)(?:spacer|pixel|blank|1x1|transparent|ad-pixel|beacon)[^/]*\.(?:gif|png)/i.test(url)) return false;
  if (width && Number(width) > 0 && Number(width) < 80) return false;
  if (height && Number(height) > 0 && Number(height) < 80) return false;
  return true;
}

function extractImageFromHtml(html, baseUrl) {
  if (!html || typeof html !== 'string') return null;

  let doc;
  try {
    const dom = new JSDOM(html, { url: baseUrl, virtualConsole: extractionConsole });
    doc = dom.window.document;
  } catch {
    return null;
  }

  // 1. OpenGraph & Twitter tags
  const metaChecks = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
    'link[rel="image_src"]',
  ];
  for (const sel of metaChecks) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const raw = el.getAttribute('content') || el.getAttribute('href') || el.getAttribute('src');
    const resolved = resolveUrl(raw, baseUrl);
    if (isUsableImage(resolved)) return resolved;
  }

  // 2. Schema.org JSON-LD
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      const text = s.textContent?.trim();
      if (!text) continue;
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        if (!item) continue;
        const img = item.image;
        if (typeof img === 'string') {
          const resolved = resolveUrl(img, baseUrl);
          if (isUsableImage(resolved)) return resolved;
        } else if (Array.isArray(img) && img.length > 0) {
          const first = typeof img[0] === 'string' ? img[0] : img[0]?.url;
          const resolved = resolveUrl(first, baseUrl);
          if (isUsableImage(resolved)) return resolved;
        } else if (img && typeof img.url === 'string') {
          const resolved = resolveUrl(img.url, baseUrl);
          if (isUsableImage(resolved)) return resolved;
        }
      }
    }
  } catch {
    // Ignore invalid JSON-LD
  }

  // 3. Scoped article body images
  const scopedSelectors = [
    'article img',
    'main img',
    '[role="main"] img',
    '.article-body img',
    '.story-body img',
    '.post-content img',
    '.entry-content img',
    '.content-body img',
  ];
  for (const sel of scopedSelectors) {
    const imgs = Array.from(doc.querySelectorAll(sel));
    const usable = imgs
      .map((img) => {
        const raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
        const url = resolveUrl(raw, baseUrl);
        const w = parseInt(img.getAttribute('width') || '0', 10) || 0;
        const h = parseInt(img.getAttribute('height') || '0', 10) || 0;
        return { url, area: w * h };
      })
      .filter((c) => isUsableImage(c.url));
    if (usable.length) {
      usable.sort((a, b) => b.area - a.area);
      return usable[0].url;
    }
  }

  // 4. Document-wide image scan as last resort
  const allImgs = Array.from(doc.querySelectorAll('img'));
  const usableAll = allImgs
    .map((img) => {
      const raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
      const url = resolveUrl(raw, baseUrl);
      const w = parseInt(img.getAttribute('width') || '0', 10) || 0;
      const h = parseInt(img.getAttribute('height') || '0', 10) || 0;
      return { url, area: w * h };
    })
    .filter((c) => isUsableImage(c.url));
  if (usableAll.length) {
    usableAll.sort((a, b) => b.area - a.area);
    return usableAll[0].url;
  }

  return null;
}

// ---------------------------------------------------------------------------
// GOOGLE NEWS RESOLVER — Resolves opaque Google News URLs to solid publisher posts
// ---------------------------------------------------------------------------
const GN_CONSENT_COOKIE = 'CONSENT=YES+cb.20240101-00-p0.en+FX+410';

async function decodeGoogleNewsUrl(url, timeoutMs = 8000) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('news.google.com')) return url;

  const m = /news\.google\.com\/(?:rss\/)?(?:articles|read)\/([^?#/]+)/.exec(url);
  if (!m) return url;
  const base64Str = m[1];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const pageRes = await fetch(`https://news.google.com/rss/articles/${base64Str}`, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: GN_CONSENT_COOKIE,
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!pageRes.ok) return url;
    const html = await pageRes.text();

    const sg = /data-n-a-sg="([^"]+)"/.exec(html);
    const ts = /data-n-a-ts="([^"]+)"/.exec(html);

    if (sg && ts) {
      const payload = [
        'Fbv4je',
        `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${ts[1]},"${sg[1]}"]`,
      ];
      const reqData = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

      const batchRes = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': BROWSER_HEADERS['User-Agent'],
          Origin: 'https://news.google.com',
          Referer: 'https://news.google.com/',
          Cookie: GN_CONSENT_COOKIE,
        },
        body: reqData,
        signal: controller.signal,
      });

      if (batchRes.ok) {
        const text = await batchRes.text();
        const splitParts = text.split('\n\n');
        for (const part of splitParts) {
          try {
            const parsedData = JSON.parse(part);
            if (Array.isArray(parsedData)) {
              for (const entry of parsedData) {
                if (Array.isArray(entry) && (entry[0] === 'wrb.fr' || entry[0] === 'w779db') && entry[1] === 'Fbv4je') {
                  const inner = JSON.parse(entry[2]);
                  if (inner && inner[1]) return inner[1];
                }
              }
            }
          } catch {}
        }
      }
    }

    // Fallback: check if the page has an external anchor tag or redirect link
    const linkMatch =
      /<c-wiz[^>]*>.*?<a[^>]+href="([^"]+)"/s.exec(html) ||
      /<a[^>]+href="([^"]+)"[^>]*>Your browser will redirect/i.exec(html) ||
      /data-n-au="([^"]+)"/.exec(html);
    if (linkMatch && !linkMatch[1].includes('google.com')) {
      return linkMatch[1];
    }

    return url;
  } catch (err) {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// HTML FETCH & FULL ARTICLE EXTRACTION
// ---------------------------------------------------------------------------
async function fetchHtml(url, { timeoutMs = 15000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = { ok: false, status: res.status, html: null };
        if (attempt === retries) return lastError;
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      const html = await res.text();
      return { ok: true, status: res.status, html, finalUrl: res.url || url };
    } catch (err) {
      lastError = { ok: false, status: 0, html: null, error: err.message };
      if (attempt === retries) return lastError;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return lastError || { ok: false, status: 0, html: null };
}

function countRealParagraphs(html) {
  if (!html || typeof html !== 'string') return 0;
  let doc;
  try {
    const dom = new JSDOM(html, { url: 'https://x', virtualConsole: extractionConsole });
    doc = dom.window.document;
  } catch {
    return 0;
  }
  let count = 0;
  for (const p of doc.querySelectorAll('p')) {
    const t = p.textContent ? p.textContent.trim() : '';
    if (t.length >= 40) count += 1;
  }
  return count;
}

async function extractFullArticle(url, options = {}) {
  // If this is a Google News URL, resolve to solid publisher post first!
  const targetUrl = url.includes('news.google.com') ? await decodeGoogleNewsUrl(url) : url;
  const actualSourceName = extractPublisherName(targetUrl, options.title, options.summary);

  const fallbackImg = getFallbackImage(options);

  const result = await fetchHtml(targetUrl);
  if (!result.ok || !result.html) {
    // Publisher unreachable or bot-blocked: compile a report from independent coverage
    const compiled = await searchAndCompileReport({
      title: options.title,
      summary: options.summary,
      category: options.category,
      tickers: options.tickers,
      institutions: options.institutions,
    });
    if (compiled) {
      return {
        resolvedUrl: targetUrl,
        actualSourceName,
        contentHtml: compiled.html,
        imageUrl: compiled.imageUrl || fallbackImg,
        byline: null,
        wordCount: compiled.wordCount,
        readingTimeMinutes: Math.max(1, Math.round(compiled.wordCount / 220)),
        status: 'compiled',
        textContent: compiled.textContent,
        sources: compiled.sources,
      };
    }
    const status = result.status;
    const richExcerpt = options.summary ? `<p>${sanitizeHtml(options.summary)}</p>` : null;
    return {
      resolvedUrl: targetUrl,
      actualSourceName,
      contentHtml: richExcerpt,
      imageUrl: fallbackImg,
      byline: null,
      wordCount: options.summary ? options.summary.split(/\s+/).length : 0,
      readingTimeMinutes: 1,
      status: status === 401 || status === 403 ? 'blocked' : 'excerpt_only',
      textContent: options.summary || null,
    };
  }

  const resolvedUrl = result.finalUrl || targetUrl;

  const imageUrl = extractImageFromHtml(result.html, resolvedUrl) || fallbackImg;

  let dom;
  try {
    dom = new JSDOM(result.html, { url: resolvedUrl, virtualConsole: extractionConsole });
  } catch {
    return {
      resolvedUrl,
      actualSourceName,
      contentHtml: options.summary ? `<p>${sanitizeHtml(options.summary)}</p>` : null,
      imageUrl,
      byline: null,
      wordCount: 0,
      readingTimeMinutes: 1,
      status: 'excerpt_only',
      textContent: options.summary || null,
    };
  }

  const doc = dom.window.document;

  // Extract meta description in case the article body is short, gated, or paywalled
  const metaDesc =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content')?.trim() ||
    '';

  const reader = new Readability(doc, {
    charThreshold: 100,
    keepClasses: false,
  });

  let article;
  try {
    article = reader.parse();
  } catch {
    article = null;
  }

  const rawText = article?.textContent?.trim() || '';
  const words = rawText ? rawText.split(/\s+/).filter(Boolean).length : 0;
  const articleParagraphs = article && article.content ? countRealParagraphs(article.content) : 0;

  // Check if article content has sufficient substantive paragraphs
  const isSubstantive = Boolean(article && article.content) && words >= 60 && articleParagraphs >= 2;

  if (!isSubstantive) {
    // Attempt fallback to main container
    const container =
      doc.querySelector('article') ||
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector('.post-content') ||
      doc.querySelector('.entry-content') ||
      doc.querySelector('.article-body');

    const containerText = container?.textContent?.trim() || '';
    const containerWords = containerText ? containerText.split(/\s+/).filter(Boolean).length : 0;
    const containerParagraphs = container ? countRealParagraphs(container.innerHTML) : 0;

    if (container && containerWords >= 80 && containerParagraphs >= 2) {
      const cleanHtml = sanitizeHtml(container.innerHTML, SANITIZE_OPTIONS);
      return {
        resolvedUrl,
        actualSourceName,
        contentHtml: cleanHtml,
        imageUrl,
        byline: null,
        wordCount: containerWords,
        readingTimeMinutes: Math.max(1, Math.round(containerWords / 220)),
        status: 'extracted',
        textContent: containerText,
        metaDescription: metaDesc || null,
      };
    }

    // If gated, paywalled, or excerpt only, compile a full report from independent
    // coverage before falling back to a meta-description excerpt.
    const compiled = await searchAndCompileReport({
      title: options.title,
      summary: options.summary,
      category: options.category,
      tickers: options.tickers,
      institutions: options.institutions,
    });
    if (compiled) {
      return {
        resolvedUrl: targetUrl,
        actualSourceName,
        contentHtml: compiled.html,
        imageUrl: compiled.imageUrl || imageUrl,
        byline: null,
        wordCount: compiled.wordCount,
        readingTimeMinutes: Math.max(1, Math.round(compiled.wordCount / 220)),
        status: 'compiled',
        textContent: compiled.textContent,
        sources: compiled.sources,
      };
    }
    // If gated, paywalled, or excerpt only, provide the meta description or RSS summary formatted as paragraph
    const bestSnippet = (metaDesc && metaDesc.length > 40 ? metaDesc : options.summary) || '';
    const cleanSnippetHtml = bestSnippet ? `<p class="lead">${sanitizeHtml(bestSnippet)}</p>` : null;

    return {
      resolvedUrl: targetUrl,
      actualSourceName,
      contentHtml: cleanSnippetHtml,
      imageUrl,
      byline: article?.byline || null,
      wordCount: bestSnippet ? bestSnippet.split(/\s+/).length : 0,
      readingTimeMinutes: 1,
      status: 'paywalled',
      textContent: bestSnippet || null,
      metaDescription: metaDesc || null,
    };
  }

  const cleanHtml = sanitizeHtml(article.content, SANITIZE_OPTIONS);
  const wordCount = words;
  const readingTime = Math.max(1, Math.round(wordCount / 220));

  return {
    resolvedUrl: targetUrl,
    actualSourceName,
    contentHtml: cleanHtml,
    imageUrl,
    byline: article.byline || null,
    wordCount,
    readingTimeMinutes: readingTime,
    status: 'extracted',
    textContent: article.textContent.trim(),
    metaDescription: metaDesc || null,
  };
}

// ---------------------------------------------------------------------------
// RESILIENT FALLBACK: paywalled / bot-blocked / excerpt-only articles
// When the publisher does not expose the full text, crawl independent
// coverage via Bing search, extract verifiable facts with source links,
// and compile a complete report. Images come from the source page's og:image
// or a keyword-based image search so reports blend in authentically.
// ---------------------------------------------------------------------------

function decodeDuckDuckGoUrl(href) {
  if (!href) return null;
  try {
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {
    // ignore
  }
  return href;
}

function decodeBingUrl(href) {
  if (!href) return null;
  try {
    const m = href.match(/[?&]u=a1([^&]+)/);
    if (m) {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (decoded.startsWith('http')) return decoded;
    }
  } catch {
    // ignore
  }
  return href;
}

async function fetchSearchPage(url) {
  const r = await fetchHtml(url, { retries: 1, timeoutMs: 15000 });
  if (!r.ok || !r.html) return null;
  let dom;
  try {
    dom = new JSDOM(r.html, { url, virtualConsole: extractionConsole });
  } catch {
    return null;
  }
  return dom;
}

async function webSearch(query, limit = 6) {
  const engines = [
    // DuckDuckGo HTML (primary)
    () => fetchSearchPage('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)),
    // Bing with Kenya market (fallback)
    () => fetchSearchPage('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&mkt=en-KE&setlang=en-US&cc=KE&count=' + limit),
  ];
  for (const engine of engines) {
    let dom;
    try {
      dom = await engine();
    } catch {
      continue;
    }
    if (!dom) continue;
    const doc = dom.window.document;
    const results = [];
    // DuckDuckGo result anchors
    for (const a of doc.querySelectorAll('a.result__a')) {
      const href = decodeDuckDuckGoUrl(a.getAttribute('href'));
      const title = a.textContent ? a.textContent.trim() : '';
      if (href && title) results.push({ url: href, title });
      if (results.length >= limit) break;
    }
    if (results.length > 0) return results;
    // Bing result anchors
    for (const li of doc.querySelectorAll('li.b_algo')) {
      const a = li.querySelector('h2 a');
      if (!a) continue;
      const href = decodeBingUrl(a.getAttribute('href'));
      const title = a.textContent ? a.textContent.trim() : '';
      if (href && title) results.push({ url: href, title });
      if (results.length >= limit) break;
    }
    if (results.length > 0) return results;
  }
  return [];
}

async function fetchPageSummary(url) {
  const r = await fetchHtml(url, { retries: 1, timeoutMs: 15000 });
  if (!r.ok || !r.html) return null;
  let dom;
  try {
    dom = new JSDOM(r.html, { url, virtualConsole: extractionConsole });
  } catch {
    return null;
  }
  const doc = dom.window.document;
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') || '';
  let article;
  try {
    article = new Readability(doc, { charThreshold: 80, keepClasses: false }).parse();
  } catch {
    article = null;
  }
  const text = (article && article.textContent ? article.textContent.trim() : '') ||
    (doc.body ? doc.body.textContent.trim() : '');
  return {
    url,
    title: (article && article.title ? article.title : doc.title) || '',
    ogImage: resolveUrl(ogImage, url) || null,
    text,
  };
}

async function fetchImageByKeyword(keywords) {
  if (!keywords) return null;
  const kw = String(keywords).split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  if (!kw) return null;

  // Strategy 1: Search for the article directly and extract its og:image
  const articleQuery = kw + ' site:nation.africa OR site:the-star.co.ke OR site:standardmedia.co.ke OR site:capitalfm.co.ke OR site:kenyanwallstreet.com OR site:businesstoday.co.ke';
  let results = await webSearch(articleQuery, 8);
  
  for (const res of results) {
    try {
      const pg = await fetchPageSummary(res.url);
      if (pg && pg.ogImage && isUsableImage(pg.ogImage)) {
        return pg.ogImage;
      }
    } catch {
      // continue to next result
    }
  }

  // Strategy 2: General keyword image search
  const query = kw + ' image';
  results = await webSearch(query, 6);
  for (const res of results) {
    const u = res.url || '';
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u) && isUsableImage(u)) return u;
  }

  // Strategy 3: DuckDuckGo lite image results
  try {
    const ddg = await fetchHtml('https://duckduckgo.com/html/?q=' + encodeURIComponent(kw + ' image') + '&iax=images&ia=images', { retries: 1, timeoutMs: 10000 });
    if (ddg.ok && ddg.html) {
      const m = ddg.html.match(/<img[^>]+src="([^"]+)"[^>]*>/gi);
      if (m) {
        for (const tag of m) {
          const sm = tag.match(/src="([^"]+)"/);
          if (sm && isUsableImage(sm[1])) return sm[1];
        }
      }
    }
  } catch {
    // ignore, graceful fallback
  }
  return null;
}

async function searchAndCompileReport(opts = {}) {
  const { title, summary, category, tickers = [], institutions = [] } = opts;

  // Build comprehensive search query using title + key entities for full text retrieval
  // Use quoted title for exact phrase matching + key entities
  const keyEntities = [...tickers, ...institutions].filter(Boolean);
  const searchTerms = [`"${title}"`, ...keyEntities, 'Kenya'].filter(Boolean);
  const query = searchTerms.join(' ');

  const results = await webSearch(query, 10);
  const crawled = [];

  for (const res of results) {
    try {
      const pg = await fetchPageSummary(res.url);
      if (pg && pg.text && pg.text.length > 200 && pg.url) {
        const host = new URL(pg.url).hostname;
        // Skip search engines and low-value aggregators only
        // Don't skip businessdailyafrica - try to fetch it, it might work
        if (/bing\.com|duckduckgo|ground\.news|news\.google\.com/i.test(host)) continue;
        crawled.push({ ...res, ...pg, host });
      }
    } catch {
      // Ignore individual crawl failures
    }
    if (crawled.length >= 5) break;
  }

  // Require at least 1 independent source for verification (customer retention priority)
  // Even one alternative source is better than empty content
  if (crawled.length < 1) return null;

  // Deduplicate by host to ensure independent sources
  const uniqueHosts = new Map();
  for (const c of crawled) {
    if (!uniqueHosts.has(c.host)) uniqueHosts.set(c.host, c);
  }
  const independentSources = Array.from(uniqueHosts.values());

  // Image: prefer first source's og:image, then keyword search as fallback ONLY when original fails
  let imageUrl = independentSources[0].ogImage || null;
  if (!imageUrl) {
    const kw = [tickers[0], institutions[0], title, category].filter(Boolean).join(' ');
    imageUrl = await fetchImageByKeyword(kw) || null;
  }

  // Compile comprehensive full-text report by stitching together content from multiple sources
  const parts = independentSources.map((c, idx) => {
    const sourceLabel = idx === 0 ? 'Primary Coverage' : `Additional Coverage ${idx}`;
    return `
      <section class="report-source" style="margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid #e5e7eb;${idx === independentSources.length - 1 ? 'border-bottom:none;padding-bottom:0' : ''};">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
          <span style="font-size:0.75rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">${sanitizeHtml(sourceLabel)}</span>
          <span style="font-size:0.75rem;color:#9ca3af;">·</span>
          <a href="${sanitizeHtml(c.url)}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem;color:#FF4D1C;text-decoration:none;">${sanitizeHtml(c.host)} &rarr;</a>
        </div>
        <h4 style="margin:0 0 0.5rem;font-size:1.05rem;font-weight:600;color:#111315;">${sanitizeHtml(c.title || '')}</h4>
        <div style="line-height:1.7;color:#374151;font-size:0.95rem;">${sanitizeHtml((c.text || '').slice(0, 2500))}</div>
      </section>
    `;
  }).join('');

  const reportHtml = `
    <div class="compiled-report" style="border:1px solid #e5e7eb;border-radius:0.75rem;padding:1.25rem;background:#fafafa;">
      <div style="font-size:0.8rem;color:#6b7280;margin:0 0 1rem;padding-bottom:0.75rem;border-bottom:1px solid #e5e7eb;">
        <strong>Full Report Compiled from ${independentSources.length} Independent Kenyan Business Source${independentSources.length > 1 ? 's' : ''}</strong>
        <br>The original publisher's full text is behind a paywall or bot-protection. This report assembles verified coverage from independent sources to provide complete context without leaving this platform.
      </div>
      ${parts}
      <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #e5e7eb;font-size:0.75rem;color:#9ca3af;">
        Sources: ${independentSources.map(s => sanitizeHtml(s.host)).join(', ')} · All content attributed to respective publishers.
      </div>
    </div>
  `;

  const combinedText = independentSources.map((c) => c.title + ' ' + c.text).join(' ');

  return {
    html: reportHtml,
    imageUrl,
    textContent: combinedText,
    wordCount: combinedText ? combinedText.split(/\s+/).filter(Boolean).length : 0,
    sources: independentSources.map((c) => c.host),
  };
}

module.exports = {
  TICKERS,
  INSTITUTIONS,
  extractTickers,
  extractInstitutions,
  extractPublisherName,
  getFallbackImage,
  resolveUrl,
  isUsableImage,
  extractImageFromHtml,
  decodeGoogleNewsUrl,
  fetchHtml,
  extractFullArticle,
  webSearch,
  fetchPageSummary,
  fetchImageByKeyword,
  searchAndCompileReport,
  BROWSER_HEADERS,
  SANITIZE_OPTIONS,
};
