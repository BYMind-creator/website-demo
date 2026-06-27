// api/admin-orders.js
// 後台用：撈訂單列表（含大樓名）。跟 orders.js 同套路，service_role key 只待這層。

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    return res.status(500).json({ error: '伺服器環境變數未設定' });
  }

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  try {
    const url = `${URL}/rest/v1/orders?select=*,buildings(name)&order=created_at.desc`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(500).json({ error: '讀取訂單失敗', detail });
    }
    const rows = await resp.json();

    const orders = rows.map(o => ({
      num: o.order_number,
      name: o.contact_name,
      phone: o.contact_phone,
      building: o.buildings?.name || '—',
      note: o.note || '',
      amount: o.total,
      subtotal: o.subtotal,
      service_fee: o.service_fee,
      status: o.status,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      time: new Date(o.created_at).toLocaleTimeString('zh-TW', {
        timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
      }),
    }));

    return res.status(200).json({ orders });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
