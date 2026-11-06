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

    // Tunggu modal "Welcome to CapCut" muncul sepenuhnya
    await delay(6000);

    // KLIK FISIK: Gunakan elementHandle.click() agar React CapCut merespons
    console.log('Mencari tombol "Continue with email"...');
    const emailBtn = await page.waitForSelector('::-p-text(Continue with email)', { 
      timeout: 20000, 
      visible: true 
    });
    
    await emailBtn.click();
    console.log('Tombol email diklik, menunggu form input...');

    // Tunggu form email muncul
    await page.waitForSelector(
      'input[type="email"], input[name="email"], input[name="mobileOrEmail"], input[placeholder*="Email" i]',
      { timeout: 15000, visible: true }
    );

    // Ambil elemen input email
    const emailInput = await page.$('input[type="email"], input[name="email"], input[name="mobileOrEmail"], input[placeholder*="Email" i]');
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email.address, { delay: 100 });

    // Cari input password (biasanya muncul bersamaan)
    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) {
      await pwdInput.click({ clickCount: 3 });
      await pwdInput.type(accountPassword, { delay: 100 });
    }

    // Klik tombol submit/continue berikutnya (juga secara fisik)
    let submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      submitBtn = await page.waitForSelector('::-p-text(Continue)', { timeout: 5000 }).catch(() => null);
    }
    
    if (submitBtn) {
      await submitBtn.click();
    } else {
      // Fallback jika tombolnya tidak standar
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const target = buttons.find(btn => btn.innerText.toLowerCase().includes('continue'));
        if (target) target.click();
      });
    }

    await delay(5000);

    // Cek apakah perlu OTP
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
    const currentUrl = page.url();
    const screenshotPath = `/tmp/capcut-fail-${Date.now()}.png`;
    
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    await browser.close().catch(() => {});
    
    const newErr = new Error(`${err.message} | URL: ${currentUrl}\n\nTeks:\n"${bodyText.replace(/\n/g, ' ').substring(0, 200)}..."`);
    newErr.screenshotPath = screenshotPath;
    throw newErr;
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
  } catch (_) {}
  return null;
}

async function applyReferral(browser, referralLink) {
  if (!referralLink) return;
  const page = await browser.newPage();
  try {
    await page.goto(referralLink, { waitUntil: 'networkidle2', timeout: 45000 });
    await delay(5000);
  } catch (_) {
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
