// services/capcut.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('../config');
const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
    await page.goto(`${config.CAPCUT_BASE}/signup`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Tunggu Cloudflare / React load (pengganti waitForNetworkIdle)
    await delay(5000);

    // Deteksi Cloudflare challenge
    const cfChallenge = await page.$(
      '#challenge-form, #cf-challenge-running, .cf-browser-verification, iframe[src*="challenges.cloudflare.com"]'
    );
    if (cfChallenge) {
      await page.screenshot({ path: '/tmp/capcut-cf.png', fullPage: true }).catch(() => {});
      throw new Error(
        'Cloudflare challenge terdeteksi — IP Railway diblokir. Perlu proxy residensial atau puppeteer-real-browser.'
      );
    }

    // Klik opsi "Other login methods" / "Continue with email" (Sintaks Puppeteer)
    const emailOption = await page.$(
      'button::-p-text(Email), div[role="button"]::-p-text(Email), ' +
      'button::-p-text(Continue with email), button::-p-text(Sign up with email), ' +
      'button::-p-text(Other login methods), div[role="button"]::-p-text(Other login methods), ' +
      'button::-p-text(More options), div[role="button"]::-p-text(More options), ' +
      'button::-p-text(Log in another way), div[role="button"]::-p-text(Log in another way)'
    );
    if (emailOption) {
      await emailOption.click().catch(() => {});
      await delay(3000);
    }

    // Selector email yang lebih luas
    const emailInput = await page.waitForSelector(
      'input[type="email"], input[name="email"], input[placeholder*="email" i], input[autocomplete="email"]',
      { timeout: 30000, visible: true }
    );

    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email.address, { delay: 80 });

    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) await pwdInput.type(accountPassword, { delay: 80 });

    // Klik tombol Sign up (Sintaks Puppeteer)
    const submitBtn = await page.$(
      'button[type="submit"], button::-p-text(Sign up), button::-p-text(Continue), button::-p-text(Next)'
    );
    if (submitBtn) await submitBtn.click();

    await delay(5000);

    const otpInput = await page.$(
      'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]'
    );

    return {
      email: email.address,
      password: accountPassword,
      needsOtpInPage: !!otpInput,
      browser,
      page,
    };
  } catch (err) {
    await page.screenshot({ path: '/tmp/capcut-fail.png', fullPage: true }).catch(() => {});
    await browser.close().catch(() => {});
    throw err;
  }
}

async function verifyOtp(page, otp) {
  const otpInput = await page.$(
    'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]'
  );
  if (!otpInput) throw new Error('Field OTP tidak ditemukan di halaman');

  await otpInput.click({ clickCount: 3 });
  await otpInput.type(otp, { delay: 100 });

  const verifyBtn = await page.$(
    'button[type="submit"], button::-p-text(Verify), button::-p-text(Confirm), button::-p-text(Next)'
  );
  if (verifyBtn) await verifyBtn.click();

  await delay(5000);
}

async function claimProTrial(page) {
  try {
    const claimBtn = await page.$(
      'a[href*="trial"], button::-p-text(Try Pro), button::-p-text(Claim), a::-p-text(Pro)'
    );
    if (claimBtn) {
      await claimBtn.click();
      await delay(5000);
    }

    const proIndicator = await page.$('[class*="pro-badge"], [data-testid*="pro"]');
    if (proIndicator) {
      return new Date(Date.now() + 7 * 86400000);
    }
  } catch (_) {
    // abaikan
  }
  return null;
}

async function applyReferral(browser, referralLink) {
  if (!referralLink) return;
  const page = await browser.newPage();
  try {
    await page.goto(referralLink, { waitUntil: 'networkidle2', timeout: 45000 });
    await delay(5000);
  } catch (_) {
    // abaikan
  } finally {
    await page.close().catch(() => {});
  }
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

module.exports = { createProAccount, registerCapCut, verifyOtp, claimProTrial };
