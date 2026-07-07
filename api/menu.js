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
    const q = (path) => fetch(`${URL}/rest/v1/${path}`, { headers });
    // 一次並行發出所有查詢（原本 7 支序列 ~3.5s → 並行 ~0.5s）
    const [bResp, rResp, rbResp, adResp, cfResp, mResp, imgResp] = await Promise.all([
      q('buildings?order=pickup_time.asc'),
      q('restaurants?is_active=eq.true&select=id,name,description,sort_order,service_fee,cover_url&order=sort_order.desc'),
      q('restaurant_buildings?select=restaurant_id,building_id').catch(() => null),
      q('restaurants?select=id,active_days').catch(() => null),
      q('category_fees?select=restaurant_id,category,fee').catch(() => null),
      q('menu_items?is_available=eq.true&select=id,restaurant_id,name,description,price,category,sort_order,image_url&order=sort_order.desc'),
      q('menu_item_images?select=menu_item_id,url,sort_order&order=sort_order.asc').catch(() => null),
    ]);

    // ---- 必要查詢：失敗就 500 ----
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
      pickup_end_time: (b.pickup_end_time || '').slice(0, 5),
      cutoff_time: (b.cutoff_time || '').slice(0, 5),
      order_start_time: (b.order_start_time || '').slice(0, 5),
      manager_name: b.manager_name || null,
      manager_phone: b.manager_phone || null,
      is_active: b.is_active,
    }));

    if (!rResp.ok) {
      const detail = await rResp.text();
      return res.status(500).json({ error: '讀取餐廳失敗', detail });
    }
    const restaurantsRaw = await rResp.json();

    if (!mResp.ok) {
      const detail = await mResp.text();
      return res.status(500).json({ error: '讀取菜單失敗', detail });
    }
    const menuRaw = await mResp.json();

    // ---- 選配查詢：失敗就降級（不擋畫面）----
    // 餐廳↔大樓：null/失敗 → rbActive=false → 客人端不過濾（全顯示）
    let rbActive = false;
    const bidsByRest = {};
    if (rbResp && rbResp.ok) {
      rbActive = true;
      for (const x of await rbResp.json()) (bidsByRest[x.restaurant_id] ||= []).push(x.building_id);
    }

    // #4 餐廳營業日：null/失敗 → adActive=false → 不以星期過濾
    let adActive = false;
    const daysByRest = {};
    if (adResp && adResp.ok) {
      adActive = true;
      for (const x of await adResp.json()) daysByRest[x.id] = x.active_days;
    }

    // #7 分類手續費：null/失敗 → 空 → 全回退餐廳 service_fee
    const feesByRest = {};
    if (cfResp && cfResp.ok) {
      for (const x of await cfResp.json()) {
        (feesByRest[x.restaurant_id] ||= {})[(x.category || '').trim()] = x.fee;
      }
    }

    // 圖片：null/失敗 → 當作沒有圖，不影響菜單
    const imagesByItem = {};
    if (imgResp && imgResp.ok) {
      for (const img of await imgResp.json()) {
        (imagesByItem[img.menu_item_id] ||= []).push(img);
      }
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
        cover_url: r.cover_url || null,
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
