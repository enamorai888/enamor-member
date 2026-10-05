import crypto from 'crypto';

/**
 * LIFF 會員綁定（零輸入綁定＋綁定見面禮）
 *
 * 前端送來：
 *   idToken  LINE 的身分證明（新版綁定頁會送；後端向 LINE 驗證，取得真正的 LINE ID）
 *   c + s    專屬連結：顧客編號＋簽名（客人不用輸入 email）
 *   e + s    專屬連結：email（編碼）＋簽名（舊官網會員，不在 Shopify）
 *   email    一般綁定：客人自己輸入
 *   （一律向 LINE 驗證身分；不再接受網頁直接傳來的 LINE ID）
 *
 * 環境變數：
 *   BIND_SECRET            專屬連結的簽名密鑰（跟 Apps Script 的 BIND_SECRET 一樣）
 *   LINE_LOGIN_CHANNEL_ID  1656208126（驗證 LINE 身分用，沒設就用預設值）
 *   GIFT_AMOUNT            見面禮金額，預設 200；設 0 就不發
 *   GIFT_MIN_SUBTOTAL      最低消費，預設 499
 *   GIFT_DAYS              見面禮、感謝禮的有效天數，預設 14 天（到期前 3 天由飛輪提醒）
 *   GIFT_END               見面禮統一到期日（例如 2026-10-31T23:59:59+08:00）；沒設或已過期就用 GIFT_DAYS
 *   THANKS_AMOUNT          已綁定老朋友的感謝禮金額，預設跟 GIFT_AMOUNT 一樣；設 0 就不發
 *   GIFT_LABEL             10/31 前的見面禮名稱，預設「10.10 會員禮」；之後自動叫「見面禮」（不用設定）
 *
 *   ── 每月會員券：全自動，不用每月改設定 ──
 *   每月 14 號自動換一波（14 號前算上個月那一波）；囤貨季月份自動不發
 *   WAVE_START             第一波的年月，預設 2612（2026 年 12 月）
 *   STOCKUP_MONTHS         囤貨季月份，預設 2,5,8,11（這幾個月不發會員券）
 *   GIFT_LABEL_UNTIL       GIFT_LABEL 用到哪天，預設 2026-10-31，之後自動叫「見面禮」
 *   THANKS_UNTIL           第一波感謝禮發到哪天，預設 2026-10-31，之後自動停止
 *   MONTHLY_AMOUNT         會員券金額，預設 100
 *   MONTHLY_MIN_SUBTOTAL   會員券最低消費，預設 799
 *   MONTHLY_LABEL          會員券名稱，預設「本月會員券」
 *
 * 領取紀錄不用標籤，記在顧客的「中繼欄位」（namespace: enamor），每個欄位只存一個值：
 *   enamor.welcome_gift   領見面禮的日期
 *   enamor.thanks_gift    領第一波感謝禮的日期
 *   enamor.coupon_wave    最近領過的會員券波次（例如 2612），下個月領會覆蓋成 2701
 *   enamor.last_gift      最近一張券（碼、金額、期限）；客人再打開綁定頁時，還沒用就再顯示一次
 * 顧客身上的標籤只留 uid_line_（飛輪推播用）。舊的 bind_gift／first_wave_gift 標籤仍會被認得，不會重複發。
 *
 * 規則：
 *   ・第一次綁定：見面禮（預設 200 元、滿 499、14 天）。綁定的那一波不再另外領會員券
 *   ・已綁定的人：本月有會員券時，每一波可領一張；期限＝領券後 30 天或下一個 14 號，取先到的
 *   ・已綁定的人、10/31 前：可領一次「第一波感謝禮」
 *   ・所有券都由程式產生、只能用一次、不跟其他折扣疊加；客人點按鈕即自動套用
 *
 * 已經綁定過的人打開綁定頁：不用輸入 email，直接領「第一波感謝禮」（THANK- 開頭的碼），每人一次。
 * 折扣碼都由程式自動產生；客人點按鈕即自動套用，不用手動輸入。
 */

const LIFF_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '1656208126';
let TOKEN_CACHE = { token: '', exp: 0 };   // Shopify token 快取，減少每次綁定的等待時間

function sign(value) {
  return crypto.createHmac('sha256', process.env.BIND_SECRET || '').update(value).digest('hex').slice(0, 32);
}
function checkSig(value, sig) {
  if (!process.env.BIND_SECRET || !sig) return false;
  const a = Buffer.from(sign(value)), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function b64urlDecode(s) {
  try { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch (e) { return ''; }
}

async function verifyIdToken(idToken) {
  const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: LIFF_CHANNEL_ID }).toString(),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data && data.sub ? data : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body  = req.body || {};
  const track = body.track || 'gift';
  const stage = body.stage || 'join';
  let email   = body.email ? String(body.email).trim().toLowerCase() : '';

  // 1. 確認 LINE 身分：一律向 LINE 驗證，沒有驗證就不綁定（不再相信網頁直接傳來的 LINE ID）
  if (!body.idToken) return res.status(401).json({ success: false, message: '請在 LINE 裡打開綁定連結' });
  const v = await verifyIdToken(body.idToken).catch(() => null);
  if (!v) return res.status(401).json({ success: false, message: 'LINE 身分驗證失敗，請關閉後重新開啟' });
  const lineUID = v.sub;
  const verified = true;

  // 2. 專屬連結：驗證簽名，決定要綁到哪一位顧客
  let signedCustomerId = '';
  if (body.s) {
    if (body.c && checkSig('c:' + body.c, body.s)) {
      signedCustomerId = String(body.c).replace(/\D/g, '');
    } else if (body.e) {
      const decoded = b64urlDecode(body.e).trim().toLowerCase();
      if (decoded && checkSig('e:' + decoded, body.s)) email = decoded;
      else return res.status(400).json({ success: false, message: '連結已失效，請改用輸入 email 綁定' });
    } else {
      return res.status(400).json({ success: false, message: '連結已失效，請改用輸入 email 綁定' });
    }
  }

  const domain       = process.env.SHOPIFY_DOMAIN;
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const lineToken    = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const sheetApi     = process.env.GOOGLE_SHEET_WEBHOOK;
  const timestamp    = new Date().toISOString();

  const TAG_MAP = {
    cool: { gift: 'Flywheel_Gift_Cool', fortune: 'Flywheel_Fortune_Cool', ambassador: 'Flywheel_Ambassador_Cool' },
    join: { gift: 'Flywheel_Gift_Join', fortune: 'Flywheel_Fortune_Join', ambassador: 'Flywheel_Ambassador_Join' },
  };
  const flywheelTag = (TAG_MAP[stage] && TAG_MAP[stage][track]) ? TAG_MAP[stage][track] : ('Flywheel_' + track + '_' + stage);
  const uidTag   = 'uid_line_' + lineUID;
  const boundTag = TAG_MAP.join[track] || null;
  const GIFT_TAG = 'bind_gift';

  async function writeSheet(status, errorMsg) {
    if (!sheetApi) return;
    try {
      await fetch(sheetApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp, email, lineUID, track, stage, status, errorMsg: errorMsg || '', upsert: true }),
        signal: AbortSignal.timeout(4000),   // 試算表紀錄最多等 4 秒，不讓客人久等
      });
    } catch (e) { console.error('Sheet error:', e.message); }
  }

  if (stage === 'cool') {
    await writeSheet('success', '');
    return res.status(200).json({ success: true });
  }

  // 3. Shopify token（有快取就直接用）
  let accessToken = TOKEN_CACHE.exp > Date.now() ? TOKEN_CACHE.token : '';
  if (!accessToken) {
    try {
      const tokenRes = await fetch('https://' + domain + '/admin/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      });
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
      if (!accessToken) throw new Error(JSON.stringify(tokenData));
      TOKEN_CACHE = { token: accessToken, exp: Date.now() + 50 * 60000 };
    } catch (e) {
      await writeSheet('failed', 'Token 換取失敗: ' + e.message);
      return res.status(500).json({ success: false, message: '無法取得 Shopify token' });
    }
  }

  const rest = (path, opt = {}) => fetch('https://' + domain + '/admin/api/2026-01/' + path, {
    ...opt,
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json', ...(opt.headers || {}) },
  });
  const gql = async (query, variables) => {
    const r = await rest('graphql.json', { method: 'POST', body: JSON.stringify({ query, variables }) });
    return r.json();
  };

  async function getSheetMessage(event_type) {
    if (!sheetApi) return null;
    try {
      const r = await fetch(sheetApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_message', event_type }) });
      const data = await r.json();
      return data.success ? data.message : null;
    } catch (e) { return null; }
  }

  async function isAlreadyBound(uid) {
    if (!sheetApi) return false;
    try {
      const r = await fetch(sheetApi, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_duplicate', uid, event_type: 'welcome_Gift', window_minutes: 30 }),
      });
      const data = await r.json();
      return data.success && data.duplicate;
    } catch (e) { return false; }
  }

  async function pushLine(uid, messages) {
    try {
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
        body: JSON.stringify({ to: uid, messages }),
      });
      if (!r.ok) console.error('LINE push error:', await r.text());
    } catch (e) { console.error('LINE push 流程錯誤:', e.message); }
  }

  async function syncKlaviyoLineUid(mail, uid) {
    const klaviyoKey = process.env.KLAVIYO_PRIVATE_KEY;
    if (!klaviyoKey || !mail) return;
    try {
      const response = await fetch('https://a.klaviyo.com/api/profiles/', {
        method: 'POST',
        headers: { 'Authorization': 'Klaviyo-API-Key ' + klaviyoKey, 'Content-Type': 'application/json', 'revision': '2024-02-15' },
        body: JSON.stringify({ data: { type: 'profile', attributes: { email: mail, properties: { line_uid: uid } } } }),
      });
      if (!response.ok) console.error('[Klaviyo sync 失敗]', response.status, await response.text());
    } catch (e) { console.error('[Klaviyo sync 錯誤]', e.message); }
  }

  async function updateCustomer(customerId, payload) {
    const r = await rest('customers/' + customerId + '.json', { method: 'PUT', body: JSON.stringify({ customer: payload }) });
    if (r.ok) return;
    const data = await r.json();
    if (payload.email && JSON.stringify(data).includes('has already been taken')) {
      const retry = { ...payload }; delete retry.email;
      const r2 = await rest('customers/' + customerId + '.json', { method: 'PUT', body: JSON.stringify({ customer: retry }) });
      if (!r2.ok) throw new Error('退回標籤更新失敗: ' + JSON.stringify(await r2.json()));
    } else {
      throw new Error('顧客更新失敗: ' + JSON.stringify(data));
    }
  }

  // 中繼欄位：讀取與寫入領取紀錄
  async function getGiftMeta(customerId) {
    try {
      const d = await gql(
        'query($id: ID!) { customer(id: $id) { w: metafield(namespace: "enamor", key: "welcome_gift") { value } t: metafield(namespace: "enamor", key: "thanks_gift") { value } c: metafield(namespace: "enamor", key: "coupon_wave") { value } g: metafield(namespace: "enamor", key: "last_gift") { value } } }',
        { id: 'gid://shopify/Customer/' + customerId }
      );
      const c = (d.data || {}).customer || {};
      let last = null;
      try { last = (c.g || {}).value ? JSON.parse(c.g.value) : null; } catch (e) { last = null; }
      return { welcome: (c.w || {}).value || '', thanks: (c.t || {}).value || '', wave: (c.c || {}).value || '', last };
    } catch (e) { console.error('讀取中繼欄位錯誤:', e.message); return { welcome: '', thanks: '', wave: '', last: null }; }
  }
  async function setGiftMeta(customerId, fields) {
    const metafields = Object.keys(fields).map(k => ({
      ownerId: 'gid://shopify/Customer/' + customerId, namespace: 'enamor', key: k,
      type: 'single_line_text_field', value: String(fields[k]),
    }));
    try {
      const d = await gql('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', { m: metafields });
      const errs = (d.errors || []).concat(((d.data || {}).metafieldsSet || {}).userErrors || []);
      if (errs.length) console.error('寫入中繼欄位失敗:', JSON.stringify(errs));
    } catch (e) { console.error('寫入中繼欄位錯誤:', e.message); }
  }
  async function codeStillUsable(code) {
    try {
      const d = await gql('query($c: String!) { codeDiscountNodeByCode(code: $c) { codeDiscount { ... on DiscountCodeBasic { status asyncUsageCount } } } }', { c: code });
      const cd = ((d.data || {}).codeDiscountNodeByCode || {}).codeDiscount;
      if (!cd) return false;
      return cd.status === 'ACTIVE' && Number(cd.asyncUsageCount || 0) === 0;
    } catch (e) { return false; }
  }
  const lastGiftValue = (g) => JSON.stringify({ kind: g.kind, label: g.label, code: g.code, amount: g.amount, min: g.min, endText: g.endText });
  const todayTW = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  async function subscribeEmail(customerId) {
    try {
      const data = await gql(
        'mutation($input: CustomerEmailMarketingConsentUpdateInput!) { customerEmailMarketingConsentUpdate(input: $input) { userErrors { field message } } }',
        { input: { customerId: 'gid://shopify/Customer/' + customerId,
          emailMarketingConsent: { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' } } }
      );
      const errs = (data.errors || []).concat(((data.data || {}).customerEmailMarketingConsentUpdate || {}).userErrors || []);
      if (errs.length) console.error('Email 同意更新失敗:', JSON.stringify(errs));
    } catch (e) { console.error('Email 同意更新錯誤:', e.message); }
  }

  // 折扣碼：當場產生一組只能用一次的碼
  //   kind: 'welcome'（見面禮）／'thanks'（第一波感謝禮）／'monthly'（每月會員券）
  function currentWave(now) {
    // 台灣時間；14 號前算上個月那一波
    const tw = new Date(now.getTime() + 8 * 3600000);
    let y = tw.getUTCFullYear(), m = tw.getUTCMonth() + 1;
    if (tw.getUTCDate() < 14) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
    const code = String(y).slice(2) + String(m).padStart(2, '0');
    const start = String(process.env.WAVE_START || '2612');
    const stockup = String(process.env.STOCKUP_MONTHS || '2,5,8,11').split(',').map(x => Number(x.trim()));
    if (code < start) return '';
    if (stockup.indexOf(m) > -1) return '';
    return code;
  }
  function beforeDate(envName, fallback) {
    const d = new Date((process.env[envName] || fallback) + 'T23:59:59+08:00');
    return Date.now() <= d.getTime();
  }

  function nextWaveStart(now) {
    // 下一個 14 號 00:00（台灣時間）：今天還沒到 14 號就是本月 14 號，否則是下個月 14 號
    const tw = new Date(now.getTime() + 8 * 3600000);
    let m = tw.getUTCMonth();
    if (tw.getUTCDate() >= 14) m += 1;
    return new Date(Date.UTC(tw.getUTCFullYear(), m, 14, 0, 0, 0) - 8 * 3600000);
  }

  async function createGiftCode(customerEmail, kind) {
    const now = new Date();
    let amount, min, prefix, label, end;
    if (kind === 'monthly') {
      amount = Number(process.env.MONTHLY_AMOUNT || 100);
      min = String(process.env.MONTHLY_MIN_SUBTOTAL || 799);
      prefix = 'MEM-';
      label = process.env.MONTHLY_LABEL || '本月會員券';
      const in30 = new Date(now.getTime() + 30 * 86400000);
      const nxt = nextWaveStart(now);
      end = nxt < in30 ? nxt : in30;
    } else {
      const isThanks = kind === 'thanks';
      amount = Number(isThanks ? (process.env.THANKS_AMOUNT || process.env.GIFT_AMOUNT || 200) : (process.env.GIFT_AMOUNT || 200));
      min = String(process.env.GIFT_MIN_SUBTOTAL || 499);
      prefix = isThanks ? 'THANK-' : 'BIND-';
      label = isThanks ? '第一波感謝禮' : (beforeDate('GIFT_LABEL_UNTIL', '2026-10-31') ? (process.env.GIFT_LABEL || '10.10 會員禮') : '見面禮');
      const fixedEnd = process.env.GIFT_END ? new Date(process.env.GIFT_END) : null;
      const days = Number(process.env.GIFT_DAYS || 14);
      end = fixedEnd && fixedEnd.getTime() > now.getTime() + 86400000 ? fixedEnd : new Date(now.getTime() + days * 86400000);
    }
    if (!amount) return null;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = prefix;
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];

    const input = {
      title: label + ' ' + code + (customerEmail ? '（' + customerEmail + '）' : ''),
      code,
      startsAt: now.toISOString(),
      endsAt: end.toISOString(),
      usageLimit: 1,
      appliesOncePerCustomer: true,
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: min } },
      customerGets: { value: { discountAmount: { amount: String(amount), appliesOnEachItem: false } }, items: { all: true } },
    };
    const mutation = 'mutation($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } } }';
    let data = await gql(mutation, { input: { context: { all: 'ALL' }, ...input } });
    if (data.errors) data = await gql(mutation, { input: { customerSelection: { all: true }, ...input } });
    const errs = (data.errors || []).concat(((data.data || {}).discountCodeBasicCreate || {}).userErrors || []);
    if (errs.length) { console.error('建立折扣碼失敗:', JSON.stringify(errs)); return null; }

    const endText = end.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
    return { kind, label, code, amount, min: Number(min), endsAt: end.toISOString(), endText };
  }

  function giftMessage(gift) {
    const url = 'https://enamorshop.com/discount/' + gift.code + '?redirect=/pages/zero-tex-landing';
    const lines = gift.kind === 'thanks'
      ? ['謝謝您', '您是第一批把 LINE 交給舒適秘書的朋友。快用完、該換一輪的時候，秘書都會在這裡提醒您。', '這份感謝禮請收下，點下方按鈕就會自動套用：']
      : gift.kind === 'monthly'
      ? [gift.label + '準備好了', '這個月的月禮也上架了，可以一起看看。這是您的' + gift.label + '，點下方按鈕就會自動套用：']
      : ['綁定完成', '每個月的月禮、會員券，快用完、該換一輪的時候，秘書都會直接在 LINE 告訴您。這是秘書為您準備的' + gift.label + '，點下方按鈕就會自動套用：'];
    return {
      type: 'flex',
      altText: gift.kind === 'thanks' ? '謝謝您一直都在，秘書為您準備了感謝禮' : (gift.kind === 'monthly' ? '您的' + gift.label + '準備好了' : '綁定完成，秘書為您準備了' + gift.label),
      contents: {
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', spacing: 'md',
          contents: [
            { type: 'text', text: lines[0], weight: 'bold', size: 'lg', color: '#1F1F1F' },
          ].concat(lines.slice(1).map(t => ({ type: 'text', text: t, wrap: true, size: 'sm', color: '#1F1F1F' }))).concat([
            { type: 'text', text: gift.code, weight: 'bold', size: 'xl', color: '#8B6F47' },
            { type: 'text', text: gift.amount + ' 元，滿 ' + gift.min + ' 元可用，' + gift.endText + ' 前有效，限用一次。不用輸入，點按鈕自動帶入。', wrap: true, size: 'xs', color: '#8B6F47' },
          ]),
        },
        footer: {
          type: 'box', layout: 'vertical',
          contents: [{ type: 'button', style: 'primary', color: '#8B6F47', action: { type: 'uri', label: '直接套用，去逛逛', uri: url } }],
        },
      },
    };
  }

  try {
    // 4. 找出要綁定的顧客
    let customers = [];
    // 這個 LINE ID 是否已經綁在任何顧客身上（綁過的人不再發見面禮，避免一個 LINE 領多次）
    const tagRes = await rest('customers/search.json?query=tag:' + encodeURIComponent(uidTag) + '&fields=id,email,tags');
    const taggedCustomers = (await tagRes.json()).customers || [];
    const lineAlreadyBound = taggedCustomers.length > 0;

    // 已經綁定過的人：不用再輸入 email
    //   本月有會員券 → 領本月會員券（每一波一次）
    //   本月沒有（囤貨季或第一波之前）→ 10/31 前可領第一波感謝禮（一輩子一次）
    const WAVE = currentWave(new Date());
    if (lineAlreadyBound && verified && stage === 'join') {
      const c0 = taggedCustomers[0];
      const tags0 = (c0.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const meta0 = await getGiftMeta(c0.id);
      let gift0 = null, note = 'already_bound', claimed = false, metaJob = null;
      if (WAVE) {
        if (meta0.wave !== WAVE) {
          gift0 = await createGiftCode(c0.email, 'monthly');
          if (gift0) { metaJob = setGiftMeta(c0.id, { coupon_wave: WAVE, last_gift: lastGiftValue(gift0) }); note = 'monthly:' + gift0.code; }
        } else { claimed = true; note = 'monthly_claimed'; }
      } else if (beforeDate('THANKS_UNTIL', '2026-10-31') && !meta0.thanks && !meta0.welcome
                 && !tags0.includes('first_wave_gift') && !tags0.includes(GIFT_TAG)) {
        gift0 = await createGiftCode(c0.email, 'thanks');
        if (gift0) { metaJob = setGiftMeta(c0.id, { thanks_gift: todayTW(), last_gift: lastGiftValue(gift0) }); note = 'thanks:' + gift0.code; }
      }
      // 沒有新的券：上一張還沒用、也還沒過期，就再顯示一次，客人不用去翻 LINE
      let reshown = false;
      if (!gift0 && meta0.last && meta0.last.code && await codeStillUsable(meta0.last.code)) {
        gift0 = meta0.last; reshown = true; claimed = false; note = 'reshown:' + gift0.code;
      }
      await Promise.all([
        (gift0 && !reshown) ? pushLine(lineUID, [giftMessage(gift0)]) : null,
        metaJob,
        writeSheet('success', note),
      ]);
      return res.status(200).json({ success: true, alreadyBound: true, gift: gift0, claimed, reshown });
    }

    // 還沒綁定、也沒有專屬連結：需要客人輸入 email
    if (stage === 'join' && !email && !signedCustomerId) {
      return res.status(200).json({ success: false, needEmail: true });
    }

    if (signedCustomerId) {
      const r = await rest('customers/' + signedCustomerId + '.json?fields=id,email,tags');
      const d = await r.json();
      if (d.customer) customers = [d.customer];
    }
    if (!customers.length) customers = taggedCustomers;
    if (!customers.length && email) {
      const r = await rest('customers/search.json?query=email:' + encodeURIComponent(email) + '&fields=id,email,tags');
      customers = (await r.json()).customers || [];
    }

    let isFirstBindOnThisTrack = true;
    let bindCustomerId = null;
    let giftEligible = false;
    let customerEmail = email;

    if (!customers.length) {
      // 新顧客
      if (await isAlreadyBound(lineUID)) {
        return res.status(200).json({ success: true, note: 'duplicate_skipped' });
      }
      giftEligible = verified && !lineAlreadyBound;
      const tags = [uidTag, flywheelTag];
      const createRes = await rest('customers.json', {
        method: 'POST',
        body: JSON.stringify({ customer: {
          email: email || undefined,
          tags: tags.join(','),
          email_marketing_consent: { state: 'subscribed', opt_in_level: 'single_opt_in' },
        } }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.customer) throw new Error('建立顧客失敗: ' + JSON.stringify(createData));
      bindCustomerId = createData.customer.id;
    } else {
      const customer = customers[0];
      customerEmail = customer.email || email;
      const tags = (customer.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      isFirstBindOnThisTrack = boundTag ? !tags.includes(boundTag) : !tags.some(t => t.startsWith('uid_line_'));

      // 見面禮：LINE 身分已驗證、這個 LINE ID 第一次綁定、這位顧客沒領過
      bindCustomerId = customer.id;
      const meta = await getGiftMeta(customer.id);
      giftEligible = verified && !lineAlreadyBound && !meta.welcome && !tags.includes(GIFT_TAG);

      let changed = false;
      [uidTag, flywheelTag].forEach(t => {
        if (!tags.includes(t)) { tags.push(t); changed = true; }
      });
      const populateEmail = email && !customer.email;
      if (changed || populateEmail) {
        const payload = { id: customer.id, tags: tags.join(',') };
        if (populateEmail) payload.email = email;
        await updateCustomer(customer.id, payload);
      }
      // 綁定頁註明「綁定即同意接收會員電子報」：既有顧客綁定後，一併開啟 Email 行銷同意
      if (customer.email || email) await subscribeEmail(customer.id);
    }

    // 5. 見面禮或歡迎訊息
    let gift = null;
    if (giftEligible) gift = await createGiftCode(customerEmail, 'welcome');
    const jobs = [];
    if (gift && bindCustomerId) {
      const f = { welcome_gift: todayTW(), last_gift: lastGiftValue(gift) };
      if (WAVE) f.coupon_wave = WAVE;
      jobs.push(setGiftMeta(bindCustomerId, f));
    }
    if (gift) {
      jobs.push(pushLine(lineUID, [giftMessage(gift)]));
    } else if (isFirstBindOnThisTrack) {
      jobs.push(getSheetMessage(track === 'fortune' ? 'welcome_fortune' : 'welcome_Gift')
        .then(welcome => welcome ? pushLine(lineUID, [{ type: 'text', text: welcome }]) : null));
    }
    jobs.push(syncKlaviyoLineUid(customerEmail, lineUID));
    jobs.push(writeSheet('success', gift ? 'gift:' + gift.code : ''));
    await Promise.all(jobs);
    return res.status(200).json({ success: true, gift });
  } catch (err) {
    console.error('liff-bind error:', err.message);
    await writeSheet('failed', err.message);
    return res.status(500).json({ success: false, message: '系統錯誤' });
  }
}
