const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;
const WEBHOOK_SECRET = process.env.KLAVIYO_WEBHOOK_SECRET;

// ── 從 Shopify Tags 抽出所有 LINE uid（支援多個）──
function extractAllLineUids(shopifyTags) {
  if (!shopifyTags) return [];
  try {
    const str = Array.isArray(shopifyTags)
      ? shopifyTags.join(',')
      : String(shopifyTags);
    const matches = str.match(/uid_line_[A-Za-z0-9]+/g);
    return matches ? [...new Set(matches)] : []; // 去重
  } catch (e) {
    console.error('解析 LINE UID 錯誤:', e.message);
    return [];
  }
}

// ── 從 GAS Sheet 查文案 ──
async function getMessageFromSheet(event_type) {
  if (!GAS_WEBHOOK) return null;
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

// ── LINE 推播（單一 uid）──
async function sendLine(uid, message) {
  try {
    const lineId = uid.replace('uid_line_', ''); // 去掉前綴，LINE API 只需要 U 開頭的 ID
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_TOKEN
      },
      body: JSON.stringify({
        to: lineId,
        messages: [{ type: 'text', text: message }]
      })
    });
    if (!res.ok) {
      const errData = await res.json();
      console.error(`LINE Push 失敗 (${lineId}):`, JSON.stringify(errData));
      return false;
    }
    return true;
  } catch (e) {
    console.error(`LINE Push 網路錯誤 (${lineId}):`, e.message);
    return false;
  }
}

// ── 主 handler ──
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 金鑰安全驗證
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { email, event_type, shopify_tags } = req.body || {};

  if (!event_type) {
    return res.status(400).json({ error: 'Missing event_type' });
  }

  // 從 Shopify Tags 抽出所有 LINE uid
  const uids = extractAllLineUids(shopify_tags);

  if (uids.length === 0) {
    // 沒有綁定 LINE → 跳過，由 Klaviyo 發 email
    console.log(`[klaviyo-line-push] 無 LINE uid，跳過：${email || '無 email'} / ${event_type}`);
    return res.status(200).json({ skipped: true, reason: 'no_line_uid', email });
  }

  // 查文案（只查一次）
  const message = await getMessageFromSheet(event_type);
  if (!message) {
    console.error(`[klaviyo-line-push] 找不到文案：${event_type}`);
    return res.status(200).json({ skipped: true, reason: 'message_not_found', event_type });
  }

  // 對所有 uid 推播
  const results = await Promise.all(
    uids.map(uid => sendLine(uid, message))
  );

  const sentCount = results.filter(Boolean).length;
  console.log(`[klaviyo-line-push] 推播結果：${sentCount}/${uids.length} 成功 / event_type：${event_type} / uids：${uids.join(',')}`);

  if (sentCount === 0) {
    // 全部失敗，回 500 讓 Klaviyo Retry
    return res.status(500).json({ success: false, error: 'All LINE pushes failed' });
  }

  return res.status(200).json({ success: true, sent: sentCount, total: uids.length, event_type });
}
