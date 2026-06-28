// Netlify Function: Remove a user (master only).
// Disables the Auth account (can't log in) + deletes the Firestore user doc (gone from the list).
// Guards: caller must be an active master; cannot remove self; cannot remove the last active master.
// Mirrors reset-password.js (same getAccessToken / verifyMaster pattern).

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

async function getAccessToken(refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientSecret) throw new Error('Server configuration error');
    const postData = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    const res = await httpRequest({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    if (res.status !== 200) throw new Error('Token exchange failed');
    return res.data.access_token;
}

async function verifyMaster(idToken) {
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
    if (role !== 'master' || !isActive) throw new Error('Not authorized'); // fail-closed: missing isActive => not authorized

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
    const baseHeaders = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST' } };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    try {
        const authHeader = event.headers.authorization || event.headers.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { statusCode: 401, headers: baseHeaders, body: JSON.stringify({ error: 'Missing auth token' }) };
        }
        const idToken = authHeader.substring(7);

        const body = JSON.parse(event.body || '{}');
        const targetUid = body.targetUid;
        if (!targetUid || typeof targetUid !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(targetUid)) {
            return { statusCode: 400, headers: baseHeaders, body: JSON.stringify({ error: 'Invalid parameters' }) };
        }

        const { uid: callerUid, accessToken } = await verifyMaster(idToken);

        // Guard: no self-removal
        if (targetUid === callerUid) {
            return { statusCode: 400, headers: baseHeaders, body: JSON.stringify({ error: 'אי אפשר למחוק את המשתמש שלך' }) };
        }

        // Guard: don't remove the last active master
        const targetDoc = await httpRequest({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${targetUid}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (targetDoc.status === 200 && targetDoc.data.fields?.role?.stringValue === 'master') {
            const list = await httpRequest({
                hostname: 'firestore.googleapis.com',
                path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users?pageSize=300`,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const otherMasters = ((list.data && list.data.documents) || []).filter(function (d) {
                const id = d.name.split('/').pop();
                const r = d.fields?.role?.stringValue;
                const a = d.fields?.isActive?.booleanValue;
                return id !== targetUid && r === 'master' && a !== false;
            });
            if (otherMasters.length === 0) {
                return { statusCode: 400, headers: baseHeaders, body: JSON.stringify({ error: 'לא ניתן למחוק את המנהל האחרון' }) };
            }
        }

        // 1) Disable the Auth account (can no longer log in)
        const disableData = JSON.stringify({ localId: targetUid, disableUser: true });
        const disableRes = await httpRequest({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/accounts:update`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'Content-Length': Buffer.byteLength(disableData) }
        }, disableData);
        if (disableRes.status !== 200) {
            return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: 'שגיאה בהשבתת חשבון הכניסה' }) };
        }

        // 2) Delete the Firestore user doc (removes from the list)
        const delRes = await httpRequest({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${targetUid}`,
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (delRes.status !== 200 && delRes.status !== 204) {
            return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: 'החשבון הושבת אך מחיקת הרשומה נכשלה' }) };
        }

        // Server-side audit trail (tamper-resistant — written with owner privileges, not the client)
        try {
            const auditData = JSON.stringify({ fields: {
                action: { stringValue: 'user_removed' },
                performedByUid: { stringValue: callerUid },
                targetUid: { stringValue: targetUid },
                source: { stringValue: 'delete-user-function' },
                clientTimestamp: { timestampValue: new Date().toISOString() }
            } });
            await httpRequest({
                hostname: 'firestore.googleapis.com',
                path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/audit_log`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'Content-Length': Buffer.byteLength(auditData) }
            }, auditData);
        } catch (e) { /* audit logging must never fail the operation */ }

        return { statusCode: 200, headers: baseHeaders, body: JSON.stringify({ success: true }) };

    } catch (err) {
        return {
            statusCode: err.message === 'Not authorized' ? 403 : 500,
            headers: baseHeaders,
            body: JSON.stringify({ error: err.message === 'Not authorized' ? 'Not authorized' : 'שגיאה בשרת' })
        };
    }
};
