// node scripts/backfill-images.js
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const Parser = require('rss-parser');

const db = new Database(path.join(__dirname, '..', 'fincapita.sqlite'));

// ── Paste the same parser config from server.js ─────────────────────────────
const parser = new Parser({
  timeout: 12000,
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

// ── Paste resolveUrl / isUsableImage / extractImage from the fix above ──────
// (identical functions, no changes needed)

const rows = db
  .prepare(`SELECT id, original_url, source_slug FROM articles WHERE image_url IS NULL OR image_url = ''`)
  .all();

console.log(`[backfill] ${rows.length} rows need an image`);

const bySource = new Map();
for (const r of rows) {
  if (!bySource.has(r.source_slug)) bySource.set(r.source_slug, []);
  bySource.get(r.source_slug).push(r);
}

const update = db.prepare(`UPDATE articles SET image_url = ? WHERE id = ?`);

(async () => {
  let filled = 0;
  for (const [slug, pending] of bySource) {
    const src = db.prepare(`SELECT feed_url FROM sources WHERE slug = ?`).get(slug);
    if (!src?.feed_url) {
      console.warn(`[backfill] ${slug}: no feed_url, skipping ${pending.length} rows`);
      continue;
    }

    let feed;
    try {
      feed = await parser.parseURL(src.feed_url);
    } catch (err) {
      console.warn(`[backfill] ${slug}: feed fetch failed — ${err.message}`);
      continue;
    }

    const itemByUrl = new Map();
    for (const item of feed.items || []) {
      if (item.link) itemByUrl.set(item.link, item);
    }

    for (const row of pending) {
      const item = itemByUrl.get(row.original_url);
      if (!item) continue;
      const img = extractImage(item, row.original_url, src.feed_url);
      if (img) {
        update.run(img, row.id);
        filled += 1;
      }
    }
    console.log(`[backfill] ${slug}: done`);
  }
  console.log(`[backfill] filled ${filled} of ${rows.length} rows`);
})();
