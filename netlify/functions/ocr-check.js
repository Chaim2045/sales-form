// Netlify Function: OCR check reading
// Google Vision API for text extraction + Claude API for intelligent parsing

const https = require('https');
const { parseChecksDeterministic } = require('./lib/parse-checks'); // פענוח שיקים דטרמיניסטי (regex, בלי AI/טוקן/עלות)

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

// פענוח השיקים עבר לקוד דטרמיניסטי (lib/parse-checks.js) — בלי AI/טוקן/עלות.
// (הוסרה parseChecksWithClaude שהשתמשה ב-ANTHROPIC_API_KEY.)

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
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 10 }],
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
            var r0 = responses && responses[0];
            if (!r0 || (!r0.fullTextAnnotation && !(r0.textAnnotations && r0.textAnnotations[0]))) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, checks: [], rawText: '' }) };
            }

            // DOCUMENT_TEXT_DETECTION → fullTextAnnotation עשיר (קורא את קוד-ה-MICR/פרטי-הבנק); נפילה אחורה ל-textAnnotations
            fullText = (r0.fullTextAnnotation && r0.fullTextAnnotation.text) || (r0.textAnnotations && r0.textAnnotations[0] && r0.textAnnotations[0].description) || '';

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

        // Parse all checks deterministically (regex/heuristics — no AI, no token, no cost)
        var parsedChecks = parseChecksDeterministic(fullText);
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
