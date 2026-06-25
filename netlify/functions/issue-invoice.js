// ============================================================================
// Netlify Function: issue-invoice — הפקת חשבונית/קבלה ב-Green Invoice (morning)
// ----------------------------------------------------------------------------
//  המקום היחיד שמחזיק את סוד GI. נקרא משני ערוצים:
//   • CRM (דפדפן):  Authorization: Bearer <Firebase ID token>  (כמו ocr-check.js)
//   • בוט (VPS):    x-invoice-secret / body.secret == INVOICE_INTAKE_SECRET
//                   (fail-closed, timing-safe — כמו lead-intake.js)
//
//  זרימה: אימות → קריאת sales_records/{saleId} (מקור-אמת) → guard אידמפוטנטי →
//          החלטת סוג-מסמך לפי קבלת-תשלום → GI token → POST /documents →
//          guard התאמת מע"מ → כתיבת מטא-דאטה אדיטיבית חזרה ל-sales_records →
//          הזנת invoice_outbox (וואטסאפ) → audit_log.
//
//  כל הכתיבות ל-Firestore דרך service-account access token (עוקף rules,
//  דפוס lead-intake.js:39-55). updateMask → אדיטיבי, לא דורס שדות קיימים.
//
//  Env (Netlify): GREEN_INVOICE_API_ID, GREEN_INVOICE_API_KEY,
//    GREEN_INVOICE_BASE_URL (sandbox: https://sandbox.d.greeninvoice.co.il/api/v1),
//    INVOICE_INTAKE_SECRET, FIREBASE_WEB_API_KEY, FIREBASE_SERVICE_ACCOUNT,
//    FIREBASE_PROJECT_ID (default law-office-sales-form).
//
//  ✅ אומת מול sandbox (2026-06-21, scripts/gi-sandbox-probe.js):
//     token = POST /account/token {id,secret} → {token,expires}; response.url הוא
//     אובייקט {origin,he}; number מספרי; income.price לפני-מע"מ + vatType 0 →
//     GI מוסיף 18% (response.vatRate=0.18); יצירת מסמך מחזירה 201.
//  ✅ עוד אומת (debug 2026-06-21): payment.type 1=מזומן + 4=העברה; date עליון + remarks תקינים;
//     GI מאמת taxId — ת.ז/ח.פ לא-תקין → 400 errorCode 1111 → שולחים taxId רק כשתקין (אחרת משמיטים).
//  ⚠️ נותר לאמת: (2) קוד payment.type ל'ביט'. ✅ (4) אומת: client.emails → GI שולח מייל אוטומטי (notify@morning.co, מסמך 60009).
//  ⚠️ החלטה עסקית (לרו"ח): ת.ז/ח.פ לא-תקין של לקוח → להשמיט ולהפיק (קיים), או לחסום הפקה?
//  ⚠️ טבלת מיפוי סוג-המסמך (decideDocument) — לאישור רו"ח לפני פרודקשן.
// ============================================================================
const https = require('https');
const crypto = require('crypto');

// ===== CONFIG — ⚠️ לאמת מול sandbox + רו"ח =====
const VAT_RATE = 0.18; // מע"מ ישראלי (תואם VAT_RATE בקליינט)
const GI_DOC = { TAX_RECEIPT: 320, RECEIPT: 400, TAX_INVOICE: 305, CREDIT: 330 };
// payment.type (מספרי). 1=מזומן + 4=העברה אומתו מול sandbox; שאר הקודים לפי תקן morning —
// לאמת פר-אמצעי בבדיקות (בעיקר 'ביט'→app). קוד לא-תקין → GI מחזיר 400 (נחסם בבטחה).
const GI_PAY = { cash: 1, cheque: 2, credit: 3, transfer: 4, app: 5 };
// allow-list לאכיפת-שרת: invoice_config יכול רק לבחור מתוך enum סגור, לעולם לא להרחיב (security 🔴#1)
const VALID_DOC = new Set([305, 320, 330, 400]);
const VALID_PAY = new Set([1, 2, 3, 4, 5]);
// מיפוי ברירת-מחדל (fallback מלא כש-invoice_config חסר/פגום) — משקף את הלוגיקה ההיסטורית
const DEFAULT_DOC_TYPE_MAP = {
    'מזומן': { docType: GI_DOC.TAX_RECEIPT, payType: GI_PAY.cash },
    'ביט': { docType: GI_DOC.TAX_RECEIPT, payType: GI_PAY.app },
    'העברה בנקאית': { docType: GI_DOC.TAX_RECEIPT, payType: GI_PAY.transfer },
    'כרטיס אשראי_מלא': { docType: GI_DOC.TAX_RECEIPT, payType: GI_PAY.credit }
};
const DEFAULT_REQUIRE_APPROVAL = true; // fail-closed כשהקונפיג חסר (Haim שולט במצב התפעולי בפאנל)
const DEFAULT_ENABLED = false; // 🛑 מתג-עצירה ראשי — fail-closed: בהיעדר config מפורש המנוע כבוי (אף הפקה)

function httpRequest(options, data) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, data: body }); }
            });
        });
        req.on('error', reject);
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

// ─── Service-account access token (כמו lead-intake.js) → כתיבה עוקפת-rules ───
function b64urlJson(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function getAccessToken() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('no FIREBASE_SERVICE_ACCOUNT');
    let sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('bad SA json'); }
    if (!sa.client_email || !sa.private_key) throw new Error('SA missing fields');
    const key = sa.private_key.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
    const signingInput = b64urlJson(header) + '.' + b64urlJson(claims);
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = signingInput + '.' + signature;
    const postData = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt);
    const res = await httpRequest({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, postData);
    if (res.status !== 200) throw new Error('Token exchange failed (' + res.status + ')');
    return res.data.access_token;
}

// timing-safe secret compare (כמו lead-intake.js)
function safeEqual(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a.length !== b.length || a.length === 0) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}

// אימות Firebase ID token (כמו ocr-check.js:23-42)
async function verifyFirebaseIdToken(idToken) {
    const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY;
    if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY not configured');
    const postData = JSON.stringify({ idToken: idToken });
    const res = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        path: '/v1/accounts:lookup?key=' + apiKey,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    if (res.status !== 200 || !res.data.users || !res.data.users[0]) throw new Error('Invalid token');
    return { uid: res.data.users[0].localId, email: res.data.users[0].email || res.data.users[0].localId };
}

function getCorsOrigin(event) {
    const origin = event.headers.origin || event.headers.Origin || '';
    if (origin.endsWith('.netlify.app') || origin.startsWith('http://localhost')) return origin;
    return '';
}

// ─── Firestore typed-value helpers ───
function fval(f) {
    if (f == null) return undefined;
    if (f.stringValue !== undefined) return f.stringValue;
    if (f.integerValue !== undefined) return Number(f.integerValue);
    if (f.doubleValue !== undefined) return Number(f.doubleValue);
    if (f.booleanValue !== undefined) return f.booleanValue;
    if (f.timestampValue !== undefined) return f.timestampValue;
    if (f.nullValue !== undefined) return null;
    if (f.mapValue !== undefined) { const o = {}; const ff = f.mapValue.fields || {}; for (const k in ff) o[k] = fval(ff[k]); return o; } // ← תמיכת mapValue (netlify 🔴#1)
    if (f.arrayValue !== undefined) { return (f.arrayValue.values || []).map(fval); }
    return undefined;
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// ולידציית ת.ז/ח.פ ישראלי (checksum תקני) — GI דוחה מספר לא-תקין (400, errorCode 1111).
// שולחים taxId ל-GI רק כשעובר; אחרת משמיטים (מסמך בלי ת.ז חוקי לגמרי).
function isValidIsraeliTaxId(raw) {
    const id = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (id.length === 0 || id.length > 9) return false;
    const p = id.padStart(9, '0');
    if (/^0+$/.test(p)) return false; // דחיית כל-אפסים
    let sum = 0;
    for (let i = 0; i < 9; i++) { let n = Number(p[i]) * ((i % 2) + 1); if (n > 9) n -= 9; sum += n; }
    return sum % 10 === 0;
}

// ─── GI: קבלת JWT — POST /account/token {id,secret} → {token} (אומת sandbox) ───
async function giToken(base) {
    const id = process.env.GREEN_INVOICE_API_ID;
    const secret = process.env.GREEN_INVOICE_API_KEY;
    if (!id || !secret) throw new Error('GREEN_INVOICE creds not configured');
    const postData = JSON.stringify({ id: id, secret: secret });
    const res = await httpRequest({
        hostname: base.hostname, path: base.basePath + '/account/token', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    if (res.status !== 200) throw new Error('GI token failed (' + res.status + ')');
    // token בגוף (res.data.token) או בכותרת X-Authorization-Bearer
    return (res.data && res.data.token) || '';
}

// ─── מפתח-תשלום: איזו "משבצת" מיפוי מתאימה לעסקה (null = טרם נגבה → דחייה) ───
function paymentKey(sale) {
    const method = (sale.paymentMethod || '').trim();
    const ccStatus = (sale.creditCardStatus || '').trim();
    const paidFull = ccStatus === 'בוצע חיוב מלא' || ccStatus === 'חיוב מלא';
    if (method === 'מזומן') return 'מזומן';
    if (method === 'ביט') return 'ביט';
    if (method === 'העברה בנקאית') return 'העברה בנקאית';
    if (method === 'כרטיס אשראי' && paidFull) return 'כרטיס אשראי_מלא';
    if (method === 'שיקים דחויים') return 'שיקים דחויים'; // Phase 3: קבלה (400) בקבלת השיקים
    return null; // טרם נגבה / פיצול → לא מפיקים בדיווח (305 פר-שיק בפירעון)
}

// ─── ולידציית docTypeMap מ-config: מפה מלאה ותקינה-כולה, או null (→ fallback מלא) ───
// security 🔴#1/#2: config יכול רק לבחור מ-enum סגור; ערך פגום/חלקי → דוחים את כל המפה
function validDocTypeMap(m) {
    if (!m || typeof m !== 'object') return null;
    const out = {};
    for (const k of Object.keys(DEFAULT_DOC_TYPE_MAP)) {
        const e = m[k];
        if (!e || !VALID_DOC.has(Number(e.docType)) || !VALID_PAY.has(Number(e.payType))) return null;
        out[k] = { docType: Number(e.docType), payType: Number(e.payType) };
    }
    return out;
}

// ─── נרמול invoice_config (per-field fail-safe) → {docTypeMap, requireApproval, channels} ───
function normalizeConfig(F) {
    const dtm = F ? validDocTypeMap(fval(F.docTypeMap)) : null;
    const ra = F ? fval(F.requireApproval) : undefined;
    const requireApproval = (ra === true || ra === false) ? ra : DEFAULT_REQUIRE_APPROVAL;
    const en = F ? fval(F.enabled) : undefined;
    const enabled = (en === true) ? true : DEFAULT_ENABLED; // 🛑 fail-closed: רק true מפורש מדליק; חסר/null/garbage → כבוי
    const ch = F ? fval(F.defaultChannels) : null;
    const channels = { whatsapp: !(ch && ch.whatsapp === false), email: !(ch && ch.email === false) };
    return { docTypeMap: dtm, requireApproval: requireApproval, enabled: enabled, channels: channels };
}

// ─── החלטת סוג-מסמך (cfg.docTypeMap שולט; fallback ל-DEFAULT; נשאר SSOT יחיד) ───
// מחזיר { issue, docType, payType, reason }
function decideDocument(sale, cfg) {
    const key = paymentKey(sale);
    if (!key) return { issue: false, reason: 'ממתין לגבייה (' + (sale.paymentMethod || 'לא ידוע') + ')' };
    // שיקים דחויים → קבלה (400) במועד הדיווח — מיפוי חוקי קבוע (Phase 0 נעול; לא נשלט ע"י config)
    if (key === 'שיקים דחויים') return { issue: true, docType: GI_DOC.RECEIPT, payType: GI_PAY.cheque, reason: 'שיקים דחויים' };
    const map = (cfg && cfg.docTypeMap) ? cfg.docTypeMap : DEFAULT_DOC_TYPE_MAP;
    const entry = map[key] || DEFAULT_DOC_TYPE_MAP[key];
    return { issue: true, docType: entry.docType, payType: entry.payType, reason: key };
}

// ─── בניית גוף מסמך GI (income.price לפני-מע"מ; GI מוסיף 18% לפי vatType 0 — אומת) ───
function buildGiDocument(sale, decision, amounts, channels, invoiceEnv) {
    const email = (sale.email || '').trim();
    const doc = {
        type: decision.docType,
        date: sale.date || new Date().toISOString().slice(0, 10),
        lang: 'he',
        currency: 'ILS',
        vatType: 0, // price לפני-מע"מ; GI מוסיף 18% (אומת: response.vatRate=0.18)
        rounding: false,
        client: {
            name: sale.clientName || 'לקוח',
            taxId: isValidIsraeliTaxId(sale.idNumber) ? String(sale.idNumber).replace(/\D/g, '').padStart(9, '0') : undefined, // רק כשתקין (GI errorCode 1111)
            emails: (invoiceEnv === 'prod' && channels && channels.email && email) ? [email] : [], // ✅ R2: מייל ללקוח רק בפרודקשן — ב-sandbox לא שולחים מסמך מזויף ללקוח אמיתי (GI שולח אוטומטית כשיש emails, אומת מסמך 60009)
            add: false
        },
        income: [{
            description: sale.transactionDescription || sale.transactionType || 'שירות משפטי',
            quantity: 1,
            price: amounts.beforeVat, // לפני מע"מ
            currency: 'ILS',
            vatType: 0
        }],
        payment: [{
            type: decision.payType,
            price: amounts.withVat, // התשלום בפועל כולל מע"מ
            date: sale.date || new Date().toISOString().slice(0, 10),
            currency: 'ILS'
        }],
        remarks: sale.notes || ''
    };
    return doc;
}

// פירוק checksDetails (string JSON או array) → מערך שיקים
function parseChecks(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    return [];
}

// ─── Phase 3: קבלה (400) לשיקים דחויים — payment[] של שיקים, בלי income. ───
// אומת sandbox: כל שיק חייב {type:2, price, date(פירעון), currency, bankName, bankBranch, bankAccount, chequeNum} (חסר → errorCode 2443); vatRate=0.
function buildGiReceipt400(sale, checks, channels, invoiceEnv) {
    const email = (sale.email || '').trim();
    return {
        type: GI_DOC.RECEIPT, // 400
        date: sale.date || new Date().toISOString().slice(0, 10),
        lang: 'he',
        currency: 'ILS',
        rounding: false,
        client: {
            name: sale.clientName || 'לקוח',
            taxId: isValidIsraeliTaxId(sale.idNumber) ? String(sale.idNumber).replace(/\D/g, '').padStart(9, '0') : undefined,
            emails: (invoiceEnv === 'prod' && channels && channels.email && email) ? [email] : [], // מייל ללקוח רק בפרודקשן + לפי toggle הערוץ (R2/G1)
            add: false
        },
        payment: checks.map(function (c) {
            return {
                type: GI_PAY.cheque, // 2 = שיק
                price: Number(c.amount) || 0,
                date: c.date || c.dueDate || sale.date, // תאריך פירעון
                currency: 'ILS',
                bankName: String(c.bankName || ''),
                bankBranch: String(c.bankBranch || ''),
                bankAccount: String(c.bankAccount || ''),
                chequeNum: String(c.chequeNum || '')
            };
        }),
        remarks: sale.notes || ''
    };
}

// ─── Phase 4: חשבונית-מס (305) פר-שיק שנפרע — income בלבד, ללא payment. ───
// הקבלה (400) כבר רשמה את המזומן בקבלת השיקים → 305 לא רושמת תשלום (מונע קבלה כפולה).
// סכום השיק הוא GROSS (כולל-מע"מ); price לפני-מע"מ + vatType 0 → GI מוסיף 18% → total = פני השיק.
function buildGiTaxInvoice305(saleObj, cheque, channels, invoiceEnv) {
    const email = (saleObj.email || '').trim();
    const beforeVat = +((Number(cheque.amount) || 0) / (1 + VAT_RATE)).toFixed(2); // הסכום GROSS → לפני-מע"מ
    const label = cheque.chequeNum ? (' מס׳ ' + cheque.chequeNum) : (' #' + cheque.index);
    return {
        type: GI_DOC.TAX_INVOICE, // 305
        date: new Date().toISOString().slice(0, 10),
        lang: 'he',
        currency: 'ILS',
        vatType: 0, // price לפני-מע"מ; GI מוסיף 18% (אומת: response.vatRate=0.18)
        rounding: false,
        client: {
            name: saleObj.clientName || 'לקוח',
            taxId: isValidIsraeliTaxId(saleObj.idNumber) ? String(saleObj.idNumber).replace(/\D/g, '').padStart(9, '0') : undefined,
            emails: (invoiceEnv === 'prod' && channels && channels.email && email) ? [email] : [], // מייל ללקוח רק בפרודקשן + לפי toggle הערוץ (R2/G1)
            add: false
        },
        income: [{
            description: (saleObj.transactionDescription || saleObj.transactionType || 'שירות משפטי') + ' — פירעון שיק' + label,
            quantity: 1,
            price: beforeVat, // לפני מע"מ
            currency: 'ILS',
            vatType: 0
        }],
        // אין payment — 305 חשבונית-מס בלבד; המזומן כבר נרשם בקבלה 400
        remarks: 'פירעון שיק ' + (cheque.chequeNum || ('#' + cheque.index))
    };
}

// ─── Firestore REST helpers (Bearer = service-account access token) ───
async function fsGet(projectId, token, collection, docId) {
    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + projectId + '/databases/(default)/documents/' + collection + '/' + docId,
        method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
    });
    return res;
}
async function fsPatch(projectId, token, collection, docId, fields, maskPaths) {
    const mask = maskPaths.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
    const postData = JSON.stringify({ fields: fields });
    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + projectId + '/databases/(default)/documents/' + collection + '/' + docId + '?' + mask,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    return res;
}
async function fsCreate(projectId, token, collection, fields) {
    const postData = JSON.stringify({ fields: fields });
    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + projectId + '/databases/(default)/documents/' + collection,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    return res;
}
// כתיבה מותנית: עוברת רק אם updateTime של ה-doc תואם (optimistic lock).
// אי-התאמה → Firestore מחזיר !=200 → המפסיד במרוץ לא מפיק מסמך שני.
async function fsPatchGuarded(projectId, token, collection, docId, fields, maskPaths, updateTime) {
    const mask = maskPaths.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
    const precond = '&currentDocument.updateTime=' + encodeURIComponent(updateTime);
    const postData = JSON.stringify({ fields: fields });
    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + projectId + '/databases/(default)/documents/' + collection + '/' + docId + '?' + mask + precond,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    return res;
}

exports.handler = async (event) => {
    const allowedOrigin = getCorsOrigin(event);
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin || '',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-invoice-secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch (e) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
        }
        const saleId = String(body.saleId || '').trim();
        if (!saleId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'saleId required' }) };
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(saleId)) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'invalid saleId' }) }; // path-injection guard (service-account REST עוקף rules)

        // ─── Auth: בוט (secret) או CRM (Firebase ID token) ───
        const botSecret = process.env.INVOICE_INTAKE_SECRET || '';
        const provided = body.secret || event.headers['x-invoice-secret'] || event.headers['X-Invoice-Secret'] || '';
        const authHeader = event.headers.authorization || event.headers.Authorization || '';
        let source = null, actor = null, callerUid = null;
        if (provided && botSecret && safeEqual(provided, botSecret)) {
            source = 'bot'; actor = String(body.actor || 'bot');
        } else if (authHeader.indexOf('Bearer ') === 0) {
            try { const u = await verifyFirebaseIdToken(authHeader.substring(7)); actor = u.email; callerUid = u.uid; source = 'tofes'; }
            catch (e) { return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid auth token' }) }; }
        } else {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Missing auth' }) };
        }
        // אישור-הפקה: רק במסלול CRM, ו-master מאומת בשרת (לא דגל מהקליינט). הבוט לא מאשר.
        const wantApprove = body.approve === true && source === 'tofes';

        // ─── GI config (fail-closed) ───
        const baseUrl = process.env.GREEN_INVOICE_BASE_URL || '';
        if (!baseUrl || !process.env.GREEN_INVOICE_API_ID || !process.env.GREEN_INVOICE_API_KEY) {
            return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Invoice service not configured' }) };
        }
        const u = new URL(baseUrl);
        const base = { hostname: u.hostname, basePath: u.pathname.replace(/\/$/, '') };
        const invoiceEnv = /sandbox/.test(baseUrl) ? 'sandbox' : 'prod';

        const projectId = process.env.FIREBASE_PROJECT_ID || 'law-office-sales-form';
        const accessToken = await getAccessToken();

        // ─── קריאת מקור-האמת + invoice_config במקביל (אפס זמן נוסף — netlify §3/§6) ───
        const [saleRes, cfgRes] = await Promise.all([
            fsGet(projectId, accessToken, 'sales_records', saleId),
            fsGet(projectId, accessToken, 'invoice_config', 'default')
        ]);
        if (saleRes.status === 404) return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'sale not found' }) };
        if (saleRes.status !== 200 || !saleRes.data.fields) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'sale read failed' }) };
        const F = saleRes.data.fields;
        const saleUpdateTime = saleRes.data.updateTime; // ל-optimistic lock
        // נרמול קונפיג fail-safe: חסר/פגום → ברירת-מחדל מחמירה + מיפוי hardcoded מלא
        const cfg = normalizeConfig((cfgRes && cfgRes.status === 200 && cfgRes.data && cfgRes.data.fields) ? cfgRes.data.fields : null);

        // ─── 🛑 מתג-עצירה ראשי (R1): מנוע כבוי → לא מפיקים כלום, לא נוגעים באף doc (לפני idempotency/approve/claim/GI) ───
        // בלתי-מותנה (לא תלוי ב-approve/master). מחזיר 200 inert — הקוראים לא-חוסמים (טופס/בוט) לא יציגו toast/retry.
        if (!cfg.enabled) {
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, disabled: true, reason: 'issuance globally disabled' }) };
        }
        // ─── 🔒 נעילת-פרודקשן כפולה (R7): GI אמיתי דורש דגל-env שני מפורש (INVOICE_ALLOW_PROD) — מונע הפקה אמיתית בטעות ───
        if (invoiceEnv === 'prod' && process.env.INVOICE_ALLOW_PROD !== 'true') {
            console.error('[issue-invoice] prod issuance blocked — INVOICE_ALLOW_PROD not set');
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, prodLocked: true, reason: 'prod issuance requires INVOICE_ALLOW_PROD' }) };
        }

        // ════════════════════════════════════════════════════════════════════
        // Phase 4: חשבונית-מס (305) פר-שיק שנפרע — מסלול נפרד לחלוטין.
        // body.checkId נוכח → מפיקים 305 לשיק הבודד וחוזרים; חסר → המסלול ברמת-העסקה ממשיך כרגיל.
        // כותב אך ורק לרשומת-השיק (sales_records/{saleId}/checks/{checkId}), לא לעסקה.
        // ════════════════════════════════════════════════════════════════════
        const checkId = String(body.checkId || '').trim();
        if (checkId) {
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(checkId)) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'invalid checkId' }) }; // path-injection guard
            const checksPath = 'sales_records/' + saleId + '/checks';

            // ─── אישור-הפקה: כמו ברמת-העסקה — master מאומת בשרת (לא דגל קליינט). הבוט לא מאשר. ───
            // פירעון שיק = פעולת-master (כפתור "נפרע" ב-CRM שולח approve:true) → אין שדה invoiceApproved נפרד לשיק.
            let approvedByMaster = false;
            if (wantApprove) {
                try {
                    const uRes = await fsGet(projectId, accessToken, 'users', callerUid);
                    const uf = (uRes.status === 200 && uRes.data && uRes.data.fields) ? uRes.data.fields : null;
                    approvedByMaster = !!uf && fval(uf.role) === 'master' && fval(uf.isActive) === true;
                } catch (e) { approvedByMaster = false; }
                if (!approvedByMaster) {
                    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'approval requires master' }) };
                }
            }
            if (cfg.requireApproval && !approvedByMaster) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, needsApproval: true }) };
            }

            // ─── קריאת רשומת-השיק (מקור-אמת פר-שיק) ───
            const chkRes = await fsGet(projectId, accessToken, checksPath, checkId);
            if (chkRes.status === 404 || chkRes.status !== 200 || !chkRes.data || !chkRes.data.fields) {
                return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'check not found' }) };
            }
            const CF = chkRes.data.fields;
            const chkUpdateTime = chkRes.data.updateTime; // ל-optimistic lock
            const cheque = {
                index: num(fval(CF.index)),
                amount: num(fval(CF.amount)),
                chequeNum: fval(CF.chequeNum),
                status: fval(CF.status),
                invoiceDocId: fval(CF.invoiceDocId),
                invoiceStatus: fval(CF.invoiceStatus),
                invoiceLockAt: fval(CF.invoiceLockAt)
            };

            // ─── guard אידמפוטנטי פר-שיק ───
            if (cheque.invoiceDocId) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, alreadyIssued: true, invoiceNumber: fval(CF.invoiceNumber) || '', invoiceUrl: fval(CF.invoiceUrl) || '' }) };
            }
            // ─── guard נעילה: הפקה בתהליך (TTL 3 דק') ───
            if (cheque.invoiceStatus === 'processing') {
                const lockAge = cheque.invoiceLockAt ? (Date.now() - Date.parse(cheque.invoiceLockAt)) : Infinity;
                if (lockAge < 180000) {
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, inProgress: true }) };
                }
                console.error('[issue-invoice] stale processing lock on cheque (' + Math.round(lockAge / 1000) + 's) — reclaiming');
            }
            // ─── guard: מצב שמעיד שמסמך GI אולי נוצר → בדיקה ידנית ───
            if (cheque.invoiceStatus === 'issued_unrecorded' || cheque.invoiceStatus === 'error_check') {
                return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ success: false, needsReconciliation: true, invoiceStatus: cheque.invoiceStatus, message: 'previous attempt may have created a document — manual check required' }) };
            }

            // ─── שער סכום-שיק תקין (מירור שער-400): 0/שלילי/NaN → לא מפיקים 305 (מסמך-מס בלתי-הפיך) ───
            if (!(Number(cheque.amount) > 0)) {
                return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'invalid_cheque_amount', message: 'cheque amount must be > 0' }) };
            }

            // ─── 🔒 נעילה אטומית (optimistic lock) על רשומת-השיק — תופסים לפני GI ───
            const claimAt = new Date().toISOString();
            const claim = await fsPatchGuarded(projectId, accessToken, checksPath, checkId,
                { invoiceStatus: { stringValue: 'processing' }, invoiceError: { stringValue: '' }, invoiceLockAt: { timestampValue: claimAt } },
                ['invoiceStatus', 'invoiceError', 'invoiceLockAt'], chkUpdateTime);
            if (claim.status !== 200) {
                console.error('[issue-invoice] cheque claim not won (' + claim.status + ') — concurrent/blocked, skipping issue');
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, inProgress: true }) };
            }

            // ─── אובייקט-לקוח מהעסקה (F) — לפרטי הלקוח על ה-305 ───
            const saleObj = {
                clientName: fval(F.clientName),
                email: fval(F.email),
                idNumber: fval(F.idNumber),
                transactionDescription: fval(F.transactionDescription),
                transactionType: fval(F.transactionType),
                notes: fval(F.notes),
                phone: fval(F.phone)
            };

            // ─── GI: token + create + writeback (עטוף ב-try/catch: כשל אחרי התפיסה משחרר/מסמן את נעילת-השיק) ───
            let created305 = false, attempted305 = false;
            let giId = '', giNumber = '', giUrl = '';
            try {
                const giJwt = await giToken(base);
                if (!giJwt) {
                    await fsPatch(projectId, accessToken, checksPath, checkId,
                        { invoiceStatus: { stringValue: 'error' }, invoiceError: { stringValue: 'GI auth failed' } }, ['invoiceStatus', 'invoiceError']);
                    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'GI auth failed' }) };
                }
                const giDoc = buildGiTaxInvoice305(saleObj, cheque, cfg.channels, invoiceEnv);
                attempted305 = true; // מכאן ייתכן שמסמך נוצר (גם אם תיזרק exception)
                const createRes = await httpRequest({
                    hostname: base.hostname, path: base.basePath + '/documents', method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + giJwt, 'Content-Length': Buffer.byteLength(JSON.stringify(giDoc)) }
                }, JSON.stringify(giDoc));

                if (createRes.status !== 200 && createRes.status !== 201) {
                    const errMsg = 'GI create ' + createRes.status; // GI דחה → לא נוצר מסמך → בטוח לשחרר ל-retry
                    console.error('[issue-invoice] ' + errMsg); // ⚠️ לא ללוגג PII/סוד
                    await fsPatch(projectId, accessToken, checksPath, checkId,
                        { invoiceStatus: { stringValue: 'error' }, invoiceError: { stringValue: errMsg } }, ['invoiceStatus', 'invoiceError']);
                    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: errMsg }) };
                }
                const gi = createRes.data || {};
                giId = String(gi.id || '');
                giNumber = String(gi.number || gi.documentNumber || '');
                giUrl = (gi.url && (gi.url.he || gi.url.origin || gi.url)) || gi.documentUrl || '';
                created305 = true; // ← קיים מסמך GI בלתי-הפיך; מכאן אסור retry שמפיק מסמך שני

                // guard מע"מ: 305 = vatRate 18% — מאמת תאימות
                if (gi.vatRate != null && Math.abs(Number(gi.vatRate) - VAT_RATE) > 0.001) {
                    console.error('[issue-invoice] VAT rate mismatch GI=' + gi.vatRate + ' expected=' + VAT_RATE);
                }

                // ─── כתיבת מטא-דאטה אדיטיבית חזרה לרשומת-השיק ───
                const nowIso = new Date().toISOString();
                const chkFields = {
                    status: { stringValue: 'cleared' },
                    clearedAt: { timestampValue: nowIso },
                    invoiceDocId: { stringValue: giId },
                    invoiceNumber: { stringValue: giNumber },
                    invoiceUrl: { stringValue: String(giUrl) },
                    invoiceType: { stringValue: '305' },
                    invoiceStatus: { stringValue: 'issued' },
                    invoiceError: { stringValue: '' }
                };
                const patchRes = await fsPatch(projectId, accessToken, checksPath, checkId, chkFields, Object.keys(chkFields));
                if (patchRes.status !== 200) {
                    // מסמך GI נוצר אך הרישום נכשל → סטטוס חוסם-retry (מונע מסמך שני) + בדיקה ידנית
                    console.error('[issue-invoice] cheque writeback failed ' + patchRes.status);
                    try {
                        await fsPatch(projectId, accessToken, checksPath, checkId,
                            { invoiceStatus: { stringValue: 'issued_unrecorded' }, invoiceDocId: { stringValue: giId }, invoiceNumber: { stringValue: giNumber }, invoiceUrl: { stringValue: String(giUrl) }, invoiceError: { stringValue: 'writeback ' + patchRes.status } },
                            ['invoiceStatus', 'invoiceDocId', 'invoiceNumber', 'invoiceUrl', 'invoiceError']);
                    } catch (e2) { /* best-effort */ }
                    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'issued_but_not_recorded', invoiceNumber: giNumber, invoiceUrl: giUrl }) };
                }

                // ─── outbox (וואטסאפ) + audit_log — לא-חוסם, מקבילי ───
                const tasks = [];
                if (cfg.channels.whatsapp && fval(F.phone)) {
                    tasks.push(fsCreate(projectId, accessToken, 'invoice_outbox', {
                        saleId: { stringValue: saleId },
                        checkId: { stringValue: checkId },
                        phone: { stringValue: String(fval(F.phone)) },
                        clientName: { stringValue: saleObj.clientName || '' },
                        invoiceUrl: { stringValue: String(giUrl) },
                        invoiceNumber: { stringValue: giNumber },
                        status: { stringValue: 'pending' },
                        source: { stringValue: source },
                        env: { stringValue: invoiceEnv }, // R3: הבוט שולח DM ללקוח רק כש-env==='prod' (sandbox → קבוצה בלבד)
                        emailed: { booleanValue: !!(invoiceEnv === 'prod' && cfg.channels.email && saleObj.email) },
                        docType: { stringValue: '305' },
                        createdAt: { timestampValue: nowIso }
                    }));
                }
                tasks.push(fsCreate(projectId, accessToken, 'audit_log', {
                    action: { stringValue: 'invoice_issued' },
                    source: { stringValue: source },
                    performedBy: { stringValue: String(actor || '') },
                    timestamp: { timestampValue: nowIso },
                    details: { mapValue: { fields: {
                        saleId: { stringValue: saleId },
                        checkId: { stringValue: checkId },
                        docType: { stringValue: '305' },
                        invoiceNumber: { stringValue: giNumber },
                        env: { stringValue: invoiceEnv }
                    } } }
                }));
                await Promise.allSettled(tasks); // כשלים כאן לא-חוסמים (המסמך כבר הופק ונרשם)

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: true, docType: 305, invoiceNumber: giNumber, invoiceUrl: giUrl, env: invoiceEnv }) };

            } catch (postClaimErr) {
                // exception אחרי התפיסה — חובה לשחרר/לסמן את נעילת-השיק כדי לא להשאיר 'processing' תקוע
                console.error('[issue-invoice] cheque post-claim failure: ' + postClaimErr.message); // בלי PII/סוד
                try {
                    if (created305) {
                        // מסמך GI קיים → אסור retry אוטומטי (היה מפיק שני) → issued_unrecorded
                        await fsPatch(projectId, accessToken, checksPath, checkId,
                            { invoiceStatus: { stringValue: 'issued_unrecorded' }, invoiceDocId: { stringValue: giId }, invoiceNumber: { stringValue: giNumber }, invoiceUrl: { stringValue: String(giUrl) }, invoiceError: { stringValue: 'post-create exception' } },
                            ['invoiceStatus', 'invoiceDocId', 'invoiceNumber', 'invoiceUrl', 'invoiceError']);
                    } else if (attempted305) {
                        // exception תוך-כדי create → דו-משמעי (אולי נוצר) → חוסם auto-retry, בדיקה ידנית
                        await fsPatch(projectId, accessToken, checksPath, checkId,
                            { invoiceStatus: { stringValue: 'error_check' }, invoiceError: { stringValue: 'create ambiguous' } }, ['invoiceStatus', 'invoiceError']);
                    } else {
                        // נכשל לפני create (token) → לא נוצר מסמך → בטוח ל-retry
                        await fsPatch(projectId, accessToken, checksPath, checkId,
                            { invoiceStatus: { stringValue: 'error' }, invoiceError: { stringValue: 'pre-create failure' } }, ['invoiceStatus', 'invoiceError']);
                    }
                } catch (e3) { console.error('[issue-invoice] cheque lock release failed (manual check needed)'); }
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'issue failed', needsCheck: created305 || attempted305 }) };
            }
        }

        const sale = {
            clientName: fval(F.clientName), phone: fval(F.phone), email: fval(F.email), idNumber: fval(F.idNumber),
            date: fval(F.date), transactionType: fval(F.transactionType), transactionDescription: fval(F.transactionDescription),
            amountBeforeVat: num(fval(F.amountBeforeVat)), vatAmount: num(fval(F.vatAmount)), amountWithVat: num(fval(F.amountWithVat)),
            paymentMethod: fval(F.paymentMethod), creditCardStatus: fval(F.creditCardStatus), notes: fval(F.notes),
            checksDetails: fval(F.checksDetails), // Phase 3: פירוט שיקים (string JSON או array) לקבלה 400
            invoiceIssued: fval(F.invoiceIssued) === true, invoiceStatus: fval(F.invoiceStatus), invoiceLockAt: fval(F.invoiceLockAt),
            invoiceApproved: fval(F.invoiceApproved) === true
        };

        // ─── guard אידמפוטנטי ───
        if (sale.invoiceIssued) {
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, alreadyIssued: true, invoiceNumber: fval(F.invoiceNumber) || fval(F.invoiceReceiptNumber) || '', invoiceUrl: fval(F.invoiceUrl) || '' }) };
        }
        // ─── guard נעילה: הפקה בתהליך (TTL 3 דק' — מונע deadlock אם קריאה קודמת קרסה) ───
        if (sale.invoiceStatus === 'processing') {
            const lockAge = sale.invoiceLockAt ? (Date.now() - Date.parse(sale.invoiceLockAt)) : Infinity;
            if (lockAge < 180000) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, inProgress: true, message: 'issuance already in progress' }) };
            }
            console.error('[issue-invoice] stale processing lock (' + Math.round(lockAge / 1000) + 's) — reclaiming');
        }
        // ─── guard: מצב שמעיד שמסמך GI אולי נוצר → לא מפיקים אוטומטית, דורש בדיקה ידנית ───
        if (sale.invoiceStatus === 'issued_unrecorded' || sale.invoiceStatus === 'error_check') {
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ success: false, needsReconciliation: true, invoiceStatus: sale.invoiceStatus, message: 'previous attempt may have created a document — manual check required' }) };
        }

        // ─── החלטת סוג-מסמך (cfg.docTypeMap שולט, fallback ל-hardcoded) ───
        const decision = decideDocument(sale, cfg);
        if (!decision.issue) {
            // טרם נגבה → סימון סטטוס בלבד, ללא הפקה
            await fsPatch(projectId, accessToken, 'sales_records', saleId,
                { invoiceStatus: { stringValue: 'pending_collection' }, invoiceError: { stringValue: '' } },
                ['invoiceStatus', 'invoiceError']);
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, deferred: true, reason: decision.reason }) };
        }

        // ─── allow-list (security 🔴#1): docType/payType חייבים מ-enum סגור לפני GI ───
        if (!VALID_DOC.has(Number(decision.docType)) || !VALID_PAY.has(Number(decision.payType))) {
            console.error('[issue-invoice] config_invalid — docType/payType out of allow-list');
            await fsPatch(projectId, accessToken, 'sales_records', saleId,
                { invoiceStatus: { stringValue: 'config_invalid' }, invoiceError: { stringValue: 'docType/payType out of allow-list' } },
                ['invoiceStatus', 'invoiceError']);
            return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'config_invalid' }) };
        }

        // ─── Phase 3: קבלה (400) דורשת פירוט מלא לכל שיק (אחרת GI errorCode 2443). שער-שרת לפני נעילה/GI. ───
        let saleChecks = [];
        if (Number(decision.docType) === GI_DOC.RECEIPT) {
            saleChecks = parseChecks(sale.checksDetails);
            if (saleChecks.length > 50) { // תקרת-שרת (הבוט עוקף את תקרת-50 של הטופס) — מונע GI ענק + N כתיבות מקבילות
                await fsPatch(projectId, accessToken, 'sales_records', saleId,
                    { invoiceStatus: { stringValue: 'checks_incomplete' }, invoiceError: { stringValue: 'too many cheques (>50)' } },
                    ['invoiceStatus', 'invoiceError']);
                return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'too_many_cheques', message: 'max 50 cheques per receipt' }) };
            }
            const bad = saleChecks.length === 0 || saleChecks.some(c =>
                !(Number(c.amount) > 0) || !(c.date || c.dueDate) ||
                !c.bankName || !c.bankBranch || !c.bankAccount || !c.chequeNum);
            if (bad) {
                await fsPatch(projectId, accessToken, 'sales_records', saleId,
                    { invoiceStatus: { stringValue: 'checks_incomplete' }, invoiceError: { stringValue: 'missing per-cheque details for receipt 400' } },
                    ['invoiceStatus', 'invoiceError']);
                return { statusCode: 422, headers: corsHeaders, body: JSON.stringify({ error: 'checks_incomplete', message: 'each cheque needs amount, due date, bank, branch, account, cheque number' }) };
            }
        }

        // ─── אם ביקשו approve — אימות master בשרת (קריאת users/{uid} דרך service-account; לא סומכים על הקליינט) ───
        let approvedByMaster = false;
        if (wantApprove) {
            try {
                const uRes = await fsGet(projectId, accessToken, 'users', callerUid);
                const uf = (uRes.status === 200 && uRes.data && uRes.data.fields) ? uRes.data.fields : null;
                approvedByMaster = !!uf && fval(uf.role) === 'master' && fval(uf.isActive) === true;
            } catch (e) { approvedByMaster = false; }
            if (!approvedByMaster) {
                return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'approval requires master' }) };
            }
        }

        // ─── אכיפת requireApproval בשרת (security 🔴#3): עובר אם master-מאומת-עכשיו או invoiceApproved קיים ───
        if (cfg.requireApproval && !sale.invoiceApproved && !approvedByMaster) {
            await fsPatch(projectId, accessToken, 'sales_records', saleId,
                { invoiceStatus: { stringValue: 'awaiting_approval' }, invoiceError: { stringValue: '' } },
                ['invoiceStatus', 'invoiceError']);
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, needsApproval: true, reason: 'awaiting approval' }) };
        }

        const amounts = {
            beforeVat: sale.amountBeforeVat,
            withVat: sale.amountWithVat || +(sale.amountBeforeVat * (1 + VAT_RATE)).toFixed(2)
        };

        // ─── 🔒 נעילה אטומית (optimistic lock) — תופסים את העסקה לפני GI ───
        // precondition על updateTime: בשתי קריאות מקבילות רק אחת זוכה בתפיסה;
        // המפסידה מקבלת status!=200 ולא מפיקה מסמך שני (fail-safe נגד כפילות).
        const claimAt = new Date().toISOString();
        const claim = await fsPatchGuarded(projectId, accessToken, 'sales_records', saleId,
            { invoiceStatus: { stringValue: 'processing' }, invoiceError: { stringValue: '' }, invoiceLockAt: { timestampValue: claimAt } },
            ['invoiceStatus', 'invoiceError', 'invoiceLockAt'], saleUpdateTime);
        if (claim.status !== 200) {
            console.error('[issue-invoice] claim not won (' + claim.status + ') — concurrent/blocked, skipping issue');
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: false, inProgress: true, message: 'issuance already in progress' }) };
        }

        // ─── GI: token + create + writeback (עטוף ב-try/catch: כשל אחרי התפיסה משחרר/מסמן נעילה) ───
        let giCreated = false, createAttempted = false;
        let giId = '', giNumber = '', giUrl = '';
        try {
            const giJwt = await giToken(base);
            if (!giJwt) {
                await fsPatch(projectId, accessToken, 'sales_records', saleId,
                    { invoiceStatus: { stringValue: 'error' }, invoiceError: { stringValue: 'GI auth failed' } }, ['invoiceStatus', 'invoiceError']);
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'GI auth failed' }) };
            }
            const giDoc = Number(decision.docType) === GI_DOC.RECEIPT
                ? buildGiReceipt400(sale, saleChecks, cfg.channels, invoiceEnv)   // Phase 3: קבלה לשיקים
                : buildGiDocument(sale, decision, amounts, cfg.channels, invoiceEnv);
            createAttempted = true; // מכאן ייתכן שמסמך נוצר (גם אם תיזרק exception)
            const createRes = await httpRequest({
                hostname: base.hostname, path: base.basePath + '/documents', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + giJwt, 'Content-Length': Buffer.byteLength(JSON.stringify(giDoc)) }
            }, JSON.stringify(giDoc));

            if (createRes.status !== 200 && createRes.status !== 201) {
                const errMsg = 'GI create ' + createRes.status; // GI דחה → לא נוצר מסמך → בטוח לשחרר ל-retry
                console.error('[issue-invoice] ' + errMsg); // ⚠️ לא ללוגג PII/סוד
                await fsPatch(projectId, accessToken, 'sales_records', saleId,
                    { invoiceStatus: { stringValue: 'error' }, invoiceError: { stringValue: errMsg } }, ['invoiceStatus', 'invoiceError']);
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: errMsg }) };
            }
            const gi = createRes.data || {};
            giId = String(gi.id || '');
            giNumber = String(gi.number || gi.documentNumber || '');
            giUrl = (gi.url && (gi.url.he || gi.url.origin || gi.url)) || gi.documentUrl || '';
            giCreated = true; // ← קיים מסמך GI בלתי-הפיך; מכאן אסור retry שמפיק מסמך שני

            // guard מע"מ: GI לא מחזיר total ביצירה אך מחזיר vatRate — מאמת תאימות 18% (קבלה 400 = vatRate 0, מדלגים)
            if (Number(decision.docType) !== GI_DOC.RECEIPT && gi.vatRate != null && Math.abs(Number(gi.vatRate) - VAT_RATE) > 0.001) {
                console.error('[issue-invoice] VAT rate mismatch GI=' + gi.vatRate + ' expected=' + VAT_RATE);
            }

            // ─── כתיבת מטא-דאטה אדיטיבית חזרה ל-sales_records ───
            const nowIso = new Date().toISOString();
            const today = nowIso.slice(0, 10);
            const invFields = {
                invoiceIssued: { booleanValue: true },
                invoiceType: { stringValue: String(decision.docType) },
                invoiceDocId: { stringValue: giId },
                invoiceNumber: { stringValue: giNumber },
                invoiceUrl: { stringValue: String(giUrl) },
                invoiceIssuedAt: { timestampValue: nowIso },
                invoiceEnv: { stringValue: invoiceEnv },
                invoiceStatus: { stringValue: 'issued' },
                invoiceError: { stringValue: '' },
                invoiceSource: { stringValue: source === 'bot' ? 'system-bot' : 'system' },
                // שדות-תצוגה קיימים (sales-records.js) — מתעדכנים כדי שהבאדג' יציג "יצאה"
                invoiceReceiptNumber: { stringValue: giNumber },
                invoiceDate: { stringValue: today }
            };
            if (approvedByMaster) { invFields.invoiceApproved = { booleanValue: true }; invFields.invoiceApprovedBy = { stringValue: String(actor || '') }; }
            const patchRes = await fsPatch(projectId, accessToken, 'sales_records', saleId, invFields, Object.keys(invFields));
            if (patchRes.status !== 200) {
                // מסמך GI נוצר אך הרישום נכשל → סטטוס חוסם-retry (מונע מסמך שני) + בדיקה ידנית
                console.error('[issue-invoice] writeback failed ' + patchRes.status);
                try {
                    await fsPatch(projectId, accessToken, 'sales_records', saleId,
                        { invoiceStatus: { stringValue: 'issued_unrecorded' }, invoiceDocId: { stringValue: giId }, invoiceNumber: { stringValue: giNumber }, invoiceUrl: { stringValue: String(giUrl) }, invoiceError: { stringValue: 'writeback ' + patchRes.status } },
                        ['invoiceStatus', 'invoiceDocId', 'invoiceNumber', 'invoiceUrl', 'invoiceError']);
                } catch (e2) { /* best-effort */ }
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'issued_but_not_recorded', invoiceNumber: giNumber, invoiceUrl: giUrl }) };
            }

            // ─── outbox (וואטסאפ) + audit_log — לא-חוסם, מקבילי (חוסך round-trip מתקציב הזמן) ───
            const tasks = [];
            if (cfg.channels.whatsapp && sale.phone) {
                tasks.push(fsCreate(projectId, accessToken, 'invoice_outbox', {
                    saleId: { stringValue: saleId },
                    phone: { stringValue: String(sale.phone) },
                    clientName: { stringValue: sale.clientName || '' },
                    invoiceUrl: { stringValue: String(giUrl) },
                    invoiceNumber: { stringValue: giNumber },
                    status: { stringValue: 'pending' },
                    source: { stringValue: source },
                    env: { stringValue: invoiceEnv }, // R3: הבוט שולח DM ללקוח רק כש-env==='prod' (sandbox → קבוצה בלבד)
                    emailed: { booleanValue: !!(invoiceEnv === 'prod' && cfg.channels.email && sale.email) },
                    createdAt: { timestampValue: nowIso }
                }));
            }
            tasks.push(fsCreate(projectId, accessToken, 'audit_log', {
                action: { stringValue: 'invoice_issued' },
                source: { stringValue: source },
                performedBy: { stringValue: String(actor || '') },
                timestamp: { timestampValue: nowIso },
                details: { mapValue: { fields: {
                    saleId: { stringValue: saleId },
                    docType: { stringValue: String(decision.docType) },
                    invoiceNumber: { stringValue: giNumber },
                    env: { stringValue: invoiceEnv }
                } } }
            }));
            // ─── Phase 2: רשומת-שיק לכל שיק (subcollection server-only) — מעקב פירעון פר-שיק → 305 בהמשך ───
            if (Number(decision.docType) === GI_DOC.RECEIPT) {
                saleChecks.forEach(function (c, i) {
                    tasks.push(fsCreate(projectId, accessToken, 'sales_records/' + saleId + '/checks', {
                        index: { integerValue: String(i + 1) },
                        amount: { doubleValue: Number(c.amount) || 0 },
                        dueDate: { stringValue: String(c.date || c.dueDate || '') },
                        status: { stringValue: 'pending' }, // pending | cleared | bounced
                        bankName: { stringValue: String(c.bankName || '') },
                        bankBranch: { stringValue: String(c.bankBranch || '') },
                        bankAccount: { stringValue: String(c.bankAccount || '') },
                        chequeNum: { stringValue: String(c.chequeNum || '') },
                        receiptDocId: { stringValue: giId },     // הקבלה (400) שמכסה את כל השיקים
                        receiptNumber: { stringValue: giNumber },
                        invoiceDocId: { stringValue: '' },       // ימולא בפירעון (305 פר-שיק, Phase 4)
                        invoiceNumber: { stringValue: '' },
                        invoiceUrl: { stringValue: '' },
                        createdAt: { timestampValue: nowIso }
                    }));
                });
            }
            await Promise.allSettled(tasks); // כשלים כאן לא-חוסמים (המסמך כבר הופק ונרשם)

            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, issued: true, docType: decision.docType, invoiceNumber: giNumber, invoiceUrl: giUrl, env: invoiceEnv }) };

        } catch (postClaimErr) {
            // exception אחרי התפיסה — חובה לשחרר/לסמן את הנעילה כדי לא להשאיר 'processing' תקוע
            console.error('[issue-invoice] post-claim failure: ' + postClaimErr.message); // בלי PII/סוד
            try {
                if (giCreated) {
                    // מסמך GI קיים → אסור retry אוטומטי (היה מפיק שני) → issued_unrecorded
                    await fsPatch(projectId, accessToken, 'sales_records', saleId,
                        { invoiceStatus: { stringValue: 'issued_unrecorded' }, invoiceDocId: { stringValue: giId }, invoiceNumber: { stringValue: giNumber }, invoiceUrl: { stringValue: String(giUrl) }, invoiceError: { stringValue: 'post-create exception' } },
                        ['invoiceStatus', 'invoiceDocId', 'invoiceNumber', 'invoiceUrl', 'invoiceError']);
                } else if (createAttempted) {
                    // exception תוך-כדי create → דו-משמעי (אולי נוצר) → חוסם auto-retry, בדיקה ידנית
                    await fsPatch(projectId, accessToken, 'sales_records', saleId,
                        { invoiceStatus: { stringValue: 'error_check' }, invoiceError: { stringValue: 'create ambiguous' } }, ['invoiceStatus', 'invoiceError']);
                } else {
                    // נכשל לפני create (token) → לא נוצר מסמך → בטוח ל-retry
                    await fsPatch(projectId, accessToken, 'sales_records', saleId,
                        { invoiceStatus: { stringValue: 'error' }, invoiceError: { stringValue: 'pre-create failure' } }, ['invoiceStatus', 'invoiceError']);
                }
            } catch (e3) { console.error('[issue-invoice] lock release failed (manual check needed)'); }
            return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'issue failed', needsCheck: giCreated || createAttempted }) };
        }

    } catch (err) {
        console.error('[issue-invoice] Error:', err.message); // ⚠️ ללא PII/סוד
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server error' }) };
    }
};
