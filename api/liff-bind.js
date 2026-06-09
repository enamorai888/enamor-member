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
  const token = process.env.SHOPIFY_ORDER_TOKEN;
  const tag = `uid_line_${lineUID}`;

  try {
    const searchRes = await fetch(
      `https://${domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}&fields=id,email,tags`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const searchData = await searchRes.json();
    const customers = searchData.customers;

    if (!customers || customers.length === 0) {
      return res.status(200).json({ success: true, message: '已記錄，會員資料建立後自動連結' });
    }

    const customer = customers[0];
    const existingTags = customer.tags ? customer.tags.split(', ') : [];
    const filteredTags = existingTags.filter(t => !t.startsWith('uid_line_'));
    filteredTags.push(tag);
    const newTags = filteredTags.join(', ');

    await fetch(
      `https://${domain}/admin/api/2024-01/customers/${customer.id}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customer: { id: customer.id, tags: newTags } })
      }
    );

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('liff-bind error:', err);
    return res.status(500).json({ success: false, message: '系統錯誤' });
  }
}
