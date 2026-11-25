require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
db.prepare("UPDATE articles SET full_text_status = 'pending', content_html = NULL, rewritten_html = NULL WHERE id = ?").run("910e9c21-7765-4cc4-8631-1e97385abf75");
console.log("Reset article for re-extraction");