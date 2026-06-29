// api/update-service-fee.js — 改某家餐廳的服務費（限 superadmin）
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { id, service_fee, _user, _pass } = req.body || {};
    if (!id || service_fee === undefined) return res.status(400).json({ error: '缺少參數' });

    const fee = parseInt(service_fee, 10);
    if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: '服務費不合法' });

    // 驗身分：查 admin_users，限 superadmin
    const authResp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/admin_users?username=eq.${encodeURIComponent(_user)}&select=role,password_hash,is_active`, {
      headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const users = await authResp.json();
    const u = users && users[0];
    if (!u || !u.is_active) return res.status(401).json({ error: '帳號無效' });

    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(process.env.AUTH_SALT + _pass).digest('hex');
    if (hash !== u.password_hash) return res.status(401).json({ error: '密碼錯誤' });
    if (u.role !== 'superadmin') return res.status(403).json({ error: '權限不足' });

    // 更新服務費
    const upd = await fetch(`${process.env.SUPABASE_URL}/rest/v1/restaurants?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ service_fee: fee }),
    });
    if (!upd.ok) return res.status(500).json({ error: '更新失敗' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
