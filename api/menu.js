// api/menu.js
// 從 Supabase 撈「上架餐廳 + 供應中菜單 + 大樓」，整形成前端畫面要的形狀。
// 跟 orders.js 一樣：service_role key 只待在這層，前端不碰。
//
// 註：菜單與圖片改成「分兩次查詢、程式端合併」，不用 PostgREST 巢狀 embed，
//     避免新表 FK 沒被 schema cache 認得時整包撈空的問題。

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
    // 1) 大樓（依取餐時間排序；停用與否交給前端過濾）
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

    // 2b) 餐廳↔大樓 關聯（分開查，不用巢狀 embed）
    //     表還沒建 / 查詢失敗 → rbActive=false → 客人端不過濾（全顯示），避免上線順序踩到開天窗
    let rbActive = false;
    const bidsByRest = {};
    try {
      const rbResp = await fetch(`${URL}/rest/v1/restaurant_buildings?select=restaurant_id,building_id`, { headers });
      if (rbResp.ok) {
        rbActive = true;
        for (const x of await rbResp.json()) (bidsByRest[x.restaurant_id] ||= []).push(x.building_id);
      }
    } catch (_) { rbActive = false; }

    // 2c) #4 餐廳營業日（分開查；欄位還沒建 / 查詢失敗 → adActive=false → 客人端不以星期過濾）
    let adActive = false;
    const daysByRest = {};
    try {
      const adResp = await fetch(`${URL}/rest/v1/restaurants?select=id,active_days`, { headers });
      if (adResp.ok) {
        adActive = true;
        for (const x of await adResp.json()) daysByRest[x.id] = x.active_days; // 可能是 null 或 [1,3,5]
      }
    } catch (_) { adActive = false; }

    // 2d) #7 分類手續費（分開查；表沒建 / 失敗 → feesByRest 空 → 全部回退餐廳 service_fee，價格不變）
    const feesByRest = {};
    try {
      const cfResp = await fetch(`${URL}/rest/v1/category_fees?select=restaurant_id,category,fee`, { headers });
      if (cfResp.ok) {
        for (const x of await cfResp.json()) {
          (feesByRest[x.restaurant_id] ||= {})[(x.category || '').trim()] = x.fee;
        }
      }
    } catch (_) { /* 表沒建就當沒有分類費，全回退餐廳費 */ }

    // 3) 菜單（只取供應中，一次撈全部；不 embed 圖片，改下一步分開撈）
    const mResp = await fetch(
      `${URL}/rest/v1/menu_items?is_available=eq.true&select=id,restaurant_id,name,description,price,category,sort_order,image_url&order=sort_order.desc`,
      { headers }
    );
    if (!mResp.ok) {
      const detail = await mResp.text();
      return res.status(500).json({ error: '讀取菜單失敗', detail });
    }
    const menuRaw = await mResp.json();

    // 3b) 圖片（單獨撈一次 menu_item_images，再依 menu_item_id 分組）
    //     用 try 包起來：就算圖片表出問題，菜單照樣出得來，不會整頁空。
    const imagesByItem = {};
    try {
      const imgResp = await fetch(
        `${URL}/rest/v1/menu_item_images?select=menu_item_id,url,sort_order&order=sort_order.asc`,
        { headers }
      );
      if (imgResp.ok) {
        const imgRaw = await imgResp.json();
        for (const img of imgRaw) {
          (imagesByItem[img.menu_item_id] ||= []).push(img);
        }
      }
    } catch (_) {
      // 圖片撈失敗就當作沒有圖，不影響菜單
    }

    // 把菜單依 restaurant_id 分組，並掛上各自的圖片陣列
    const menuByRest = {};
    for (const m of menuRaw) {
      const imgs = (imagesByItem[m.id] || [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(x => x.url);
      (menuByRest[m.restaurant_id] ||= []).push({
        id: m.id,
        name: m.name,
        desc: m.description || '',
        price: m.price,
        category: m.category || '其他',
        images: imgs,                              // 多圖陣列
        image_url: imgs[0] || m.image_url || null, // 封面（相容舊單圖）
      });
    }

    // 4) 組成前端要的「胖」物件
    const restaurants = restaurantsRaw.map((r, i) => {
      const restFee = r.service_fee ?? 0; // 保底費（沒設分類費時回退用）
      // #7：每道菜的服務費 = 該分類的手續費；沒設 → 回退餐廳 service_fee（fallback A）
      const menu = (menuByRest[r.id] || []).map(m => {
        const cat = (m.category || '').trim();
        const cf = (feesByRest[r.id] || {})[cat];
        const itemFee = (cf === undefined || cf === null) ? restFee : Number(cf);
        return {
          ...m,
          base_price: m.price,            // 保留店內原價（對帳/給餐廳用）
          service_fee: itemFee,           // 這道菜含的服務費（分類費 or 回退餐廳費）
          price: m.price + itemFee,       // 客人看到、要付的價（含服務費）
        };
      });
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
        service_fee: restFee,
        priceRange,
        itemCount: menu.length,
        categories,
        menu,
        building_ids: rbActive ? (bidsByRest[r.id] || []) : null, // null=功能未啟用→客人端全顯示；[]=沒設大樓→客人端隱藏
        active_days: adActive ? (daysByRest[r.id] || []) : null,  // null=功能未啟用→不以星期過濾；[]=沒設營業日→隱藏(b-1)
      };
    });

    return res.status(200).json({ buildings, restaurants });
  } catch (e) {
    console.error('[menu]', e);
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
