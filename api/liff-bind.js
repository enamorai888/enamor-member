export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const email = body.email ? body.email.trim() : '';
  const lineUID = body.lineUID ? body.lineUID.trim() : '';
  const track = body.track || 'lycra_free';
  const stage = body.stage || 'join';

  if (!lineUID) return res.status(400).json({ success: false, message: '缺少 lineUID' });
  if (stage === 'join' && !email) return res.status(400).json({ success: false, message: '缺少 email' });

  const domain       = process.env.SHOPIFY_DOMAIN;
  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const lineToken    = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const sheetApi     = process.env.GOOGLE_SHEET_WEBHOOK;

  const timestamp = new Date().toISOString();

  const TAG_MAP = {
    cool: { lycra_free: 'Flywheel_Lycra_Cool', fortune_test: 'Flywheel_Fortune_Cool' },
    join: { lycra_free: 'Flywheel_Lycra_Join', fortune_test: 'Flywheel_Fortune_Join' }
  };
  const flywheelTag = (TAG_MAP[stage] && TAG_MAP[stage][track])
    ? TAG_MAP[stage][track]
    : ('Flywheel_' + track + '_' + stage);
  const uidTag = 'uid_line_' + lineUID;

  async function writeSheet(status, errorMsg) {
    if (!sheetApi) return;
    try {
      await fetch(sheetApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: timestamp,
          email: email,
          lineUID: lineUID,
          track: track,
          stage: stage,
          status: status,
          errorMsg: errorMsg || '',
          upsert: true
        })
      });
    } catch (e) {
      console.error('Sheet error:', e.message);
    }
  }

  if (stage === 'cool') {
    await writeSheet('success', '');
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
    await writeSheet('failed', 'Token 換取失敗: ' + e.message);
    return res.status(500).json({ success: false, message: '無法取得 Shopify token' });
  }

  const welcomeMessage = '歡迎成為 EnamoR 恩娜茉兒的一員。\n\n很高興您在這裡。從現在起，每個月我們會透過 LINE 私訊發送專屬月禮連結，只有綁定會員才能收到，請保持好友狀態不要封鎖，避免錯失每月禮遇。\n\n這是您本月的會員月禮，專屬於您：\nhttps://enamor.cc/xZpUD';

  try {
    const searchRes = await fetch(
      'https://' + domain + '/admin/api/2026-01/customers/search.json?query=email:' + encodeURIComponent(email) + '&fields=id,email,tags',
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    const searchData = await searchRes.json();
    const customers = searchData.customers;

    let isFirstBind = true;

    if (!customers || customers.length === 0) {
      const createRes = await fetch('https://' + domain + '/admin/api/2026-01/customers.json', {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            email: email,
            tags: uidTag + ',' + flywheelTag,
            email_marketing_consent: { state: 'not_subscribed', opt_in_level: 'single_opt_in' }
          }
        })
      });
      const createData = await createRes.json();
      if (!createData.customer) throw new Error('建立顧客失敗: ' + JSON.stringify(createData));

    } else {
      const customer = customers[0];
      let existingTags = [];
      if (customer.tags && typeof customer.tags === 'string') {
        existingTags = customer.tags.split(',').map(function(t) { return t.trim(); });
      }
      isFirstBind = !existingTags.some(function(t) { return t.startsWith('uid_line_'); });

      var finalTags = [];
      for (var i = 0; i < existingTags.length; i++) {
        if (existingTags[i].length > 0) finalTags.push(existingTags[i]);
      }
      if (finalTags.indexOf(uidTag) === -1) finalTags.push(uidTag);
      if (finalTags.indexOf(flywheelTag) === -1) finalTags.push(flywheelTag);

      const mergedTags = finalTags.join(',');
      console.log('舊客更新標籤：', mergedTags);

      const updateRes = await fetch('https://' + domain + '/admin/api/2026-01/customers/' + customer.id + '.json', {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: { id: customer.id, tags: mergedTags } })
      });
      if (!updateRes.ok) {
        const errData = await updateRes.json();
        throw new Error('舊客更新標籤失敗: ' + JSON.stringify(errData));
      }
    }

    if (isFirstBind) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
        body: JSON.stringify({ to: lineUID, messages: [{ type: 'text', text: welcomeMessage }] })
      });
    }

    await writeSheet('success', '');
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('liff-bind error:', err.message);
    await writeSheet('failed', err.message);
    return res.status(500).json({ success: false, message: '系統錯誤' });
  }
}
