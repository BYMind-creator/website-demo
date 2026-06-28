// api/ecpay-checkout.js — 產生綠界付款表單（測試環境）
import crypto from 'crypto';

const MERCHANT_ID = '3002607';
const HASH_KEY = 'pwFHCqoQZGmho4w6';
const HASH_IV = 'EkRm7iFT261dpevs';
const ECPAY_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';

// 綠界檢查碼：照官方規則（自然排序→前後加key/iv→URLencode→小寫→SHA256→大寫）
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const b = req.body || {};
    const amount = parseInt(b.amount, 10);
    const orderNumber = b.order_number;
    if (!amount || amount < 1 || !orderNumber) {
      return res.status(400).json({ error: '缺少金額或訂單編號' });
    }

    // 綠界交易編號：英數、≤20碼。用訂單號去掉橫線 + 時間尾碼
    const tradeNo = (orderNumber.replace(/-/g, '') + Date.now().toString().slice(-6)).slice(0, 20);

    // 用台灣時區組出綠界要的精確格式：yyyy/MM/dd HH:mm:ss
    const tw = new Date(Date.now() + 8 * 3600 * 1000); // UTC+8 台灣時間
    const pad = (n) => String(n).padStart(2, '0');
    const tradeDate =
      `${tw.getUTCFullYear()}/${pad(tw.getUTCMonth() + 1)}/${pad(tw.getUTCDate())} ` +
      `${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}:${pad(tw.getUTCSeconds())}`;

    // 回調網址：用你的 Vercel 網域
    const base = `https://${req.headers.host}`;

    const params = {
      MerchantID: MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: tradeDate,
      PaymentType: 'aio',
      TotalAmount: amount,
      TradeDesc: 'BY Mind lunch order',
      ItemName: `午餐訂單 ${orderNumber}`,
      ReturnURL: `${base}/api/ecpay-callback`,       // 綠界 server 通知（背景）
      ClientBackURL: `${base}/lunchbox-order.html`,   // 客人付完返回
      ChoosePayment: 'ALL',
      EncryptType: 1,
      CustomField1: orderNumber,                      // 把我們的訂單號帶著，回調時用
    };
    params.CheckMacValue = genCheckMacValue(params);

    // 回傳一張會自動送出的表單，瀏覽器一打開就跳轉到綠界付款頁
    const inputs = Object.entries(params)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}">`)
      .join('');
    const html = `<!DOCTYPE html><html><body onload="document.forms[0].submit()">
      <form method="post" action="${ECPAY_URL}">${inputs}</form>
      <p style="font-family:sans-serif;text-align:center;margin-top:3rem;">正在前往付款頁…</p>
    </body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).json({ error: e.message || '未知錯誤' });
  }
}
