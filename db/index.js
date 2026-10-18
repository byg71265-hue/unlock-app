// db/index.js
// SQLite is fine for small-to-medium user bases. Swap to Postgres later by
// replacing this file only — nothing else in the app talks to the DB driver
// directly, it all goes through the functions exported below.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  telegram_chat_id TEXT,          -- NULL until the user links their Telegram
  telegram_link_code TEXT,        -- one-time code used to link a chat_id
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,  -- 0 = unlocked, 1 = locked
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
