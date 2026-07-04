// api/admin-menu.js — 後台用：撈所有餐廳 + 各自菜單（給資料管理頁）
export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return res.status(500).json({ error: '伺服器環境變數未設定' });
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  try {
    // 一次撈餐廳 + 它的菜單（用 Supabase 的關聯查詢）
    const resp = await fetch(
      `${URL}/rest/v1/restaurants?select=id,name,is_active,service_fee,address,sort_order,menu_items(id,name,description,price,category,is_available,sort_order,image_url,menu_item_images(id,url,sort_order))&order=sort_order.desc`,
      { headers }
    );
    if (!resp.ok) {
      return res.status(500).json({ error: '載入餐廳菜單失敗', detail: await resp.text() });
    }
    const restaurants = await resp.json();

    // #5：餐廳↔大樓 關聯（分開查，不用巢狀 embed）。後台一律附上 building_ids 供勾選 UI 顯示現況。
    try {
      const rbResp = await fetch(`${URL}/rest/v1/restaurant_buildings?select=restaurant_id,building_id`, { headers });
      if (rbResp.ok) {
        const bidsByRest = {};
        for (const x of await rbResp.json()) (bidsByRest[x.restaurant_id] ||= []).push(x.building_id);
        restaurants.forEach(r => { r.building_ids = bidsByRest[r.id] || []; });
      } else {
        restaurants.forEach(r => { r.building_ids = []; });
      }
    } catch (_) {
      restaurants.forEach(r => { r.building_ids = []; });
    }

    // #4：營業日（分開查）。後台附上 active_days 供勾選 UI 顯示現況。
    try {
      const adResp = await fetch(`${URL}/rest/v1/restaurants?select=id,active_days`, { headers });
      if (adResp.ok) {
        const daysByRest = {};
        for (const x of await adResp.json()) daysByRest[x.id] = x.active_days || [];
        restaurants.forEach(r => { r.active_days = daysByRest[r.id] || []; });
      } else {
        restaurants.forEach(r => { r.active_days = []; });
      }
    } catch (_) {
      restaurants.forEach(r => { r.active_days = []; });
    }

    // #7：分類手續費（分開查）。後台附上 category_fees = {category: fee} 供設定 UI 顯示現況。
    try {
      const cfResp = await fetch(`${URL}/rest/v1/category_fees?select=restaurant_id,category,fee`, { headers });
      if (cfResp.ok) {
        const byRest = {};
        for (const x of await cfResp.json()) (byRest[x.restaurant_id] ||= {})[(x.category || '').trim()] = x.fee;
        restaurants.forEach(r => { r.category_fees = byRest[r.id] || {}; });
      } else {
        restaurants.forEach(r => { r.category_fees = {}; });
      }
    } catch (_) {
      restaurants.forEach(r => { r.category_fees = {}; });
    }

    return res.status(200).json({ restaurants });
  } catch (e) {
    console.error('[admin-menu]', e);
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
