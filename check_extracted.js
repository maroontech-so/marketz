require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const row = db.prepare("SELECT id, title, content_html, full_text_status FROM articles WHERE full_text_status = 'extracted' ORDER BY published_at DESC LIMIT 5").all();
row.forEach(r => {
  console.log("ID:", r.id);
  console.log("Title:", r.title);
  console.log("Status:", r.full_text_status);
  console.log("HTML len:", r.content_html?.length);
  console.log("HTML end:", r.content_html?.slice(-500));
  console.log("---");
});