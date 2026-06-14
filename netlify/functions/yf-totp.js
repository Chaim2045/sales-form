// ⛔ YF Dashboards — שרת אימות TOTP (אטום, server-enforced)
// מאמת קוד TOTP בצד-שרת מול ה-secret (שנשאר רק כאן), בודק הרשאה (owner או permission
// 'yfCashflow' מניהול המשתמשים), מגביל ניסיונות (rate-limit), ומחתים claim 'yfTotpVerified'.
// חוקי ה-Firestore דורשים את החותמת → לא ניתן לעקוף מהדפדפן. ראה SHARED-CONTEXT §9.
const https = require('https');
const crypto = require('crypto');

const PROJECT_ID = 'law-office-sales-form';
const YF_DB = 'yf-dashboards';
const OWNERS = ['guy@ghlawoffice.co.il', 'haim@ghlawoffice.co.il']; // תמיד מורשים
const ISSUER = 'YF תזרים';
const PERIOD = 30, DIGITS = 6, WINDOW = 1;
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000; // 5 ניסיונות → נעילה 15 דק'

function httpRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch (e) { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}
async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) throw new Error('Server configuration error');
  const postData = `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.FIREBASE_REFRESH_TOKEN)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const res = await httpRequest({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, postData);
  if (res.status !== 200) throw new Error('Token exchange failed');
  return res.data.access_token;
}

// ---------- TOTP (RFC 6238) בלי תלות חיצונית ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32decode(s) { s = String(s).replace(/=+$/, '').replace(/\s/g, '').toUpperCase(); let bits = 0, val = 0; const out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
function totpAt(secret, counter) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', secret).update(buf).digest(); const o = h[h.length - 1] & 0xf; const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff); return String(bin % (10 ** DIGITS)).padStart(DIGITS, '0'); }
function totpVerify(b32, code) { code = String(code || '').replace(/\D/g, ''); if (code.length !== DIGITS) return false; const secret = b32decode(b32); const counter = Math.floor(Date.now() / 1000 / PERIOD); for (let w = -WINDOW; w <= WINDOW; w++) { const cand = totpAt(secret, counter + w); if (crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(code))) return true; } return false; }

// ---------- אימות הטוקן (בלי שער-אימייל — ההרשאה נבדקת בנפרד) ----------
async function verifyToken(idToken) {
  const r = await httpRequest({ hostname: 'identitytoolkit.googleapis.com', path: `/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ idToken }));
  if (r.status !== 200 || !r.data.users || !r.data.users[0]) throw new Error('Invalid token');
  const u = r.data.users[0];
  return { uid: u.localId, email: (u.email || '').toLowerCase(), customAttributes: u.customAttributes };
}
// בדיקת הרשאה: owner קבוע, או isActive + permissions.yfCashflow מ-(default)/users
async function isAuthorized(token, uid, email) {
  if (OWNERS.includes(email)) return true;
  const r = await httpRequest({ hostname: 'firestore.googleapis.com', path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`, method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
  if (r.status !== 200) return false;
  const f = r.data.fields || {};
  const active = f.isActive && f.isActive.booleanValue === true;
  const perms = (f.permissions && f.permissions.mapValue && f.permissions.mapValue.fields) || {};
  const yf = perms.yfCashflow && perms.yfCashflow.booleanValue === true;
  if (!(active && yf)) return false;
  // הרשאה זמנית: אם הוגדר תאריך תפוגה ועבר — הגישה פגה (server-enforced)
  const exp = parseInt((f.yfCashflowExpiresAt && f.yfCashflowExpiresAt.integerValue) || '0', 10);
  if (exp && Date.now() > exp) return false;
  return true;
}

// ---------- Firestore REST (מסד yf-dashboards) ----------
const FS = (p) => ({ hostname: 'firestore.googleapis.com', path: `/v1/projects/${PROJECT_ID}/databases/${YF_DB}/documents/${p}` });
async function getAccessDoc(token, uid) {
  const r = await httpRequest({ ...FS(`yf_access/${uid}`), method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
  if (r.status !== 200) return null;
  const f = r.data.fields || {};
  return {
    secret: f.totpSecret?.stringValue || null,
    confirmed: f.totpConfirmed?.booleanValue || false,
    fails: parseInt(f.failedAttempts?.integerValue || '0', 10),
    lockedUntil: parseInt(f.lockedUntil?.integerValue || '0', 10)
  };
}
async function writeAccessDoc(token, uid, fields) {
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const body = JSON.stringify({ fields });
  const r = await httpRequest({ ...FS(`yf_access/${uid}?${mask}`), method: 'PATCH', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  return r.status === 200;
}
async function stampToken(token, uid, existingAttrs) {
  let attrs = {}; try { attrs = existingAttrs ? JSON.parse(existingAttrs) : {}; } catch (e) {}
  attrs.yfTotpVerified = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ localId: uid, customAttributes: JSON.stringify(attrs) });
  const r = await httpRequest({ hostname: 'identitytoolkit.googleapis.com', path: `/v1/projects/${PROJECT_ID}/accounts:update?key=${process.env.FIREBASE_API_KEY}`, method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  return r.status === 200;
}
function cors(event) { const o = event.headers.origin || event.headers.Origin || ''; return (o.endsWith('.netlify.app') || o.startsWith('http://localhost')) ? o : ''; }

exports.handler = async (event) => {
  const origin = cors(event);
  const H = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: H };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: H, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return { statusCode: 401, headers: H, body: JSON.stringify({ error: 'Missing token' }) };
    const { action, code } = JSON.parse(event.body || '{}');

    const me = await verifyToken(authHeader.substring(7));
    const accessToken = await getAccessToken();
    if (!(await isAuthorized(accessToken, me.uid, me.email))) return { statusCode: 403, headers: H, body: JSON.stringify({ error: 'Not authorized' }) };
    const doc = await getAccessDoc(accessToken, me.uid);

    if (action === 'begin') {
      if (doc && doc.secret && doc.confirmed) return { statusCode: 200, headers: H, body: JSON.stringify({ enrolled: true }) };
      const secret = b32encode(crypto.randomBytes(20));
      const ok = await writeAccessDoc(accessToken, me.uid, {
        totpSecret: { stringValue: secret }, totpConfirmed: { booleanValue: false },
        email: { stringValue: me.email }, failedAttempts: { integerValue: 0 }, lockedUntil: { integerValue: 0 },
        totpEnrolledAt: { timestampValue: new Date().toISOString() }
      });
      if (!ok) throw new Error('save failed');
      const uri = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(me.email)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
      return { statusCode: 200, headers: H, body: JSON.stringify({ enrolled: false, uri }) };
    }

    if (action === 'verify') {
      if (!doc || !doc.secret) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'not enrolled' }) };
      const now = Date.now();
      if (doc.lockedUntil && now < doc.lockedUntil) {
        return { statusCode: 429, headers: H, body: JSON.stringify({ error: 'locked', retryAfter: Math.ceil((doc.lockedUntil - now) / 1000) }) };
      }
      if (!totpVerify(doc.secret, code)) {
        const fails = doc.fails + 1;
        const upd = { failedAttempts: { integerValue: fails } };
        if (fails >= MAX_FAILS) upd.lockedUntil = { integerValue: now + LOCK_MS };
        await writeAccessDoc(accessToken, me.uid, upd);
        return { statusCode: 200, headers: H, body: JSON.stringify({ success: false, attemptsLeft: Math.max(0, MAX_FAILS - fails) }) };
      }
      await writeAccessDoc(accessToken, me.uid, { totpConfirmed: { booleanValue: true }, failedAttempts: { integerValue: 0 }, lockedUntil: { integerValue: 0 } });
      await stampToken(accessToken, me.uid, me.customAttributes);
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'unknown action' }) };
  } catch (err) {
    const c = err.message === 'Invalid token' ? 401 : 500;
    return { statusCode: c, headers: H, body: JSON.stringify({ error: err.message || 'server error' }) };
  }
};
