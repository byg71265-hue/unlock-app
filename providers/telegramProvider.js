// providers/telegramProvider.js
//
// Stand-in for an SMS provider (e.g. Twilio Verify) during development.
// Exposes the same two functions any provider here must have:
//   sendMessage(destination, text)  -> delivers a message to the user
//   isReady()                       -> whether the provider is configured
//
// `destination` here is a Telegram chat_id (a user must have messaged the
// bot at least once for a chat_id to exist — see the /link flow in
// routes/auth.js). When you move to Twilio, `destination` becomes a phone
// number instead; nothing else in the app needs to change if you keep this
// same function signature in a twilioProvider.js and swap the require()
// in routes/auth.js.

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (token) {
  // polling:true is fine for development; for production behind a real
  // domain you'd switch to webhooks instead.
  bot = new TelegramBot(token, { polling: true });
}

function isReady() {
  return !!bot;
}

async function sendMessage(chatId, text) {
  if (!bot) throw new Error('Telegram bot not configured (TELEGRAM_BOT_TOKEN missing)');
  if (!chatId) throw new Error('No chat_id — user has not linked Telegram yet');
  return bot.sendMessage(chatId, text);
}

// Handles the linking step: user sends /start <linkCode> to the bot,
// we match linkCode to a pending user row and store their chat_id.
function registerLinkHandler(onLinkCode) {
  if (!bot) return;
  bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
    const code = match && match[1] ? match[1].trim() : null;
    const chatId = msg.chat.id;
    if (!code) {
      bot.sendMessage(chatId, 'Send the link code shown on the website to connect your account.');
      return;
    }
    onLinkCode(code, String(chatId), (ok) => {
      bot.sendMessage(
        chatId,
        ok
          ? '✅ Telegram linked to your account. You can now receive unlock codes here.'
          : '❌ That link code is invalid or expired. Generate a new one on the website.'
      );
    });
  });
}

module.exports = { isReady, sendMessage, registerLinkHandler };
