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
    await page.waitForSelector('button', { timeout: 30000 });
    await delay(3000);

    // Klik tombol "Continue with email" secara spesifik menggunakan teks persis
    const clicked = await page.evaluate(() => {
      // Cari semua button, lalu filter yang teksnya persis "Continue with email"
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find(btn => {
        const text = btn.innerText ? btn.innerText.trim() : '';
        return text === 'Continue with email';
      });
      
      if (target) {
        target.click();
        return true;
      }
      
      // Fallback: jika tidak ketemu, cari elemen apa pun yang mengandung teks tersebut
      const allElements = Array.from(document.querySelectorAll('*'));
      const fallbackTarget = allElements.find(el => {
        const text = el.innerText ? el.innerText.trim() : '';
        return text === 'Continue with email' && el.tagName !== 'HTML' && el.tagName !== 'BODY';
      });
      
      if (fallbackTarget) {
        fallbackTarget.click();
        return true;
      }
      
      return false;
    });

    if (!clicked) {
      throw new Error('Tombol "Continue with email" tidak ditemukan di halaman.');
    }

    // Tunggu form email muncul (biasanya muncul di tempat yang sama setelah klik)
    await delay(3000);

    // Gunakan waitForFunction untuk memastikan input email benar-benar ada di DOM
    await page.waitForFunction(() => {
      return document.querySelector('input[type="email"]') !== null ||
             document.querySelector('input[name="email"]') !== null ||
             document.querySelector('input[name="mobileOrEmail"]') !== null ||
             document.querySelector('input[placeholder*="Email" i]') !== null;
    }, { timeout: 15000 });

    // Dapatkan elemen input email yang pertama terlihat
    const emailInput = await page.evaluateHandle(() => {
      const selectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="mobileOrEmail"]',
        'input[placeholder*="Email" i]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el; // pastikan terlihat
      }
      return null;
    });

    if (!emailInput) {
      throw new Error('Form input email tidak muncul setelah mengklik tombol.');
    }

    // Ketik email
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email.address, { delay: 80 });

    // Cari input password (biasanya muncul bersamaan)
    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) {
      await pwdInput.click({ clickCount: 3 });
      await pwdInput.type(accountPassword, { delay: 80 });
    }

    // Klik tombol submit/continue berikutnya
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find(btn => {
        const text = btn.innerText ? btn.innerText.toLowerCase() : '';
        return text.includes('continue') || text.includes('sign up') || text.includes('next');
      });
      if (target) target.click();
    });

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
    
    const newErr = new Error(`${err.message} | URL: ${currentUrl}\n\nTeks di layar:\n"${bodyText.replace(/\n/g, ' ').substring(0, 200)}..."`);
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
