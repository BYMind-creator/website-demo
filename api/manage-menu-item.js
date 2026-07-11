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
    if (u.role !== 'superadmin' && u.role !== 'ops') return res.status(403).json({ error: '權限不足' });
    // ——

    const action = b.action; // 'create' / 'delete' / 'upload-image'

    if (action === 'upload-image') {
      if (!b.data) return res.status(400).json({ error: '沒有收到圖片資料' });
      const clean = String(b.data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(clean, 'base64');
      if (buffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: '圖片太大（請壓到 5MB 以內）' });
      const type = b.content_type || 'image/jpeg';
      const ext = type.includes('png') ? 'png' : (type.includes('webp') ? 'webp' : 'jpg');
      const path = `${crypto.randomUUID()}.${ext}`;
      const upResp = await fetch(`${URL}/storage/v1/object/menu-images/${path}`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': type, 'x-upsert': 'true' },
        body: buffer,
      });
      if (!upResp.ok) return res.status(500).json({ error: '圖片上傳失敗', detail: await upResp.text() });
      return res.status(200).json({ ok: true, url: `${URL}/storage/v1/object/public/menu-images/${path}` });
    }

    if (action === 'add-image') {
      if (!b.menu_item_id || !b.url) return res.status(400).json({ error: '缺少 menu_item_id 或 url' });
      const imgRow = { menu_item_id: b.menu_item_id, url: b.url, sort_order: b.sort_order ?? 0 };
      const resp = await fetch(`${URL}/rest/v1/menu_item_images`,
        { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(imgRow) });
      if (!resp.ok) return res.status(500).json({ error: '加圖失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true, image: (await resp.json())[0] || null });
    }

    if (action === 'delete-image') {
      if (!b.image_id) return res.status(400).json({ error: '缺少 image_id' });
      const resp = await fetch(`${URL}/rest/v1/menu_item_images?id=eq.${encodeURIComponent(b.image_id)}`,
        { method: 'DELETE', headers });
      if (!resp.ok) return res.status(500).json({ error: '刪圖失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reorder') {
      if (!Array.isArray(b.items)) return res.status(400).json({ error: '缺少 items 陣列' });
      for (const it of b.items) {
        await fetch(`${URL}/rest/v1/menu_items?id=eq.${encodeURIComponent(it.id)}`,
          { method: 'PATCH', headers, body: JSON.stringify({ sort_order: parseInt(it.sort_order, 10) }) });
      }
      return res.status(200).json({ ok: true });
    }
    
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
      const urls = Array.isArray(b.image_urls) ? b.image_urls.filter(Boolean) : [];
      const row = {
        restaurant_id: b.restaurant_id,
        name: b.name,
        price,
        category: b.category || '其他',
        description: b.description || '',
        image_url: urls[0] || b.image_url || null, // 封面（相容舊單圖顯示）
        sort_order: b.sort_order !== undefined ? parseInt(b.sort_order, 10) : 0,
        is_available: true,
      };
      const resp = await fetch(`${URL}/rest/v1/menu_items`,
        { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!resp.ok) return res.status(500).json({ error: '新增失敗', detail: await resp.text() });
      const created = (await resp.json())[0] || null;
      if (created && urls.length) {
        const imgRows = urls.map((url, i) => ({ menu_item_id: created.id, url, sort_order: i }));
        const imgResp = await fetch(`${URL}/rest/v1/menu_item_images`,
          { method: 'POST', headers, body: JSON.stringify(imgRows) });
        if (!imgResp.ok) return res.status(500).json({ error: '餐點建立了、但圖片存檔失敗', detail: await imgResp.text() });
      }
      return res.status(200).json({ ok: true, item: created });
    }

    if (action === 'update-fields') {
      // 改價格 / 上下架（原 update-menu-item.js 的功能，合併進來省一支 function）
      if (!b.id) return res.status(400).json({ error: '缺少餐點 id' });
      const patch = {};
      if (b.price !== undefined) {
        const price = Number(b.price);
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: '價格不合法' });
        patch.price = price;
      }
      if (b.is_available !== undefined) patch.is_available = !!b.is_available;
      if (!Object.keys(patch).length) return res.status(400).json({ error: '沒有要更新的內容' });
      const resp = await fetch(`${URL}/rest/v1/menu_items?id=eq.${encodeURIComponent(b.id)}`,
        { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (!resp.ok) return res.status(500).json({ error: '更新失敗', detail: await resp.text() });
      return res.status(200).json({ ok: true, item: (await resp.json())[0] || null });
    }

    return res.status(400).json({ error: '未知的 action（要 create 或 delete）' });
  } catch (e) {
    console.error('[manage-menu-item]', e);
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
