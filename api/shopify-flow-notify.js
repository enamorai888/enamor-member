const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;

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

// 從 GAS 文案庫查對應文案
async function getMessageFromSheet(event_type) {
  try {
    const res = await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_message', event_type })
    });
    const data = await res.json();
    if (data.success) return data.message;
    console.error('GAS 查文案失敗：', data.error);
    return null;
  } catch (e) {
    console.error('GAS 連線失敗：', e.message);
    return null;
  }
}

// 沒有傳入 tags 時，用 email 查 Shopify customer
async function getCustomerTags(email) {
  const domain = process.env.SHOPIFY_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  const tokenRes = await fetch('https://' + domain + '/admin/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });
  const { access_token } = await tokenRes.json();

  const searchRes = await fetch(
    'https://' + domain + '/admin/api/2026-01/customers/search.json?query=email:' + encodeURIComponent(email),
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
      'Authorization': 'Bearer ' + LINE_TOKEN
    },
    body: JSON.stringify({
      to: uid,
      messages: [{ type: 'text', text: message }]
    })
  });
  return res.ok;
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
    // 取得 LINE UID
    const tags = shopify_tags || await getCustomerTags(email);
    const uid = extractLineUid(tags);

    if (!uid) {
      return res.status(200).json({ skipped: true, reason: 'no_line_uid' });
    }

    // 從 GAS 文案庫查文案
    const message = await getMessageFromSheet(event_type);
    if (!message) {
      return res.status(200).json({ skipped: true, reason: 'message_not_found: ' + event_type });
    }

    // 推 LINE
    const sent = await sendLine(uid, message);
    console.log('LINE 推播結果：', sent, '/ event_type：', event_type, '/ uid：', uid);

    return res.status(200).json({ success: sent, event_type });

  } catch (err) {
    console.error('shopify-flow-notify error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
