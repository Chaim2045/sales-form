// ============================================================================
// Netlify Function: lead-intake — קליטת לידים מובנית (קמפיינים / דף נחיתה / סוכנות)
// ----------------------------------------------------------------------------
//  • מקבל POST עם שדות מובנים (name/phone/email/subject/source) + secret.
//  • אימות: secret חייב להתאים ל-LEAD_INTAKE_SECRET (env). fail-CLOSED —
//    אם לא הוגדר secret בשרת → דחייה (אינו פתוח לכולם, בניגוד ל-lead-from-email הישן).
//  • כתיבה ל-leads דרך service-account access token (Admin) → עוקף Firestore rules
//    (דפוס מוכח כמו yf-totp.js / lead-from-email.js). אינו תלוי ב-create:if true.
//  • Dedup לפי phoneLast7. השדות תואמים ל-schema שה-CRM קורא (js/leads.js).
// ============================================================================
const https = require('https');
const crypto = require('crypto');

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

function getLast7(phone) {
    return (phone || '').replace(/\D/g, '').slice(-7);
}

// access token דרך Service Account (JWT RS256) — env FIREBASE_SERVICE_ACCOUNT.
// כתיבה עם token זה מאומתת כ-service account → עוקפת Firestore rules (כמו Admin SDK).
function b64urlJson(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function getAccessToken() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Server configuration error (no FIREBASE_SERVICE_ACCOUNT)');
    let sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('Server configuration error (bad SA json)'); }
    if (!sa.client_email || !sa.private_key) throw new Error('Server configuration error (SA missing fields)');
    const key = sa.private_key.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
    const signingInput = b64urlJson(header) + '.' + b64urlJson(claims);
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = signingInput + '.' + signature;
    const postData = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt);
    const res = await httpRequest({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } }, postData);
    if (res.status !== 200) throw new Error('Token exchange failed (' + res.status + ')');
    return res.data.access_token;
}

// השוואת-סוד timing-safe (מונע timing attacks)
function safeEqual(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a.length !== b.length || a.length === 0) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}

exports.handler = async (event) => {
    var corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        var body = {};
        try { body = JSON.parse(event.body || '{}'); } catch (e) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
        }

        // ─── Auth: shared secret (fail-CLOSED) ───
        var expected = process.env.LEAD_INTAKE_SECRET || '';
        if (!expected) {
            console.error('[Lead Intake] LEAD_INTAKE_SECRET not configured — rejecting (fail-closed)');
            return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Service not configured' }) };
        }
        var provided = body.secret || event.headers['x-webhook-secret'] || event.headers['X-Webhook-Secret'] || '';
        var authHeader = event.headers.authorization || event.headers.Authorization || '';
        if (!provided && authHeader.indexOf('Bearer ') === 0) provided = authHeader.substring(7);
        if (!safeEqual(provided, expected)) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid or missing secret' }) };
        }

        // ─── Fields (canonical + common aliases) ───
        var name = String(body.name || body.fullName || body.full_name || '').trim();
        var phone = String(body.phone || body.phoneNumber || body.phone_number || '').trim();
        var email = String(body.email || '').trim();
        var subject = String(body.subject || body.interest || body.topic || body.message || '').trim();
        var source = String(body.source || body.campaign || 'campaign').trim();
        var message = String(body.message || body.notes || '').trim();
        var phoneLast7 = getLast7(phone);

        if (!phoneLast7 && !name) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'At least one of "name" or "phone" is required' }) };
        }

        var projectId = process.env.FIREBASE_PROJECT_ID || 'law-office-sales-form';
        var accessToken = await getAccessToken();
        var nowIso = new Date().toISOString();

        // ─── Dedup by phoneLast7 (non-blocking) ───
        if (phoneLast7 && phoneLast7.length >= 7) {
            try {
                var queryBody = JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'leads' }],
                        where: { fieldFilter: { field: { fieldPath: 'phoneLast7' }, op: 'EQUAL', value: { stringValue: phoneLast7 } } },
                        limit: 1
                    }
                });
                var checkRes = await httpRequest({
                    hostname: 'firestore.googleapis.com',
                    path: '/v1/projects/' + projectId + '/databases/(default)/documents:runQuery',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken, 'Content-Length': Buffer.byteLength(queryBody) }
                }, queryBody);
                if (checkRes.status === 200 && Array.isArray(checkRes.data) && checkRes.data[0] && checkRes.data[0].document) {
                    console.log('[Lead Intake] Dedup match phoneLast7=' + phoneLast7 + ' — skipping create');
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, deduped: true }) };
                }
            } catch (dedupErr) {
                console.error('[Lead Intake] Dedup check failed (non-blocking):', dedupErr.message);
            }
        }

        // ─── Create lead (fields match the schema read by js/leads.js) ───
        var firestoreDoc = {
            fields: {
                name: { stringValue: name },
                phone: { stringValue: phone },
                phoneLast7: { stringValue: phoneLast7 },
                email: { stringValue: email },
                subject: { stringValue: subject },
                source: { stringValue: source },
                status: { stringValue: 'new' },
                statusNote: { stringValue: '' },
                priority: { stringValue: 'normal' },
                assignedTo: { nullValue: null },
                assignedAt: { nullValue: null },
                followupAt: { nullValue: null },
                createdAt: { timestampValue: nowIso },
                lastUpdated: { timestampValue: nowIso },
                originalMessage: { stringValue: message.substring(0, 1000) },
                crmUpdated: { booleanValue: false },
                schemaVersion: { integerValue: '1' },
                history: { arrayValue: { values: [{
                    mapValue: { fields: {
                        action: { stringValue: 'created' },
                        by: { stringValue: 'campaign-intake' },
                        at: { stringValue: nowIso },
                        note: { stringValue: 'ליד נקלט מקמפיין: ' + source }
                    } }
                }] } }
            }
        };

        var postData = JSON.stringify(firestoreDoc);
        var res = await httpRequest({
            hostname: 'firestore.googleapis.com',
            path: '/v1/projects/' + projectId + '/databases/(default)/documents/leads',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken, 'Content-Length': Buffer.byteLength(postData) }
        }, postData);

        if (res.status === 200 || res.status === 201) {
            console.log('[Lead Intake] Saved lead from source=' + source);
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, created: true }) };
        }
        console.error('[Lead Intake] Firestore write error:', res.status, JSON.stringify(res.data).substring(0, 200));
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Write failed', status: res.status }) };

    } catch (err) {
        console.error('[Lead Intake] Error:', err.message);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server error' }) };
    }
};
