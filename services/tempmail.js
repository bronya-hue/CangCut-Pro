// services/tempmail.js
const axios = require('axios');

const MAILTM_BASE = 'https://api.mail.tm';

async function createInbox() {
  // 1. Ambil domain yang tersedia
  const { data: domains } = await axios.get(`${MAILTM_BASE}/domains`, { timeout: 15000 });
  const domain = domains['hydra:member'][0].domain;

  // 2. Buat alamat & password acak
  const local = `capcut${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const address = `${local}@${domain}`;
  const password = `P@ss${Math.random().toString(36).slice(2, 10)}!`;

  // 3. Daftarkan akun email
  await axios.post(`${MAILTM_BASE}/accounts`, { address, password }, { timeout: 15000 });

  // 4. Login untuk mendapat token
  const { data: tokenRes } = await axios.post(
    `${MAILTM_BASE}/token`,
    { address, password },
    { timeout: 15000 }
  );

  return {
    address,
    password,
    token: tokenRes.token,
    id: tokenRes.id,
  };
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
        // Cari 4–8 digit (OTP CapCut biasanya 6 digit)
        const match = text.match(/\b(\d{4,8})\b/);
        if (match) return match[1];
      }
    } catch (_) {
      // diamkan, coba lagi
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('OTP tidak ditemukan dalam batas waktu');
}

module.exports = { createInbox, fetchLatestOtp };
