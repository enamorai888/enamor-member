export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, lineUID } = req.body;
  if (!email || !lineUID) {
    return res.status(400).json({ success: false, message: '缺少必要參數' });
  }

  const domain = process.env.SHOPIFY_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  try {
    // 換 token
    const tokenRes = await fetch(
      `https://${domain}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret
        }).toString()
      }
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error('Token error:', JSON.stringify(tokenData));
      return res.status(500).json({ success: false, message: '無法取得 Shopify token' });
    }

    const tag = `uid_line_${lineUID}`;

    // 搜尋顧客
    const searchRes = await fetch(
      `https://${domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}&fields=id,email,tags`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    const searchData = await searchRes.json();
    const customers = searchData.customers;

    let customerId, existingTags;

    if (!customers || customers.length === 0) {
      // 找不到 → 建立新 customer
      const createRes = await fetch(
        `https://${domain}/admin/api/2024-01/customers.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            customer: {
              email: email,
              tags: tag,
              email_marketing_consent: {
                state: 'not_subscribed',
                opt_in_level: 'single_opt_in'
              }
            }
          })
        }
      );
      const createData = await createRes.json();
      if (!createData.customer) {
        console.error('Create error:', JSON.stringify(createData));
        return res.status(500).json({ success: false, message: '建立會員失敗' });
      }
      return res.status(200).json({ success: true });
    }

    // 找到 → 更新 tag
    const customer = customers[0];
    existingTags = customer.tags ? customer.tags.split(', ') : [];
    const filteredTags = existingTags.filter(t => !t.startsWith('uid_line_'));
    filteredTags.push(tag);
    const newTags = filteredTags.join(', ');

    const updateRes = await fetch(
      `https://${domain}/admin/api/2024-01/customers/${customer.id}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customer: { id: customer.id, tags: newTags } })
      }
    );

    if (!updateRes.ok) {
      const err = await updateRes.json();
      console.error('Update error:', JSON.stringify(err));
      return res.status(500).json({ success: false, message: '寫入失敗' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('liff-bind error:', err);
    return res.status(500).json({ success: false, message: '系統錯誤' });
  }
}
