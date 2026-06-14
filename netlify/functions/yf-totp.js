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
function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// access token דרך Service Account (JWT חתום RS256) — env FIREBASE_SERVICE_ACCOUNT = JSON (client_email + private_key)
async function getAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Server configuration error (no FIREBASE_SERVICE_ACCOUNT)');
  let sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('Server configuration error (bad SA json)'); }
  if (!sa.client_email || !sa.private_key) throw new Error('Server configuration error (SA missing fields)');
  const key = sa.private_key.replace(/\\n/g, '\n'); // תיקון newlines אם נשמרו כ-\\n ב-env
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const signingInput = b64urlJson(header) + '.' + b64urlJson(claims);
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = signingInput + '.' + signature;
  const postData = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;
  const res = await httpRequest({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, postData);
  if (res.status !== 200) throw new Error('Token exchange failed (' + res.status + ')');
  return res.data.access_token;
}

// ---------- TOTP (RFC 6238) בלי תלות חיצונית ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32decode(s) { s = String(s).replace(/=+$/, '').replace(/\s/g, '').toUpperCase(); let bits = 0, val = 0; const out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); }
function totpAt(secret, counter) { const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', secret).update(buf).digest(); const o = h[h.length - 1] & 0xf; const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff); return String(bin % (10 ** DIGITS)).padStart(DIGITS, '0'); }
function totpVerify(b32, code) { code = String(code || '').replace(/\D/g, ''); if (code.length !== DIGITS) return false; const secret = b32decode(b32); const counter = Math.floor(Date.now() / 1000 / PERIOD); for (let w = -WINDOW; w <= WINDOW; w++) { const cand = totpAt(secret, counter + w); if (crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(code))) return true; } return false; }

// ---------- אימות הטוקן (בלי שער-אימייל — ההרשאה נבדקת בנפרד) ----------
// אימות idToken מקומית (חתימת JWT מול מפתחות Firebase הציבוריים) — לא תלוי ב-API key
let _fbKeys = null, _fbKeysExp = 0;
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function getFbKeys() {
  if (_fbKeys && Date.now() < _fbKeysExp) return _fbKeys;
  _fbKeys = await httpsGetJson('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  _fbKeysExp = Date.now() + 3600000;
  return _fbKeys;
}
function b64url(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
async function verifyToken(idToken) {
  const p = String(idToken || '').split('.');
  if (p.length !== 3) throw new Error('auth bad-format');
  const head = JSON.parse(b64url(p[0]).toString());
  const body = JSON.parse(b64url(p[1]).toString());
  const keys = await getFbKeys();
  const cert = keys[head.kid];
  if (!cert) throw new Error('auth unknown-kid');
  const v = crypto.createVerify('RSA-SHA256');
  v.update(p[0] + '.' + p[1]);
  if (!v.verify(cert, b64url(p[2]))) throw new Error('auth bad-signature');
  const now = Math.floor(Date.now() / 1000);
  if (body.exp <= now) throw new Error('auth expired');
  if (body.aud !== PROJECT_ID) throw new Error('auth wrong-project');
  if (body.iss !== 'https://securetoken.google.com/' + PROJECT_ID) throw new Error('auth wrong-issuer');
  if (!body.sub) throw new Error('auth no-uid');
  return { uid: body.sub, email: (body.email || '').toLowerCase(), customAttributes: null };
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
  const r = await httpRequest({ hostname: 'identitytoolkit.googleapis.com', path: `/v1/projects/${PROJECT_ID}/accounts:update`, method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, body);
  if (r.status !== 200) { console.error('stampToken failed', r.status, JSON.stringify(r.data).slice(0,150)); }
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
        email: { stringValue: me.email }, failedAttempts: { integerValue: '0' }, lockedUntil: { integerValue: '0' },
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
        const upd = { failedAttempts: { integerValue: String(fails) } };
        if (fails >= MAX_FAILS) upd.lockedUntil = { integerValue: String(now + LOCK_MS) };
        await writeAccessDoc(accessToken, me.uid, upd);
        return { statusCode: 200, headers: H, body: JSON.stringify({ success: false, attemptsLeft: Math.max(0, MAX_FAILS - fails) }) };
      }
      await writeAccessDoc(accessToken, me.uid, { totpConfirmed: { booleanValue: true }, failedAttempts: { integerValue: '0' }, lockedUntil: { integerValue: '0' } });
      await stampToken(accessToken, me.uid, me.customAttributes);
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'unknown action' }) };
  } catch (err) {
    const c = err.message === 'Invalid token' ? 401 : 500;
    return { statusCode: c, headers: H, body: JSON.stringify({ error: err.message || 'server error' }) };
  }
};
