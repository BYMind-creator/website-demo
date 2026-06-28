// api/update-status.js
// 後台用：更新一筆訂單的狀態。

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return res.status(500).json({ error: '伺服器環境變數未設定' });

  const headers = {
    apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
  };

  try {
    const b = req.body || {};
    const VALID = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!b.order_number || !VALID.includes(b.status)) {
      return res.status(400).json({ error: '缺少訂單編號或狀態不合法' });
    }

    const resp = await fetch(
      `${URL}/rest/v1/orders?order_number=eq.${encodeURIComponent(b.order_number)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ status: b.status }),
      }
    );
    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(500).json({ error: '更新狀態失敗', detail });
    }
    const updated = await resp.json();
    return res.status(200).json({ ok: true, order: updated[0] || null });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
