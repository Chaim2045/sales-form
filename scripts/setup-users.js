/**
 * Setup Users Script (one-time)
 * Creates/updates Firebase Auth accounts and Firestore user documents
 * Run: node scripts/setup-users.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ───
const PROJECT_ID = 'law-office-sales-form';
const API_KEY = 'AIzaSyAkRGg1HUaJhimwIhRir7wQ0vrZRUuqIy8';

// Users to create/update
const USERS = [
    {
        displayName: 'חיים',
        email: 'haim@ghlawoffice.co.il',
        password: 'Haim2024!',
        role: 'master',
        permissions: {
            salesForm: true,
            billingManagement: true,
            salesManagement: true,
            activityLog: true,
            userManagement: true
        }
    },
    {
        displayName: 'גיא הרשקוביץ',
        email: 'guy@ghlawoffice.co.il',
        password: 'Guy2024!',
        role: 'office_manager',
        permissions: {
            salesForm: true,
            billingManagement: true,
            salesManagement: true,
            activityLog: false,
            userManagement: false
        }
    },
    {
        displayName: 'מירי טל',
        email: 'miri@ghlawoffice.co.il',
        password: 'Miri2024!',
        role: 'office_manager',
        permissions: {
            salesForm: true,
            billingManagement: true,
            salesManagement: true,
            activityLog: false,
            userManagement: false
        }
    },
    {
        displayName: 'רועי הרשקוביץ',
        email: 'roi@ghlawoffice.co.il',
        password: 'Roi2024!',
        role: 'salesperson',
        permissions: {
            salesForm: true,
            billingManagement: false,
            salesManagement: true,
            activityLog: false,
            userManagement: false
        }
    },
    {
        displayName: 'אורי שטיינברג',
        email: 'ori@ghlawoffice.co.il',
        password: 'Ori2024!',
        role: 'salesperson',
        permissions: {
            salesForm: true,
            billingManagement: false,
            salesManagement: true,
            activityLog: false,
            userManagement: false
        }
    }
];

// ─── Helper: HTTP Request ───
function httpRequest(options, data) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

// ─── Get Access Token from Firebase CLI refresh token ───
async function getAccessToken() {
    const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    let refreshToken = config.tokens?.refresh_token || config.user?.tokens?.refresh_token;

    if (!refreshToken) throw new Error('No Firebase CLI refresh token found. Run: firebase login');

    const postData = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com&client_secret=j9iVZfS8kkCEFUPaAeJV0sAi`;

    const res = await httpRequest({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);

    if (res.status !== 200) throw new Error('Token exchange failed: ' + JSON.stringify(res.data));
    return res.data.access_token;
}

// ─── List existing Firebase Auth users ───
async function listAuthUsers(accessToken) {
    const res = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=100`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    return res.data.users || [];
}

// ─── Create or Update Firebase Auth user ───
async function createOrUpdateAuthUser(accessToken, user, existingUsers) {
    const existing = existingUsers.find(u => u.email === user.email);

    if (existing) {
        // Update existing user password
        const updateData = JSON.stringify({
            localId: existing.localId,
            password: user.password,
            displayName: user.displayName
        });

        const res = await httpRequest({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/accounts:update`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Length': Buffer.byteLength(updateData)
            }
        }, updateData);

        if (res.status === 200) {
            console.log(`  ✓ Updated auth: ${user.email} (uid: ${existing.localId})`);
            return existing.localId;
        } else {
            console.error(`  ✗ Failed to update ${user.email}:`, res.data);
            return null;
        }
    } else {
        // Create new user
        const createData = JSON.stringify({
            email: user.email,
            password: user.password,
            displayName: user.displayName,
            emailVerified: true
        });

        const res = await httpRequest({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/accounts`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Length': Buffer.byteLength(createData)
            }
        }, createData);

        if (res.status === 200 && res.data.localId) {
            console.log(`  ✓ Created auth: ${user.email} (uid: ${res.data.localId})`);
            return res.data.localId;
        } else {
            console.error(`  ✗ Failed to create ${user.email}:`, res.data);
            return null;
        }
    }
}

// ─── Write Firestore document ───
async function writeFirestoreDoc(accessToken, collection, docId, fields) {
    // Convert JS object to Firestore REST format
    function toFirestoreValue(val) {
        if (val === null || val === undefined) return { nullValue: null };
        if (typeof val === 'boolean') return { booleanValue: val };
        if (typeof val === 'number') return { integerValue: String(val) };
        if (typeof val === 'string') return { stringValue: val };
        if (val instanceof Date) return { timestampValue: val.toISOString() };
        if (typeof val === 'object' && !Array.isArray(val)) {
            const mapFields = {};
            for (const [k, v] of Object.entries(val)) {
                mapFields[k] = toFirestoreValue(v);
            }
            return { mapValue: { fields: mapFields } };
        }
        if (Array.isArray(val)) {
            return { arrayValue: { values: val.map(toFirestoreValue) } };
        }
        return { stringValue: String(val) };
    }

    const firestoreFields = {};
    for (const [k, v] of Object.entries(fields)) {
        firestoreFields[k] = toFirestoreValue(v);
    }

    const body = JSON.stringify({ fields: firestoreFields });

    const res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}?updateMask.fieldPaths=${Object.keys(fields).join('&updateMask.fieldPaths=')}`,
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'Content-Length': Buffer.byteLength(body)
        }
    }, body);

    return res.status === 200;
}

// ─── Main ───
async function main() {
    console.log('═══ Setup Users for Law Office System ═══\n');

    // Get access token
    console.log('1. Getting access token...');
    const accessToken = await getAccessToken();
    console.log('   ✓ Got access token\n');

    // List existing auth users
    console.log('2. Listing existing Firebase Auth users...');
    const existingUsers = await listAuthUsers(accessToken);
    console.log(`   Found ${existingUsers.length} existing users\n`);

    // Process each user
    console.log('3. Creating/updating users...\n');
    const results = [];

    for (const user of USERS) {
        console.log(`── ${user.displayName} (${user.email}) ──`);

        // Create/update Firebase Auth
        const uid = await createOrUpdateAuthUser(accessToken, user, existingUsers);
        if (!uid) {
            console.log('   Skipping Firestore docs due to auth failure\n');
            continue;
        }

        // Write users/{uid} document
        const userDoc = {
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
            isActive: true,
            createdAt: new Date()
        };
        const usersOk = await writeFirestoreDoc(accessToken, 'users', uid, userDoc);
        console.log(usersOk ? '  ✓ Written users/' + uid : '  ✗ Failed users/' + uid);

        // Write public_users/{uid} document
        const publicDoc = {
            displayName: user.displayName,
            email: user.email
        };
        const publicOk = await writeFirestoreDoc(accessToken, 'public_users', uid, publicDoc);
        console.log(publicOk ? '  ✓ Written public_users/' + uid : '  ✗ Failed public_users/' + uid);

        results.push({ name: user.displayName, email: user.email, password: user.password, uid, role: user.role });
        console.log('');
    }

    // Summary
    console.log('\n═══ Summary ═══\n');
    console.log('User Credentials (SAVE THESE!):');
    console.log('─'.repeat(60));
    results.forEach(r => {
        console.log(`  ${r.name}`);
        console.log(`    Email:    ${r.email}`);
        console.log(`    Password: ${r.password}`);
        console.log(`    Role:     ${r.role}`);
        console.log(`    UID:      ${r.uid}`);
        console.log('');
    });
    console.log('─'.repeat(60));
    console.log('\nDone! Now deploy Firestore rules and update the app code.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
