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

// Fallback image logic removed per user request; only real extracted images are used.


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
  if (width && Number(width) > 0 && Number(width) < 120) return false;
  if (height && Number(height) > 0 && Number(height) < 120) return false;

  // Reject Unsplash placeholder images (zero tolerance for fallbacks)
  if (/unsplash\.com/i.test(url)) return false;

  // Reject Wikipedia / Wikimedia images and flags
  if (/wiki(?:pedia|media)\.org/i.test(url)) return false;

  // Reject Google News icons, favicons, branding, logos, gstatic
  if (/googleusercontent\.com|google\.com\/images|\.googleusercontent\.com|news\.google\.com|gstatic\.com/i.test(url)) return false;

  // Reject generic logos, banners, avatars, icons, badges, and flags
  if (/(?:^|[_\W])(?:logo|brand|icon|avatar|badge|flag|banner-ad|advert|favicon|apple-touch-icon)[_\W]/i.test(url)) return false;
  if (/(?:NewLogoCBK|ngxlogo|symbol-logo|Flag_of_)/i.test(url)) return false;

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

  const result = await fetchHtml(targetUrl);
  if (!result.ok || !result.html) {
    // Publisher unreachable or bot-blocked: search for alternative coverage & AI-score match
    const fallback = await findAndExtractFallbackCoverage({
      title: options.title,
      summary: options.summary,
      originalUrl: targetUrl,
      category: options.category,
      tickers: options.tickers,
      institutions: options.institutions,
    });
    if (fallback) {
      return {
        resolvedUrl: targetUrl,
        actualSourceName,
        contentHtml: fallback.contentHtml,
        imageUrl: fallback.imageUrl || null,
        fallbackUrl: fallback.fallbackUrl || null,
        fallbackSourceName: fallback.fallbackSourceName || null,
        byline: fallback.byline || null,
        wordCount: fallback.wordCount,
        readingTimeMinutes: fallback.readingTimeMinutes,
        status: fallback.status,
        textContent: fallback.textContent,
      };
    }
    const status = result.status;
    const richExcerpt = options.summary ? `<p class="lead">${sanitizeHtml(options.summary)}</p>` : null;
    return {
      resolvedUrl: targetUrl,
      actualSourceName,
      contentHtml: richExcerpt,
      imageUrl: null,
      fallbackUrl: null,
      fallbackSourceName: null,
      byline: null,
      wordCount: options.summary ? options.summary.split(/\s+/).length : 0,
      readingTimeMinutes: 1,
      status: status === 401 || status === 403 ? 'blocked' : 'excerpt_only',
      textContent: options.summary || null,
    };
  }

  const resolvedUrl = result.finalUrl || targetUrl;

  const imageUrl = extractImageFromHtml(result.html, resolvedUrl);

  let dom;
  try {
    dom = new JSDOM(result.html, { url: resolvedUrl, virtualConsole: extractionConsole });
  } catch {
    const fallback = await findAndExtractFallbackCoverage({
      title: options.title,
      summary: options.summary,
      originalUrl: resolvedUrl,
      category: options.category,
      tickers: options.tickers,
      institutions: options.institutions,
    });
    if (fallback) {
      return {
        resolvedUrl,
        actualSourceName,
        ...fallback,
      };
    }
    return {
      resolvedUrl,
      actualSourceName,
      contentHtml: options.summary ? `<p>${sanitizeHtml(options.summary)}</p>` : null,
      imageUrl,
      fallbackUrl: null,
      fallbackSourceName: null,
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
        fallbackUrl: null,
        fallbackSourceName: null,
        byline: null,
        wordCount: containerWords,
        readingTimeMinutes: Math.max(1, Math.round(containerWords / 220)),
        status: 'extracted',
        textContent: containerText,
        metaDescription: metaDesc || null,
      };
    }

    // Gated, paywalled, or blocked: search independent coverage & score with AI
    const fallback = await findAndExtractFallbackCoverage({
      title: options.title,
      summary: options.summary || metaDesc,
      originalUrl: resolvedUrl,
      category: options.category,
      tickers: options.tickers,
      institutions: options.institutions,
    });
    if (fallback) {
      return {
        resolvedUrl: targetUrl,
        actualSourceName,
        contentHtml: fallback.contentHtml,
        imageUrl: fallback.imageUrl || imageUrl,
        fallbackUrl: fallback.fallbackUrl || null,
        fallbackSourceName: fallback.fallbackSourceName || null,
        byline: fallback.byline || null,
        wordCount: fallback.wordCount,
        readingTimeMinutes: fallback.readingTimeMinutes,
        status: fallback.status,
        textContent: fallback.textContent,
      };
    }

    const bestSnippet = (metaDesc && metaDesc.length > 40 ? metaDesc : options.summary) || '';
    const cleanSnippetHtml = bestSnippet ? `<p class="lead">${sanitizeHtml(bestSnippet)}</p>` : null;

    return {
      resolvedUrl: targetUrl,
      actualSourceName,
      contentHtml: cleanSnippetHtml,
      imageUrl,
      fallbackUrl: null,
      fallbackSourceName: null,
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
    fallbackUrl: null,
    fallbackSourceName: null,
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

// ---------------------------------------------------------------------------
// RESILIENT AI-SCORED FALLBACK CRAWLER
// When an original publisher blocks scraping, crawl independent coverage of
// the exact headline/event from reputable news sources, use AI (Groq) to score
// whether a candidate reports on the same core news event, and replace the
// blocked source with the full, complete article content.
// ---------------------------------------------------------------------------

function cleanHeadlineForSearch(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let t = rawTitle.replace(/\s+[-|–—]\s+[^-|–—]+$/, '').trim(); // Remove publisher suffix
  t = t.replace(/^["']|["']$/g, '').trim();
  t = t.replace(/[^\w\s%.,-]/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

function plainTextToSafeHtml(text) {
  if (!text || typeof text !== 'string') return '';
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

async function scoreCandidateWithAI(targetTitle, targetSummary, candidateTitle, candidateSnippet) {
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) {
    try {
      const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
      const prompt = `Target Story Title: "${targetTitle}"
Target Excerpt: "${(targetSummary || '').slice(0, 300)}"

Candidate Article Title: "${candidateTitle}"
Candidate Article Excerpt: "${(candidateSnippet || '').slice(0, 450)}"

Does the candidate article report on the EXACT SAME core news event or transaction as the target story? (Wording and headline may vary, but the news event must be the same).
Return a JSON object only: {"match": true|false, "score": 0-100, "reason": "brief reason"}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          return {
            match: Boolean(parsed.match),
            score: typeof parsed.score === 'number' ? parsed.score : parsed.match ? 85 : 0,
            reason: parsed.reason || '',
          };
        }
      }
    } catch {
      // fallback to token/entity scoring
    }
  }

  // Fallback heuristic scoring: word / entity overlap
  const targetWords = new Set(
    `${targetTitle} ${targetSummary || ''}`
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['kenya', 'nairobi', 'about', 'after', 'before', 'their', 'which', 'market'].includes(w))
  );
  if (targetWords.size === 0) return { match: false, score: 0 };
  const candWords = `${candidateTitle} ${candidateSnippet || ''}`
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/);
  let hits = 0;
  for (const w of candWords) {
    if (targetWords.has(w)) hits++;
  }
  const ratio = hits / targetWords.size;
  const match = ratio >= 0.35;
  return { match, score: Math.round(ratio * 100), reason: 'heuristic overlap' };
}

async function synthesizeAccurateDispatch(title, summary, sourceName) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

  const prompt = `Title: ${title}
Source Context: ${sourceName || 'Wire Reports'}
Verified facts: ${summary}

Write a clean, professional, objective financial news dispatch in 2 to 3 substantive paragraphs based strictly on these verified facts. Do not invent unverified numbers or company statements. Output clean HTML paragraphs only (<p>...</p>).`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content && content.includes('<p>')) {
        return sanitizeHtml(content, SANITIZE_OPTIONS);
      } else if (content && content.trim().length > 60) {
        return plainTextToSafeHtml(content.trim());
      }
    }
  } catch {}
  return null;
}

async function findAndExtractFallbackCoverage(opts = {}) {
  const { title = '', summary = '', originalUrl = '', category, tickers = [], institutions = [] } = opts;
  const cleanTitle = cleanHeadlineForSearch(title);
  if (!cleanTitle) return null;

  let origHost = '';
  try {
    if (originalUrl) origHost = new URL(originalUrl).hostname.toLowerCase();
  } catch {}

  // 1. Search for independent coverage using exact clean title or keywords
  // Target known Kenyan business news sources for better results
  const kenyanSources = 'site:nation.africa OR site:the-star.co.ke OR site:standardmedia.co.ke OR site:capitalfm.co.ke OR site:kenyanwallstreet.com OR site:businesstoday.co.ke OR site:sokodirectory.com OR site:khusoko.com OR site:money254.co.ke OR site:dabafinance.com OR site:eastleighvoice.com OR site:businessdailyafrica.com';
  
  const queries = [
    `"${cleanTitle}"`,
    `${cleanTitle.slice(0, 75)} Kenya`,
    `${cleanTitle.slice(0, 60)} ${kenyanSources}`,
  ];

  let candidateResults = [];
  for (const q of queries) {
    const res = await webSearch(q, 8);
    if (res && res.length > 0) {
      candidateResults.push(...res);
      if (candidateResults.length >= 10) break;
    }
  }

  // Deduplicate and filter out unwanted domains
  const seenUrls = new Set();
  const filteredCandidates = [];
  for (const item of candidateResults) {
    if (!item?.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    try {
      const u = new URL(item.url);
      const host = u.hostname.toLowerCase();
      // Skip original blocked host
      if (origHost && (host === origHost || host.includes(origHost) || origHost.includes(host))) continue;
      // Skip search engines, wikipedia, social media, video platforms, scrapers
      if (/google|bing|duckduckgo|yahoo|wiki(?:pedia|media)|youtube|twitter|x\.com|facebook|instagram|linkedin|reddit|ground\.news/i.test(host)) continue;
      // Skip file downloads
      if (/\.(pdf|doc|docx|ppt|xls|xlsx)(\?|$)/i.test(u.pathname)) continue;
      filteredCandidates.push({ ...item, host });
    } catch {}
  }

  // 2. Fetch and score candidates
  let bestCandidate = null;
  let bestScore = 0;

  for (const cand of filteredCandidates.slice(0, 6)) {
    try {
      const r = await fetchHtml(cand.url, { timeoutMs: 8000, retries: 0 });
      if (!r.ok || !r.html) continue;

      let dom;
      try {
        dom = new JSDOM(r.html, { url: cand.url, virtualConsole: extractionConsole });
      } catch {
        continue;
      }

      const reader = new Readability(dom.window.document, { charThreshold: 80, keepClasses: false });
      let article;
      try {
        article = reader.parse();
      } catch {
        article = null;
      }

      const rawText = article?.textContent?.trim() || '';
      const words = rawText ? rawText.split(/\s+/).filter(Boolean).length : 0;
      if (words < 70) continue;

      // Score candidate using AI
      const scoreResult = await scoreCandidateWithAI(
        cleanTitle,
        summary,
        article.title || cand.title,
        rawText.slice(0, 500)
      );

      // Accept heuristic scores >= 50 as fallback when AI is unavailable
      const effectiveScore = scoreResult.score;
      const effectiveMatch = scoreResult.match || (effectiveScore >= 50 && !process.env.GROQ_API_KEY);

      if (effectiveMatch && effectiveScore >= 50 && effectiveScore > bestScore) {
        const cleanHtml = sanitizeHtml(article.content, SANITIZE_OPTIONS);
        const img = extractImageFromHtml(r.html, cand.url);
        const pubName = extractPublisherName(cand.url, article.title) || cand.host.replace(/^www\./, '');

        bestScore = effectiveScore;
        bestCandidate = {
          contentHtml: cleanHtml,
          imageUrl: isUsableImage(img) ? img : null,
          fallbackUrl: cand.url,
          fallbackSourceName: pubName,
          byline: article.byline || null,
          wordCount: words,
          readingTimeMinutes: Math.max(1, Math.round(words / 220)),
          status: 'fallback',
          textContent: rawText,
        };

        if (bestScore >= 80) break; // High-confidence match found!
      }
    } catch {
      // Continue to next candidate
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  // 3. Last resort: If no candidate matched or all failed, synthesize an accurate,
  // verified dispatch from the headline and RSS summary facts using Groq
  if (summary && summary.length >= 30) {
    const synthHtml = await synthesizeAccurateDispatch(cleanTitle, summary, origHost);
    if (synthHtml) {
      const textOnly = synthHtml.replace(/<[^>]+>/g, ' ').trim();
      const words = textOnly.split(/\s+/).filter(Boolean).length;
      return {
        contentHtml: synthHtml,
        imageUrl: null,
        fallbackUrl: null,
        fallbackSourceName: null,
        byline: null,
        wordCount: words,
        readingTimeMinutes: Math.max(1, Math.round(words / 220)),
        status: 'synthesized',
        textContent: textOnly,
      };
    }
  }

  return null;
}

// Backward-compatible alias
const searchAndCompileReport = findAndExtractFallbackCoverage;

module.exports = {
  TICKERS,
  INSTITUTIONS,
  extractTickers,
  extractInstitutions,
  extractPublisherName,
  cleanHeadlineForSearch,
  plainTextToSafeHtml,
  resolveUrl,
  isUsableImage,
  extractImageFromHtml,
  decodeGoogleNewsUrl,
  fetchHtml,
  extractFullArticle,
  webSearch,
  fetchPageSummary,
  fetchImageByKeyword,
  scoreCandidateWithAI,
  synthesizeAccurateDispatch,
  findAndExtractFallbackCoverage,
  searchAndCompileReport,
  BROWSER_HEADERS,
  SANITIZE_OPTIONS,
};
