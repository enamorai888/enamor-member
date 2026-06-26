// api/shopify-flow-notify.js
// 部署位置：enamorai888/enamor-member → api/shopify-flow-notify.js
// 用途：接收 Shopify Flow 的 webhook，依事件類型推對應的 LINE 訊息（LTV 飛輪 A-G + 棄單）
// 最後更新：2026-06-26

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 從 Shopify customer tags 抽出 LINE UID
function extractLineUid(shopifyTags) {
  if (!shopifyTags) return null;
  try {
    const tags = Array.isArray(shopifyTags)
      ? shopifyTags
      : shopifyTags.split(',').map(t => t.trim());
    const tag = tags.find(t => t.startsWith('uid_line_'));
    return tag ? tag.replace('uid_line_', '') : null;
  } catch (e) {
    return null;
  }
}

// 沒有傳入 tags 時，用 email 查 Shopify customer
async function getCustomerTags(email) {
  const domain = process.env.SHOPIFY_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const { access_token } = await tokenRes.json();

  const searchRes = await fetch(
    `https://${domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}`,
    { headers: { 'X-Shopify-Access-Token': access_token } }
  );
  const { customers } = await searchRes.json();
  if (!customers || customers.length === 0) return null;
  return customers[0].tags;
}

// 發送 LINE push
async function sendLine(uid, message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      to: uid,
      messages: [{ type: 'text', text: message }]
    })
  });
  return res.ok;
}

// A-G 七條飛輪文案 + 棄單
function buildMessage(event_type) {
  switch (event_type) {

    // 棄單提醒
    case 'abandoned_cart':
      return `妳剛剛的購物車還在等妳 👀\n\n剛才沒結帳沒關係，庫存幫妳留著——但熱門尺寸跑得很快，趁現在回來完成訂單：\nhttps://enamorshop.com/checkouts`;

    // A｜EnTry99首購 → 沐浴乳（30天）
    case 'entry_to_care':
      return `妳買的第一件內著，穿得還習慣嗎？💌\n算我私心寵粉！老客人才有的「隱藏版微涼沐浴乳」偷偷補貨。因為成本真的很高，非會員買就是通路價，只有走這條老友秘密通道才有專屬特惠：\nhttps://enamorshop.com/collections/vip-secret?utm_source=auto_flow&utm_medium=entry_to_care`;

    // B｜EnTry99首購 → SKIN（60天）
    case 'entry_to_skin':
      return `嗨！之前的 EnTry99 穿得還習慣嗎？💌\n悄悄通知妳，買過基礎款的老客人，超過 70% 下一站都是換這款「裸體感」SKIN 莫代爾。因為材質太熱門常常斷碼，這條是幫老客留的【優先補貨通道】，趁現在尺寸最齊全趕快換上：\nhttps://enamorshop.com/collections/skin-modal-all`;

    // C｜BraTop首購 → 沐浴乳（30天）
    case 'bra_to_care':
      return `BraTop 把外在顧好了，洗澡的儀式感也不能將就 ✨\n點播率最高的「微涼香氛沐浴乳」補貨到！因為製作成本極高，非會員買就是通路價，這頁是官網找不到的老客隱藏版特惠，算我的私心寵粉：\nhttps://enamorshop.com/collections/vip-secret?utm_source=auto_flow&utm_medium=bra_to_care`;

    // D｜BraTop首購 → SKIN（60天）
    case 'bra_to_skin':
      return `穿過 BraTop 的無鋼圈束縛，應該被寵壞了吧？🤭\n幾近零著感的舒適度，回家後妳更該試試這套常規爆款——SKIN 莫代爾。輕盈軟綿，很多女孩一回家就換上它。這是專為懂得犒賞自己的老客準備的升級提案：\nhttps://enamorshop.com/collections/skin-modal-all`;

    // E｜SKIN → 沐浴乳（90天）
    case 'skin_to_care':
      return `在家有 SKIN 陪妳放鬆，洗澡時的肌膚享受也要同步封頂 ☁️\n這瓶「微涼沐浴乳」產量很少、成本很高，非會員買就是通路價。算我私心寵粉，只有點這條官網找不到的隱藏連結才有老友限定價：\nhttps://enamorshop.com/collections/vip-secret?utm_source=auto_flow&utm_medium=skin_to_care`;

    // F｜SKIN → 萊卡（60天）
    case 'skin_to_zerotex':
      return `在家有 SKIN 溫柔陪著妳 🕊️\n這是我們只傳給 SKIN 老客人的外出提案：試試 ZERO-TEX 萊卡系列吧！極佳彈力與機能包覆，久坐整天依舊透氣不卡襠，給妳出門最完美的支撐：\nhttps://enamorshop.com/collections/zero-tex-all`;

    // G｜ZeroTex → 沐浴乳（90天）
    case 'zerotex_to_care':
      return `穿萊卡度過整天緊繃的久坐，回家最期待的就是沖個痛快！💪\n穿過萊卡的老客浴室都有這瓶「微涼幕斯沐浴乳」。因為成本高，非會員買就是通路價，這是我私心留給妳的隱藏特惠，官網類目找不到喔：\nhttps://enamorshop.com/collections/vip-secret?utm_source=auto_flow&utm_medium=zerotex_to_care`;

    default:
      return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 驗證來源
  const secret = req.headers['x-proxy-token'];
  if (secret !== process.env.PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { email, event_type, shopify_tags } = req.body;
  if (!email || !event_type) {
    return res.status(400).json({ error: 'Missing email or event_type' });
  }

  try {
    // 先用傳入的 tags，沒有再查 Shopify
    const tags = shopify_tags || await getCustomerTags(email);
    const uid = extractLineUid(tags);

    if (!uid) {
      return res.status(200).json({ skipped: true, reason: 'no_line_uid' });
    }

    const message = buildMessage(event_type);
    if (!message) {
      return res.status(200).json({ skipped: true, reason: 'unknown_event_type' });
    }

    const sent = await sendLine(uid, message);
    return res.status(200).json({ success: sent, event_type });

  } catch (err) {
    console.error('shopify-flow-notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
