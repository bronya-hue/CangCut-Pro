// index.js
const TelegramBot = require('node-telegram-bot-api');
const { nanoid } = require('nanoid');

const config = require('./config');
const { initDB, addAccount, getAccounts, setMainReferral, getMainReferral } = require('./db');
const { createInbox, fetchLatestOtp } = require('./services/tempmail');
const { createProAccount } = require('./services/capcut');
const Queue = require('./utils/queue');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
const farmQueue = new Queue(config.FARM_DELAY_MS);

// chatId yang sedang menunggu input link referral
const awaitingReferral = new Set();
const ACCOUNTS_PER_PAGE = 5;

function daysLeft(until) {
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until) - Date.now()) / 86400000));
}

// ---------- Keyboard builders ----------
function mainMenu() {
  const farmRow = [];
  if (config.MAX_FARM_BATCH >= 1) farmRow.push({ text: '🌾 Farm 1', callback_data: 'farm:1' });
  if (config.MAX_FARM_BATCH >= 3) farmRow.push({ text: '🌾 Farm 3', callback_data: 'farm:3' });
  if (config.MAX_FARM_BATCH >= 5) farmRow.push({ text: '🌾 Farm 5', callback_data: 'farm:5' });
  if (config.MAX_FARM_BATCH >= 10) farmRow.push({ text: '🌾 Farm 10', callback_data: 'farm:10' });

  return {
    inline_keyboard: [
      farmRow,
      [
        { text: '📋 Akun', callback_data: 'accounts:0' },
        { text: '📊 Status', callback_data: 'status' },
      ],
      [
        { text: '🔗 Set Referral', callback_data: 'referral:set' },
        { text: '🗑 Hapus Referral', callback_data: 'referral:clear' },
      ],
    ],
  };
}

function backMenu() {
  return { inline_keyboard: [[{ text: '⬅️ Menu', callback_data: 'menu:main' }]] };
}

// ---------- /start ----------
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '*CapCut Farm Bot*\n\nPilih aksi dari menu di bawah:',
    { parse_mode: 'Markdown', reply_markup: mainMenu() }
  );
});

// ---------- /farm (fallback teks) ----------
bot.onText(/\/farm(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const n = Math.min(parseInt(match[1] || '1', 10), config.MAX_FARM_BATCH);
  runFarm(chatId, n);
});

// ---------- /setreferral (fallback teks) ----------
bot.onText(/\/setreferral\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const link = match[1].trim();
  if (!link.includes('capcut.com')) {
    return bot.sendMessage(chatId, '❌ Link harus dari domain capcut.com', { reply_markup: mainMenu() });
  }
  await setMainReferral(link);
  bot.sendMessage(chatId, `✅ Referral disimpan:\n\`${link}\``, {
    parse_mode: 'Markdown',
    reply_markup: mainMenu(),
  });
});

// ---------- Inti farming ----------
// index.js — tambahkan di atas runFarm
let farmInProgress = false;

async function runFarm(chatId, count) {
  if (farmInProgress) {
    return bot.sendMessage(chatId, '⏳ Masih ada farming berjalan. Tunggu selesai dulu.', { reply_markup: mainMenu() });
  }
  farmInProgress = true;

  const referralLink = await getMainReferral();
  const statusMsg = await bot.sendMessage(chatId, `⏳ Memulai farming ${count} akun...`);

  try {
    for (let i = 0; i < count; i++) {
      // ... sisa loop identik dengan sebelumnya ...
    }
  } finally {
    farmInProgress = false;
  }

  await bot.editMessageText(`🏁 Farming selesai (${count} akun).`, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
    reply_markup: mainMenu(),
  }).catch(() => {});
}
async function runFarm(chatId, count) {
  const referralLink = await getMainReferral();
  const statusMsg = await bot.sendMessage(chatId, `⏳ Memulai farming ${count} akun...`);

  for (let i = 0; i < count; i++) {
    try {
      const res = await farmQueue.add(async () => {
        const inbox = await createInbox();
        const result = await createProAccount(
          { address: inbox.address, password: inbox.password },
          () => fetchLatestOtp(inbox.token, config.OTP_TIMEOUT_MS),
          referralLink
        );

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
        return result;
      });

      const sisa = daysLeft(res.proUntil);
      await bot.sendMessage(
        chatId,
        `✅ *Akun ${i + 1}/${count}*\n📧 \`${res.email}\`\n🔑 \`${res.password}\`\n⭐ ${res.proUntil ? 'Pro aktif' : 'Free'} (${sisa} hari)`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Akun ${i + 1}/${count} gagal: ${err.message}`);
    }
  }

  await bot
    .editMessageText(`🏁 Farming selesai (${count} akun).`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      reply_markup: mainMenu(),
    })
    .catch(() => {});
}

// ---------- Callback router ----------
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  const data = q.data || '';

  try {
    // Tombol "noop" untuk label halaman
    if (data === 'noop') return bot.answerCallbackQuery(q.id);

    if (data === 'menu:main') {
      await bot.editMessageText('*CapCut Farm Bot*\n\nPilih aksi:', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: mainMenu(),
      }).catch(() => {});
      return bot.answerCallbackQuery(q.id);
    }

    if (data.startsWith('farm:')) {
      const n = Math.min(parseInt(data.split(':')[1], 10) || 1, config.MAX_FARM_BATCH);
      await bot.answerCallbackQuery(q.id, { text: `Memulai ${n} akun...` });
      await bot.editMessageText(`⏳ Farming ${n} akun dimulai...`, {
        chat_id: chatId,
        message_id: messageId,
      }).catch(() => {});
      runFarm(chatId, n); // fire and forget
      return;
    }

    if (data.startsWith('accounts:')) {
      const page = parseInt(data.split(':')[1], 10) || 0;
      const accounts = await getAccounts();

      if (accounts.length === 0) {
        await bot.editMessageText('Belum ada akun. Mulai farming dulu.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: mainMenu(),
        }).catch(() => {});
        return bot.answerCallbackQuery(q.id);
      }

      const totalPages = Math.max(1, Math.ceil(accounts.length / ACCOUNTS_PER_PAGE));
      const safePage = Math.max(0, Math.min(page, totalPages - 1));
      const slice = accounts
        .slice()
        .reverse()
        .slice(safePage * ACCOUNTS_PER_PAGE, (safePage + 1) * ACCOUNTS_PER_PAGE);

      let text = `📋 *Akun (${accounts.length} total)* — halaman ${safePage + 1}/${totalPages}\n\n`;
      slice.forEach((a, i) => {
        const idx = safePage * ACCOUNTS_PER_PAGE + i + 1;
        const sisa = daysLeft(a.proUntil);
        text += `${idx}. \`${a.email}\`\n   ⭐ ${a.status} | ${sisa} hari\n\n`;
      });

      const nav = [];
      if (safePage > 0) nav.push({ text: '⬅️', callback_data: `accounts:${safePage - 1}` });
      nav.push({ text: `${safePage + 1}/${totalPages}`, callback_data: 'noop' });
      if (safePage < totalPages - 1) nav.push({ text: '➡️', callback_data: `accounts:${safePage + 1}` });

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [nav, [{ text: '⬅️ Menu', callback_data: 'menu:main' }]] },
      }).catch(() => {});
      return bot.answerCallbackQuery(q.id);
    }

    if (data === 'status') {
      const ref = await getMainReferral();
      const accounts = await getAccounts();
      const proCount = accounts.filter(a => a.status === 'PRO' && daysLeft(a.proUntil) > 0).length;

      const text =
        `📊 *Status*\n\n` +
        `🔗 Referral: ${ref ? '✅ Terpasang' : '❌ Belum diset'}\n` +
        `👥 Total akun: ${accounts.length}\n` +
        `⭐ Pro aktif: ${proCount}`;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backMenu(),
      }).catch(() => {});
      return bot.answerCallbackQuery(q.id);
    }

    if (data === 'referral:set') {
      awaitingReferral.add(chatId);
      await bot.editMessageText(
        '🔗 Kirim link referral CapCut Anda sebagai pesan berikutnya.\n\nContoh:\n`https://www.capcut.com/activity/...?invite_code=XXX`',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu:main' }]] },
        }
      ).catch(() => {});
      return bot.answerCallbackQuery(q.id);
    }

    if (data === 'referral:clear') {
      await setMainReferral(null);
      await bot.editMessageText('🗑 Referral dihapus.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: mainMenu(),
      }).catch(() => {});
      return bot.answerCallbackQuery(q.id);
    }

    return bot.answerCallbackQuery(q.id);
  } catch (err) {
    console.error('Callback error:', err);
    bot.answerCallbackQuery(q.id, { text: 'Terjadi error', show_alert: false }).catch(() => {});
  }
});

// ---------- Text handler (input referral dari tombol) ----------
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!awaitingReferral.has(chatId)) return;

  awaitingReferral.delete(chatId);
  const link = msg.text.trim();

  if (!link.includes('capcut.com')) {
    return bot.sendMessage(chatId, '❌ Link harus dari domain capcut.com', { reply_markup: mainMenu() });
  }
  await setMainReferral(link);
  bot.sendMessage(chatId, `✅ Referral disimpan:\n\`${link}\``, {
    parse_mode: 'Markdown',
    reply_markup: mainMenu(),
  });
});

// ---------- Init ----------
(async () => {
  await initDB();
  console.log('Bot berjalan...');
})();
