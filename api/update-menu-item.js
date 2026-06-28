// api/update-menu-item.js — 後台：改某個餐點的價格 / 上下架。只有 superadmin 能改。
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SALT = process.env.AUTH_SALT;
  if (!URL || !KEY || !SALT) return res.status(500).json({ error: '伺服器環境變數未設定' });

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  try {
    const b = req.body || {};

    // —— 驗身分：回 DB 查真 role ——
    const { _user, _pass } = b;
    if (!_user || !_pass) return res.status(401).json({ error: '未登入或缺少驗證資訊' });
    const inputHash = crypto.createHash('sha256').update(SALT + _pass).digest('hex');
    const uResp = await fetch(
      `${URL}/rest/v1/admin_users?username=eq.${encodeURIComponent(_user)}&is_active=eq.true&select=role,password_hash`,
      { headers }
    );
    const u = (await uResp.json())[0];
    if (!u || u.password_hash !== inputHash) return res.status(401).json({ error: '身分驗證失敗' });
    if (u.role !== 'superadmin') return res.status(403).json({ error: '權限不足，只有管理員能修改菜單' });
    // —— 驗身分結束 ——

    if (!b.id) return res.status(400).json({ error: '缺少餐點 id' });

    // 要改什麼：price 和/或 is_available。只帶有送來的欄位。
    const patch = {};
    if (b.price !== undefined) {
      const price = Number(b.price);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '價格不合法' });
      patch.price = price;
    }
    if (b.is_available !== undefined) patch.is_available = !!b.is_available;
    if (!Object.keys(patch).length) return res.status(400).json({ error: '沒有要更新的內容' });

    const resp = await fetch(
      `${URL}/rest/v1/menu_items?id=eq.${encodeURIComponent(b.id)}`,
      { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) }
    );
    if (!resp.ok) return res.status(500).json({ error: '更新失敗', detail: await resp.text() });

    const updated = await resp.json();
    return res.status(200).json({ ok: true, item: updated[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
