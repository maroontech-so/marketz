require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const rows = db.prepare("SELECT id, title, content_html FROM articles WHERE title LIKE '%Proparco%' OR title LIKE '%green%' OR title LIKE '%sustainable%' ORDER BY published_at DESC LIMIT 5").all();
rows.forEach(r => {
  console.log("ID:", r.id);
  console.log("Title:", r.title);
  console.log("HTML len:", r.content_html?.length);
  console.log("HTML end:", r.content_html?.slice(-300));
  console.log("---");
});