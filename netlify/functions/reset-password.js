// Netlify Function: Reset user password (master only)
// Uses Firebase Admin REST API to update password directly

const https = require('https');
const crypto = require('crypto');

const PROJECT_ID = 'law-office-sales-form';

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

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mint a Google access token from the Firebase service account (cloud-platform = Firestore + Identity Toolkit).
// (Was refresh-token based, but GOOGLE_CLIENT_SECRET + FIREBASE_REFRESH_TOKEN are not configured on the site.)
async function getAccessToken() {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const key = sa.private_key.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const claim = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    });
    const sig = crypto.createSign('RSA-SHA256').update(claim).sign(key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const post = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + claim + '.' + sig;
    const res = await httpRequest({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(post) }
    }, post);
    if (res.status !== 200 || !res.data.access_token) throw new Error('SA token exchange failed');
    return res.data.access_token;
}

// Verify the caller is a master user
async function verifyMaster(idToken) {
    // Verify the ID token and get the UID
    const verifyRes = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ idToken }));

    if (verifyRes.status !== 200 || !verifyRes.data.users || !verifyRes.data.users[0]) {
        throw new Error('Invalid token');
    }

    const uid = verifyRes.data.users[0].localId;

    // Check user role in Firestore
    const accessToken = await getAccessToken();
    const userDoc = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (userDoc.status !== 200) throw new Error('User doc not found');

    const role = userDoc.data.fields?.role?.stringValue;
    const isActive = userDoc.data.fields?.isActive?.booleanValue;

    if (role !== 'master' || !isActive) {
        throw new Error('Not authorized');
    }

    return { uid, accessToken };
}

function getCorsOrigin(event) {
    const origin = event.headers.origin || event.headers.Origin || '';
    // Only THIS site (prod + draft deploys) and localhost dev — NOT any *.netlify.app
    if (/^https:\/\/([a-z0-9-]+--)?helpful-licorice-ac11ba\.netlify\.app$/.test(origin)) return origin;
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
    return '';
}

exports.handler = async (event) => {
    const allowedOrigin = getCorsOrigin(event);

    // CORS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST' } };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    try {
        // Get authorization header
        const authHeader = event.headers.authorization || event.headers.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token' }) };
        }
        const idToken = authHeader.substring(7);

        // Parse body
        const { targetUid, newPassword } = JSON.parse(event.body);
        if (!targetUid || !newPassword || newPassword.length < 6 || newPassword.length > 128) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid parameters' }) };
        }

        // Verify caller is master
        const { accessToken } = await verifyMaster(idToken);

        // Update password via Identity Toolkit Admin API
        const updateData = JSON.stringify({
            localId: targetUid,
            password: newPassword
        });

        const updateRes = await httpRequest({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/accounts:update`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Length': Buffer.byteLength(updateData)
            }
        }, updateData);

        if (updateRes.status === 200) {
            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true })
            };
        } else {
            return {
                statusCode: 500,
                headers: { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'שגיאה בעדכון סיסמה' })
            };
        }

    } catch (err) {
        return {
            statusCode: err.message === 'Not authorized' ? 403 : 500,
            headers: { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message === 'Not authorized' ? 'Not authorized' : 'שגיאה בשרת' })
        };
    }
};
