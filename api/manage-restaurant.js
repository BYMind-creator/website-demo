// api/manage-restaurant.js — 後台：新增 / 編輯餐廳（含服務大樓關聯）。只有 superadmin / ops。
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

    // 小工具：全量覆蓋某餐廳的服務大樓
    async function setBuildings(restaurantId, buildingIds) {
      await fetch(`${URL}/rest/v1/restaurant_buildings?restaurant_id=eq.${encodeURIComponent(restaurantId)}`,
        { method: 'DELETE', headers });
      if (buildingIds.length) {
        const rows = buildingIds.map(bid => ({ restaurant_id: restaurantId, building_id: bid }));
        const r = await fetch(`${URL}/rest/v1/restaurant_buildings`,
          { method: 'POST', headers, body: JSON.stringify(rows) });
        if (!r.ok) throw new Error('服務大樓存檔失敗：' + (await r.text()));
      }
    }

    const action = b.action; // 'create' 或 'update'

    if (action === 'create') {
      if (!b.name) return res.status(400).json({ error: '缺少餐廳名稱' });
      const building_ids = Array.isArray(b.building_ids) ? b.building_ids.filter(Boolean) : [];
      if (building_ids.length === 0) return res.status(400).json({ error: '請至少選一棟服務大樓' }); // #5 必填
      const active_days = Array.isArray(b.active_days) ? b.active_days.map(Number).filter(n => n >= 1 && n <= 7) : [];
      if (active_days.length === 0) return res.status(400).json({ error: '請至少選一個營業日' }); // #4 必填(b-1)
      const row = {
        name: b.name,
        description: b.description || '',
        address: b.address || null,
        sort_order: b.sort_order !== undefined ? parseInt(b.sort_order, 10) : 0,
        active_days,
        cover_url: b.cover_url || null,
        is_active: b.is_active !== undefined ? !!b.is_active : true,
      };
      const resp = await fetch(`${URL}/rest/v1/restaurants`,
        { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (!resp.ok) return res.status(500).json({ error: '新增餐廳失敗', detail: await resp.text() });
      const created = (await resp.json())[0] || null;
      if (created) {
        try { await setBuildings(created.id, building_ids); }
        catch (e) { return res.status(500).json({ error: '餐廳建立了、但服務大樓存檔失敗', detail: e.message }); }
      }
      return res.status(200).json({ ok: true, restaurant: created });
    }

    if (action === 'update') {
      if (!b.id) return res.status(400).json({ error: '缺少餐廳 id' });
      const patch = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.description !== undefined) patch.description = b.description;
      if (b.is_active !== undefined) patch.is_active = !!b.is_active;
      if (b.address !== undefined) patch.address = b.address;
      if (b.sort_order !== undefined) patch.sort_order = parseInt(b.sort_order, 10);
      if (b.cover_url !== undefined) patch.cover_url = b.cover_url;

      // #4：有帶 active_days 才動（必填、存進 restaurants.active_days）
      if (Array.isArray(b.active_days)) {
        const active_days = b.active_days.map(Number).filter(n => n >= 1 && n <= 7);
        if (active_days.length === 0) return res.status(400).json({ error: '請至少選一個營業日' });
        patch.active_days = active_days;
      }

      // #5：有帶 building_ids 才動關聯（全量覆蓋，必填）
      let touchedBuildings = false;
      if (Array.isArray(b.building_ids)) {
        const building_ids = b.building_ids.filter(Boolean);
        if (building_ids.length === 0) return res.status(400).json({ error: '請至少選一棟服務大樓' });
        try { await setBuildings(b.id, building_ids); touchedBuildings = true; }
        catch (e) { return res.status(500).json({ error: '服務大樓更新失敗', detail: e.message }); }
      }

      if (!Object.keys(patch).length && !touchedBuildings) {
        return res.status(400).json({ error: '沒有要更新的內容' });
      }
      if (Object.keys(patch).length) {
        const resp = await fetch(`${URL}/rest/v1/restaurants?id=eq.${encodeURIComponent(b.id)}`,
          { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        if (!resp.ok) return res.status(500).json({ error: '更新餐廳失敗', detail: await resp.text() });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'set-category-fees') {
      if (!b.restaurant_id) return res.status(400).json({ error: '缺少 restaurant_id' });
      const fees = Array.isArray(b.fees) ? b.fees : [];
      // 全量覆蓋：先刪這家所有分類費，再插入有填的（沒填的分類→客人端回退餐廳 service_fee）
      await fetch(`${URL}/rest/v1/category_fees?restaurant_id=eq.${encodeURIComponent(b.restaurant_id)}`,
        { method: 'DELETE', headers });
      const rows = fees
        .filter(x => x && x.category && x.fee !== '' && x.fee !== null && x.fee !== undefined)
        .map(x => ({ restaurant_id: b.restaurant_id, category: String(x.category).trim(), fee: parseInt(x.fee, 10) || 0 }));
      if (rows.length) {
        const r = await fetch(`${URL}/rest/v1/category_fees`,
          { method: 'POST', headers, body: JSON.stringify(rows) });
        if (!r.ok) return res.status(500).json({ error: '分類手續費存檔失敗', detail: await r.text() });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: '未知的 action（要 create 或 update）' });
  } catch (e) {
    console.error('[manage-restaurant]', e);
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
