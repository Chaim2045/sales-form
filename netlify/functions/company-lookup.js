// Netlify Function: Company lookup from Israeli Registrar of Companies (רשות התאגידים)
// Proxies requests to data.gov.il API (no CORS support on their end)

const https = require('https');

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
                'Access-Control-Allow-Headers': 'Content-Type',
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
