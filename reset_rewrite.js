require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
db.prepare("UPDATE articles SET rewritten_html = NULL, rewrite_method = NULL WHERE id = ?").run("00de7d64-ad9a-498c-9e75-6adf4c513ad3");
console.log("Reset rewrite for article");