/**
 * FinCapita Comprehensive Database Migration & Backfill
 * Resolves Google News URLs to solid publisher posts, extracts images & content,
 * updates tickers/institutions, dedups articles, and ensures production readiness.
 */
const path = require('path');
const Database = require('better-sqlite3');
const {
  extractTickers,
  extractInstitutions,
  extractPublisherName,
  extractFullArticle,
  decodeGoogleNewsUrl,
} = require('./lib/extract');

const db = new Database(path.join(__dirname, 'fincapita.sqlite'));
db.pragma('journal_mode = WAL');

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

(async () => {
  console.log('=== Starting FinCapita Database Migration & Backfill ===');

  // Step 1: Deduplicate articles based on title & source
  console.log('[step 1] Checking for duplicate articles...');
  const duplicates = db.prepare(`
    SELECT title, COUNT(*) as c
    FROM articles
    GROUP BY title
    HAVING c > 1
  `).all();

  let removedDuplicates = 0;
  const deleteStmt = db.prepare('DELETE FROM articles WHERE id = ?');
  for (const dup of duplicates) {
    const rows = db.prepare('SELECT id, content_html, image_url, published_at FROM articles WHERE title = ? ORDER BY published_at DESC').all(dup.title);
    // Keep the one with content or the newest one
    let best = rows[0];
    for (const r of rows) {
      if (r.content_html && (!best.content_html || r.content_html.length > best.content_html.length)) {
        best = r;
      }
    }
    for (const r of rows) {
      if (r.id !== best.id) {
        deleteStmt.run(r.id);
        removedDuplicates++;
      }
    }
  }
  console.log(`[step 1] Removed ${removedDuplicates} duplicate articles.`);

  // Step 2: Re-classify tickers and institutions for all articles
  console.log('[step 2] Updating tickers and institutions for all articles...');
  const allArticles = db.prepare('SELECT id, title, summary, category, tickers, institutions, original_url, image_url, resolved_url, actual_source_name FROM articles').all();
  const updateMetaStmt = db.prepare(`
    UPDATE articles
    SET tickers = ?, institutions = ?
    WHERE id = ?
  `);

  for (const art of allArticles) {
    const text = `${art.title} ${art.summary || ''}`;
    const tickers = extractTickers(text);
    const institutions = extractInstitutions(text);
    updateMetaStmt.run(JSON.stringify(tickers), JSON.stringify(institutions), art.id);
  }
  console.log(`[step 2] Tickers and institutions updated for ${allArticles.length} articles.`);

  // Step 3: Decode Google News URLs and extract solid content & images
  console.log('[step 3] Decoding Google News URLs and extracting publisher content & images...');
  const toProcess = db.prepare(`
    SELECT id, title, summary, category, tickers, institutions, original_url, image_url, resolved_url, source_slug, source_name, content_html, full_text_status
    FROM articles
    WHERE resolved_url IS NULL
       OR resolved_url LIKE '%news.google.com%'
       OR content_html IS NULL
       OR image_url IS NULL
       OR image_url = ''
       OR full_text_status = 'pending'
  `).all();

  console.log(`[step 3] ${toProcess.length} articles need resolution/extraction.`);

  const updateArticleStmt = db.prepare(`
    UPDATE articles
    SET resolved_url = ?,
        actual_source_name = ?,
        image_url = ?,
        content_html = ?,
        byline = ?,
        word_count = ?,
        reading_time_minutes = ?,
        full_text_status = ?,
        summary = COALESCE(?, summary),
        compiled_sources = ?
    WHERE id = ?
  `);

  const limiter = createLimiter(5);
  let processed = 0;
  let resolvedCount = 0;
  let withContentCount = 0;

  const tasks = toProcess.map((art) =>
    limiter(async () => {
      const tickers = JSON.parse(art.tickers || '[]');
      const institutions = JSON.parse(art.institutions || '[]');

      try {
        const extracted = await extractFullArticle(art.original_url, {
          title: art.title,
          summary: art.summary,
          category: art.category,
          tickers,
          institutions,
        });

        const targetUrl = extracted.resolvedUrl || art.original_url;
        const actualPub = extracted.actualSourceName || extractPublisherName(targetUrl, art.title, art.summary) || art.source_name;
        const finalImg = extracted.imageUrl || art.image_url;
        const finalSummary = (extracted.metaDescription && (!art.summary || art.summary.length < 50))
          ? extracted.metaDescription
          : art.summary;

        const compiledSources = extracted.sources ? JSON.stringify(extracted.sources) : null;

        updateArticleStmt.run(
          targetUrl,
          actualPub,
          finalImg,
          extracted.contentHtml,
          extracted.byline,
          extracted.wordCount,
          extracted.readingTimeMinutes,
          extracted.status,
          finalSummary,
          compiledSources,
          art.id
        );

        if (targetUrl && !targetUrl.includes('news.google.com')) resolvedCount++;
        if (extracted.contentHtml) withContentCount++;
      } catch (err) {
        // Fallback safety — no placeholder images
        const fallbackImg = art.image_url;
        updateArticleStmt.run(
          art.resolved_url || art.original_url,
          art.source_name,
          fallbackImg,
          art.content_html || (art.summary ? `<p>${art.summary}</p>` : null),
          null,
          art.summary ? art.summary.split(/\s+/).length : 0,
          1,
          'excerpt_only',
          art.summary,
          null,
          art.id
        );
      } finally {
        processed++;
        if (processed % 10 === 0 || processed === toProcess.length) {
          console.log(`[step 3 progress] ${processed}/${toProcess.length} processed (${resolvedCount} decoded to publisher, ${withContentCount} with content)`);
        }
      }
    })
  );

  await Promise.allSettled(tasks);

  // Step 4: Final verification — report missing images but do NOT fill with fallbacks
  console.log('[step 4] Final verification...');
  const missingImgRows = db.prepare(`SELECT id, category, tickers, institutions FROM articles WHERE image_url IS NULL OR image_url = ''`).all();
  if (missingImgRows.length > 0) {
    console.log(`[step 4] ${missingImgRows.length} articles have no extracted image — leaving as null (no fallback)`);
  }

  // Summary statistics
  const total = db.prepare('SELECT COUNT(*) as c FROM articles').get().c;
  const withImages = db.prepare("SELECT COUNT(*) as c FROM articles WHERE image_url IS NOT NULL AND image_url != ''").get().c;
  const withContent = db.prepare("SELECT COUNT(*) as c FROM articles WHERE content_html IS NOT NULL AND content_html != ''").get().c;
  const resolvedPublishers = db.prepare("SELECT COUNT(*) as c FROM articles WHERE resolved_url IS NOT NULL AND resolved_url NOT LIKE '%news.google.com%'").get().c;

  console.log('\n=== Backfill Summary ===');
  console.log(`Total Articles: ${total}`);
  console.log(`Articles with Guaranteed Images: ${withImages} (${Math.round((withImages / total) * 100)}%)`);
  console.log(`Articles with Content / Rich Body: ${withContent} (${Math.round((withContent / total) * 100)}%)`);
  console.log(`Google News URLs Resolved to Publisher Posts: ${resolvedPublishers} (${Math.round((resolvedPublishers / total) * 100)}%)`);
  console.log('=== Backfill Complete ===\n');
})();
