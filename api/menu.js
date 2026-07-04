// api/menu.js
// 從 Supabase 撈「上架餐廳 + 供應中菜單 + 大樓」，整形成前端畫面要的形狀。
// 跟 orders.js 一樣：service_role key 只待在這層，前端不碰。

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    return res.status(500).json({ error: '伺服器環境變數未設定（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）' });
  }

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  // 裝飾用：依餐廳順序輪流配 emoji 與底色（DB 沒這欄，純前端外觀）
  const THUMBS = [
    { emoji: '🍱', thumbClass: 'bento' },
    { emoji: '🥗', thumbClass: 'salad' },
    { emoji: '🍜', thumbClass: 'ramen' },
  ];

  try {
    // 1) 大樓（只取上架，依取餐時間排序）
    const bResp = await fetch(
      `${URL}/rest/v1/buildings?order=pickup_time.asc`,
      { headers }
    );
    if (!bResp.ok) {
      const detail = await bResp.text();
      return res.status(500).json({ error: '讀取大樓失敗', detail });
    }
    const buildingsRaw = await bResp.json();
    const buildings = buildingsRaw.map(b => ({
      id: b.id,
      name: b.name,
      district: b.district,
      address: b.address,
      pickup_location: b.pickup_location,
      pickup_time: (b.pickup_time || '').slice(0, 5),   // "12:00:00" → "12:00"
      cutoff_time: (b.cutoff_time || '').slice(0, 5),
      order_start_time: (b.order_start_time || '').slice(0, 5),
      manager_name: b.manager_name || null,
      manager_phone: b.manager_phone || null,
      is_active: b.is_active,
    }));

    // 2) 餐廳（只取上架，sort_order 大的在前）
    const rResp = await fetch(
      `${URL}/rest/v1/restaurants?is_active=eq.true&select=id,name,description,sort_order,service_fee&order=sort_order.desc`,
      { headers }
    );
    if (!rResp.ok) {
      const detail = await rResp.text();
      return res.status(500).json({ error: '讀取餐廳失敗', detail });
    }
    const restaurantsRaw = await rResp.json();

    // 3) 菜單（只取供應中，一次撈全部，再依餐廳分組）
    const mResp = await fetch(
      `${URL}/rest/v1/menu_items?is_available=eq.true&order=sort_order.desc`,
      { headers }
    );
    if (!mResp.ok) {
      const detail = await mResp.text();
      return res.status(500).json({ error: '讀取菜單失敗', detail });
    }
    const menuRaw = await mResp.json();

    // 把菜單依 restaurant_id 分組
    const menuByRest = {};
    for (const m of menuRaw) {
      (menuByRest[m.restaurant_id] ||= []).push({
        id: m.id,                 // 真 UUID（下一關寫 order_items 會用到）
        name: m.name,
        desc: m.description || '',
        price: m.price,
        category: m.category || '其他',
        image_url: m.image_url || null,
      });
    }

    // 4) 組成前端要的「胖」物件
    const restaurants = restaurantsRaw.map((r, i) => {
      const fee = r.service_fee ?? 0;
      // 把該餐廳的服務費灌進每道菜：顯示價 = 店內價 + 服務費
      const menu = (menuByRest[r.id] || []).map(m => ({
        ...m,
        base_price: m.price,            // 保留店內原價（之後對帳/給餐廳用）
        service_fee: fee,               // 這道菜含的服務費
        price: m.price + fee,           // 客人看到、要付的價（含服務費）
      }));
      const prices = menu.map(x => x.price);
      const priceRange = prices.length
        ? `$${Math.min(...prices)}-${Math.max(...prices)}`
        : '—';
      const categories = [...new Set(menu.map(x => x.category))];
      const look = THUMBS[i % THUMBS.length];
      return {
        id: r.id,
        name: r.name,
        emoji: look.emoji,
        thumbClass: look.thumbClass,
        description: r.description || '',
        service_fee: fee,
        priceRange,
        itemCount: menu.length,
        categories,
        menu,
      };
    });

    return res.status(200).json({ buildings, restaurants });
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
