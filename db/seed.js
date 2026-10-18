// Creates a test user you can use to try the unlock flow.
// Exported as a function so server.js can auto-seed on first boot —
// useful on hosts (like Render's free tier) where you don't get a shell.
const bcrypt = require('bcryptjs');
const db = require('./index');

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const username = 'testuser';
  const pin = '1234';
  const pinHash = bcrypt.hashSync(pin, 10);
  // Optional: set TEST_CHAT_ID in your environment to pre-link this test
  // user to your own Telegram chat, so you can test without the manual
  // /start linking step.
  const chatId = process.env.TEST_CHAT_ID || null;
  // Starts LOCKED so you can test the unlock flow immediately.
  db.prepare(
    'INSERT INTO users (username, pin_hash, locked, telegram_chat_id) VALUES (?, ?, 1, ?)'
  ).run(username, pinHash, chatId);
  console.log(`Seeded locked test user: username="${username}" pin="${pin}"${chatId ? ' (Telegram pre-linked)' : ''}`);
}

if (require.main === module) {
  seedIfEmpty();
} else {
  module.exports = seedIfEmpty;
}
