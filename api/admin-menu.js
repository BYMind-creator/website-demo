// api/admin-menu.js — 後台用：撈所有餐廳 + 各自菜單（給資料管理頁）
export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return res.status(500).json({ error: '伺服器環境變數未設定' });

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  try {
    // 一次撈餐廳 + 它的菜單（用 Supabase 的關聯查詢）
    const resp = await fetch(
      `${URL}/rest/v1/restaurants?select=id,name,is_active,service_fee,address,sort_order,menu_items(id,name,description,price,category,is_available,sort_order,image_url,menu_item_images(id,url,sort_order))&order=sort_order.desc`,    );
    if (!resp.ok) {
      return res.status(500).json({ error: '載入餐廳菜單失敗', detail: await resp.text() });
    }
    const restaurants = await resp.json();
    return res.status(200).json({ restaurants });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
