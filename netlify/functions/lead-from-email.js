// Netlify Function: Receive lead from Gmail via Google Apps Script
// Parses email content with Claude AI, saves to Firestore, notifies WhatsApp bot

const https = require('https');
const crypto = require('crypto');

// השוואת-סוד timing-safe (מונע timing attacks)
function safeEqual(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a.length !== b.length || a.length === 0) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}

function getLast7(phone) {
    if (!phone) return '';
    var digits = (phone || '').replace(/\D/g, '');
    return digits.slice(-7);
}

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

// access token דרך Service Account (JWT RS256) — env FIREBASE_SERVICE_ACCOUNT (client_email + private_key).
// כתיבה עם token זה מאומתת כ-service account → עוקפת Firestore rules (כמו Admin SDK). מוכח ב-yf-totp.js.
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

// Parse email with Claude to extract lead details
async function parseEmailWithClaude(emailBody, emailSubject, emailFrom) {
    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return null;

    var prompt = 'אתה מסנן מיילים למשרד עו"ד גיא הרשקוביץ ומחלץ לידים אמיתיים.\n\n' +
        'המייל הבא הגיע:\n' +
        'מאת: ' + (emailFrom || 'לא ידוע') + '\n' +
        'נושא: ' + (emailSubject || 'ללא נושא') + '\n' +
        'תוכן:\n' + (emailBody || '').substring(0, 1500) + '\n\n' +
        'החזר JSON בלבד:\n' +
        '{\n' +
        '  "name": "שם הלקוח הפוטנציאלי (לא שם השולח/האתר/המנהלת)",\n' +
        '  "phone": "מספר טלפון של הלקוח (05X-XXXXXXX)",\n' +
        '  "email": "מייל הלקוח אם יש",\n' +
        '  "subject": "נושא הפנייה (3-5 מילים)",\n' +
        '  "summary": "סיכום קצר",\n' +
        '  "callDuration": "משך השיחה אם מצוין (למשל 00:42, 03:15). אם לא מצוין: null",\n' +
        '  "isLead": true/false,\n' +
        '  "score": 1-10\n' +
        '}\n\n' +
        '=== ליד אמיתי (isLead: true) ===\n' +
        '- "שיחה שלא נענתה מלקוח מאתר דין" = ליד חם (score: 7+)\n' +
        '- "שיחה שנענתה / קיבלת שיחה מלקוח מאתר דין" = גם ליד! (score: 6) — צריך מעקב\n' +
        '- כל מייל מ-din.co.il עם מספר טלפון של לקוח = ליד\n' +
        '- מייל מ-callbiz.co.il עם פרטי לקוח = ליד (score: 6)\n' +
        '- "פנייה חדשה מהפורום" / "טופס יצירת קשר" עם טלפון של לקוח = ליד\n' +
        '- הודעה עם שם + טלפון + נושא משפטי = ליד\n' +
        '- גם אם יש רק טלפון בלי שם — עדיין ליד (name: null)\n\n' +
        '=== לא ליד (isLead: false) ===\n' +
        '- מיילים מרותם / מנהלת אתר din.co.il (תזכורות, כתבות לאישור, דוחות, חשבוניות)\n' +
        '- "העברתי לכם כתבות" / "תזכורת חידוש" / "לאישור" / "דוח חודשי"\n' +
        '- ניוזלטרים, פרסומות, הצעות לפרסום\n' +
        '- מיילים ללא טלפון של לקוח ובלי פנייה ספציפית\n' +
        '- מיילים פנימיים מצוות אתר דין / צוות משפטי / ספקים\n\n' +
        'הכלל: אם אין מספר טלפון של לקוח פוטנציאלי ואין פנייה ספציפית = isLead: false.\n' +
        'JSON בלבד.';

    var requestBody = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
    });

    try {
        var res = await httpRequest({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        }, requestBody);

        if (res.status !== 200) {
            console.error('Claude error:', res.status);
            return null;
        }

        var text = res.data.content[0].text.trim();
        var jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('Claude parse error:', e.message);
        return null;
    }
}

// Save lead to Firestore via Firebase Admin REST API
async function saveLeadToFirestore(leadData) {
    var projectId = process.env.FIREBASE_PROJECT_ID || 'law-office-sales-form';
    // אבטחה (F3): כתיבה דרך service-account access token (Admin) — עוקף Firestore rules,
    // כדי לאפשר סגירת leads create:if true (world-writable) בלי לשבור את קליטת לידי-המייל.
    var accessToken = await getAccessToken();
    var firestoreDoc = {
        fields: {
            name: { stringValue: leadData.name || '' },
            phone: { stringValue: leadData.phone || '' },
            phoneLast7: { stringValue: getLast7(leadData.phone) },
            email: { stringValue: leadData.email || '' },
            subject: { stringValue: leadData.subject || '' },
            source: { stringValue: 'email' },
            status: { stringValue: 'new' },
            statusNote: { stringValue: leadData.summary || '' },
            priority: { stringValue: (leadData.score && leadData.score >= 7) ? 'high' : 'normal' },
            assignedTo: { nullValue: null },
            assignedAt: { nullValue: null },
            followupAt: { nullValue: null },
            createdAt: { timestampValue: new Date().toISOString() },
            lastUpdated: { timestampValue: new Date().toISOString() },
            originalMessage: { stringValue: (leadData.originalBody || '').substring(0, 500) },
            callDuration: { stringValue: leadData.callDuration || '' },
            crmUpdated: { booleanValue: false },
            escalated: { booleanValue: false },
            aiScore: { integerValue: leadData.score || 0 },
            aiReason: { stringValue: leadData.summary || '' },
            history: { arrayValue: { values: [{
                mapValue: { fields: {
                    action: { stringValue: 'created' },
                    by: { stringValue: 'gmail-bot' },
                    at: { stringValue: new Date().toISOString() },
                    note: { stringValue: 'ליד נקלט מהמייל: ' + (leadData.emailFrom || '') }
                }}
            }]}}
        }
    };

    // Dedup: check if lead with same phone already exists
    var phoneLast7 = getLast7(leadData.phone);
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
                console.log('[Email Lead] Dedup match: phoneLast7=' + phoneLast7 + ' — skipping create');
                return true;
            }
        } catch (dedupErr) {
            console.error('[Email Lead] Dedup check failed (non-blocking):', dedupErr.message);
        }
    }

    var postData = JSON.stringify(firestoreDoc);
    var res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + projectId + '/databases/(default)/documents/leads',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
            'Content-Length': Buffer.byteLength(postData)
        }
    }, postData);

    if (res.status === 200 || res.status === 201) {
        console.log('[Email Lead] Saved to Firestore');
        return true;
    } else {
        var errDetail = JSON.stringify(res.data).substring(0, 300);
        console.error('[Email Lead] Firestore error:', res.status, errDetail);
        return { error: true, status: res.status, detail: errDetail };
    }
}

exports.handler = async (event) => {
    var corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        var body = JSON.parse(event.body);

        // Verify webhook secret — fail-CLOSED (אם לא הוגדר secret בשרת → דחה; השוואה timing-safe)
        var expectedSecret = process.env.WEBHOOK_SECRET || '';
        if (!expectedSecret) {
            console.error('[Email Lead] WEBHOOK_SECRET not configured — rejecting (fail-closed)');
            return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Service not configured' }) };
        }
        if (!safeEqual(body.secret || '', expectedSecret)) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid or missing secret' }) };
        }

        var emailBody = body.body || body.content || '';
        var emailSubject = body.subject || '';
        var emailFrom = body.from || body.sender || '';
        var emailDate = body.date || new Date().toISOString();

        if (!emailBody && !emailSubject) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No email content' }) };
        }

        // Parse with Claude
        var parsed = await parseEmailWithClaude(emailBody, emailSubject, emailFrom);

        if (!parsed || !parsed.isLead) {
            console.log('[Email Lead] Not a lead: ' + emailSubject);
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ success: true, isLead: false, reason: 'Not identified as a lead' })
            };
        }

        // Save to Firestore
        parsed.originalBody = emailBody;
        parsed.emailFrom = emailFrom;
        var saved = await saveLeadToFirestore(parsed);
        var isSuccess = saved === true;

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: isSuccess,
                isLead: true,
                name: parsed.name,
                phone: parsed.phone,
                subject: parsed.subject,
                score: parsed.score,
                _debug: !isSuccess && saved && saved.error ? saved : undefined
            })
        };

    } catch (err) {
        console.error('[Email Lead] Error:', err.message);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
};
