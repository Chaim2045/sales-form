// Netlify Function: Send SMS via Twilio (master only)
// Uses Twilio REST API directly (no npm packages)

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

    if (role !== 'master' || !isActive) {
        throw new Error('Not authorized');
    }

    return { uid, accessToken };
}

// Format Israeli phone to international format
function formatPhoneToInternational(phone) {
    // Remove all non-digits
    let digits = phone.replace(/\D/g, '');
    // Israeli mobile: 05X -> +972-5X
    if (digits.startsWith('0')) {
        digits = '972' + digits.substring(1);
    }
    // If already starts with 972
    if (!digits.startsWith('972')) {
        digits = '972' + digits;
    }
    return '+' + digits;
}

exports.handler = async (event) => {
    // CORS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST' } };
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
        const { phone, displayName, password, appUrl } = JSON.parse(event.body);
        if (!phone || !displayName || !password) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
        }

        // Verify caller is master
        await verifyMaster(idToken);

        // Check Twilio config
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;

        if (!accountSid || !authToken || !fromNumber) {
            return {
                statusCode: 500,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'SMS service not configured' })
            };
        }

        // Format phone number
        const toNumber = formatPhoneToInternational(phone);

        // Build SMS message
        const message = `שלום ${displayName}, קיבלת גישה למערכת המשרד.\nסיסמה: ${password}\nכניסה: ${appUrl || 'https://tofes.netlify.app'}`;

        // Send SMS via Twilio REST API
        const twilioData = `To=${encodeURIComponent(toNumber)}&From=${encodeURIComponent(fromNumber)}&Body=${encodeURIComponent(message)}`;
        const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        const smsRes = await httpRequest({
            hostname: 'api.twilio.com',
            path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${twilioAuth}`,
                'Content-Length': Buffer.byteLength(twilioData)
            }
        }, twilioData);

        if (smsRes.status === 201 || smsRes.status === 200) {
            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, sid: smsRes.data.sid })
            };
        } else {
            return {
                statusCode: 500,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'SMS send failed', details: smsRes.data })
            };
        }

    } catch (err) {
        return {
            statusCode: err.message === 'Not authorized' ? 403 : 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message })
        };
    }
};
