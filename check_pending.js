require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const rows = db.prepare('SELECT id, image_url, full_text_status, rights FROM articles WHERE full_text_status = "pending" AND image_url IS NOT NULL AND image_url != "" LIMIT 5').all();
rows.forEach(r => console.log(r.id, r.full_text_status, r.rights, r.image_url ? "HAS IMAGE" : "NO IMAGE"));