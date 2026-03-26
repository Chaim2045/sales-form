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
// Tuned for real OCR output from scanned Israeli bank checks
function parseCheckText(fullText) {
    var match;

    // === DATE ===
    // OCR reads handwritten dates near DATE/תאריך in various broken formats:
    // "304 26" (30/4/26), "30626" (30/6/26), "3826" (30/8/26), "30.9.26"
    var bestDate = '';

    // Find the area near DATE/תאריך
    var dateAreaMatch = fullText.match(/(?:DATE|תאריך)[\s\S]{0,5}/i);
    var dateSearchArea = '';
    if (dateAreaMatch) {
        // Search 60 chars before DATE keyword (date is written above it)
        var dateIdx = fullText.indexOf(dateAreaMatch[0]);
        var startIdx = Math.max(0, dateIdx - 60);
        dateSearchArea = fullText.substring(startIdx, dateIdx + 20);
    }

    // Pattern 1: clean format DD.MM.YY or DD/MM/YY
    var cleanDatePattern = /(\d{1,2})\s*[\.\/-]\s*(\d{1,2})\s*[\.\/-]\s*(\d{2,4})/g;
    var searchIn = dateSearchArea || fullText;
    while ((match = cleanDatePattern.exec(searchIn)) !== null) {
        var day = match[1], month = match[2], year = match[3];
        if (year.length === 2) year = '20' + year;
        var d = parseInt(day), m = parseInt(month), y = parseInt(year);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2024 && y <= 2030) {
            bestDate = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
            break;
        }
    }

    // Pattern 2: digits smashed together near DATE — e.g., "304 26" or "30626" or "3826"
    if (!bestDate && dateSearchArea) {
        // Look for 3-6 digit sequences near DATE
        var smashedPattern = /(\d{3,6})\s*(\d{2})?/g;
        while ((match = smashedPattern.exec(dateSearchArea)) !== null) {
            var digits = match[1] + (match[2] || '');
            var parsed = parseSmashedDate(digits);
            if (parsed) {
                bestDate = parsed;
                break;
            }
        }
    }

    // === AMOUNT ===
    // OCR reads amounts as: "8,850", "$8,850", "18,850", "8.850", "18.850"
    // The actual amount has comma or dot as thousands separator
    var bestAmount = 0;

    // Collect all numbers with comma or dot thousands separator (X,XXX or X.XXX)
    var amountPattern = /[\$₪]?\s*[1]?(\d{1,3}[,\.]\d{3}(?:\.\d{1,2})?)/g;
    var amountCandidates = [];
    while ((match = amountPattern.exec(fullText)) !== null) {
        // Remove leading 1 that OCR sometimes adds, and normalize separators
        var numStr = match[1].replace(/\./g, ','); // normalize dots to commas
        var val = parseFloat(numStr.replace(/,/g, ''));
        if (val >= 100 && val < 10000000) {
            amountCandidates.push(val);
        }
    }

    if (amountCandidates.length > 0) {
        // Find the most common amount (the real amount appears multiple times on a check)
        var counts = {};
        amountCandidates.forEach(function(v) {
            counts[v] = (counts[v] || 0) + 1;
        });
        var sorted = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
        bestAmount = parseFloat(sorted[0]);
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

// Parse smashed date digits: "30426" → 30/4/26, "30626" → 30/6/26, "3826" → 30/8/26 (dropped 0)
function parseSmashedDate(digits) {
    // Try different splits for DD M YY or DD MM YY
    var attempts = [];

    if (digits.length === 5) {
        // DDMYY: e.g., "30426" → 30, 4, 26
        attempts.push({ d: digits.substr(0, 2), m: digits.substr(2, 1), y: digits.substr(3, 2) });
        // DMMYY: e.g., "3 04 26" unlikely but try
        attempts.push({ d: digits.substr(0, 1), m: digits.substr(1, 2), y: digits.substr(3, 2) });
    } else if (digits.length === 6) {
        // DDMMYY: e.g., "300426"
        attempts.push({ d: digits.substr(0, 2), m: digits.substr(2, 2), y: digits.substr(4, 2) });
    } else if (digits.length === 4) {
        // DMYY: e.g., "3826" → could be 3/8/26 or 30/8/26 (dropped 0)
        attempts.push({ d: digits.substr(0, 1), m: digits.substr(1, 1), y: digits.substr(2, 2) });
        // Try with leading 30: "3826" → 30, 8, 26 (OCR dropped the 0 from 30)
        attempts.push({ d: '30', m: digits.substr(1, 1), y: digits.substr(2, 2) });
        attempts.push({ d: digits.substr(0, 2), m: digits.substr(2, 1), y: '2' + digits.substr(3, 1) });
    } else if (digits.length === 3) {
        // MYY or DMY: e.g., "426" → 4/26? unlikely, skip
    }

    for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        var d = parseInt(a.d), m = parseInt(a.m), y = parseInt(a.y.length === 2 ? '20' + a.y : a.y);
        if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2024 && y <= 2030) {
            return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        }
    }
    return null;
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
