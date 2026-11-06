// config.js
module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || 'ISI_TOKEN_BOT_TELEGRAM_ANDA',
  // Temp mail service: 'mailtm' (default) atau 'tempmail'
  TEMPMAIL_PROVIDER: process.env.TEMPMAIL_PROVIDER || 'mailtm',
  // Jumlah maksimal akun yang dibuat per perintah /farm
  MAX_FARM_BATCH: parseInt(process.env.MAX_FARM_BATCH || '5', 10),
  // Jeda antar pembuatan akun (ms) untuk menghindari rate limit
  FARM_DELAY_MS: parseInt(process.env.FARM_DELAY_MS || '8000', 10),
  // Mode headless untuk Puppeteer
  HEADLESS: process.env.HEADLESS !== 'false',
  // Timeout OTP (ms)
  OTP_TIMEOUT_MS: parseInt(process.env.OTP_TIMEOUT_MS || '120000', 10),
  // URL dasar CapCut
  CAPCUT_BASE: 'https://www.capcut.com',
  CAPCUT_API: 'https://api.capcut.com',
};
