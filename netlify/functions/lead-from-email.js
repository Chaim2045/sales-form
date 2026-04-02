// Netlify Function: Receive lead from Gmail via Google Apps Script
// Parses email content with Claude AI, saves to Firestore, notifies WhatsApp bot

const https = require('https');

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

// Parse email with Claude to extract lead details
async function parseEmailWithClaude(emailBody, emailSubject, emailFrom) {
    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return null;

    var prompt = 'אתה מחלץ פרטי לידים ממיילים שמגיעים למשרד עו"ד.\n\n' +
        'המייל הבא הגיע:\n' +
        'מאת: ' + (emailFrom || 'לא ידוע') + '\n' +
        'נושא: ' + (emailSubject || 'ללא נושא') + '\n' +
        'תוכן:\n' + (emailBody || '').substring(0, 1500) + '\n\n' +
        'חלץ את הפרטים הבאים והחזר JSON בלבד:\n' +
        '{\n' +
        '  "name": "שם הפונה (לא שם השולח אלא שם הלקוח הפוטנציאלי)",\n' +
        '  "phone": "מספר טלפון (פורמט: 05X-XXXXXXX)",\n' +
        '  "email": "מייל אם יש",\n' +
        '  "subject": "נושא הפנייה בקצרה (3-5 מילים)",\n' +
        '  "summary": "סיכום קצר של מה הלקוח צריך (משפט אחד)",\n' +
        '  "isLead": true/false,\n' +
        '  "score": 1-10\n' +
        '}\n\n' +
        'אם זה לא ליד (ספאם, ניוזלטר, פרסום, מייל פנימי) — החזר isLead: false.\n' +
        'אם אין טלפון במייל, שים null.\n' +
        'JSON בלבד, בלי טקסט מחוץ ל-JSON.';

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
    var apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY;

    var firestoreDoc = {
        fields: {
            name: { stringValue: leadData.name || '' },
            phone: { stringValue: leadData.phone || '' },
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

    var postData = JSON.stringify(firestoreDoc);
    var res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + projectId + '/databases/(default)/documents/leads?key=' + apiKey,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    }, postData);

    if (res.status === 200 || res.status === 201) {
        console.log('[Email Lead] Saved to Firestore');
        return true;
    } else {
        console.error('[Email Lead] Firestore error:', res.status, JSON.stringify(res.data).substring(0, 200));
        return false;
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

        // Verify webhook secret
        var secret = process.env.WEBHOOK_SECRET || '';
        if (secret && body.secret !== secret) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid secret' }) };
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

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: saved,
                isLead: true,
                name: parsed.name,
                phone: parsed.phone,
                subject: parsed.subject,
                score: parsed.score
            })
        };

    } catch (err) {
        console.error('[Email Lead] Error:', err.message);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
    }
};
