require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const row = db.prepare("SELECT id, title, content_html, rewritten_html, full_text_status FROM articles WHERE id = '00de7d64-ad9a-498c-9e75-6adf4c513ad3'").get();
if (row) {
  console.log("ID:", row.id);
  console.log("Title:", row.title);
  console.log("Status:", row.full_text_status);
  console.log("content_html len:", row.content_html?.length);
  console.log("rewritten_html len:", row.rewritten_html?.length);
  console.log("rewritten_html end:", row.rewritten_html?.slice(-300));
}