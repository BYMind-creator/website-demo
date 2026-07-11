// api/orders.js
// Vercel Serverless Function：安全地把一筆訂單寫進 Supabase。
// service_role key 只存在這層（環境變數），不會外洩到瀏覽器。
//
// 需要在 Vercel 設這三個環境變數：
//   SUPABASE_URL                你的 Project URL（結尾不要多斜線）
//   SUPABASE_SERVICE_ROLE_KEY   Supabase 的 service_role key
//   GUEST_USER_ID               00000000-0000-0000-0000-000000000000
//   SESSION_SECRET              ← 新增：必須跟 api/auth.js 用同一個值
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
        // 想記錄「誰用 LINE 下的單」→ 先在 orders 表加兩欄（見對話說明），
        // 再把下面這兩行的註解拿掉即可：
        // line_user_id: lineUser.uid,
        // line_name: lineUser.name,
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
    // ↓↓↓ 新增這一段 ↓↓↓
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
    // ↑↑↑ 新增結束 ↑↑↑
    return res.status(200).json({
      order_number: order.order_number,
      order_id: order.id,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
