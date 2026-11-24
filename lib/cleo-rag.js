const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { fallbackEmbedding } = require('./groq-client');

const db = new Database(path.join(__dirname, '..', 'fincapita.sqlite'));
db.pragma('journal_mode = WAL');

const EMBEDDING_DIM = 384;

let embeddingCache = new Map();
let vectorIndex = null;
let articlesData = [];

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

async function getEmbedding(text) {
  const hash = textHash(text);
  if (embeddingCache.has(hash)) return embeddingCache.get(hash);
  const embedding = fallbackEmbedding(text);
  embeddingCache.set(hash, embedding);
  return embedding;
}

async function buildVectorIndex() {
  console.log('[cleo] Building vector index...');
  initVectorTable();

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

  for (const art of articles) {
    const text = `${art.title}\n${art.summary || ''}\n${art.content_html ? art.content_html.replace(/<[^>]+>/g, ' ') : ''}`.slice(0, 4000);
    const hash = textHash(text);

    let row = db.prepare('SELECT embedding, text_hash FROM article_embeddings WHERE article_id = ?').get(art.id);
    let embedding;

    if (row && row.text_hash === hash) {
      embedding = new Float32Array(Buffer.from(row.embedding));
    } else {
      embedding = new Float32Array(await getEmbedding(text));
      const blob = Buffer.from(embedding.buffer);
      db.prepare('INSERT OR REPLACE INTO article_embeddings (article_id, embedding, text_hash) VALUES (?, ?, ?)')
        .run(art.id, blob, hash);
    }
    embeddings.push({ id: art.id, embedding, article: art });
  }

  vectorIndex = embeddings;
  console.log(`[cleo] Vector index built with ${embeddings.length} articles`);
  return embeddings.length;
}

function searchSimilar(queryEmbedding, topK = 10, filters = {}) {
  if (!vectorIndex || vectorIndex.length === 0) return [];

  let candidates = vectorIndex;

  if (filters.category) {
    candidates = candidates.filter(c => c.article.category === filters.category);
  }
  if (filters.ticker) {
    candidates = candidates.filter(c => JSON.parse(c.article.tickers || '[]').includes(filters.ticker));
  }
  if (filters.institution) {
    candidates = candidates.filter(c => JSON.parse(c.article.institutions || '[]').includes(filters.institution));
  }
  if (filters.since) {
    const sinceDate = new Date(filters.since).getTime();
    candidates = candidates.filter(c => new Date(c.article.published_at).getTime() >= sinceDate);
  }
  if (filters.until) {
    const untilDate = new Date(filters.until).getTime();
    candidates = candidates.filter(c => new Date(c.article.published_at).getTime() <= untilDate);
  }

  let queryKeywords = filters.queryKeywords || [];
  if (queryKeywords && queryKeywords.length > 0) {
    const before = candidates.length;
    candidates = candidates.filter(c => {
      const title = (c.article.title || '').toLowerCase();
      const summary = (c.article.summary || '').toLowerCase();
      const content = (c.article.content_html || '').toLowerCase().replace(/<[^>]+>/g, ' ');
      const haystack = title + ' ' + summary + ' ' + content;
      return queryKeywords.some(kw => haystack.includes(kw));
    });
  }

  const scored = candidates.map(c => {
    const title = (c.article.title || '').toLowerCase();
    const summary = (c.article.summary || '').toLowerCase();
    const content = (c.article.content_html || '').toLowerCase().replace(/<[^>]+>/g, ' ');
    const haystack = title + ' ' + summary + ' ' + content;
    
    let keywordMatches = 0;
    let titleKeywordScore = 0;
    if (queryKeywords.length > 0) {
      keywordMatches = queryKeywords.filter(kw => haystack.includes(kw)).length;
      for (const kw of queryKeywords) {
        const titleCount = (title.match(new RegExp(kw, 'g')) || []).length;
        const summaryCount = (summary.match(new RegExp(kw, 'g')) || []).length;
        titleKeywordScore += titleCount * 2 + summaryCount;
      }
    }
    
    const embeddingScore = cosineSimilarity(queryEmbedding, c.embedding);
    const boostedScore = embeddingScore + (keywordMatches * 0.1) + (titleKeywordScore * 0.03);
    
    return { ...c, score: boostedScore, keywordMatches, embeddingScore, titleKeywordScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function retrieveContext(query, options = {}) {
  const { topK = 8, category, ticker, institution, since, until } = options;
  const queryEmbedding = await getEmbedding(query);
  const stopWords = new Set(['what', 'are', 'is', 'the', 'and', 'for', 'you', 'your', 'can', 'how', 'who', 'when', 'where', 'why', 'which', 'will', 'would', 'could', 'should', 'about', 'with', 'from', 'this', 'that', 'have', 'has', 'had', 'been', 'were', 'was', 'been', 'recent', 'recently', 'announcement', 'announcements', 'news', 'update', 'updates', 'latest', 'new']);
  const queryKeywords = query.toLowerCase().split(/\W+/).filter(w => w.length >= 3 && !stopWords.has(w));
  const results = searchSimilar(queryEmbedding, topK, { category, ticker, institution, since, until, queryKeywords });

  const context = results.map((r, i) => {
    const art = r.article;
    const content = art.content_html
      ? art.content_html.replace(/<[^>]+>/g, ' ').slice(0, 1500)
      : (art.summary || '').slice(0, 800);
    return `[Source ${i + 1}] ${art.source_name} · ${art.category} · ${new Date(art.published_at).toLocaleDateString('en-KE')}\nTitle: ${art.title}\nContent: ${content}\nURL: ${art.resolved_url || art.original_url}\nRelevance: ${(r.score * 100).toFixed(1)}%\n---`;
  }).join('\n');

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

async function answerQuestion(question, options = {}) {
  const { topK = 8, category, ticker, institution, since, until } = options;
  const { context, sources, scores } = await retrieveContext(question, { topK, category, ticker, institution, since, until });

  const prompt = `You are Cleo, an expert Kenya capital markets analyst. Answer the user's question using ONLY the provided context from FinCapita's article database.

Question: "${question}"

Context from ${sources.length} relevant articles:
${context}

Instructions:
- Answer directly and comprehensively using the provided sources
- Cite sources inline like [Source 1], [Source 2]
- If context is insufficient, say so and suggest what additional info would help
- Use Kenya market terminology (KES, NSE, CBK, CMA, T-bills, infrastructure bonds, etc.)
- Be precise with numbers, dates, and entity names
- If the question asks for analysis/trends, provide structured insights`;

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
  const withEmbeddings = db.prepare('SELECT COUNT(*) as c FROM article_embeddings').get().c;
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
  getStats,
  initVectorTable,
};