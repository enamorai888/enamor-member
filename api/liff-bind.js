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
      gift:       'Flywheel_Gift_Cool',
      fortune:    'Flywheel_Fortune_Cool',
      ambassador: 'Flywheel_Ambassador_Cool'
    },
    join: {
      gift:       'Flywheel_Gift_Join',
      fortune:    'Flywheel_Fortune_Join',
      ambassador: 'Flywheel_Ambassador_Join'
    }
  };

  const flywheelTag = (TAG_MAP[stage] && TAG_MAP[stage][track])
    ? TAG_MAP[stage][track]
    : ('Flywheel_' + track + '_' + stage);
  const uidTag = 'uid_line_' + lineUID;

  // 這個 track 對應的「已綁定過」tag，用來判斷是否此軌道的首次綁定
  // gift → Flywheel_Gift_Join，fortune → Flywheel_Fortune_Join
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
    console.log('Token 結果：', JSON.stringify(tokenData));
    accessToken = tokenData.access_token;
    if (!accessToken) throw new Error(JSON.stringify(tokenData));
  } catch (e) {
    await writeSheet('failed', 'Token 換取失敗: ' + e.message);
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
      return false; // 查不到就放行，不誤擋
    }
  }

  // LINE 推播：非同步背景執行，不阻塞主流程回應
  // [補強5] 舊版 await 串行導致前端卡 2~3 秒，改為 .then() 背景處理
  function sendWelcomeLine(uid, welcomeEventType) {
    getWelcomeMessage(welcomeEventType).then(welcomeMessage => {
      if (!welcomeMessage) return;
      fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lineToken },
        body: JSON.stringify({ to: uid, messages: [{ type: 'text', text: welcomeMessage }] })
      }).catch(e => console.error('LINE push error:', e.message));
    }).catch(e => console.error('getWelcomeMessage error:', e.message));
  }

  try {
    const searchRes = await fetch(
      'https://' + domain + '/admin/api/2026-01/customers/search.json?query=email:' + encodeURIComponent(email) + '&fields=id,email,tags',
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    const searchData = await searchRes.json();
    console.log('搜尋結果：', JSON.stringify(searchData).substring(0, 200));
    const customers = searchData.customers;

    let isFirstBindOnThisTrack = true;

    if (!customers || customers.length === 0) {
      // 新客人路徑：先查競態去重
      const alreadyBound = await isAlreadyBound(lineUID);
      if (alreadyBound) {
        console.log('競態去重：UID 已在 30 分鐘內完成綁定，跳過');
        return res.status(200).json({ success: true, note: 'duplicate_skipped' });
      }

      await fetch('https://' + domain + '/admin/api/2026-01/customers.json', {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            email,
            tags: uidTag + ',' + flywheelTag,
            email_marketing_consent: { state: 'not_subscribed', opt_in_level: 'single_opt_in' }
          }
        })
      }).then(async r => {
        const d = await r.json();
        console.log('建立顧客結果：', JSON.stringify(d).substring(0, 200));
        if (!d.customer) throw new Error('建立顧客失敗: ' + JSON.stringify(d));
      });

    } else {
      const customer = customers[0];
      let existingTags = [];
      if (customer.tags && typeof customer.tags === 'string') {
        existingTags = customer.tags.split(',').map(t => t.trim());
      }

      // [補強3] 跨軌道判斷：不再用 uid_line_ 判斷是否首次綁定
      // 改為判斷「此軌道的 Join tag」是否已存在
      // 例：已有 Flywheel_Gift_Join 的人去玩 fortune，isFirstBindOnThisTrack 仍為 true
      isFirstBindOnThisTrack = boundTag ? !existingTags.includes(boundTag) : !existingTags.some(t => t.startsWith('uid_line_'));

      const finalTags = existingTags.filter(t => t.length > 0);
      if (!finalTags.includes(uidTag))      finalTags.push(uidTag);
      if (!finalTags.includes(flywheelTag)) finalTags.push(flywheelTag);

      // [補強4] 舊客補 email：若 Shopify 顧客資料沒有 email，這次填了就補進去
      const updatePayload = { id: customer.id, tags: finalTags.join(',') };
      if (email && !customer.email) {
        updatePayload.email = email;
        console.log('舊客補 email：', email);
      }

      const updateRes = await fetch('https://' + domain + '/admin/api/2026-01/customers/' + customer.id + '.json', {
        method: 'PUT',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: updatePayload })
      });
      const updateData = await updateRes.json();
      console.log('更新結果：', JSON.stringify(updateData).substring(0, 200));
      if (!updateRes.ok) throw new Error('舊客更新失敗: ' + JSON.stringify(updateData));
    }

    // [補強5] 此軌道首次綁定才推歡迎訊息，非同步背景執行不阻塞回應
    if (isFirstBindOnThisTrack) {
      const welcomeEventType = track === 'fortune' ? 'welcome_fortune' : 'welcome_Gift';
      sendWelcomeLine(lineUID, welcomeEventType);
    }

    // Shopify 處理完立即回應，不等 LINE 推播
    writeSheet('success', ''); // 也不等 Sheet 寫入
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('liff-bind error:', err.message);
    await writeSheet('failed', err.message);
    return res.status(500).json({ success: false, message: '系統錯誤' });
  }
}
