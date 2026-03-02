// Netlify Function: Reset user password (master only)
// Uses Firebase Admin REST API to update password directly

const https = require('https');

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

// Exchange Google OAuth2 refresh token for access token
async function getAccessToken(refreshToken) {
    const postData = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com&client_secret=j9iVZfS8kkCEFUPaAeJV0sAi`;
    const res = await httpRequest({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    if (res.status !== 200) throw new Error('Token exchange failed');
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
    const accessToken = await getAccessToken(process.env.FIREBASE_REFRESH_TOKEN);
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
    // Allow same-site requests (Netlify) and localhost for dev
    if (origin.endsWith('.netlify.app') || origin.startsWith('http://localhost')) {
        return origin;
    }
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
