// Netlify Function: OCR check reading
// Google Vision API for text extraction + Claude API for intelligent parsing

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

// Verify caller is authenticated
async function verifyAuth(idToken) {
    var apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY;
    if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY not configured');

    var postData = JSON.stringify({ idToken: idToken });
    var res = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        path: '/v1/accounts:lookup?key=' + apiKey,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    }, postData);

    if (res.status !== 200 || !res.data.users || !res.data.users[0]) {
        throw new Error('Invalid token');
    }
    return res.data.users[0].localId;
}

function getCorsOrigin(event) {
    var origin = event.headers.origin || event.headers.Origin || '';
    if (origin.endsWith('.netlify.app') || origin.startsWith('http://localhost')) {
        return origin;
    }
    return '';
}

// Use Claude API to extract check dates and amounts from OCR text
// Supports single check or multiple checks (separated by "--- עמוד X ---")
async function parseChecksWithClaude(ocrText) {
    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
        console.warn('ANTHROPIC_API_KEY not configured');
        return [];
    }

    // Count pages
    var pageCount = (ocrText.match(/--- עמוד/g) || []).length + 1;

    var prompt = 'You are parsing OCR output from scanned Israeli bank checks (שיקים). ' +
        'The text contains ' + pageCount + ' check(s). Each check is on a separate page, ' +
        'separated by "--- עמוד X ---". A page may contain MORE THAN ONE check — extract EVERY distinct check found across all pages.\n\n' +
        'CRITICAL RULES:\n' +
        '1. DATE (primary, required): Located near "DATE" or "תאריך" at the bottom of each check. ' +
        'Format is DAY/MONTH/YEAR (Israeli). Year is 2-digit (26 = 2026). ' +
        'OCR smashes digits: "304 26"=30/4/26, "30626"=30/6/26, "3826"=30/8/26, "726"=30/7/26, ' +
        '"5.26" near "30"=30/5/26. Look BEFORE the word DATE/תאריך.\n' +
        '2. AMOUNT (primary, required): Near ₪ or N.I.S. Format: X,XXX. ' +
        'OCR adds leading "1" (18,850→8,850) or "$". Cross-reference with Hebrew words. ' +
        'Dot can replace comma (8.850=8,850).\n' +
        '3. BANK DETAILS (best-effort, may be blank): Each cheque carries bank, branch, account and cheque number — ' +
        'printed on the cheque FACE (bank name + סניף + מספר חשבון; cheque number near the top) and in the MICR codeline ' +
        'at the very bottom (digits with the symbols ⑆ ⑇ ⑈; pattern: chequeNumber ⑆ bankCode[2 digits]-branch[3 digits] ⑆ account ⑇).\n' +
        '   - bankName: the printed Hebrew bank name (e.g. הפועלים, לאומי, מזרחי טפחות, דיסקונט, הבינלאומי). ' +
        'If only a 2-digit code is visible map: 12=הפועלים, 10=לאומי, 20=מזרחי טפחות, 11=דיסקונט, 31=הבינלאומי, 04=יהב, 14=אוצר החייל, 17=מרכנתיל, 46=מסד. Otherwise "".\n' +
        '   - bankBranch: 3-digit branch (סניף). bankAccount: account number, digits only, KEEP leading zeros. chequeNum: the cheque serial number.\n' +
        '   - PREFER the printed face; use the MICR codeline only to confirm. Do NOT merge the 2-digit bank code into the branch.\n' +
        '4. ANTI-HALLUCINATION (mandatory): NEVER invent or complete digits. If a field is unreadable or ambiguous, return an EMPTY STRING "" for it. ' +
        'A blank is correct; a guessed bank/account/cheque number is a serious error. Date and amount stay the priority.\n\n' +
        'Respond with ONLY a JSON array, one object PER CHECK (not per page), no other text. Each object MUST have all six keys (use "" for unreadable string fields):\n' +
        '[{"date":"YYYY-MM-DD","amount":8850,"bankName":"","bankBranch":"","bankAccount":"","chequeNum":""}]\n\n' +
        'Return one object for EVERY distinct check found — there may be more than ' + pageCount + ' if some pages hold multiple checks. Do not pad or drop to match the page count.\n\n' +
        'OCR Text:\n' + ocrText;

    var requestBody = JSON.stringify({
        model: 'claude-opus-4-8', // שדרוג דיוק לפענוח-שיקים (עלות זניחה, שימוש נדיר; אותם פרמטרים — model+max_tokens+messages)
        max_tokens: 4000, // 6 שדות × עד ~50 שיקים
        messages: [{ role: 'user', content: prompt }]
    });

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
        console.error('Claude API error:', res.status, JSON.stringify(res.data).substring(0, 300));
        return [];
    }

    try {
        var responseText = res.data.content[0].text.trim();
        console.log('Claude response:', responseText);
        // Extract JSON array from response
        var jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            // Try single object
            var objMatch = responseText.match(/\{[\s\S]*\}/);
            if (objMatch) return [JSON.parse(objMatch[0])];
            return [];
        }
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('Failed to parse Claude response:', e);
        return [];
    }
}

exports.handler = async (event) => {
    var allowedOrigin = getCorsOrigin(event);

    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': allowedOrigin,
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'POST'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    var corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Content-Type': 'application/json'
    };

    try {
        // Verify authentication
        var authHeader = event.headers.authorization || event.headers.Authorization || '';
        var idToken = authHeader.replace('Bearer ', '');
        if (!idToken) {
            return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Missing auth token' }) };
        }
        await verifyAuth(idToken);

        // Parse request body
        var body = JSON.parse(event.body);

        // Mode 1: Single image (Vision + Claude)
        // Mode 2: Pre-extracted OCR texts from multiple pages (Claude only)
        var fullText = '';

        if (body.ocrTexts) {
            // Multiple pages — texts already extracted by client via Vision API
            fullText = body.ocrTexts.map(function(t, i) {
                return (i > 0 ? '\n--- עמוד ' + (i + 1) + ' ---\n' : '') + t;
            }).join('');
        } else if (body.imageBase64) {
            // Single image — extract text with Vision API
            var imageBase64 = body.imageBase64;
            if (imageBase64.indexOf('base64,') !== -1) {
                imageBase64 = imageBase64.split('base64,')[1];
            }

            var visionApiKey = process.env.GOOGLE_VISION_API_KEY;
            if (!visionApiKey) {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Vision API not configured' }) };
            }

            var visionRequest = {
                requests: [{
                    image: { content: imageBase64 },
                    features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
                    imageContext: { languageHints: ['he', 'en'] }
                }]
            };

            var visionData = JSON.stringify(visionRequest);
            var visionRes = await httpRequest({
                hostname: 'vision.googleapis.com',
                path: '/v1/images:annotate?key=' + visionApiKey,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(visionData)
                }
            }, visionData);

            if (visionRes.status !== 200) {
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Vision API error' }) };
            }

            var responses = visionRes.data.responses;
            if (!responses || !responses[0] || !responses[0].textAnnotations || !responses[0].textAnnotations[0]) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, checks: [], rawText: '' }) };
            }

            fullText = responses[0].textAnnotations[0].description || '';

            // Vision-only mode: return raw text without Claude parsing
            if (body.visionOnly) {
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ success: true, rawText: fullText })
                };
            }
        } else {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing image or text data' }) };
        }

        // Parse all checks with Claude in one call
        var parsedChecks = await parseChecksWithClaude(fullText);
        var checks = parsedChecks.map(function(c, i) {
            return {
                date: c.date || '',
                amount: parseFloat(c.amount) || 0,
                // פרטי-בנק (best-effort; מחרוזות לשמירת אפסים מובילים; ריק = לא נקרא, להשלמה ידנית)
                bankName: (c.bankName || '').toString().trim(),
                bankBranch: (c.bankBranch || '').toString().trim(),
                bankAccount: (c.bankAccount || '').toString().trim(),
                chequeNum: (c.chequeNum || '').toString().trim(),
                index: i + 1
            };
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ success: true, checks: checks, rawText: fullText })
        };

    } catch (err) {
        console.error('OCR function error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: err.message || 'Internal error' })
        };
    }
};
