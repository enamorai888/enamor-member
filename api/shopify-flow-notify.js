const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;

const EVENT_DELAY_DAYS = {
  flywheel_gift_30: 30,
  flywheel_gift_40: 40,
  flywheel_care_21: 21,
  zerotex_to_care: 90,
  skin_to_care: 90,
  skin_to_zerotex: 50,
  entry_to_care: 30,
  bra_to_care: 30,
  bra_to_skin: 50,
  flywheel_rescue: 0,
  flywheel_fortune_rescue: 0,
};

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

// ★ 去重檢查（10分鐘窗口）
async function checkDuplicate(uid, event_type) {
  try {
    const res = await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'check_duplicate',
        uid,
        event_type,
        window_minutes: 10
      })
    });
    const data = await res.json();
    return data.duplicate === true;
  } catch (e) {
    console.error('check_duplicate 失敗：', e.message);
    return false; // 查詢失敗時不擋，讓它繼續發
  }
}

async function writePurchase(uid, email, event_type, shopify_tags) {
  try {
    await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write_purchase',
        uid,
        email,
        event_type,
        shopify_tags: shopify_tags || ''
      })
    });
  } catch (e) {
    console.error('write_purchase 失敗：', e.message);
  }
}

async function writeTask(uid, event_type) {
  try {
    const delay_days = EVENT_DELAY_DAYS[event_type] ?? 30;
    await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write_task',
        uid,
        event_type,
        delay_days
      })
    });
  } catch (e) {
    console.error('write_task 失敗：', e.message);
  }
}

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

  const secret = req.headers['x-proxy-token'];
  if (secret !== process.env.PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { email, event_type, shopify_tags } = req.body;
  if (!email || !event_type) {
    return res.status(400).json({ error: 'Missing email or event_type' });
  }

  try {
    const tags = shopify_tags || await getCustomerTags(email);
    const uid = extractLineUid(tags);

    if (!uid) {
      return res.status(200).json({ skipped: true, reason: 'no_line_uid' });
    }

    // ★ 去重檢查：10分鐘內同一UID+event_type只發一次
    const isDuplicate = await checkDuplicate(uid, event_type);
    if (isDuplicate) {
      console.log(`[去重] 跳過重複：${uid} - ${event_type}`);
      return res.status(200).json({ skipped: true, reason: 'duplicate_within_10min' });
    }

    // 記錄購買行為和推播任務（平行執行）
    await Promise.all([
      writePurchase(uid, email, event_type, shopify_tags),
      writeTask(uid, event_type)
    ]);

    // 查文案
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
