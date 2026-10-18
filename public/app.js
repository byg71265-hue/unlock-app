// public/app.js
// Each page only ever talks to our own /api/* backend — nothing here
// stores or checks a secret itself, it just relays to the server.
// Flow: index.html (1) -> login-pin.html (2, PIN) -> verify-otp.html (3, OTP)

const api = (path, body) =>
  fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || 'Request failed');
      err.data = data;
      throw err;
    }
    return data;
  });

function setMsg(text, isError = false) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'msg' + (isError ? ' error' : '');
}

// ---------- index.html (page 1: lock notice) ----------
const checkBtn = document.getElementById('checkBtn');
if (checkBtn) {
  checkBtn.addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    if (!username) return setMsg('Enter a username', true);

    try {
      const status = await api('/account/lock-status', { username });
      if (!status.locked) {
        setMsg('This account is not locked.');
        return;
      }
      sessionStorage.setItem('unlock_username', username);
      window.location.href = 'login-pin.html';
    } catch (err) {
      setMsg(err.message, true);
    }
  });
}

// ---------- login-pin.html (page 2: PIN step, sends OTP) ----------
const pinBtn = document.getElementById('pinBtn');
if (pinBtn) {
  pinBtn.addEventListener('click', async () => {
    const username = sessionStorage.getItem('unlock_username');
    const pin = document.getElementById('pin').value;
    if (!username) {
      setMsg('Session expired — start again.', true);
      return;
    }
    try {
      await api('/account/pin-attempt', { username, pin });
      window.location.href = 'verify-otp.html';
    } catch (err) {
      if (err.message.includes('Telegram not linked')) {
        const linkRes = await api('/link/start', { username });
        document.getElementById('linkBox').hidden = false;
        document.getElementById('telegramLink').href = linkRes.telegram_deep_link;
        setMsg('Link Telegram first, then click continue.');
      } else {
        setMsg(err.message, true);
      }
    }
  });

  const linkDoneBtn = document.getElementById('linkDoneBtn');
  if (linkDoneBtn) {
    linkDoneBtn.addEventListener('click', async () => {
      const username = sessionStorage.getItem('unlock_username');
      const pin = document.getElementById('pin').value;
      try {
        await api('/account/pin-attempt', { username, pin });
        window.location.href = 'verify-otp.html';
      } catch (err) {
        setMsg(err.message, true);
      }
    });
  }
}

// ---------- verify-otp.html (page 3: OTP step, reveals PIN result) ----------
const verifyBtn = document.getElementById('verifyBtn');
if (verifyBtn) {
  verifyBtn.addEventListener('click', async () => {
    const username = sessionStorage.getItem('unlock_username');
    const otp = document.getElementById('otp').value.trim();
    try {
      const result = await api('/account/unlock/verify', { username, otp });
      setMsg(result.message);
      sessionStorage.removeItem('unlock_username');
      // Redirect to your real site/dashboard here.
    } catch (err) {
      setMsg(err.message, true);
      if (err.data && err.data.retryPin) {
        setTimeout(() => { window.location.href = 'login-pin.html'; }, 1500);
      }
    }
  });
  }
