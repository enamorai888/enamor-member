export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body    = req.body || {};
  const email   = body.email   ? body.email.trim()   : '';
  const lineUID = body.lineUID ? body.lineUID.trim() : '';
  const track   = body.track   || 'gift';
  const stage   = body.stage   || 'join';

  if (!lineUID) return res.status(400).json({ success: false, message: '缺少 lineUID' });
  if (stage === 'join' && !email) return res.status(400).json({ success: false, message: '缺少 email' });

  const domain       = process.env.SHOPIFY_DOMAIN;
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const lineToken    = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const sheetApi     = process.env.GOOGLE_SHEET_WEBHOOK;

  const timestamp = new Date().toISOString();

  const TAG_MAP = {
    cool: {
      gift:        'Flywheel_Gift_Cool',
      fortune:     'Flywheel_Fortune_Cool',
      ambassador:  'Flywheel_Ambassador_Cool'
    },
    join: {
      gift:        'Flywheel_Gift_Join',
      fortune:     'Flywheel_Fortune_Join',
      ambassador:  'Flywheel_Ambassador_Join'
    }
  };

  const flywheelTag = (TAG_MAP[stage] && TAG_MAP[stage][track])
    ? TAG_MAP[stage][track]
    : ('Flywheel_' + track + '_' + stage);
  const uidTag   = 'uid_line_' + lineUID;
  const boundTag = TAG_MAP['join'][track] || null;

  async function writeSheet(status, errorMsg) {
    if (!sheetApi) return;
    try {
      await fetch(sheetApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp, email, lineUID, track, stage,
          status, errorMsg: errorMsg || '', upsert: true
        })
      });
    } catch (e) {
      console.error('Sheet error:', e.message);
    }
  }

  if (stage === 'cool') {
    writeSheet('success', '');
    return res.status(200).json({ success: true });
  }

  let accessToken;
  try {
    const tokenRes = await fetch('https://' + domain + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      })
    });
    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error(JSON.stringify(tokenData));
  } catch (e) {
    writeSheet('failed', 'Token 換取失敗: ' + e.message);
    return res.status(500).json({ success: false, message: '無法取得 Shopify token' });
  }

  async function getWelcomeMessage(event_type) {
    if (!sheetApi) return null;
    try {
      const r = await fetch(sheetApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_message', event_type })
      });
      const data = await r.json();
      return data.success ? data.message : null;
    } catch (e) {
      return null;
    }
  }

  // 競態去重：新客人建立前查 GAS，防止雙重 POST 建兩筆顧客
  async function isAlreadyBound(uid) {
    if (!sheetApi) return false;
    try {
      const r = await fetch(sheetApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_duplicate', uid, event_type: 'welcome_Gift', window_minutes: 30 })
      });
      const data = await r.json();
      return data.success && data.duplicate;
    } catch (e) {
      return false;
    }
  }

  // LINE 推播
  async function sendWelcomeLine(uid, welcomeEventType) {
    try {
      const welcomeMessage = await getWelcomeMessage(welcomeEventType);
      if (!welcomeMessage) return;
      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
        body: JSON.stringify({ to: uid, messages: [{ type: 'text', text: welcomeMessage }] })
      });
      if (!lineRes.ok) {
        const errData = await lineRes.json();
        console.error('LINE push error:', JSON.stringify(errData));
      }
    } catch (e) {
      console.error('LINE push 流程錯誤:', e.message);
    }
  }

  // Klaviyo 同步 line_uid 進 profile（符合 2024-02-15+ API 規範）
  async function syncKlaviyoLineUid(email, lineUID) {
    const klaviyoKey = process.env.KLAVIYO_PRIVATE_KEY;
    if (!klaviyoKey || !email) return;
    try {
      const response = await fetch('https://a.klaviyo.com/api/profiles/', {
        method: 'POST',
        headers: {
          'Authorization': 'Klaviyo-API-Key ' + klaviyoKey,
          'Content-Type': 'application/json',
          'revision': '2024-10-15'
        },
        body: JSON.stringify({
          data: {
            type: 'profile',
            attributes: {
              email: email,
              properties: {
                line_uid: lineUID
              }
            }
          }
        })
      });
      if (!response.ok) {
        const errData = await response.json();
        console.error('[Klaviyo sync 失敗]', response.status, JSON.stringify(errData));
      } else {
        console.log('[Klaviyo] line_uid synced:', email, lineUID);
      }
    } catch (e) {
      console.error('[Klaviyo sync 網路/系統錯誤]', e.message);
    }
  }

  // 更新舊客，處理 email 衝突時退回只更新 tag
  async function updateCustomer(customerId, payload) {
    const updateRes = await fetch(
      'https://' + domain + '/admin/api/2026-01/customers/' + customerId + '.json',
      {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: payload })
      }
    );
    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      if (payload.email && JSON.stringify(updateData).includes('has already been taken')) {
        console.warn('Email 衝突，退回只更新 tag');
        const retryPayload = { ...payload };
        delete retryPayload.email;
        const retryRes = await fetch(
          'https://' + domain + '/admin/api/2026-01/customers/' + customerId + '.json',
          {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer: retryPayload })
          }
        );
        if (!retryRes.ok) {
          const retryData = await retryRes.json();
          throw new Error('退回標籤更新失敗: ' + JSON.stringify(retryData));
        }
      } else {
        throw new Error('舊客更新失敗: ' + JSON.stringify(updateData));
      }
    }
  }

  try {
    let customers = [];

    // 先用 uid_line_ tag 搜尋
    const tagSearchRes = await fetch(
      'https://' + domain + '/admin/api/2026-01/customers/search.json?query=tag:' + uidTag + '&fields=id,email,tags',
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    const tagSearchData = await tagSearchRes.json();
    customers = tagSearchData.customers || [];

    // tag 找不到才用 email 搜尋
    if (customers.length === 0 && email) {
      const emailSearchRes = await fetch(
        'https://' + domain + '/admin/api/2026-01/customers/search.json?query=email:' + encodeURIComponent(email) + '&fields=id,email,tags',
        { headers: { 'X-Shopify-Access-Token': accessToken } }
      );
      const emailSearchData = await emailSearchRes.json();
      customers = emailSearchData.customers || [];
    }

    let isFirstBindOnThisTrack = true;

    if (customers.length === 0) {
      // 新客人路徑：先查競態去重
      const alreadyBound = await isAlreadyBound(lineUID);
      if (alreadyBound) {
        console.log('競態去重：UID 已在 30 分鐘內完成綁定，跳過');
        return res.status(200).json({ success: true, note: 'duplicate_skipped' });
      }

      const createRes = await fetch('https://' + domain + '/admin/api/2026-01/customers.json', {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            email: email || undefined,
            tags: uidTag + ',' + flywheelTag,
            email_marketing_consent: { state: 'not_subscribed', opt_in_level: 'single_opt_in' }
          }
        })
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.customer) {
        throw new Error('建立顧客失敗: ' + JSON.stringify(createData));
      }

      isFirstBindOnThisTrack = true; // 新建立的顧客必然是首次綁定

    } else {
      const customer = customers[0];
      const finalTags = (customer.tags && typeof customer.tags === 'string')
        ? customer.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];

      isFirstBindOnThisTrack = boundTag
        ? !finalTags.includes(boundTag)
        : !finalTags.some(t => t.startsWith('uid_line_'));

      let tagsChanged = false;
      if (!finalTags.includes(uidTag))      { finalTags.push(uidTag);      tagsChanged = true; }
      if (!finalTags.includes(flywheelTag)) { finalTags.push(flywheelTag); tagsChanged = true; }

      const shouldPopulateEmail = email && !customer.email;

      if (tagsChanged || shouldPopulateEmail) {
        const updatePayload = { id: customer.id, tags: finalTags.join(',') };
        if (shouldPopulateEmail) updatePayload.email = email;
        await updateCustomer(customer.id, updatePayload);
      } else {
        console.log('顧客資料無變動，跳過 Shopify PUT');
      }
    }

    // 此軌道首次綁定才推歡迎訊息（非阻塞 / 背景發送即可）
    if (isFirstBindOnThisTrack) {
      const welcomeEventType = track === 'fortune' ? 'welcome_fortune' : 'welcome_Gift';
      sendWelcomeLine(lineUID, welcomeEventType);
    }

    // 非阻塞背景同步（不 await）
    syncKlaviyoLineUid(email, lineUID);
    writeSheet('success', '');

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('liff-bind error:', err.message);
    writeSheet('failed', err.message);
    return res.status(500).json({ success: false, message: '系統錯誤' });
  }
}
