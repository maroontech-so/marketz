const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { fallbackEmbedding } = require('./groq-client');
const { getMarketData } = require('./market-data');
const {
  TICKERS,
  TICKER_SECTORS,
  INSTITUTIONS,
  INSTITUTION_DETAILS,
  extractTickers,
  extractInstitutions,
} = require('./extract');

const db = new Database(process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, '..', 'fincapita.sqlite'));
db.pragma('journal_mode = WAL');

const EMBEDDING_DIM = 384;
const MAX_EMBEDDING_CACHE = 500;
const VECTOR_INDEX_BATCH_SIZE = 100;
const MAX_SIMILARITY_CANDIDATES = 200; // Pre-filter to top N by keyword before cosine

let embeddingCache = new Map();
let vectorIndex = null;
let vectorIndexBuilt = false;
let vectorIndexBuilding = false;
let articlesData = [];
let embeddingMatrix = null; // Float32Array [n * dim] for batch cosine
let articleIds = []; // parallel array
let articleSearchText = []; // pre-computed lowercase searchable text

function initVectorTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_embeddings (
      article_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      text_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (article_id) REFERENCES articles(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_embeddings_article ON article_embeddings(article_id);
  `);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function textHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function pruneEmbeddingCache() {
  if (embeddingCache.size > MAX_EMBEDDING_CACHE) {
    const keysToDelete = [...embeddingCache.keys()].slice(0, embeddingCache.size - MAX_EMBEDDING_CACHE);
    keysToDelete.forEach(k => embeddingCache.delete(k));
  }
}

async function getEmbedding(text) {
  const hash = textHash(text);
  if (embeddingCache.has(hash)) return embeddingCache.get(hash);
  const embedding = fallbackEmbedding(text);
  embeddingCache.set(hash, embedding);
  pruneEmbeddingCache();
  return embedding;
}

async function buildVectorIndex() {
  if (vectorIndexBuilt && vectorIndex) return vectorIndex.length;
  if (vectorIndexBuilding) {
    while (vectorIndexBuilding) await new Promise(r => setTimeout(r, 100));
    return vectorIndex?.length || 0;
  }

  vectorIndexBuilding = true;
  console.log('[cleo] Building vector index...');
  initVectorTable();
  db.prepare('DELETE FROM article_embeddings WHERE article_id NOT IN (SELECT id FROM articles)').run();

  const articles = db.prepare(`
    SELECT id, title, summary, content_html, category, published_at, source_name,
           tickers, institutions, resolved_url, full_text_status
    FROM articles
    WHERE (content_html IS NOT NULL AND content_html != '')
       OR (summary IS NOT NULL AND summary != '')
    ORDER BY published_at DESC
  `).all();

  articlesData = articles;
  const embeddings = [];
  let processed = 0;

  for (let i = 0; i < articles.length; i += VECTOR_INDEX_BATCH_SIZE) {
    const batch = articles.slice(i, i + VECTOR_INDEX_BATCH_SIZE);
    
    for (const art of batch) {
      const text = `${art.title}\n${art.summary || ''}\n${art.content_html ? art.content_html.replace(/<[^>]+>/g, ' ') : ''}`.slice(0, 4000);
      const hash = textHash(text);

      let row = db.prepare('SELECT embedding, text_hash FROM article_embeddings WHERE article_id = ?').get(art.id);
      let embedding;

      if (row && row.text_hash === hash) {
        const buf = Buffer.from(row.embedding);
        const floatLen = buf.length / 4;
        embedding = new Float32Array(buf.buffer, buf.byteOffset, floatLen);
        // Handle legacy embeddings with different dimensions
        if (embedding.length !== EMBEDDING_DIM) {
          console.warn(`[cleo] Re-embedding article ${art.id}: stored dim=${embedding.length}, expected=${EMBEDDING_DIM}`);
          embedding = new Float32Array(await getEmbedding(text));
          const blob = Buffer.from(embedding.buffer);
          db.prepare('INSERT OR REPLACE INTO article_embeddings (article_id, embedding, text_hash) VALUES (?, ?, ?)')
            .run(art.id, blob, hash);
        }
      } else {
        embedding = new Float32Array(await getEmbedding(text));
        const blob = Buffer.from(embedding.buffer);
        db.prepare('INSERT OR REPLACE INTO article_embeddings (article_id, embedding, text_hash) VALUES (?, ?, ?)')
          .run(art.id, blob, hash);
      }
      embeddings.push({ id: art.id, embedding, article: art });
    }
    
    processed += batch.length;
    if (processed % 200 === 0 || processed === articles.length) {
      console.log(`[cleo] Vector index progress: ${processed}/${articles.length}`);
      if (global.gc) global.gc();
    }
  }

  vectorIndex = embeddings;
  // Build embedding matrix for batch cosine similarity
  const n = embeddings.length;
  console.log(`[cleo] Building embedding matrix: ${n} articles, dim=${EMBEDDING_DIM}`);
  embeddingMatrix = new Float32Array(n * EMBEDDING_DIM);
  articleIds = new Array(n);
  // Pre-compute searchable text for fast keyword matching
  articleSearchText = new Array(n);
  for (let i = 0; i < n; i++) {
    const emb = embeddings[i].embedding;
    if (!emb || emb.length !== EMBEDDING_DIM) {
      console.error(`[cleo] Invalid embedding at index ${i}:`, emb?.length, emb?.constructor?.name);
      continue;
    }
    embeddingMatrix.set(emb, i * EMBEDDING_DIM);
    articleIds[i] = embeddings[i].id;
    const art = embeddings[i].article;
    const title = (art.title || '').toLowerCase();
    const summary = (art.summary || '').toLowerCase();
    const content = (art.content_html || '').toLowerCase().replace(/<[^>]+>/g, ' ');
    articleSearchText[i] = title + ' ' + summary + ' ' + content;
  }
  vectorIndexBuilt = true;
  vectorIndexBuilding = false;
  console.log(`[cleo] Vector index built with ${embeddings.length} articles`);
  return embeddings.length;
}

async function ensureVectorIndex() {
  if (!vectorIndexBuilt || !vectorIndex) {
    await buildVectorIndex();
  }
  return vectorIndex;
}

function searchSimilar(queryEmbedding, topK = 10, filters = {}) {
  if (!vectorIndex || vectorIndex.length === 0) return [];

  let candidateIndices = [];
  for (let i = 0; i < vectorIndex.length; i++) {
    const c = vectorIndex[i];
    let match = true;
    if (filters.category && c.article.category !== filters.category) match = false;
    if (match && filters.ticker && !JSON.parse(c.article.tickers || '[]').includes(filters.ticker)) match = false;
    if (match && filters.institution && !JSON.parse(c.article.institutions || '[]').includes(filters.institution)) match = false;
    if (match && filters.since && new Date(c.article.published_at).getTime() < new Date(filters.since).getTime()) match = false;
    if (match && filters.until && new Date(c.article.published_at).getTime() > new Date(filters.until).getTime()) match = false;
    if (match) candidateIndices.push(i);
  }

  const queryKeywords = filters.queryKeywords || [];

  // Fast keyword pre-filter using pre-computed search text
  let keywordScored = candidateIndices;
  if (queryKeywords.length > 0) {
    const kwScores = candidateIndices.map(idx => {
      const haystack = articleSearchText[idx];
      let keywordMatches = 0;
      let titleKeywordScore = 0;
      for (const kw of queryKeywords) {
        if (haystack.includes(kw)) keywordMatches++;
        // Simple count without regex
        let pos = haystack.indexOf(kw);
        while (pos !== -1) {
          // Check if in title portion (roughly first 200 chars)
          if (pos < 200) titleKeywordScore += 2;
          else titleKeywordScore += 1;
          pos = haystack.indexOf(kw, pos + 1);
        }
      }
      return { idx, keywordMatches, titleKeywordScore };
    });
    kwScores.sort((a, b) => (b.keywordMatches * 10 + b.titleKeywordScore) - (a.keywordMatches * 10 + a.titleKeywordScore));
    keywordScored = kwScores.slice(0, MAX_SIMILARITY_CANDIDATES).map(k => k.idx);
  }

  // Batch cosine similarity using matrix multiplication
  const n = keywordScored.length;
  const scores = new Float32Array(n);
  
  // Compute dot products using embedding matrix
  for (let i = 0; i < n; i++) {
    const vecOffset = keywordScored[i] * EMBEDDING_DIM;
    let dot = 0;
    for (let j = 0; j < EMBEDDING_DIM; j++) {
      dot += queryEmbedding[j] * embeddingMatrix[vecOffset + j];
    }
    scores[i] = dot;
  }

  // Combine scores
  const results = keywordScored.map((idx, i) => {
    const c = vectorIndex[idx];
    const embeddingScore = scores[i];
    const keywordMatches = queryKeywords.length > 0 ? articleSearchText[idx].split(' ').filter(w => queryKeywords.includes(w)).length : 0;
    const boostedScore = embeddingScore + (keywordMatches * 0.1);
    return { ...c, score: boostedScore, keywordMatches, embeddingScore };
  });

  results.sort((a, b) => b.score - a.score);
  return results.filter(r => r.keywordMatches > 0 || r.embeddingScore >= 0.12).slice(0, topK);
}
async function retrieveContext(query, options = {}) {
  const start = Date.now();
  await ensureVectorIndex();
  const indexTime = Date.now();
  const { topK = 8, category, ticker, institution, since, until } = options;
  const queryEmbedding = await getEmbedding(query);
  const embedTime = Date.now();
  const stopWords = new Set(['what', 'are', 'is', 'the', 'and', 'for', 'you', 'your', 'can', 'how', 'who', 'when', 'where', 'why', 'which', 'will', 'would', 'could', 'should', 'about', 'with', 'from', 'this', 'that', 'have', 'has', 'had', 'been', 'were', 'was', 'been', 'recent', 'recently', 'announcement', 'announcements', 'news', 'update', 'updates', 'latest', 'new']);
  const queryKeywords = query.toLowerCase().split(/\W+/).filter(w => w.length >= 3 && !stopWords.has(w));
  const results = searchSimilar(queryEmbedding, topK, { category, ticker, institution, since, until, queryKeywords });
  const searchTime = Date.now();

  const context = results.map((r, i) => {
    const art = r.article;
    const summary = (art.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260);
    const content = art.content_html
      ? art.content_html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 420)
      : '';
    const excerpt = [summary && `Summary: ${summary}`, content && `Article text: ${content}`].filter(Boolean).join('\n');
    return `[Source ${i + 1}] ${art.source_name} · ${art.category} · ${new Date(art.published_at).toLocaleDateString('en-KE')}\nTitle: ${art.title}\n${excerpt}\nURL: ${art.resolved_url || art.original_url}\nRelevance: ${(r.score * 100).toFixed(1)}%\n---`;
  }).join('\n');

  console.log(`[cleo] retrieveContext: index=${indexTime-start}ms embed=${embedTime-indexTime}ms search=${searchTime-embedTime}ms total=${Date.now()-start}ms results=${results.length}`);
  return { context, sources: results.map(r => r.article), scores: results.map(r => r.score) };
}

async function analyzeTrends(options = {}) {
  const { days = 30, category, ticker, institution } = options;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = 'Recent market trends and developments';
  if (ticker) query += ` for ${ticker}`;
  if (institution) query += ` regarding ${institution}`;
  if (category) query += ` in ${category}`;

  const { context, sources } = await retrieveContext(query, { topK: 20, since, category, ticker, institution });

  const prompt = `You are Cleo, a Kenya capital markets intelligence analyst. Analyze the following articles from the last ${days} days and provide:

1. **Key Trends** (3-5 bullet points): Major themes, patterns, or shifts
2. **Market Sentiment**: Bullish/bearish/neutral with evidence
3. **Notable Events**: Significant announcements, auctions, results, regulatory actions
4. **Sector/Company Focus**: If specific ticker/institution mentioned, deep dive
5. **Actionable Insights**: What investors/researchers should watch

Articles:
${context}

Be specific, cite sources by [Source N], and use Kenya market terminology (KES, NSE, CBK, CMA, T-bills, etc.).`;

  return { prompt, sources, context };
}

function compactText(value, maxLength = 240) {
  return String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function formatNumber(value, maximumFractionDigits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-KE', { maximumFractionDigits }).format(value);
}

function formatPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${formatNumber(value)}%`;
}

function formatDate(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function buildDatabaseContext({ includeLatest = true, includeSources = false } = {}) {
  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           MAX(published_at) AS latestPublishedAt,
           MAX(collected_at) AS latestCollectedAt,
           SUM(CASE WHEN full_text_status = 'extracted' THEN 1 ELSE 0 END) AS extractedCount
    FROM articles
  `).get();
  const sourceTotals = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
    FROM sources
  `).get();
  const categories = db.prepare('SELECT category, COUNT(*) AS count FROM articles GROUP BY category ORDER BY count DESC').all();
  const latest = db.prepare(`
    SELECT title, summary, source_name, category, published_at, resolved_url, original_url
    FROM articles
    ORDER BY published_at DESC
    LIMIT 6
  `).all();
  const sources = db.prepare(`
    SELECT s.slug, s.name, s.tier, s.rights, s.enabled, s.last_success_at,
           s.consecutive_failures, COUNT(a.id) AS article_count,
           MAX(a.published_at) AS latest_article_at
    FROM sources s
    LEFT JOIN articles a ON a.source_slug = s.slug
    GROUP BY s.slug
    ORDER BY s.tier, s.name
  `).all();

  const lines = [
    '## FinCapita database snapshot',
    `Articles: ${totals.total}; extracted full text: ${totals.extractedCount || 0}.`,
    `Latest article published: ${formatDate(totals.latestPublishedAt)}; latest article collected: ${formatDate(totals.latestCollectedAt)}.`,
    `Sources: ${sourceTotals.total} registered; ${sourceTotals.enabled || 0} currently enabled. News ingestion runs every 10 minutes; this is periodically refreshed site news, not a streaming feed.`,
    `Categories: ${categories.map(item => `${item.category}=${item.count}`).join(', ') || 'none'}.`,
  ];
  if (includeLatest) {
    lines.push('', 'Latest site headlines:');
    lines.push(...latest.map(article => `- ${formatDate(article.published_at)} | ${article.source_name} | ${article.category} | ${compactText(article.title, 150)}${article.summary ? ` — ${compactText(article.summary, 140)}` : ''} | ${article.resolved_url || article.original_url}`));
  }
  if (includeSources) {
    lines.push('', 'Source registry:');
    lines.push(...sources.map(source => `- ${source.name} (${source.slug}): ${source.enabled ? 'enabled' : 'disabled'}, tier ${source.tier}, ${source.rights}, ${source.article_count} articles, latest ${formatDate(source.latest_article_at)}, last successful collection ${formatDate(source.last_success_at)}, consecutive failures ${source.consecutive_failures}.`));
  }

  return {
    text: lines.join('\n'),
    dataSource: {
      id: 'fincapita-db',
      name: 'FinCapita database',
      kind: 'database',
      updatedAt: totals.latestCollectedAt || totals.latestPublishedAt || null,
      articleCount: totals.total,
      sourceCount: sourceTotals.total,
    },
  };
}

function buildReferenceContext() {
  const companies = Object.entries(TICKERS).map(([ticker, name]) => `${ticker}: ${name}; sector: ${TICKER_SECTORS[ticker] || 'Not classified'}`);
  const institutions = Object.entries(INSTITUTIONS).map(([code, name]) => {
    const details = INSTITUTION_DETAILS[code] || {};
    return `${code}: ${name}; role: ${details.role || 'Not specified'}; website: ${details.website || 'Not listed'}`;
  });
  return [
    '## Site reference directory',
    'Companies covered by the site:',
    ...companies.map(line => `- ${line}`),
    'Institutions covered by the site:',
    ...institutions.map(line => `- ${line}`),
  ].join('\n');
}

function buildEntityContext(entityText, tickers, institutions) {
  const lines = [];
  for (const ticker of tickers) {
    const name = TICKERS[ticker] || ticker;
    const root = name.replace(/\s+(?:PLC|Limited)\.?$/i, '');
    const where = '(tickers LIKE ? OR title LIKE ? OR summary LIKE ?)';
    const params = [`%"${ticker}"%`, `%${root}%`, `%${root}%`];
    const stats = db.prepare(`SELECT COUNT(*) AS count, MAX(published_at) AS latest FROM articles WHERE ${where}`).get(...params);
    const recent = db.prepare(`SELECT title, source_name, published_at FROM articles WHERE ${where} ORDER BY published_at DESC LIMIT 2`).all(...params);
    lines.push(`- ${ticker} (${name}; sector ${TICKER_SECTORS[ticker] || 'not classified'}): ${stats.count} matching site articles; latest ${formatDate(stats.latest)}.${recent.length ? ` Recent coverage: ${recent.map(article => `${compactText(article.title, 140)} (${article.source_name}, ${formatDate(article.published_at)})`).join('; ')}.` : ''}`);
  }
  for (const code of institutions) {
    const name = INSTITUTIONS[code] || code;
    const where = '(institutions LIKE ? OR title LIKE ? OR summary LIKE ?)';
    const params = [`%"${code}"%`, `%${name}%`, `%${name}%`];
    const stats = db.prepare(`SELECT COUNT(*) AS count, MAX(published_at) AS latest FROM articles WHERE ${where}`).get(...params);
    const recent = db.prepare(`SELECT title, source_name, published_at FROM articles WHERE ${where} ORDER BY published_at DESC LIMIT 2`).all(...params);
    lines.push(`- ${code} (${name}): ${stats.count} matching site articles; latest ${formatDate(stats.latest)}.${recent.length ? ` Recent coverage: ${recent.map(article => `${compactText(article.title, 140)} (${article.source_name}, ${formatDate(article.published_at)})`).join('; ')}.` : ''}`);
  }
  return lines.length ? `## Entity coverage in FinCapita\n${lines.join('\n')}` : '';
}

function stockMentioned(stock, text) {
  const lower = text.toLowerCase();
  const ticker = String(stock.ticker || '').toLowerCase();
  const name = String(stock.name || '').toLowerCase();
  return Boolean((ticker && new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) ||
    (name.length >= 4 && lower.includes(name)));
}

function formatStock(stock) {
  return `${stock.ticker} (${stock.name || 'name unavailable'}): price ${formatNumber(stock.price, 4)} KES; change ${formatNumber(stock.change, 4)} (${formatPercent(stock.changePct)}); previous close ${formatNumber(stock.previousClose, 4)}; volume ${formatNumber(stock.volume, 0)}; turnover ${formatNumber(stock.turnover)} KES; market cap ${formatNumber(stock.marketCap)} KES; quote updated ${formatDate(stock.updatedAt)}.`;
}

function buildMarketContext(markets, entityText, sections) {
  const lines = [];
  const references = [];

  if (sections.nse) {
    const nse = markets.nse;
    if (nse?.available) {
      references.push({ id: 'nse', name: 'NSE market data via Mansa API', kind: 'market', status: nse.status, updatedAt: nse.updatedAt, fetchedAt: nse.fetchedAt, url: nse.url });
      lines.push('## NSE equities and indices');
      lines.push(`Provider status: ${nse.status}; provider-reported update: ${formatDate(nse.updatedAt)}; fetched ${formatDate(nse.fetchedAt)}${nse.stale ? '; stale cached data' : ''}. Do not call this real-time unless the provider status is live.`);
      if (nse.partial && nse.errors) lines.push(`Provider feed gaps: ${Object.entries(nse.errors).map(([feed, error]) => `${feed}: ${error}`).join('; ')}.`);
      if (nse.indices?.length) {
        lines.push('Indices:');
        lines.push(...nse.indices.slice(0, 10).map(index => `- ${index.code} (${index.name || 'name unavailable'}): ${formatNumber(index.value, 4)}; change ${formatNumber(index.changeAbs ?? index.change, 4)} (${formatPercent(index.changePct)}); updated ${formatDate(index.updatedAt)}.`));
      }
      const mentioned = nse.stocks.filter(stock => stockMentioned(stock, entityText)).slice(0, 8);
      if (!mentioned.length && nse.breadth) {
        lines.push(`Breadth: ${nse.breadth.advancing} advancing, ${nse.breadth.declining} declining, ${nse.breadth.unchanged} unchanged, ${nse.breadth.unknown} unknown across ${nse.breadth.total} returned stocks.`);
      }
      if (!mentioned.length && nse.marketSummary) {
        const summary = nse.marketSummary;
        lines.push(`Reported totals across ${summary.pricedCount}/${summary.stockCount} priced stocks: volume ${formatNumber(summary.totalVolume, 0)} (coverage ${summary.volumeCoverage.known}/${summary.volumeCoverage.total}); turnover ${formatNumber(summary.totalTurnover)} KES (coverage ${summary.turnoverCoverage.known}/${summary.turnoverCoverage.total}); market cap ${formatNumber(summary.totalMarketCap)} KES (coverage ${summary.marketCapCoverage.known}/${summary.marketCapCoverage.total}).`);
        lines.push('Top gainers:');
        lines.push(...(summary.topGainers || []).slice(0, 3).map(stock => `- ${formatStock(stock)}`));
        lines.push('Top losers:');
        lines.push(...(summary.topLosers || []).slice(0, 3).map(stock => `- ${formatStock(stock)}`));
      }
      if (!mentioned.length && nse.sectors?.length) {
        lines.push('Sector summary:');
        lines.push(...nse.sectors.slice(0, 6).map(sector => `- ${sector.sector}: ${sector.stockCount} stocks; turnover ${formatNumber(sector.turnover)} KES; market cap ${formatNumber(sector.marketCap)} KES; ${sector.advancing} advancing/${sector.declining} declining/${sector.unchanged} unchanged.`));
      }
      if (mentioned.length) {
        lines.push('Quotes for entities mentioned in the conversation:');
        lines.push(...mentioned.map(formatStock));
      }
      for (const [code, history] of Object.entries(nse.history || {})) {
        if (!Array.isArray(history) || !history.length) continue;
        lines.push(`${code} recent history:`);
        lines.push(...history.slice(-6).map(point => `- ${point.date}: ${formatNumber(point.value, 4)}${point.changePct === null || point.changePct === undefined ? '' : ` (${formatPercent(point.changePct)})`}.`));
      }
    } else {
      lines.push('## NSE equities and indices\nCurrent provider data is unavailable. Do not invent prices, index levels, or market status.');
    }
  }

  if (sections.forex) {
    const forex = markets.forex;
    if (forex?.available) {
      references.push({ id: 'cbk-forex', name: 'CBK Forex', kind: 'forex', status: forex.status, updatedAt: forex.asOf, url: forex.url });
      const lower = entityText.toLowerCase();
      const mentionedPairs = forex.pairs.filter(pair => {
        const code = String(pair.code || '').toLowerCase();
        const name = String(pair.name || '').toLowerCase();
        return new RegExp(`\\b${code}\\b`, 'i').test(entityText) || (name.length >= 4 && lower.includes(name));
      });
      const pairs = mentionedPairs.length ? mentionedPairs : forex.pairs.slice(0, 6);
      lines.push('## CBK foreign exchange');
      lines.push(`Status: ${forex.status}; rates as of ${formatDate(forex.asOf)}${forex.stale ? '; stale cached data' : ''}. Source: ${forex.url}`);
      lines.push(...pairs.map(pair => `- ${pair.code}/KES (${pair.name}): ${formatNumber(pair.rate, 6)} KES; inverse ${formatNumber(pair.inverse, 6)}.`));
    } else {
      lines.push('## CBK foreign exchange\nCurrent provider data is unavailable. Do not invent exchange rates.');
    }
  }

  if (sections.fixedIncome) {
    const fixedIncome = markets.fixedIncome;
    if (fixedIncome?.available) {
      lines.push('## CBK fixed income and inflation');
      if (fixedIncome.centralBankRate?.available) {
        const cbr = fixedIncome.centralBankRate;
        references.push({ id: 'cbk-cbr', name: 'CBK Central Bank Rate', kind: 'rate', status: cbr.status, updatedAt: cbr.asOf, url: cbr.url });
        lines.push(`Central Bank Rate: ${formatNumber(cbr.rate)}%; as of ${formatDate(cbr.asOf)}${cbr.stale ? '; stale cached data' : ''}.`);
        lines.push(...cbr.history.slice(-5).map(point => `- CBR ${point.date}: ${formatNumber(point.rate)}%.`));
      }
      if (fixedIncome.inflation?.available) {
        const inflation = fixedIncome.inflation;
        references.push({ id: 'cbk-inflation', name: 'CBK Inflation', kind: 'inflation', status: inflation.status, updatedAt: inflation.asOf, url: inflation.url });
        lines.push(`Inflation: ${inflation.month} ${inflation.year} 12-month ${formatNumber(inflation.twelveMonth)}%; annual average ${formatNumber(inflation.annualAverage)}%; as of ${formatDate(inflation.asOf)}${inflation.stale ? '; stale cached data' : ''}.`);
        lines.push(...inflation.history.slice(-5).map(point => `- Inflation ${point.date}: 12-month ${formatNumber(point.twelveMonth)}%; annual average ${formatNumber(point.annualAverage)}%.`));
      }
      if (fixedIncome.treasuryBillsMeta?.available) {
        const meta = fixedIncome.treasuryBillsMeta;
        references.push({ id: 'cbk-bills', name: 'CBK Treasury Bills', kind: 'fixed_income', status: meta.status, updatedAt: meta.asOf, url: meta.url });
        lines.push(`Treasury bills on offer (as of ${formatDate(meta.asOf)}${meta.stale ? '; stale cached data' : ''}):`);
        lines.push(...fixedIncome.treasuryBills.map(bill => `- ${bill.label}: issue ${bill.issueNumber}; auction ${bill.auctionDate}; value date ${bill.valueDate}; previous average rate ${formatNumber(bill.previousAverageRate)}% (not a live yield).`));
      }
    } else {
      lines.push('## CBK fixed income and inflation\nCurrent provider data is unavailable. Do not invent the CBR, inflation, auction dates, or yields.');
    }
  }

  return { text: lines.join('\n'), dataSources: references };
}

async function getCleoSiteContext(question, options = {}) {
  const historyText = typeof options.historyText === 'string' ? options.historyText.slice(-4000) : '';
  const entityText = `${historyText}\n${question}`.slice(-8000);
  const followup = /\b(?:it|its|that|this|same|there|they|them)\b/i.test(question);
  const intentText = followup ? `${historyText.slice(-1200)}\n${question}` : question;
  const lower = intentText.toLowerCase();
  const baseTickers = extractTickers(entityText);
  const wantsNews = /\b(?:news|markets?|latest|recent|headlines?|updates?|announcements?|events?|developments?)\b/i.test(intentText);
  const wantsSources = /\b(?:sources?|publishers?|feeds?|database|fincapita|registered|coverage|statistics|stats|how many|count|total)\b/i.test(intentText);
  const wantsDirectory = /\b(?:which|what|list|show|how many|number of|count of)\b/i.test(intentText) &&
    /\b(?:companies|institutions|issuers|sources)\b/i.test(intentText) &&
    /\b(?:cover|track|list|registered|available|site|fincapita|how many|number of|count of)\b/i.test(intentText);
  const sections = {
    nse: baseTickers.length > 0 || /\b(?:nse|nasi|stocks?|shares?|prices?|indices|index|market|equity|ticker|turnover|volume|market cap|gainers?|losers?|sectors?)\b/i.test(intentText),
    forex: /\b(?:forex|foreign exchange|exchange rates?|currenc(?:y|ies)|usd|kes|eur|gbp|cny|jpy|rwf|tzs|ugx|bif|zar|inr|aed|cad|chf|sek|dkk|aud|sgd|hkd|sar|nok|euro|pound|shilling|rand|rupee|dirham|franc|kroner|krone)\b/i.test(intentText),
    fixedIncome: /\b(?:cbk|cbr|central bank rate|inflation|treasury|t-?bills?|bonds?|yields?|auctions?|fixed income|interest rates?)\b/i.test(intentText),
  };

  const [database, markets] = await Promise.all([
    Promise.resolve(buildDatabaseContext({ includeLatest: wantsNews, includeSources: wantsSources })),
    getMarketData().catch(() => ({ available: false, nse: null, forex: null, fixedIncome: null })),
  ]);
  const mentionedStocks = markets.nse?.available
    ? markets.nse.stocks.filter(stock => stockMentioned(stock, entityText))
    : [];
  const tickers = [...new Set([...baseTickers, ...mentionedStocks.map(stock => stock.ticker).filter(Boolean)])];
  const institutions = [...new Set(extractInstitutions(entityText))];
  const market = buildMarketContext(markets, entityText, sections);
  const context = [
    database.text,
    wantsDirectory ? buildReferenceContext() : '',
    buildEntityContext(entityText, tickers, institutions),
    market.text,
  ].filter(Boolean).join('\n\n');

  return {
    context,
    dataSources: [database.dataSource, ...market.dataSources],
    matchedTickers: tickers,
    matchedInstitutions: institutions,
  };
}

async function answerQuestion(question, options = {}) {
  const { topK = 6, category, ticker, institution, since, until, skipArticles = false } = options;
  const { context, sources, scores } = skipArticles
    ? { context: '', sources: [], scores: [] }
    : await retrieveContext(question, { topK, category, ticker, institution, since, until });
  const siteContextResult = options.siteContextPromise
    ? await options.siteContextPromise
    : { context: options.siteContext || '' };
  const siteData = siteContextResult.context || 'No structured site data was supplied.';

  if (sources.length === 0) {
    return {
      prompt: `Question: "${question}"\n\nAuthenticated FinCapita site data:\n${siteData}\n\nNo relevant article passages were retrieved. Answer from the structured site data when it contains the answer. Article references are optional for database, company-directory, source-health, price, index, FX, rate, auction, or inflation facts. Clearly distinguish provider-reported live/delayed/end-of-day data from periodically refreshed site news, and state when a requested figure is unavailable.`,
      sources,
      scores,
      context,
    };
  }

  const prompt = `You are Cleo, an expert Kenya capital markets analyst. Answer the user's question using the supplied FinCapita article passages and authenticated site data.

Question: "${question}"

Context from ${sources.length} relevant articles:
${context}

Authenticated FinCapita site data:
${siteData}

Instructions:
- Answer directly; do not reply with a list of article titles
- Use structured site data for current prices, indices, FX, rates, auctions, inflation, counts, profiles, and source freshness
- Cite [Source N] only when a retrieved article supports the claim; structured site data does not require an article citation, so name the dataset naturally instead of inventing a citation label
- Respect each dataset's actual timestamp and status; never call delayed, end-of-day, daily-reference, or cached data real-time
- If context is insufficient, say so and suggest what additional info would help
- Use Kenya market terminology (KES, NSE, CBK, CMA, T-bills, infrastructure bonds, etc.)
- Be precise with numbers, dates, and entity names
- If the question asks for analysis/trends, synthesize 3-5 concise, evidence-backed insights`;

  return { prompt, sources, scores, context };
}

async function getMarketPosition(ticker) {
  const { context, sources } = await retrieveContext(
    `${ticker} financial results dividend earnings share price market position strategy`,
    { topK: 15, ticker, since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() }
  );

  const prompt = `You are Cleo, analyzing ${ticker}'s market position based on recent coverage. Provide:

1. **Financial Health**: Recent results, profitability, dividends
2. **Market Sentiment**: News tone, analyst views, investor reaction
3. **Strategic Developments**: Acquisitions, expansions, board changes, new products
4. **Regulatory/Policy Impact**: CBK, CMA, NSE actions affecting the company
5. **Key Risks & Catalysts**: What to watch in coming months
6. **Peer Comparison Context**: How it stacks up if mentioned

Articles:
${context}

Cite sources [Source N]. Be specific to Kenya market context.`;

  return { prompt, sources, context };
}

async function getInstitutionCoverage(institution) {
  const { context, sources } = await retrieveContext(
    `${institution} circular directive auction policy regulation announcement`,
    { topK: 15, institution, since: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() }
  );

  const prompt = `You are Cleo, summarizing recent actions by ${institution}. Provide:

1. **Recent Directives/Circulars**: Key policy announcements
2. **Market Operations**: Auctions, tenders, interventions
3. **Regulatory Actions**: Enforcement, licensing, approvals
4. **Forward Guidance**: Signals about future policy direction
5. **Market Impact**: How actions affected yields, prices, sentiment

Articles:
${context}

Cite sources [Source N]. Use official terminology.`;

  return { prompt, sources, context };
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as c FROM articles').get().c;
  const withContent = db.prepare("SELECT COUNT(*) as c FROM articles WHERE content_html IS NOT NULL AND content_html != ''").get().c;
  const withEmbeddings = db.prepare('SELECT COUNT(*) as c FROM article_embeddings e JOIN articles a ON a.id = e.article_id').get().c;
  const categories = db.prepare('SELECT category, COUNT(*) as c FROM articles GROUP BY category').all();
  const latest = db.prepare('SELECT MAX(published_at) as p FROM articles').get().p;

  return { total, withContent, withEmbeddings, categories, latest };
}

module.exports = {
  buildVectorIndex,
  retrieveContext,
  answerQuestion,
  analyzeTrends,
  getMarketPosition,
  getInstitutionCoverage,
  getCleoSiteContext,
  getStats,
  initVectorTable,
};