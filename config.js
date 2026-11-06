// config.js
module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || 'ISI_TOKEN',
  TEMPMAIL_PROVIDER: process.env.TEMPMAIL_PROVIDER || 'mailtm',
  MAX_FARM_BATCH: parseInt(process.env.MAX_FARM_BATCH || '3', 10),
  FARM_DELAY_MS: parseInt(process.env.FARM_DELAY_MS || '15000', 10),
  HEADLESS: process.env.HEADLESS !== 'false',
  OTP_TIMEOUT_MS: parseInt(process.env.OTP_TIMEOUT_MS || '180000', 10),
  CAPCUT_BASE: 'https://www.capcut.com',
  CAPCUT_API: 'https://api.capcut.com',
  CHROME_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
};
