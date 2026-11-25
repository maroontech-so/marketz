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

const TICKER_SECTORS = {
  SCOM: 'Telecommunications',
  KCB: 'Banking',
  EQTY: 'Banking',
  COOP: 'Banking',
  EABL: 'Manufacturing & Allied',
  KEGN: 'Energy & Petroleum',
  CTUM: 'Investment',
  KPLC: 'Energy & Petroleum',
  KQ: 'Transport',
  NCBA: 'Banking',
  ABSA: 'Banking',
  SCBK: 'Banking',
  BAMB: 'Construction',
  SASN: 'Agricultural',
  KUKZ: 'Agricultural',
  BAT: 'Manufacturing',
};

const INSTITUTION_DETAILS = {
  CBK: { role: 'Monetary Authority & Debt Agent', website: 'https://www.centralbank.go.ke' },
  CMA: { role: 'Capital Markets Regulator', website: 'https://www.cma.or.ke' },
  NSE: { role: 'Securities Exchange', website: 'https://www.nse.co.ke' },
  CDSC: { role: 'Clearing & Settlement Depository', website: 'https://cdsckenya.com' },
  TREASURY: { role: 'Fiscal & Public Debt Authority', website: 'https://www.treasury.go.ke' },
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

function imageDimension(value) {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

function isUsableImage(url, width, height) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.svg(\?|$)/i.test(url)) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (/(?:^|\.)(?:doubleclick\.net|google-analytics\.com|googlesyndication\.com)$/i.test(parsed.hostname) || /facebook\.com\/tr\b/i.test(parsed.hostname + parsed.pathname)) return false;
  if (/(?:^|[/_.-])(?:spacer|pixel|blank|1x1|transparent|ad-pixel|beacon|placeholder|default|fallback|no-image|missing-image|loading)(?:[/_.-]|$)/i.test(parsed.pathname)) return false;
  if (/(?:^|[?&])(?:pixel|beacon|tracking|impression|analytics)(?:[=_&]|$)/i.test(parsed.search)) return false;

  const resolvedWidth = imageDimension(width) || imageDimension(parsed.searchParams.get('w')) || imageDimension(parsed.searchParams.get('width'));
  const resolvedHeight = imageDimension(height) || imageDimension(parsed.searchParams.get('h')) || imageDimension(parsed.searchParams.get('height'));
  if ((resolvedWidth && resolvedWidth < 120) || (resolvedHeight && resolvedHeight < 120)) return false;

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

function imageSrcsetCandidates(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = part.match(/^(\S+)(?:\s+(.+))?$/);
    if (!match) return null;
    const width = match[2]?.match(/(?:^|\s)(\d+(?:\.\d+)?)w(?:\s|$)/);
    return { raw: match[1], width: width ? imageDimension(width[1]) : null };
  }).filter(Boolean);
}

function imageCandidates(rawSources, rawSrcsets, baseUrl, fallbackWidth = null, fallbackHeight = null) {
  const candidates = [];
  const add = (raw, width = null, height = null) => {
    const url = resolveUrl(raw, baseUrl);
    if (url) candidates.push({ url, width: width || fallbackWidth, height: height || fallbackHeight });
  };
  for (const raw of rawSources) add(raw);
  for (const rawSrcset of rawSrcsets) {
    for (const candidate of imageSrcsetCandidates(rawSrcset)) add(candidate.raw, candidate.width);
  }
  return candidates;
}

function bestUsableImage(candidates) {
  const usable = candidates.filter((candidate) => isUsableImage(candidate.url, candidate.width, candidate.height));
  if (!usable.length) return null;
  const rank = (candidate) => [
    candidate.width || candidate.height ? 1 : 0,
    candidate.width && candidate.height ? candidate.width * candidate.height : 0,
    candidate.width || 0,
    candidate.height || 0,
  ];
  usable.sort((left, right) => {
    for (let index = 0; index < rank(left).length; index += 1) {
      const difference = rank(right)[index] - rank(left)[index];
      if (difference) return difference;
    }
    return 0;
  });
  return usable[0].url;
}

function imageElementCandidates(img, baseUrl) {
  const style = img.getAttribute('style') || '';
  const width = imageDimension(img.getAttribute('data-width')) || imageDimension(img.getAttribute('width')) ||
    imageDimension(style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)px/i)?.[1]);
  const height = imageDimension(img.getAttribute('data-height')) || imageDimension(img.getAttribute('height')) ||
    imageDimension(style.match(/(?:^|;)\s*height\s*:\s*([\d.]+)px/i)?.[1]);
  const rawSources = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy-original', 'data-url', 'data-hi-res-src', 'src']
    .map((attribute) => img.getAttribute(attribute));
  const rawSrcsets = ['data-srcset', 'data-lazy-srcset', 'srcset'].map((attribute) => img.getAttribute(attribute));
  const picture = img.closest('picture');
  if (picture) {
    for (const source of picture.querySelectorAll('source')) {
      rawSrcsets.push(source.getAttribute('data-srcset'), source.getAttribute('srcset'));
    }
  }
  return imageCandidates(rawSources, rawSrcsets, baseUrl, width, height);
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
  const metaWidth = imageDimension(doc.querySelector('meta[property="og:image:width"]')?.getAttribute('content'));
  const metaHeight = imageDimension(doc.querySelector('meta[property="og:image:height"]')?.getAttribute('content'));
  for (const sel of metaChecks) {
    const candidates = Array.from(doc.querySelectorAll(sel)).flatMap((el) => {
      const raw = el.getAttribute('content') || el.getAttribute('href') || el.getAttribute('src');
      return imageCandidates([raw], [el.getAttribute('srcset')], baseUrl, metaWidth, metaHeight);
    });
    const best = bestUsableImage(candidates);
    if (best) return best;
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
        const images = Array.isArray(item.image) ? item.image : [item.image];
        for (const image of images) {
          const raw = typeof image === 'string' ? image : image?.url || image?.contentUrl;
          const best = bestUsableImage(imageCandidates([raw], [], baseUrl, imageDimension(image?.width), imageDimension(image?.height)));
          if (best) return best;
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
    const candidates = Array.from(doc.querySelectorAll(sel)).flatMap((img) => imageElementCandidates(img, baseUrl));
    const best = bestUsableImage(candidates);
    if (best) return best;
  }

  // 4. Document-wide image scan as last resort
  const candidates = Array.from(doc.querySelectorAll('img')).flatMap((img) => imageElementCandidates(img, baseUrl));
  return bestUsableImage(candidates);
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

function hasExplicitPaywall(doc) {
  const accessible = doc.querySelector('meta[property="article:is_accessible_for_free"]')?.getAttribute('content')?.trim().toLowerCase();
  if (accessible === 'false') return true;
  const contentTier = doc.querySelector('meta[property="article:content_tier"], meta[name="content-tier"]')?.getAttribute('content')?.trim().toLowerCase();
  if (['premium', 'paid', 'subscriber', 'subscribers'].includes(contentTier)) return true;
  if (doc.querySelector('meta[name="paywall"][content="true" i], [data-paywall]:not([data-paywall="false" i]), .paywall, .paywall-overlay, .paid-content, .subscriber-only, .premium-content')) return true;

  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const pending = [JSON.parse(script.textContent)];
      const seen = new WeakSet();
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        if (value.isAccessibleForFree === false || String(value.isAccessibleForFree || '').toLowerCase() === 'false') return true;
        for (const child of Object.values(value)) pending.push(child);
      }
    } catch {}
  }

  const text = doc.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return /subscribe\s+(?:now\s+)?to\s+(?:continue|keep\s+)?reading|subscribe\s+(?:now\s+)?to\s+read\s+this\s+(?:article|story)|(?:continue|keep)\s+reading\s+(?:by\s+)?(?:subscribing|with\s+a\s+subscription)|(?:this|the) (?:article|content|story).{0,50}(?:subscribers? only|for subscribers?|premium)|already a subscriber|sign in to (?:read|continue)|unlock this article|reached your (?:free )?article limit/i.test(text);
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
  const explicitPaywall = hasExplicitPaywall(doc);

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

  if (!isSubstantive || explicitPaywall) {
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

    if (!explicitPaywall && container && containerWords >= 80 && containerParagraphs >= 2) {
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

    // Incomplete or gated: search independent coverage & score with AI
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
      status: explicitPaywall ? 'paywalled' : bestSnippet ? 'excerpt_only' : metaDesc ? 'metadata_only' : 'failed',
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

const MATCH_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'are', 'article', 'before', 'being', 'between',
  'business', 'by', 'can', 'company', 'could', 'for', 'from', 'group', 'has', 'have', 'how', 'into',
  'its', 'kenya', 'kenyan', 'latest', 'market', 'more', 'most', 'nairobi', 'news', 'of', 'on', 'or',
  'our', 'over', 'report', 'reported', 'reports', 'said', 'says', 'share', 'shares', 'stock', 'stocks',
  'story', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'under', 'update', 'updates', 'was', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
]);

function matchWords(value) {
  const words = String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/);
  return [...new Set(words.filter((word) => word.length > 2 && !MATCH_STOP_WORDS.has(word)))];
}

function tokenOverlap(targetWords, candidateWords) {
  const target = new Set(targetWords);
  const candidate = new Set(candidateWords);
  const hits = [...target].filter((word) => candidate.has(word)).length;
  return { hits, ratio: target.size ? hits / target.size : 0 };
}

function eventNumberTokens(value) {
  const pattern = /(?:KES|KSh|USD|EUR|GBP|\$|£|€)\s*\d[\d,.]*(?:\s*(?:million|billion|trillion|bn|m))?|\b\d[\d,.]*\s*(?:%|percent|basis points?|bps|million|billion|trillion|shares|days?|months?|years?)\b/gi;
  return new Set([...String(value || '').matchAll(pattern)].map((match) => match[0].toLowerCase().replace(/[\s,]/g, '')));
}

function fallbackEntities(value) {
  return {
    tickers: new Set(extractTickers(value)),
    institutions: new Set(extractInstitutions(value)),
  };
}

function hasTrustworthyFallbackMatch(targetTitle, targetSummary, candidateTitle, candidateText) {
  const titleWords = matchWords(targetTitle);
  const candidateTitleWords = matchWords(candidateTitle);
  if (titleWords.length < 2) return false;
  const titleOverlap = tokenOverlap(titleWords, candidateTitleWords);
  if (titleOverlap.hits < 2 || titleOverlap.ratio < 0.5) return false;

  const summaryWords = matchWords(targetSummary);
  const contentOverlap = tokenOverlap(summaryWords, matchWords(candidateText));
  const normalizedTitle = matchWords(targetTitle).join(' ');
  const exactTitle = normalizedTitle.length >= 8 && normalizedTitle === candidateTitleWords.join(' ');
  const targetEntities = fallbackEntities(`${targetTitle} ${targetSummary || ''}`);
  const candidateEntities = fallbackEntities(`${candidateTitle} ${candidateText}`);
  const sharedTicker = [...targetEntities.tickers].some((ticker) => candidateEntities.tickers.has(ticker));
  const sharedInstitution = [...targetEntities.institutions].some((institution) => candidateEntities.institutions.has(institution));
  if (targetEntities.tickers.size && !sharedTicker) return false;

  const corroborated = exactTitle || (summaryWords.length >= 3 && contentOverlap.hits >= 3 && contentOverlap.ratio >= 0.25) ||
    ((sharedTicker || sharedInstitution) && titleOverlap.ratio >= 0.75 && contentOverlap.hits >= 1);
  if (!corroborated) return false;

  const targetNumbers = eventNumberTokens(`${targetTitle} ${targetSummary || ''}`);
  const candidateNumbers = eventNumberTokens(`${candidateTitle} ${candidateText}`);
  return targetNumbers.size < 2 || [...targetNumbers].some((number) => candidateNumbers.has(number));
}

function isGenericFallbackPath(pathname) {
  const path = String(pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/' || /^\/(?:home|index(?:\.html?)?)$/.test(path)) return true;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 1 && /^[a-z]{2}(?:-[a-z]{2})?$/.test(segments[0])) return true;
  return /^\/(?:about|author|authors|category|categories|contact|define|dictionary|meaning|privacy|search|tag|tags|terms|topic|topics)(?:\/|$)/i.test(path) ||
    /^\/(?:news|business|markets?|economy|companies?)\/?$/.test(path);
}

function isFallbackArticlePage(url, doc, article, rawText) {
  if (!article?.content) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (isGenericFallbackPath(parsed.pathname)) return false;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonical) {
    try {
      if (isGenericFallbackPath(new URL(canonical, parsed).pathname)) return false;
    } catch {}
  }
  const title = article.title || doc.title || '';
  if (/(?:^|\b)(?:404|403|page not found|access denied|just a moment|attention required|verify you are human)(?:\b|$)/i.test(title)) return false;
  if (rawText.length < 500 && /page not found|access denied|verify you are human|enable javascript to continue/i.test(rawText)) return false;
  const fragment = JSDOM.fragment(article.content);
  const text = fragment.textContent?.trim() || '';
  const linkedText = [...fragment.querySelectorAll('a')].map((link) => link.textContent || '').join(' ');
  if (text && linkedText.length / text.length > 0.5) return false;
  return countRealParagraphs(article.content) >= 2;
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
  const targetWords = matchWords(`${targetTitle} ${targetSummary || ''}`);
  if (targetWords.length === 0) return { match: false, score: 0 };
  const candidateWords = matchWords(`${candidateTitle} ${candidateSnippet || ''}`);
  const overlap = tokenOverlap(targetWords, candidateWords);
  const match = overlap.ratio >= 0.35;
  return { match, score: Math.round(overlap.ratio * 100), reason: 'heuristic overlap' };
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

      const candidateUrl = r.finalUrl || cand.url;
      let dom;
      try {
        dom = new JSDOM(r.html, { url: candidateUrl, virtualConsole: extractionConsole });
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
      const candidateTitle = article?.title || cand.title || '';
      if (words < 70 || !isFallbackArticlePage(candidateUrl, dom.window.document, article, rawText)) continue;
      if (!hasTrustworthyFallbackMatch(cleanTitle, summary, candidateTitle, rawText)) continue;

      // Score candidate using AI
      const scoreResult = await scoreCandidateWithAI(
        cleanTitle,
        summary,
        candidateTitle,
        rawText.slice(0, 500)
      );

      // Accept heuristic scores >= 50 as fallback when AI is unavailable
      const effectiveScore = scoreResult.score;
      const effectiveMatch = scoreResult.match || (effectiveScore >= 50 && !process.env.GROQ_API_KEY);

      if (effectiveMatch && effectiveScore >= 50 && effectiveScore > bestScore) {
        const cleanHtml = sanitizeHtml(article.content, SANITIZE_OPTIONS);
        const img = extractImageFromHtml(r.html, candidateUrl);
        const pubName = extractPublisherName(candidateUrl, article.title) || cand.host.replace(/^www\./, '');

        bestScore = effectiveScore;
        bestCandidate = {
          contentHtml: cleanHtml,
          imageUrl: isUsableImage(img) ? img : null,
          fallbackUrl: candidateUrl,
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
  TICKER_SECTORS,
  INSTITUTIONS,
  INSTITUTION_DETAILS,
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
