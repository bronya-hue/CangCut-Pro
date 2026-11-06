// services/tempmail.js
const axios = require('axios');

const MAILTM_BASE = 'https://api.mail.tm';

async function withRetry(fn, label, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Retry hanya untuk 429 / 5xx / network error
      if (status && status !== 429 && status < 500) throw err;
      const wait = status === 429 ? 15000 * attempt : 2000 * attempt;
      console.warn(`[tempmail] ${label} gagal (attempt ${attempt}/${maxAttempts}): ${err.message}. Retry dalam ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function createInbox() {
  const domain = await withRetry(async () => {
    const { data } = await axios.get(`${MAILTM_BASE}/domains`, { timeout: 15000 });
    return data['hydra:member'][0].domain;
  }, 'get-domain');

  const local = `capcut${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const address = `${local}@${domain}`;
  const password = `P@ss${Math.random().toString(36).slice(2, 10)}!`;

  await withRetry(
    () => axios.post(`${MAILTM_BASE}/accounts`, { address, password }, { timeout: 15000 }),
    'create-account'
  );

  const tokenRes = await withRetry(
    () => axios.post(`${MAILTM_BASE}/token`, { address, password }, { timeout: 15000 }),
    'login-token'
  );

  return { address, password, token: tokenRes.data.token, id: tokenRes.data.id };
}

async function fetchLatestOtp(token, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { data } = await axios.get(`${MAILTM_BASE}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      const messages = data['hydra:member'] || [];
      for (const msg of messages) {
        const { data: full } = await axios.get(`${MAILTM_BASE}/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        });
        const text = (full.text || '') + (full.html ? full.html.join(' ') : '');
        const match = text.match(/\b(\d{4,8})\b/);
        if (match) return match[1];
      }
    } catch (err) {
      // 429 saat polling: tunggu lebih lama, jangan spam
      if (err?.response?.status === 429) {
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('OTP tidak ditemukan dalam batas waktu');
}

module.exports = { createInbox, fetchLatestOtp };
