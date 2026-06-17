// Netlify Function: Company lookup from Israeli Registrar of Companies (רשות התאגידים)
// Proxies requests to data.gov.il API (no CORS support on their end)

const https = require('https');
const crypto = require('crypto');

// ── אבטחה (U4): אימות Firebase ID token — verify מקומי מול מפתחות Google הציבוריים (בלי round-trip/עלות) ──
const PROJECT_ID = 'law-office-sales-form';
let _fbKeys = null, _fbKeysExp = 0;
function b64url(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
async function getFbKeys() {
    if (_fbKeys && Date.now() < _fbKeysExp) return _fbKeys;
    var r = await httpsGet('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    _fbKeys = r.data; _fbKeysExp = Date.now() + 3600000;
    return _fbKeys;
}
async function verifyToken(idToken) {
    var p = String(idToken || '').split('.');
    if (p.length !== 3) throw new Error('auth bad-format');
    var head = JSON.parse(b64url(p[0]).toString());
    var body = JSON.parse(b64url(p[1]).toString());
    if (head.alg !== 'RS256') throw new Error('auth bad-alg');
    var keys = await getFbKeys();
    var cert = keys[head.kid];
    if (!cert) throw new Error('auth unknown-kid');
    var v = crypto.createVerify('RSA-SHA256');
    v.update(p[0] + '.' + p[1]);
    if (!v.verify(cert, b64url(p[2]))) throw new Error('auth bad-signature');
    var now = Math.floor(Date.now() / 1000);
    if (body.exp <= now) throw new Error('auth expired');
    if (body.aud !== PROJECT_ID) throw new Error('auth wrong-project');
    if (body.iss !== 'https://securetoken.google.com/' + PROJECT_ID) throw new Error('auth wrong-issuer');
    if (!body.sub) throw new Error('auth no-uid');
    return { uid: body.sub };
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'LawOffice/1.0' } }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, data: body }); }
            });
        }).on('error', reject);
    });
}

function getCorsOrigin(event) {
    var origin = event.headers.origin || event.headers.Origin || '';
    if (origin.endsWith('.netlify.app') || origin.startsWith('http://localhost')) {
        return origin;
    }
    return '';
}

function extractCompanyData(record) {
    var data = {
        companyName: (record['שם חברה'] || '').trim(),
        companyNameEn: (record['שם באנגלית'] || '').trim(),
        companyNumber: (record['מספר חברה'] || '').toString().trim(),
        status: (record['סטטוס חברה'] || '').trim(),
        companyType: (record['סוג תאגיד'] || '').trim(),
        registrationDate: (record['תאריך התאגדות'] || '').trim(),
        city: (record['שם עיר'] || '').trim(),
        street: (record['שם רחוב'] || '').trim(),
        houseNumber: (record['מספר בית'] || '').toString().trim(),
        zipCode: (record['מיקוד'] || '').toString().trim(),
        purpose: (record['מטרת החברה'] || '').trim()
    };

    // Build full address
    var addressParts = [];
    if (data.street) {
        addressParts.push(data.street);
        if (data.houseNumber) addressParts.push(data.houseNumber);
    }
    if (data.city) addressParts.push(data.city);
    data.fullAddress = addressParts.join(' ');

    return data;
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
                'Access-Control-Allow-Methods': 'GET'
            }
        };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    var corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Content-Type': 'application/json'
    };

    // אבטחה (U4): דרישת אימות — בלי token תקין של משתמש מחובר → 401 (סוגר את ה-proxy האנונימי)
    var authHeader = event.headers.authorization || event.headers.Authorization || '';
    if (authHeader.indexOf('Bearer ') !== 0) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Missing token' }) };
    }
    try {
        await verifyToken(authHeader.substring(7));
    } catch (e) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    try {
        var params = event.queryStringParameters || {};
        var companyNumber = params.q;
        var companyName = params.name;
        var mode = companyNumber ? 'number' : (companyName ? 'name' : null);

        if (!mode) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing query parameter: q (number) or name' }) };
        }

        var resourceId = 'f004176c-b85f-4542-8901-7b3176f9a054';

        if (mode === 'number') {
            // === Search by company number (ח.פ.) ===
            companyNumber = companyNumber.replace(/\D/g, '');
            if (companyNumber.length < 5 || companyNumber.length > 9) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid company number length' }) };
            }

            var apiUrl = 'https://data.gov.il/api/3/action/datastore_search'
                + '?resource_id=' + resourceId
                + '&q=' + encodeURIComponent(companyNumber)
                + '&limit=5';

            var result = await httpsGet(apiUrl);

            if (result.status !== 200 || !result.data.success) {
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'data.gov.il API error' }) };
            }

            var records = result.data.result.records || [];

            // Find exact match by company number
            var match = records.find(function(r) {
                var num = String(r['מספר חברה'] || '').replace(/\D/g, '');
                return num === companyNumber;
            });

            if (!match) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ found: false }) };
            }

            var companyData = extractCompanyData(match);
            companyData.found = true;

            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(companyData) };

        } else {
            // === Search by company name ===
            companyName = companyName.trim();
            if (companyName.length < 2) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Name too short' }) };
            }

            var apiUrl = 'https://data.gov.il/api/3/action/datastore_search'
                + '?resource_id=' + resourceId
                + '&q=' + encodeURIComponent(companyName)
                + '&limit=10';

            var result = await httpsGet(apiUrl);

            if (result.status !== 200 || !result.data.success) {
                return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'data.gov.il API error' }) };
            }

            var records = result.data.result.records || [];

            // Filter to only active companies and extract data
            var results = records
                .filter(function(r) {
                    var name = (r['שם חברה'] || '').trim();
                    return name.length > 0;
                })
                .map(function(r) { return extractCompanyData(r); })
                .slice(0, 8);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ results: results })
            };
        }

    } catch (err) {
        console.error('Company lookup error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: err.message || 'Internal error' })
        };
    }
};
