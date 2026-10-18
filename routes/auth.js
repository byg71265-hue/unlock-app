// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const provider = require('../providers/telegramProvider');

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 5;      // failed PIN attempts before lockout
const OTP_TTL_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

// Generic rate limiting on all auth endpoints to slow brute-forcing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
router.use(authLimiter);

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function generateLinkCode() {
  return crypto.randomBytes(4).toString('hex'); // short, human-typeable
}

// Wire up the Telegram /start <code> handler to actually attach chat_id.
provider.registerLinkHandler((linkCode, chatId, callback) => {
  const user = db.prepare('SELECT id FROM users WHERE telegram_link_code = ?').get(linkCode);
  if (!user) return callback(false);
  db.prepare('UPDATE users SET telegram_chat_id = ?, telegram_link_code = NULL WHERE id = ?')
    .run(chatId, user.id);
  callback(true);
});

// --- 0. Generate a link code so a user can connect Telegram (one-time setup) ---
router.post('/link/start', (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'No such account' });

  const code = generateLinkCode();
  db.prepare('UPDATE users SET telegram_link_code = ? WHERE id = ?').run(code, user.id);

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'your_bot';
  res.json({
    message: 'Open Telegram and send this to the bot to link your account',
    link_code: code,
    telegram_deep_link: `https://t.me/${botUsername}?start=${code}`
  });
});

// --- 1. Check lock status ---
router.post('/account/lock-status', (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT username, locked FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'No such account' });
  res.json({ locked: !!user.locked });
});

// --- 2. PIN step (page 2): checked against the real hash immediately, but
// the result is kept server-side only — the client gets no right/wrong
// feedback here. This is what makes "PIN first" safe: nothing is revealed
// yet, so it can't be used as a brute-force oracle. The result is only
// revealed once OTP (page 3) succeeds. This also sends the OTP, so page 2
// doubles as the "someone is attempting to unlock" trigger. ---
router.post('/account/pin-attempt', async (req, res) => {
  const { username, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'No such account' });
  if (!user.locked) return res.status(400).json({ error: 'Account is not locked' });
  if (!user.telegram_chat_id) {
    return res.status(400).json({ error: 'Telegram not linked yet. Use /link/start first.' });
  }

  // Check for real, but DO NOT return this to the client yet.
  const pinValid = bcrypt.compareSync(String(pin), user.pin_hash);
  req.session.unlockFlow = { username, pinValid };

  const code = generateOtp();
  const codeHash = bcrypt.hashSync(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO otp_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, codeHash, expiresAt);

  try {
    await provider.sendMessage(
      user.telegram_chat_id,
      `Unlock attempt received. Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Do not share this with anyone.`
    );
  } catch (err) {
    return res.status(502).json({ error: 'Could not send code: ' + err.message });
  }

  // Deliberately generic — never hints whether the PIN was right.
  res.json({ message: 'A code has been sent to your Telegram.' });
});

// --- 3. Verify OTP (page 3) -> only now do we reveal/act on the PIN result ---
router.post('/account/unlock/verify', (req, res) => {
  const { username, otp } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'No such account' });

  const otpRow = db.prepare(
    `SELECT * FROM otp_codes WHERE user_id = ? AND used = 0
     ORDER BY created_at DESC LIMIT 1`
  ).get(user.id);

  if (!otpRow) return res.status(400).json({ error: 'No active code. Go back and try again.' });
  if (new Date(otpRow.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Code expired. Go back and try again.' });
  }
  if (otpRow.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Go back and try again.' });
  }

  const otpValid = bcrypt.compareSync(String(otp), otpRow.code_hash);
  db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);

  if (!otpValid) {
    return res.status(400).json({ error: 'Incorrect code' });
  }
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRow.id);

  // OTP alone proves "this is really them" via the out-of-band channel.
  // Now, and only now, check what the PIN step found.
  const flow = req.session.unlockFlow;
  delete req.session.unlockFlow;

  if (!flow || flow.username !== username) {
    return res.status(400).json({ error: 'Session expired. Start again from the PIN step.', retryPin: true });
  }

  if (!flow.pinValid) {
    // Identity confirmed via OTP, but the PIN they entered was wrong —
    // send them back to re-enter it (account stays locked until it's right).
    return res.status(401).json({ error: 'Incorrect PIN. Please go back and try again.', retryPin: true });
  }

  db.prepare('UPDATE users SET locked = 0, failed_attempts = 0 WHERE id = ?').run(user.id);
  req.session.user = username;
  res.json({ message: 'Logged in successfully.' });
});

// --- 4. Normal PIN login, for already-unlocked accounts on a future visit ---
router.post('/login', (req, res) => {
  const { username, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'No such account' });
  if (user.locked) return res.status(403).json({ error: 'Account is locked. Unlock it first.' });

  const valid = bcrypt.compareSync(String(pin), user.pin_hash);
  if (!valid) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    db.prepare('UPDATE users SET failed_attempts = ?, locked = ? WHERE id = ?')
      .run(attempts, lock ? 1 : 0, user.id);
    return res.status(401).json({
      error: lock ? 'Too many failed attempts — account locked' : 'Incorrect PIN',
      locked: lock
    });
  }

  db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(user.id);
  req.session.user = username;
  res.json({ message: 'Logged in' });
});

module.exports = router;
