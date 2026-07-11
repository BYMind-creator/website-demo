import crypto from 'crypto';
import { parseCookies, signSession, getUser } from '../lib/line-auth.js';

export default async function handler(req, res) {
  const { code, state, action } = req.query;
  const appUrl = process.env.APP_URL;

  // 1) CALLBACK：LINE 導回時會帶 code & state
  if (code && state) {
    const cookies = parseCookies(req.headers.cookie);
    if (state !== cookies.line_state) {
      res.writeHead(302, { Location: `${appUrl}?login=failed` }); return res.end();
    }
    try {
      const token = await (await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code,
          redirect_uri: process.env.LINE_REDIRECT_URI,
          client_id: process.env.LINE_CHANNEL_ID,
          client_secret: process.env.LINE_CHANNEL_SECRET,
        }),
      })).json();
      if (!token.access_token) throw new Error('token failed');

      const profile = await (await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })).json();
      if (!profile.userId) throw new Error('profile failed');

      const session = signSession({
        uid: profile.userId, name: profile.displayName,
        pic: profile.pictureUrl || '', exp: Date.now() + 7 * 24 * 3600 * 1000,
      });
      res.setHeader('Set-Cookie', [
        `session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`,
        `line_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      ]);
      res.writeHead(302, { Location: appUrl }); return res.end();
    } catch {
      res.writeHead(302, { Location: `${appUrl}?login=failed` }); return res.end();
    }
  }

  // 2) ME：前端查登入狀態
  if (action === 'me') {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'not_logged_in' });
    return res.status(200).json({ user: { uid: user.uid, name: user.name, pic: user.pic } });
  }

  // 3) LOGOUT
  if (action === 'logout') {
    res.setHeader('Set-Cookie', `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    res.writeHead(302, { Location: appUrl }); return res.end();
  }

  // 4) LOGIN（預設）：導去 LINE 授權頁
  const newState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINE_CHANNEL_ID,
    redirect_uri: process.env.LINE_REDIRECT_URI,
    state: newState, scope: 'profile',
  });
  res.setHeader('Set-Cookie',
    `line_state=${newState}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  res.writeHead(302, { Location: `https://access.line.me/oauth2/v2.1/authorize?${params}` });
  res.end();
}
