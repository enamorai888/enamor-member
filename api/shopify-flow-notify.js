const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;

const EVENT_DELAY_DAYS = {
  flywheel_gift_30:        30,
  flywheel_gift_40:        40,
  flywheel_care_21:        21,
  flywheel_fortune_rescue:  0,
  zerotex_to_care:         90,
  skin_to_care:            90,
  skin_to_zerotex:         50,
  entry_to_care:           30,
  entry_to_skin:           50,
  bra_to_care:             30,
  bra_to_skin:             50,
  value_low_rescue:         0,
  value_vip_care:           0,
  loyal_user_upgrade:       0,
  ambassador_recruit:       0,
  sleep_rescue:             0,
  flywheel_rescue:          0, // Flow 已等 2hr
  abandoned_cart:           0, // Flow 已等 1hr
};

const DEDUP_WINDOW_MINUTES = {
  flywheel_rescue:         24 * 60,
  abandoned_cart:          24 * 60,
  flywheel_fortune_rescue: 24 * 60,
  value_low_rescue:        24 * 60,
  value_vip_care:          24 * 60,
  flywheel_gift_30:        7 * 24 * 60,
  flywheel_gift_40:        7 * 24 * 60,
  flywheel_care_21:        7 * 24 * 60,
  entry_to_care:           7 * 24 * 60,
  entry_to_skin:           7 * 24 * 60,
  bra_to_care:             7 * 24 * 60,
  bra_to_skin:             7 * 24 * 60,
  skin_to_care:            7 * 24 * 60,
  skin_to_zerotex:         7 * 24 * 60,
  zerotex_to_care:         7 * 24 * 60,
};
const DEFAULT_DEDUP_MINUTES = 24 * 60;

function extractLineUid(shopifyTags) {
  if (!shopifyTags) return null;
  try {
    const tags = Array.isArray(shopifyTags)
      ? shopifyTags
      : shopifyTags.split(',').map(t => t.trim());
    const tag = tags.find(t => t.startsWith('uid_line_'));
    return tag ? tag.replace('uid_line_', '').trim() : null;
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

async function checkDuplicate(uid, event_type) {
  try {
    const window_minutes = DEDUP_WINDOW_MINUTES[event_type] || DEFAULT_DEDUP_MINUTES;
    const res = await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check_duplicate', uid, event_type, window_minutes })
    });
    const data = await res.json();
    return data.duplicate === true;
  } catch (e) {
    console.error('check_duplicate 失敗：', e.message);
    return false;
  }
}

async function writePurchase(uid, email, event_type, shopify_tags) {
  try {
    let tagsStr = '';
    if (Array.isArray(shopify_tags)) {
      tagsStr = shopify_tags.join(',');
    } else if (typeof shopify_tags === 'string') {
      tagsStr = shopify_tags;
    }
    await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write_purchase', uid, email, event_type, shopify_tags: tagsStr })
    });
  } catch (e) {
    console.error('write_purchase 失敗：', e.message);
  }
}

async function writeTask(uid, event_type, delay_days) {
  try {
    await fetch(GAS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write_task', uid, event_type, delay_days })
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
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
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
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ to: uid, messages: [{ type: 'text', text: message }] })
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

    const isDuplicate = await checkDuplicate(uid, event_type);
    if (isDuplicate) {
      console.log(`[去重] 跳過：${uid} - ${event_type}`);
      return res.status(200).json({ skipped: true, reason: 'duplicate' });
    }

    const delay_days = EVENT_DELAY_DAYS[event_type];

    if (delay_days && delay_days > 0) {
      await Promise.all([
        writePurchase(uid, email, event_type, tags),
        writeTask(uid, event_type, delay_days)
      ]);
      console.log(`[排程] ${uid} - ${event_type} (${delay_days}天)`);
      return res.status(200).json({ success: true, mode: 'delayed', event_type });

    } else {
      const [, message] = await Promise.all([
        writePurchase(uid, email, event_type, tags),
        getMessageFromSheet(event_type)
      ]);

      if (!message) {
        return res.status(200).json({ skipped: true, reason: 'message_not_found: ' + event_type });
      }

      const sent = await sendLine(uid, message);
      console.log('LINE 即時推播：', sent, '/ event_type：', event_type, '/ uid：', uid);
      return res.status(200).json({ success: sent, mode: 'instant', event_type });
    }

  } catch (err) {
    console.error('shopify-flow-notify error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
