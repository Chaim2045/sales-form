// Netlify Function: OCR check reading via Google Cloud Vision API
// Receives a check photo, extracts amount, date, and check number

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

// Verify caller is authenticated (any active user, not just master)
async function verifyAuth(idToken) {
    var apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY;
    console.log('verifyAuth: API key exists:', !!apiKey, 'token length:', idToken ? idToken.length : 0);

    if (!apiKey) {
        throw new Error('FIREBASE_WEB_API_KEY not configured');
    }

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

    console.log('verifyAuth response:', res.status, JSON.stringify(res.data).substring(0, 200));

    if (res.status !== 200 || !res.data.users || !res.data.users[0]) {
        throw new Error('Invalid token - status: ' + res.status + ' data: ' + JSON.stringify(res.data).substring(0, 200));
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

// Parse a SINGLE Israeli check text — one page = one check
// Returns { date, amount, checkNumber } — the best match from the text
function parseCheckText(fullText) {
    var match;

    // === DATE: find the check date (DD/MM/YYYY) ===
    // Israeli checks have the date near the top. Pick the first valid future/recent date.
    var datePattern = /(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](20\d{2}|\d{2})/g;
    var bestDate = '';
    while ((match = datePattern.exec(fullText)) !== null) {
        var day = match[1].padStart(2, '0');
        var month = match[2].padStart(2, '0');
        var year = match[3].length === 2 ? '20' + match[3] : match[3];
        var d = parseInt(day), m = parseInt(month), y = parseInt(year);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2024 && y <= 2030) {
            bestDate = year + '-' + month + '-' + day;
            break; // Take the first valid date (usually the check date at the top)
        }
    }

    // === AMOUNT: find the check amount ===
    // Priority 1: amount between asterisks (***1,500.00***) — standard Israeli check format
    var bestAmount = 0;

    var asteriskPattern = /\*{1,3}\s*([\d,]+\.?\d{0,2})\s*\*{1,3}/g;
    while ((match = asteriskPattern.exec(fullText)) !== null) {
        var val = parseFloat(match[1].replace(/,/g, ''));
        if (val > 0 && val < 10000000) {
            bestAmount = val;
            break;
        }
    }

    // Priority 2: amount near ש"ח / ₪
    if (bestAmount === 0) {
        var shekelPattern = /(\d[\d,]*\.?\d{0,2})\s*(?:ש"ח|₪|שקל|ש״ח)/g;
        while ((match = shekelPattern.exec(fullText)) !== null) {
            var val2 = parseFloat(match[1].replace(/,/g, ''));
            if (val2 >= 100 && val2 < 10000000) {
                bestAmount = val2;
                break;
            }
        }
    }

    // Priority 3: amount near "סכום" / "סך"
    if (bestAmount === 0) {
        var sumPattern = /(?:סכום|סך|sum|amount)[^\d]*([\d,]+\.?\d{0,2})/gi;
        while ((match = sumPattern.exec(fullText)) !== null) {
            var val3 = parseFloat(match[1].replace(/,/g, ''));
            if (val3 >= 100 && val3 < 10000000) {
                bestAmount = val3;
                break;
            }
        }
    }

    // Priority 4: largest number that looks like a reasonable check amount (500-10M)
    if (bestAmount === 0) {
        var numberPattern = /(?:^|[\s\*])(\d{1,3}(?:,\d{3})*\.?\d{0,2})(?:[\s\*]|$)/gm;
        var candidates = [];
        while ((match = numberPattern.exec(fullText)) !== null) {
            var val4 = parseFloat(match[1].replace(/,/g, ''));
            if (val4 >= 500 && val4 < 10000000) candidates.push(val4);
        }
        if (candidates.length > 0) {
            // Take the largest — usually the check amount is the biggest number
            bestAmount = Math.max.apply(null, candidates);
        }
    }

    // Return single check or empty
    if (!bestDate && bestAmount === 0) {
        return { checks: [], rawText: fullText };
    }

    return {
        checks: [{
            date: bestDate,
            amount: bestAmount,
            index: 1
        }],
        rawText: fullText
    };
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
        var mimeType = body.mimeType || 'image/jpeg';

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
            return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Vision API error', details: visionRes.data }) };
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
        console.log('OCR raw text:', fullText);

        // Parse the check data
        var result = parseCheckText(fullText);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                checks: result.checks,
                rawText: result.rawText
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
