// api/ecpay-callback.js — 接收綠界付款結果通知（零套件版）
import crypto from 'crypto';

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
    const received = body.CheckMacValue;
    const params = { ...body };
    delete params.CheckMacValue;
    const calculated = genCheckMacValue(params);

    if (received !== calculated) {
      return res.status(200).send('0|FAIL');
    }
    if (String(body.SimulatePaid) === '1') {
      return res.status(200).send('1|OK');
    }
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
    return res.status(200).send('1|OK');
  } catch (e) {
    return res.status(200).send('1|OK');
  }
}
