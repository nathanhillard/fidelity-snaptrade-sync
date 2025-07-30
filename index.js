// index.js
require('dotenv').config();
const { Snaptrade } = require('snaptrade-typescript-sdk');
const { google }    = require('googleapis');

// 1️⃣ Initialize SnapTrade client
const snap = new Snaptrade({
  clientId:    process.env.SNAPTRADE_CLIENT_ID.trim(),
  consumerKey: process.env.SNAPTRADE_CONSUMER_KEY.trim(),
});

// 2️⃣ Helper: authenticate to Google Sheets
async function authSheets() {
  // 1) Load your service account key JSON
  const creds = require('./service-account.json');

  // 2) Create a JWT client using the options-object constructor
  const jwt = new google.auth.JWT({
    email:   creds.client_email,    // service account email
    key:     creds.private_key,     // private key string
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  // 3) Authorize & return a Sheets client
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

// 3️⃣ One‑time: register your SnapTrade “user”
async function registerUser() {
  try {
    const resp = await snap.authentication.registerSnapTradeUser({
      userId: process.env.SNAPTRADE_USER_ID.trim()
    });
    console.log('✅ Got userSecret:', resp.data.userSecret);
  } catch (err) {
    console.error('❌ registerUser error:', err);
  }
}

// 4️⃣ One‑time: open the OAuth portal to link Fidelity
async function openPortal() {
  try {
    const resp = await snap.authentication.loginSnapTradeUser({
      userId:     process.env.SNAPTRADE_USER_ID.trim(),
      userSecret: process.env.SNAPTRADE_USER_SECRET.trim(),
      broker:     'FIDELITY',
      immediateRedirect: false
    });
    console.log('🔗 Connection Portal URL:\n', resp.data.redirectURI);
  } catch (err) {
    console.error('❌ openPortal error:', err);
  }
}

// 5️⃣ Daily: fetch positions & write to your sheet
async function sync() {
  const sheets = await authSheets();
  const spreadsheetId = process.env.SHEET_ID.trim();

  // 1) Write a "Last Updated" timestamp into A1
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',   // your local time
    month: 'numeric', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'FidelityRaw!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Last Updated', now]] }
  });

  // 2) Clear only the old data (leave row 1 intact)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'FidelityRaw!A2:Z'
  });

  // 3) Fetch your positions as before…
  const accountsResp = await snap.accountInformation.listUserAccounts({
    userId:     process.env.SNAPTRADE_USER_ID.trim(),
    userSecret: process.env.SNAPTRADE_USER_SECRET.trim(),
  });
  const acctId = accountsResp.data[0].id;

  const positions = await snap.accountInformation.getUserAccountPositions({
    userId:     process.env.SNAPTRADE_USER_ID.trim(),
    userSecret: process.env.SNAPTRADE_USER_SECRET.trim(),
    accountId:  acctId,
  }).then(r => r.data);

  // 4) Map into rows: [Ticker, Qty, MarketValue]
  const rows = positions.map(p => [
    p.symbol.symbol.symbol,
    p.units,
    p.price * p.units
  ]);

  // 5) Write the new data starting in row 2
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'FidelityRaw!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows }
  });

  console.log(`✅ Synced ${rows.length} positions at ${now}.`);
}

// 6️⃣ Dispatch based on command‑line argument
const cmd = process.argv[2];
if (cmd === 'registerUser')       registerUser();
else if (cmd === 'openPortal')    openPortal();
else                              sync();
