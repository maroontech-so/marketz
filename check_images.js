require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const total = db.prepare("SELECT COUNT(*) as c FROM articles").get().c;
const withImg = db.prepare("SELECT COUNT(*) as c FROM articles WHERE image_url IS NOT NULL AND image_url != ''").get().c;
console.log("Total:", total, "With images:", withImg);
const recent = db.prepare("SELECT id, title, image_url FROM articles ORDER BY published_at DESC LIMIT 10").all();
recent.forEach(r => console.log(r.id, r.image_url ? "HAS IMAGE" : "NO IMAGE", r.title?.slice(0, 60)));