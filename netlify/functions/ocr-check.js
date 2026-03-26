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

// Use Claude API to extract check date and amount from OCR text
async function parseCheckWithClaude(ocrText) {
    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
        console.warn('ANTHROPIC_API_KEY not configured, falling back to regex');
        return null;
    }

    var prompt = 'You are parsing OCR output from a scanned Israeli bank check (שיק). ' +
        'Extract ONLY the check date and check amount.\n\n' +
        'CRITICAL RULES:\n' +
        '1. DATE: Located near the word "DATE" or "תאריך" at the bottom of the check. ' +
        'Format is DAY/MONTH/YEAR (Israeli format). Year is 2-digit (26 = 2026). ' +
        'OCR often smashes digits together, for example:\n' +
        '   - "304 26" = 30/4/26 (April 30, 2026)\n' +
        '   - "30626" = 30/6/26 (June 30, 2026)\n' +
        '   - "3826" = 30/8/26 (August 30, 2026) - the 0 was dropped\n' +
        '   - "726" = likely 30/7/26 (July 30, 2026) - digits were lost\n' +
        '   - "30.9.26" = 30/9/26 (September 30, 2026)\n' +
        '   - "5.26" near "30" = 30/5/26 (May 30, 2026) - digits split across lines\n' +
        '   Look for digits BEFORE the word DATE/תאריך. The date is always written above the DATE label.\n' +
        '2. AMOUNT: Located near ₪ or N.I.S. on the right side of the check. ' +
        'Format uses comma as thousands separator (e.g., 8,850). ' +
        'IMPORTANT: OCR very often adds a leading "1" by mistake — if you see "18,850" or "18.850" but ' +
        'the Hebrew words say "שמונה אלפים" (eight thousand), the real amount is 8,850 NOT 18,850. ' +
        'Always cross-reference the numeric amount with the Hebrew words on the check. ' +
        'OCR may also use $ instead of ₪, or dot instead of comma (8.850 = 8,850). ' +
        'If you see "IN 18,850" or "$18,850" — the leading 1 is almost certainly an OCR error.\n' +
        '3. IGNORE: account numbers (381817), branch numbers (78000), phone numbers (054...), ' +
        'check numbers (0014095), and ID numbers (515652881).\n\n' +
        'Respond with ONLY valid JSON, no other text:\n' +
        '{"date": "YYYY-MM-DD", "amount": 8850}\n\n' +
        'OCR Text:\n' + ocrText;

    var requestBody = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
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
        return null;
    }

    try {
        var responseText = res.data.content[0].text.trim();
        // Extract JSON from response (Claude might wrap it in markdown)
        var jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        var parsed = JSON.parse(jsonMatch[0]);
        return {
            date: parsed.date || '',
            amount: parseFloat(parsed.amount) || 0
        };
    } catch (e) {
        console.error('Failed to parse Claude response:', e);
        return null;
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
        var imageBase64 = body.imageBase64;

        if (!imageBase64) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing image data' }) };
        }

        // Remove data URL prefix if present
        if (imageBase64.indexOf('base64,') !== -1) {
            imageBase64 = imageBase64.split('base64,')[1];
        }

        // Call Google Cloud Vision API
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
            console.error('Vision API error:', JSON.stringify(visionRes.data));
            return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Vision API error' }) };
        }

        // Extract text from Vision API response
        var responses = visionRes.data.responses;
        if (!responses || !responses[0] || !responses[0].textAnnotations || responses[0].textAnnotations.length === 0) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ success: true, checks: [], rawText: '', message: 'No text detected in image' })
            };
        }

        var fullText = responses[0].textAnnotations[0].description || '';

        // Parse with Claude API
        var checkData = await parseCheckWithClaude(fullText);

        var checks = [];
        if (checkData && (checkData.date || checkData.amount > 0)) {
            checks.push({
                date: checkData.date,
                amount: checkData.amount,
                index: 1
            });
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                checks: checks,
                rawText: fullText
            })
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
