// services/capcut.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('../config');

const LAUNCH_OPTS = {
  headless: config.HEADLESS,
  ...(config.CHROME_PATH ? { executablePath: config.CHROME_PATH } : {}),
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--window-size=1366,768',
  ],
  defaultViewport: { width: 1366, height: 768 },
};

async function registerCapCut(email, accountPassword) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  const page = await browser.newPage();
  try {
    await page.goto(`${config.CAPCUT_BASE}/signup`, { waitUntil: 'networkidle2', timeout: 60000 });

    const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 20000 });
    await emailInput.type(email.address, { delay: 80 });

    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) await pwdInput.type(accountPassword, { delay: 80 });

    const submitBtn = await page.$('button[type="submit"], button:has-text("Sign up"), button:has-text("Continue")');
    if (submitBtn) await submitBtn.click();

    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => {});

    const otpInput = await page.$('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]');
    return { email: email.address, password: accountPassword, needsOtpInPage: !!otpInput, browser, page };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function verifyOtp(page, otp) {
  const otpInput = await page.$('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]');
  if (!otpInput) throw new Error('Field OTP tidak ditemukan di halaman');
  await otpInput.click({ clickCount: 3 });
  await otpInput.type(otp, { delay: 100 });
  const verifyBtn = await page.$('button[type="submit"], button:has-text("Verify"), button:has-text("Confirm")');
  if (verifyBtn) await verifyBtn.click();
  await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => {});
}

async function claimProTrial(page) {
  try {
    const claimBtn = await page.$(
      'a[href*="trial"], button:has-text("Try Pro"), button:has-text("Claim"), a:has-text("Pro")'
    );
    if (claimBtn) {
      await claimBtn.click();
      await page.waitForNetworkIdle({ idleTime: 3000, timeout: 30000 }).catch(() => {});
    }
    const proIndicator = await page.$('[class*="pro-badge"], [data-testid*="pro"]');
    if (proIndicator) {
      return new Date(Date.now() + 7 * 86400000);
    }
  } catch (_) {}
  return null;
}

async function applyReferral(browser, referralLink) {
  if (!referralLink) return;
  const page = await browser.newPage();
  try {
    await page.goto(referralLink, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));
  } catch (_) {}
  finally { await page.close().catch(() => {}); }
}

async function createProAccount(emailCreds, otpFetcher, referralLink = null) {
  const accountPassword = `Cp${Math.random().toString(36).slice(2, 12)}!`;
  const session = await registerCapCut(emailCreds, accountPassword);

  try {
    if (referralLink) await applyReferral(session.browser, referralLink);

    if (session.needsOtpInPage) {
      const otp = await otpFetcher();
      await verifyOtp(session.page, otp);
    }

    const proUntil = await claimProTrial(session.page);
    return {
      email: session.email,
      password: session.password,
      proUntil,
    };
  } finally {
    await session.browser.close().catch(() => {});
  }
}

// >>> Baris ini yang wajib ada agar tidak muncul "is not a function" <<<
module.exports = { createProAccount, registerCapCut, verifyOtp, claimProTrial };
