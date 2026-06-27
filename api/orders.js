// api/orders.js
// Vercel Serverless Function：安全地把一筆訂單寫進 Supabase。
// service_role key 只存在這層（環境變數），不會外洩到瀏覽器。
//
// 需要在 Vercel 設這三個環境變數：
//   SUPABASE_URL                你的 Project URL（結尾不要多斜線）
//   SUPABASE_SERVICE_ROLE_KEY   Supabase 的 service_role key
//   GUEST_USER_ID               00000000-0000-0000-0000-000000000000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GUEST = process.env.GUEST_USER_ID;

  if (!URL || !KEY || !GUEST) {
    return res.status(500).json({ error: '伺服器環境變數未設定（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GUEST_USER_ID）' });
  }

  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const b = req.body || {};

    // 基本驗證
    if (!b.contact_name || !b.contact_phone || !b.building_id) {
      return res.status(400).json({ error: '缺少必要欄位（姓名 / 電話 / 大樓）' });
    }

    // 1) 用資料庫內建函式產生訂單編號（格式 YYYYMMDD-XXX，每日從 001 起算）
    const rpcResp = await fetch(`${URL}/rest/v1/rpc/generate_order_number`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    if (!rpcResp.ok) {
      const detail = await rpcResp.text();
      return res.status(500).json({ error: '產生訂單編號失敗', detail });
    }
    const order_number = await rpcResp.json();

    // 2) 取台灣時區的今天日期（YYYY-MM-DD）
    const pickup_date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

    // 3) 寫入訂單
    const insResp = await fetch(`${URL}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        order_number,
        user_id: GUEST,
        building_id: b.building_id,
        pickup_date,
        pickup_time: '12:00',            // 下一關改成依大樓帶入
        contact_name: b.contact_name,
        contact_phone: b.contact_phone,
        note: b.note || null,
        subtotal: b.subtotal,
        service_fee: b.service_fee ?? 25,
        total: b.total,
        payment_method: b.payment_method || 'cash',
      }),
    });

    if (!insResp.ok) {
      const detail = await insResp.text();
      return res.status(500).json({ error: '寫入訂單失敗', detail });
    }

    const inserted = await insResp.json();
    const order = Array.isArray(inserted) ? inserted[0] : inserted;

    return res.status(200).json({
      order_number: order.order_number,
      order_id: order.id,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
