// api/ecpay-callback.js — 接收綠界付款結果通知
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const HASH_KEY = 'pwFHCqoQZGmho4w6';
const HASH_IV = 'EkRm7iFT261dpevs';

function genCheckMacValue(params) {
  const sorted = Object.keys(params).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let raw = `HashKey=${HASH_KEY}&` + sorted.map(k => `${k}=${params[k]}`).join('&') + `&HashIV=${HASH_IV}`;
  raw = encodeURIComponent(raw).toLowerCase()
    .replace(/%20/g, '+').replace(/%2d/g, '-').replace(/%5f/g, '_')
    .replace(/%2e/g, '.').replace(/%21/g, '!').replace(/%2a/g, '*')
    .replace(/%28/g, '(').replace(/%29/g, ')');
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
}

export default async function handler(req, res) {
  try {
    const body = req.body || {};

    // 1) 驗證檢查碼：把綠界送來的參數(去掉 CheckMacValue)重算一次，比對
    const received = body.CheckMacValue;
    const params = { ...body };
    delete params.CheckMacValue;
    const calculated = genCheckMacValue(params);

    if (received !== calculated) {
      // 算出來不一樣 → 可能是偽造，拒絕
      return res.status(200).send('0|FAIL');
    }

    // 2) 模擬付款通知（後台按「模擬付款」會送這個）→ 不可改訂單狀態
    if (String(body.SimulatePaid) === '1') {
      return res.status(200).send('1|OK');
    }

    // 3) 付款成功：RtnCode = 1
    if (String(body.RtnCode) === '1') {
      const orderNumber = body.CustomField1;
      if (orderNumber) {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}`, {
          method: 'PATCH',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ payment_status: 'paid' }),
        });
      }
    }

    // 4) 不管成功失敗，最後一定回 1|OK 告訴綠界「我收到了」
    return res.status(200).send('1|OK');
  } catch (e) {
    return res.status(200).send('1|OK'); // 出錯也回 200，避免綠界一直重送
  }
}
