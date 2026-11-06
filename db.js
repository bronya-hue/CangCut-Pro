// db.js
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');

const adapter = new JSONFile(path.join(__dirname, 'accounts.json'));
const db = new Low(adapter, {
  accounts: [],      // { id, email, password, createdAt, proUntil, status, referralLink }
  mainReferral: null // link referral akun utama
});

async function initDB() {
  await db.read();
  db.data ||= { accounts: [], mainReferral: null };
  await db.write();
}

async function addAccount(acc) {
  db.data.accounts.push(acc);
  await db.write();
}

async function updateAccount(id, patch) {
  const idx = db.data.accounts.findIndex(a => a.id === id);
  if (idx !== -1) Object.assign(db.data.accounts[idx], patch);
  await db.write();
}

async function getAccounts() {
  await db.read();
  return db.data.accounts;
}

async function setMainReferral(link) {
  db.data.mainReferral = link;
  await db.write();
}

async function getMainReferral() {
  await db.read();
  return db.data.mainReferral;
}

module.exports = { initDB, addAccount, updateAccount, getAccounts, setMainReferral, getMainReferral };
