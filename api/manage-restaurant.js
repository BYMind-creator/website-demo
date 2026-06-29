// api/manage-restaurant.js — 後台：新增 / 編輯餐廳。只有 superadmin。
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
    const { _user, _pass } = b;
    if (!_user || !_pass) return res.status(401).json({ error: '未登入' });
    const inputHash = crypto.createHash('sha256').update(SALT + _pass).digest('hex');
    const uResp = await fetch(
      `${URL}/rest/v1/admin_users?username=eq.${encodeURIComponent(_user)}&is_active=eq.true&select=role,password_hash`,
      { headers }
    );
    const u = (await uResp.json())[0];
    if (!u || u.password_hash !== inputHash) return res.status(401).json({ error: '身分驗證失敗' });
    if (u.role !== 'superadmin' && u.role !== 'ops') return res.status(403).json({ error: '權限不足' });

    const action = b.action; // 'create' 或 'update'

    if (action === 'create') {
      if (!b.name) return res.status(400).json({ error: '缺少餐廳名稱' });
      const row = {
        name: b.name,
        description: b.description || '',
        is_active: b.is_active !== undefined ? !!b.is_active : true,
      };
      const resp = await fetch(`${URL}/rest/v1/restaurants`,
        { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!resp.ok) return res.status(500).json({ error: '新增餐廳失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true, restaurant: (await resp.json())[0] || null });
    }

    if (action === 'update') {
      if (!b.id) return res.status(400).json({ error: '缺少餐廳 id' });
      const patch = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.description !== undefined) patch.description = b.description;
      if (b.is_active !== undefined) patch.is_active = !!b.is_active;
      if (b.service_fee !== undefined) patch.service_fee = parseInt(b.service_fee, 10);
      if (!Object.keys(patch).length) return res.status(400).json({ error: '沒有要更新的內容' });
      const resp = await fetch(`${URL}/rest/v1/restaurants?id=eq.${encodeURIComponent(b.id)}`,
        { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (!resp.ok) return res.status(500).json({ error: '更新餐廳失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true, restaurant: (await resp.json())[0] || null });
    }

    return res.status(400).json({ error: '未知的 action（要 create 或 update）' });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
