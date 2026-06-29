// api/admin-orders.js
// 後台用：撈訂單列表（含大樓名）。支援 ?month=YYYY-MM 撈整月；不帶則撈全部。
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
    let url = `${URL}/rest/v1/orders?select=*,buildings(name),order_items(item_name,item_price,quantity,subtotal,restaurants(name))&order=created_at.desc`;

    // 月份篩選：?month=2026-06 → 撈該月 1 號到下月 1 號之間
    const month = req.query?.month;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01T00:00:00+08:00`;
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const end = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00+08:00`;
      url += `&created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(end)}`;
    }

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
      created_at: o.created_at,
      date: new Date(o.created_at).toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
      }),
      time: new Date(o.created_at).toLocaleTimeString('zh-TW', {
        timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
      }),
      items: (o.order_items || []).map(it => ({
        name: it.item_name,
        price: it.item_price,
        quantity: it.quantity,
        subtotal: it.subtotal,
        restaurant: it.restaurants?.name || '其他',
      })),
    }));
    return res.status(200).json({ orders });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
