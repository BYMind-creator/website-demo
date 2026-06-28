// api/manage-menu-item.js — 後台：新增 / 刪除餐點。只有 superadmin 能用。
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

    // —— 驗身分：只有 superadmin 能改菜單 ——
    const { _user, _pass } = b;
    if (!_user || !_pass) return res.status(401).json({ error: '未登入' });
    const inputHash = crypto.createHash('sha256').update(SALT + _pass).digest('hex');
    const uResp = await fetch(
      `${URL}/rest/v1/admin_users?username=eq.${encodeURIComponent(_user)}&is_active=eq.true&select=role,password_hash`,
      { headers }
    );
    const u = (await uResp.json())[0];
    if (!u || u.password_hash !== inputHash) return res.status(401).json({ error: '身分驗證失敗' });
    if (u.role !== 'superadmin') return res.status(403).json({ error: '權限不足，只有管理員能管理菜單' });
    // ——

    const action = b.action; // 'create' 或 'delete'

    if (action === 'delete') {
      if (!b.id) return res.status(400).json({ error: '缺少餐點 id' });
      const resp = await fetch(`${URL}/rest/v1/menu_items?id=eq.${encodeURIComponent(b.id)}`,
        { method: 'DELETE', headers });
      if (!resp.ok) return res.status(500).json({ error: '刪除失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true });
    }

    if (action === 'create') {
      if (!b.restaurant_id || !b.name || b.price === undefined) {
        return res.status(400).json({ error: '缺少必填：餐廳、名稱、價格' });
      }
      const price = Number(b.price);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '價格不合法' });

      const row = {
        restaurant_id: b.restaurant_id,
        name: b.name,
        price,
        category: b.category || '其他',
        description: b.description || '',
        is_available: true,
      };
      const resp = await fetch(`${URL}/rest/v1/menu_items`,
        { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!resp.ok) return res.status(500).json({ error: '新增失敗', detail: await resp.text() });
      const created = await resp.json();
      return res.status(200).json({ ok: true, item: created[0] || null });
    }

    return res.status(400).json({ error: '未知的 action（要 create 或 delete）' });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
