// api/shopify-flow-notify.js
// 部署位置：enamorai888/enamor-member → api/shopify-flow-notify.js
// 用途：接收 Shopify Flow 的 webhook，依事件類型推對應的 LINE 訊息（LTV 飛輪 A-D）

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

// A-D 四條文案（短版定稿）
function buildMessage(event_type) {
  switch (event_type) {
    // 路徑 A：EnTry99 首購 → 推萊卡
    case 'entry_to_zerotex':
      return `EnTry99 幫妳先找到喜歡的版型，\n下一步可以試試「久坐一整天也不悶」的那條：ZERO-TEX 萊卡。\n\n👉 看萊卡這一櫃\nhttps://enamorshop.com/collections/zero-tex-all`;

    // 路徑 B：買萊卡 → 推莫代爾
    case 'zerotex_to_modal':
      return `白天久坐交給萊卡，下班之後，可以換成一套專門在家放鬆的。\nSKIN 莫代爾，是那種「在家不想有衣服感」的材質。\n\n👉 看莫代爾家居服\nhttps://enamorshop.com/collections/skin-modal-all`;

    // 路徑 C：買莫代爾 → 推萊卡
    case 'modal_to_zerotex':
      return `在家那套，妳已經用莫代爾顧好了。\n如果上班也常久坐，可以試試專門給久坐穿的 ZERO-TEX 萊卡。\n\n👉 看萊卡這一櫃\nhttps://enamorshop.com/collections/zero-tex-all`;

    // 路徑 D：90 天未回購 win-back
    case 'win_back':
      return `這陣子調整了幾個版型，也加了新色。\n每個月會員都有禮可以領，這個月的也幫妳留著。\n\n👉 領這個月的會員禮\nhttps://enamorshop.com/collections/member-gift`;

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
