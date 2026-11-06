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

    // Tunggu React render
    await delay(8000);

    // 1. Coba cari iframe dan beralih ke dalamnya jika ada
    for (const frame of page.mainFrame().childFrames()) {
      const url = frame.url();
      if (url.includes('login') || url.includes('signup') || url.includes('auth')) {
        await frame.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('button, a, div, span, p'));
          const target = elements.find(el => {
            const text = el.innerText ? el.innerText.toLowerCase() : '';
            return text.includes('email') || text.includes('continue');
          });
          if (target) target.click();
        }).catch(() => {});
      }
    }

    // 2. Klik paksa di frame utama (jika form tidak di iframe)
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a, div, span, p'));
      const target = elements.find(el => {
        const text = el.innerText ? el.innerText.toLowerCase() : '';
        return text.includes('email') || 
               text.includes('other login') || 
               text.includes('more options') || 
               text.includes('continue with');
      });
      if (target) target.click();
    }).catch(() => {});

    await delay(3000);

    // 3. Cari input email (termasuk di dalam iframe)
    let emailInput = null;
    try {
      emailInput = await page.waitForSelector(
        'input[type="email"], input[name="email"], input[placeholder*="email" i], ' +
        'input[autocomplete="email"], input[name="mobileOrEmail"], input[type="text"][placeholder*="Email" i]',
        { timeout: 15000, visible: true }
      );
    } catch (e) {
      // Jika gagal di main frame, coba cari di semua iframe
      for (const frame of page.mainFrame().childFrames()) {
        try {
          emailInput = await frame.waitForSelector(
            'input[type="email"], input[name="email"], input[placeholder*="email" i], input[name="mobileOrEmail"]',
            { timeout: 5000, visible: true }
          );
          if (emailInput) break;
        } catch (_) {}
      }
      if (!emailInput) throw e; // Lemparkan error asli jika semua iframe gagal
    }

    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email.address, { delay: 80 });

    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) await pwdInput.type(accountPassword, { delay: 80 });

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
    const currentUrl = page.url();
    const screenshotPath = `/tmp/capcut-fail-${Date.now()}.png`;
    
    // Ambil Screenshot
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    
    // Ambil Teks di layar untuk diagnosa
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
