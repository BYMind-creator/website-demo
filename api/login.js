// api/login.js — 驗證後台帳密，回傳角色
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SALT = process.env.AUTH_SALT;
  if (!URL || !KEY || !SALT) return res.status(500).json({ error: '伺服器環境變數未設定（含 AUTH_SALT）' });

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '請輸入帳號與密碼' });

    const inputHash = crypto.createHash('sha256').update(SALT + password).digest('hex');

    const resp = await fetch(
      `${URL}/rest/v1/admin_users?username=eq.${encodeURIComponent(username)}&is_active=eq.true&select=username,password_hash,role,display_name`,
      { headers }
    );
    if (!resp.ok) return res.status(500).json({ error: '登入查詢失敗', detail: await resp.text() });

    const user = (await resp.json())[0];
    if (!user || user.password_hash !== inputHash) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    return res.status(200).json({
      ok: true,
      username: user.username,
      role: user.role,
      display_name: user.display_name || user.username,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
