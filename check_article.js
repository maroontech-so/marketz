require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const row = db.prepare('SELECT id, title, content_html, source_name, original_url FROM articles WHERE id = ?').get("910e9c21-7765-4cc4-8631-1e97385abf75");
console.log("Title:", row.title);
console.log("Source:", row.source_name);
console.log("URL:", row.original_url);
console.log("HTML:", row.content_html?.slice(0, 500));