// services/referral.js
const config = require('../config');

/**
 * Membuka link referral di tab baru (dalam sesi Puppeteer yang sama).
 * Link referral formatnya: https://www.capcut.com/activity/...?invite_code=XXX
 */
async function applyReferral(browser, referralLink) {
  if (!referralLink) return;
  const page = await browser.newPage();
  try {
    await page.goto(referralLink, { waitUntil: 'networkidle2', timeout: 45000 });
    // Tunggu sebentar agar CapCut mencatat referral
    await new Promise(r => setTimeout(r, 5000));
  } catch (_) {
    // abaikan
  } finally {
    await page.close();
  }
}

module.exports = { applyReferral };
