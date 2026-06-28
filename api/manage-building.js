// api/manage-building.js — 後台：新增 / 編輯大樓。只有 superadmin。
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
    if (u.role !== 'superadmin') return res.status(403).json({ error: '權限不足，只有管理員能管理大樓' });

    const action = b.action;

    if (action === 'create') {
      if (!b.name) return res.status(400).json({ error: '缺少大樓名稱' });
      const row = {
        name: b.name,
        district: b.district || '',
        pickup_location: b.pickup_location || '',
        cutoff_time: b.cutoff_time || null,
        pickup_time: b.pickup_time || null,
        is_active: b.is_active !== undefined ? !!b.is_active : true,
      };
      const resp = await fetch(`${URL}/rest/v1/buildings`,
        { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!resp.ok) return res.status(500).json({ error: '新增大樓失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true, building: (await resp.json())[0] || null });
    }

    if (action === 'update') {
      if (!b.id) return res.status(400).json({ error: '缺少大樓 id' });
      const patch = {};
      ['name', 'district', 'pickup_location', 'cutoff_time', 'pickup_time'].forEach(k => {
        if (b[k] !== undefined) patch[k] = b[k] || null;
      });
      if (b.is_active !== undefined) patch.is_active = !!b.is_active;
      if (!Object.keys(patch).length) return res.status(400).json({ error: '沒有要更新的內容' });
      const resp = await fetch(`${URL}/rest/v1/buildings?id=eq.${encodeURIComponent(b.id)}`,
        { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (!resp.ok) return res.status(500).json({ error: '更新大樓失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true, building: (await resp.json())[0] || null });
    }

    return res.status(400).json({ error: '未知的 action（要 create 或 update）' });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
