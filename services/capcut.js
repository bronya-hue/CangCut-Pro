// services/capcut.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('../config');

const LAUNCH_OPTS = {
  headless: config.HEADLESS,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--window-size=1366,768',
  ],
  defaultViewport: { width: 1366, height: 768 },
};

/**
 * Membuat akun CapCut baru.
 * @param {{address:string, password:string}} email  Kredensial email sementara
 * @param {string} accountPassword                 Password untuk akun CapCut
 * @returns {Promise<{email:string, password:string, proUntil:Date|null}>}
 */
async function registerCapCut(email, accountPassword) {
  const browser = await puppeteer.launch(LAUNCH_OPTS);
  const page = await browser.newPage();

  try {
    // 1. Buka halaman sign-up CapCut
    await page.goto(`${config.CAPCUT_BASE}/signup`, { waitUntil: 'networkidle2', timeout: 60000 });

    // 2. Isi email
    const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 20000 });
    await emailInput.type(email.address, { delay: 80 });

    // 3. Isi password
    const pwdInput = await page.$('input[type="password"]');
    if (pwdInput) await pwdInput.type(accountPassword, { delay: 80 });

    // 4. Klik tombol sign-up / continue
    const submitBtn = await page.$('button[type="submit"], button:has-text("Sign up"), button:has-text("Continue")');
    if (submitBtn) await submitBtn.click();

    // 5. Tunggu OTP dikirim (CapCut mungkin menampilkan modal verifikasi)
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => {});

    // 6. Jika ada field OTP di halaman, isi nanti setelah OTP didapat
    const otpInput = await page.$('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]');
    const needsOtpInPage = !!otpInput;

    return {
      email: email.address,
      password: accountPassword,
      needsOtpInPage,
      browser,
      page,
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Menyelesaikan verifikasi OTP di halaman yang sama.
 */
async function verifyOtp(page, otp) {
  const otpInput = await page.$('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]');
  if (!otpInput) throw new Error('Field OTP tidak ditemukan di halaman');

  await otpInput.click({ clickCount: 3 });
  await otpInput.type(otp, { delay: 100 });

  const verifyBtn = await page.$('button[type="submit"], button:has-text("Verify"), button:has-text("Confirm")');
  if (verifyBtn) await verifyBtn.click();

  await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => {});
}

/**
 * Mencoba mengklaim trial Pro setelah akun terverifikasi.
 * Mengembalikan tanggal kedaluwarsa Pro jika berhasil, atau null.
 */
async function claimProTrial(page) {
  try {
    // Cari banner / tombol "Try Pro free" atau "Claim trial"
    const claimBtn = await page.$(
      'a[href*="trial"], button:has-text("Try Pro"), button:has-text("Claim"), a:has-text("Pro")'
    );
    if (claimBtn) {
      await claimBtn.click();
      await page.waitForNetworkIdle({ idleTime: 3000, timeout: 30000 }).catch(() => {});
    }

    // Cek apakah ada indikasi Pro aktif
    const proIndicator = await page.$('[class*="pro-badge"], [data-testid*="pro"], text/Pro');
    if (proIndicator) {
      // Asumsikan trial 7 hari (atau 30 hari jika promo desktop)
      const days = 7; // bisa diperiksa dari teks halaman
      const proUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      return proUntil;
    }
  } catch (_) {
    // abaikan
  }
  return null;
}

/**
 * Alur lengkap: registrasi → OTP → klaim trial.
 */
async function createProAccount(emailCreds, otpFetcher) {
  const accountPassword = `Cp${Math.random().toString(36).slice(2, 12)}!`;
  const session = await registerCapCut(emailCreds, accountPassword);

  try {
    let proUntil = null;

    if (session.needsOtpInPage) {
      const otp = await otpFetcher();
      await verifyOtp(session.page, otp);
    }

    // Setelah verifikasi, coba klaim trial
    proUntil = await claimProTrial(session.page);

    return {
      email: session.email,
      password: session.password,
      proUntil,
    };
  } finally {
    await session.browser.close();
  }
}

module.exports = { createProAccount };
