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
  try {
    const sheets = await authSheets();

// debug: list all sheet names
const meta = await sheets.spreadsheets.get({
  spreadsheetId: process.env.SHEET_ID.trim(),
});
const titles = meta.data.sheets.map(s => s.properties.title);
console.log('📑 Available tabs:', titles);


    // ▼ list your linked accounts
    const accountsResp = await snap.accountInformation.listUserAccounts({
      userId:     process.env.SNAPTRADE_USER_ID.trim(),
      userSecret: process.env.SNAPTRADE_USER_SECRET.trim(),
    });
    const acctId = accountsResp.data[0].id;
    console.log('🔍 Found account ID:', acctId);

        // ▼ fetch positions for that account
const posResp = await snap.accountInformation.getUserAccountPositions({
  userId:     process.env.SNAPTRADE_USER_ID.trim(),
  userSecret: process.env.SNAPTRADE_USER_SECRET.trim(),
  accountId:  acctId,
});

// ▼ The SDK returns the array directly in resp.data
const positions = posResp.data;  

// DEBUG: dump the first 3 positions so we can inspect their structure
console.log('🔎 Position sample:', JSON.stringify(positions.slice(0,3), null, 2));

// ▼ build rows: [Ticker, Qty, MarketValue]
const rows = positions.map(p => [
  // ticker is nested under symbol.symbol.symbol
  p.symbol.symbol.symbol,                
  // number of shares is in `units`
  p.units,                               
  // compute market value = price × units
  p.price * p.units                      
]);


console.log('📝 About to write rows:', rows);

const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.SHEET_ID.trim(),
  range: 'FidelityRaw!A1:Z10'
});
console.log('🔍 Before clear, sheet had:', existing.data.values);


    await sheets.spreadsheets.values.clear({
  spreadsheetId: process.env.SHEET_ID.trim(),
  range: 'FidelityRaw!A:Z'
});


// then write starting at A1
await sheets.spreadsheets.values.update({
  spreadsheetId:   process.env.SHEET_ID.trim(),
  range:           'FidelityRaw!A1',
  valueInputOption:'USER_ENTERED',
  requestBody:     { values: rows }
});


    console.log(`✅ Synced ${rows.length} positions.`);
  } catch (err) {
    console.error('❌ sync error:', err);
  }
}

// 6️⃣ Dispatch based on command‑line argument
const cmd = process.argv[2];
if (cmd === 'registerUser')       registerUser();
else if (cmd === 'openPortal')    openPortal();
else                              sync();
