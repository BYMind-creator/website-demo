// api/orders.js
// Vercel Serverless Function：安全地把一筆訂單寫進 Supabase。
// service_role key 只存在這層（環境變數），不會外洩到瀏覽器。
//
// 需要在 Vercel 設這些環境變數：
//   SUPABASE_URL                你的 Project URL（結尾不要多斜線）
//   SUPABASE_SERVICE_ROLE_KEY   Supabase 的 service_role key
//   SESSION_SECRET              ← 必須跟 api/auth.js 用同一個值
import crypto from 'crypto';

// ===== 內建：驗證 LINE 登入（不 import lib，跟 auth.js 同一套簽章）=====
function getLineUser(req) {
  const SECRET = process.env.SESSION_SECRET || '';
  const raw = (req.headers.cookie || '').split(';')
    .map(v => v.trim()).find(v => v.startsWith('session='));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice('session='.length));
  if (!token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ===== 真正的鎖：沒登入就不准下單 =====
  const lineUser = getLineUser(req);
  if (!lineUser) {
    return res.status(401).json({ error: '請先用 LINE 登入才能訂餐' });
  }

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    return res.status(500).json({ error: '伺服器環境變數未設定（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）' });
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

    // 0) 記顧客：把這個 LINE 用戶 upsert 進 users 表（有就更新、沒有就新增）
    //    靠 line_user_id 的 unique 限制去重；on_conflict 指定用它比對。
    const upsertResp = await fetch(
      `${URL}/rest/v1/users?on_conflict=line_user_id`,
      {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          line_user_id: lineUser.uid,
          display_name: lineUser.name || null,
          picture_url: lineUser.pic || null,
          phone: b.contact_phone,             // 順手把這次填的電話存進顧客檔
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!upsertResp.ok) {
      const detail = await upsertResp.text();
      return res.status(500).json({ error: '寫入用戶檔失敗', detail });
    }
    const upserted = await upsertResp.json();
    const customer = Array.isArray(upserted) ? upserted[0] : upserted;
    const customerId = customer && customer.id;
    if (!customerId) {
      return res.status(500).json({ error: '取得用戶 ID 失敗' });
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
    // 3) 寫入訂單（user_id 指向這位 LINE 用戶本人，不再是 guest）
    const insResp = await fetch(`${URL}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        order_number,
        user_id: customerId,             // ← 訂單掛在本人底下（關聯用，追得到人、可 JOIN users）
        line_user_id: lineUser.uid,      // ← 訂單上直接存一份 LINE ID（免 JOIN 就看得到）
        line_name: lineUser.name || null,// ← 訂單上直接存一份 LINE 名字
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
    // 寫入訂單明細 order_items
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length) {
      const rows = items.map(it => ({
        order_id: order.id,
        restaurant_id: it.restaurant_id,
        menu_item_id: it.menu_item_id,
        item_name: it.item_name,
        item_price: it.item_price,
        quantity: it.quantity,
        subtotal: it.subtotal,
      }));
      const itemResp = await fetch(`${URL}/rest/v1/order_items`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(rows),
      });
      if (!itemResp.ok) {
        const detail = await itemResp.text();
        return res.status(500).json({ error: '寫入訂單明細失敗', detail });
      }
    }
    return res.status(200).json({
      order_number: order.order_number,
      order_id: order.id,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
