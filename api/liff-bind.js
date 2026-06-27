import fetch from 'node-fetch';

// 1. 定義標籤對應表
const TAG_MAP = {
  cool: {
    lycra_free: 'Flywheel_Lycra_Cool',
    fortune_test: 'Flywheel_Fortune_Cool'
  },
  join: {
    lycra_free: 'Flywheel_Lycra_Join',
    fortune_test: 'Flywheel_Fortune_Join'
  }
};

export default async function handler(req, res) {
  // 允許跨域請求 (CORS)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { lineUID, email, track = 'lycra_free', stage = 'join' } = req.body;

    if (!lineUID) {
      return res.status(400).json({ success: false, message: '缺少 LINE UID' });
    }
    if (stage === 'join' && !email) {
      return res.status(400).json({ success: false, message: '缺少 Email' });
    }

    // 從環境變數讀取憑證
    const domain = process.env.SHOPIFY_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    const gasWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;

    // 決定這次要新增的標籤
    const uidTag = `uid_line_${lineUID}`;
    const flywheelTag = TAG_MAP[stage]?.[track] || `Flywheel_${track}_${stage}`;

    let isFirstBind = true;
    let statusText = '未知狀態';

    // ==========================================
    // 階段 A：如果是 cool 階段，免查詢直接進 GAS
    // ==========================================
    if (stage === 'cool') {
      statusText = '冷客觸發';
    } 
    // ==========================================
    // 階段 B：如果是 join 階段，執行 Shopify 與 GAS
    // ==========================================
    else {
      // 1. 查詢 Shopify 是否已有該 Email 顧客
      const searchRes = await fetch(`https://${domain}/admin/api/2026-01/customers/search.json?query=email:${email}`, {
        method: 'GET',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' }
      });

      if (!searchRes.ok) {
        const searchErr = await searchRes.json();
        throw new Error(`Shopify 查詢失敗: ${JSON.stringify(searchErr)}`);
      }

      const searchData = await searchRes.json();
      const customers = searchData.customers || [];

      if (customers.length === 0) {
        // 【新客註冊】
        statusText = '新客註冊成功';
        const createRes = await fetch(`https://${domain}/admin/api/2026-01/customers.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: {
              email: email,
              first_name: 'LINE用戶',
              tags: `${uidTag},${flywheelTag}` // 新客直接給標準去空格標籤
            }
          })
        });

        if (!createRes.ok) {
          const createErr = await createRes.json();
          throw new Error(`Shopify 建立顧客失敗: ${JSON.stringify(createErr)}`);
        }
      } else {
        // 【舊客/重複進人處理】無條件強制疊加標籤，打破死結
        const customer = customers[0];
        let existingTags = [];

        // 精準清洗所有舊標籤，防止古怪格式干擾
        if (customer.tags && typeof customer.tags === 'string') {
          existingTags = customer.tags.split(',').map(t => t.trim());
        }

        // 判斷是否為這輩子第一次綁定 LINE
        isFirstBind = !existingTags.some(t => t.startsWith('uid_line_'));
        statusText = isFirstBind ? '舊客首次綁定' : '老客重複參加活動';

        // 建立新標籤陣列，保留有價值的舊標籤
        let finalTags = [];
        for (let i = 0; i < existingTags.length; i++) {
          if (existingTags[i].length > 0) {
            finalTags.push(existingTags[i]);
          }
        }

        // 檢查並強力疊加這次的新標籤（陣列中沒有才加，完美去重）
        if (finalTags.indexOf(uidTag) === -1) {
          finalTags.push(uidTag);
        }
        if (finalTags.indexOf(flywheelTag) === -1) {
          finalTags.push(flywheelTag);
        }

        // 用標準的「純逗號、無空格」打包，強迫 Shopify 立刻固化儲存
        const mergedTags = finalTags.join(',');

        const updateRes = await fetch(`https://${domain}/admin/api/2026-01/customers/${customer.id}.json`, {
          method: 'PUT',
          headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer: { id: customer.id, tags: mergedTags } })
        });

        if (!updateRes.ok) {
          const updateErr = await updateRes.json();
          throw new Error(`Shopify 舊客更新失敗: ${JSON.stringify(updateErr)}`);
        }
      }
    }

    // ==========================================
    // 階段 C：將數據打進 Google Sheet (GAS Webhook)
    // ==========================================
    if (gasWebhookUrl) {
      try {
        await fetch(gasWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            email: email || 'N/A',
            lineUID: lineUID,
            track: track,
            stage: stage,
            statusText: statusText
          })
        });
      } catch (gasErr) {
        console.error('Google Sheet 寫入失敗，但不阻斷前端流：', gasErr);
      }
    }

    // 成功回傳給前端
    return res.status(200).json({
      success: true,
      message: statusText,
      isFirstBind: isFirstBind
    });

  } catch (error) {
    console.error('API 崩潰錯誤記錄:', error);
    return res.status(500).json({
      success: false,
      message: `伺服器出錯: ${error.message}`
    });
  }
}
