require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const row = db.prepare("SELECT id, title, content_html FROM articles WHERE id = 'c092d56c-3fe5-4743-a6e1-3b21dcfc65da'").get();
if (row) {
  console.log("ID:", row.id);
  console.log("Title:", row.title);
  console.log("HTML len:", row.content_html?.length);
  console.log("HTML end:", row.content_html?.slice(-500));
  console.log("---");
  console.log("Full HTML:", row.content_html);
}