require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const seedIfEmpty = require('./db/seed');

seedIfEmpty(); // creates the locked testuser/1234 account on first boot

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'change-this-in-prod'],
  maxAge: 30 * 60 * 1000 // 30 min
}));

app.use('/api', authRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Unlock app running at http://localhost:${PORT}`);
  console.log(`Run "node db/seed.js" once to create a test user.`);
});
