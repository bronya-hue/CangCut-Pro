// index.js
const TelegramBot = require('node-telegram-bot-api');
const { nanoid } = require('nanoid');

const config = require('./config');
const { initDB, addAccount, updateAccount, getAccounts, setMainReferral, getMainReferral } = require('./db');
const { createInbox, fetchLatestOtp } = require('./services/tempmail');
const { createProAccount } = require('./services/capcut');
const Queue = require('./utils/queue');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
const farmQueue = new Queue(config.FARM_DELAY_MS);

// ---------- Util ----------
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toISOString().slice(0, 10);
}

function daysLeft(until) {
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until) - Date.now()) / (1000 * 60 * 60 * 24)));
}

// ---------- Commands ----------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
🤖 *CapCut Farm Bot*

Perintah:
/farm <jumlah>  — Buat akun Pro baru (maks ${config.MAX_FARM_BATCH})
/accounts       — Lihat semua akun & status Pro
/setreferral <link> — Set link referral akun utama
/status         — Info referral & antrian
/help           — Bantuan

_Contoh:_ /farm 3
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/farm(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const count = Math.min(parseInt(match[1] || '1', 10), config.MAX_FARM_BATCH);

  const referralLink = await getMainReferral();
  const statusMsg = await bot.sendMessage(chatId, `⏳ Memulai farming ${count} akun...`);

  for (let i = 0; i < count; i++) {
    try {
      await farmQueue.add(async () => {
        // 1. Buat inbox sementara
        const inbox = await createInbox();

        // 2. Buat akun CapCut + verifikasi OTP + klaim Pro
        const result = await createProAccount(
          { address: inbox.address, password: inbox.password },
          () => fetchLatestOtp(inbox.token, config.OTP_TIMEOUT_MS),
          referralLink
        );

        // 3. Simpan
        const id = nanoid(10);
        await addAccount({
          id,
          email: result.email,
          password: result.password,
          createdAt: new Date().toISOString(),
          proUntil: result.proUntil ? result.proUntil.toISOString() : null,
          status: result.proUntil ? 'PRO' : 'FREE',
          referralLink: referralLink || null,
        });

        return { id, ...result };
      }).then(async (res) => {
        const sisa = daysLeft(res.proUntil);
        await bot.sendMessage(
          chatId,
          `✅ *Akun ${i + 1}/${count} dibuat*\n📧 \`${res.email}\`\n🔑 \`${res.password}\`\n⭐ Pro: ${res.proUntil ? 'Aktif' : 'Tidak aktif'} (${sisa} hari)`,
          { parse_mode: 'Markdown' }
        );
      });
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Akun ${i + 1}/${count} gagal: ${err.message}`);
    }
  }

  await bot.editMessageText(`🏁 Farming selesai (${count} akun).`, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
  });
});

bot.onText(/\/accounts/, async (msg) => {
  const chatId = msg.chat.id;
  const accounts = await getAccounts();
  if (accounts.length === 0) return bot.sendMessage(chatId, 'Belum ada akun. Jalankan /farm');

  let text = '📋 *Daftar Akun CapCut*\n\n';
  accounts.slice(-20).reverse().forEach((a, i) => {
    const sisa = daysLeft(a.proUntil);
    text += `${i + 1}. \`${a.email}\`\n   ⭐ ${a.status} | sisa ${sisa} hari\n\n`;
  });
  if (accounts.length > 20) text += `_…dan ${accounts.length - 20} akun lainnya._`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/setreferral\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const link = match[1].trim();
  if (!link.includes('capcut.com')) {
    return bot.sendMessage(chatId, '❌ Link harus dari domain capcut.com');
  }
  await setMainReferral(link);
  bot.sendMessage(chatId, `✅ Link referral disimpan:\n\`${link}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const ref = await getMainReferral();
  const accounts = await getAccounts();
  const proCount = accounts.filter(a => a.status === 'PRO' && daysLeft(a.proUntil) > 0).length;
  bot.sendMessage(chatId, `
📊 *Status*
🔗 Referral: ${ref ? '✅ Terpasang' : '❌ Belum diset'}
👥 Total akun: ${accounts.length}
⭐ Akun Pro aktif: ${proCount}
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `
*Bantuan*
• /farm <n> — buat n akun Pro (maks ${config.MAX_FARM_BATCH} per batch)
• /accounts — daftar akun
• /setreferral <link> — pasang link referral akun utama
• /status — ringkasan

Bot bekerja dengan membuat akun CapCut via email sementara, memverifikasi OTP, lalu mengklaim trial Pro. Referral loop memungkinkan akun utama terus mendapat bonus hari.
  `, { parse_mode: 'Markdown' });
});

// ---------- Init ----------
(async () => {
  await initDB();
  console.log('Bot berjalan...');
})();
