// Deduplicate leads in Firestore — keeps best record per phone, deletes rest
// Usage: node scripts/dedupe-leads.js [--dry-run] [--limit=N]

var https = require('https');
var API_KEY = 'AIzaSyAkRGg1HUaJhimwIhRir7wQ0vrZRUuqIy8';
var PROJECT_ID = 'law-office-sales-form';
var AUTH_EMAIL = 'haim@ghlawoffice.co.il';
var AUTH_PASSWORD = process.env.FIREBASE_AUTH_PASSWORD || '';
var authToken = null;

// Status priority — higher = better (we keep the best)
var STATUS_PRIORITY = {
    'closed': 6,
    'contacted': 5,
    'followup': 4,
    'assigned': 3,
    'no_answer': 2,
    'new': 1,
    'not_relevant': 0
};

// Spam names to auto-delete
var SPAM_NAMES = ['pHqghUme', 'RDFYjolf', 'acunetix', 'testing', '${', 'javascript:', '<script'];

function httpReq(opts, data) {
    return new Promise(function(resolve, reject) {
        var req = https.request(opts, function(res) {
            var body = '';
            res.on('data', function(d) { body += d; });
            res.on('end', function() { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch(e) { resolve({ status: res.statusCode, data: body }); } });
        });
        req.on('error', reject);
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

function normalizePhone(p) {
    if (!p) return '';
    var d = p.replace(/[\s\-()]/g, '');
    if (d.startsWith('972')) d = '0' + d.substring(3);
    if (d.length === 9 && d.startsWith('5')) d = '0' + d;
    return d;
}

async function authenticate() {
    if (!AUTH_PASSWORD) {
        console.error('Usage: FIREBASE_AUTH_PASSWORD=xxx node scripts/dedupe-leads.js');
        process.exit(1);
    }
    var postData = JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD, returnSecureToken: true });
    var res = await httpReq({
        hostname: 'identitytoolkit.googleapis.com',
        path: '/v1/accounts:signInWithPassword?key=' + API_KEY,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, postData);
    if (res.status !== 200) { console.error('Auth failed'); process.exit(1); }
    authToken = res.data.idToken;
    console.log('Authenticated');
}

async function loadAllLeads() {
    var allLeads = [];
    var nextPageToken = '';

    for (var page = 0; page < 100; page++) {
        var path = '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/leads?key=' + API_KEY + '&pageSize=300';
        if (nextPageToken) path += '&pageToken=' + encodeURIComponent(nextPageToken);

        var res = await httpReq({
            hostname: 'firestore.googleapis.com',
            path: path,
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });

        if (res.status !== 200 || !res.data.documents) break;

        res.data.documents.forEach(function(doc) {
            var f = doc.fields || {};
            allLeads.push({
                id: doc.name.split('/').pop(),
                fullPath: doc.name,
                phone: normalizePhone(f.phone ? f.phone.stringValue : ''),
                name: f.name ? f.name.stringValue : '',
                status: f.status ? f.status.stringValue : 'new',
                source: f.source ? f.source.stringValue : '',
                assignedTo: f.assignedTo ? f.assignedTo.stringValue : '',
                imported: f.importedFromCRM ? f.importedFromCRM.booleanValue : false,
                created: f.createdAt ? (f.createdAt.timestampValue || '') : '',
                aiScore: f.aiScore ? (parseInt(f.aiScore.integerValue) || 0) : 0
            });
        });

        if (page % 10 === 0) console.log('Loading... ' + allLeads.length + ' leads');
        if (!res.data.nextPageToken) break;
        nextPageToken = res.data.nextPageToken;
    }

    return allLeads;
}

async function deleteDoc(docId) {
    var res = await httpReq({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/leads/' + docId + '?key=' + API_KEY,
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + authToken }
    });
    return res.status === 200 || res.status === 204;
}

// Pick the best record from a group of duplicates
function pickBest(records) {
    return records.sort(function(a, b) {
        // 1. Status priority (closed > contacted > ... > not_relevant)
        var sa = STATUS_PRIORITY[a.status] || 0;
        var sb = STATUS_PRIORITY[b.status] || 0;
        if (sa !== sb) return sb - sa;

        // 2. Has name > no name
        var na = a.name && !/^\d+$/.test(a.name) ? 1 : 0;
        var nb = b.name && !/^\d+$/.test(b.name) ? 1 : 0;
        if (na !== nb) return nb - na;

        // 3. Has assignee > no assignee
        var aa = a.assignedTo ? 1 : 0;
        var ab = b.assignedTo ? 1 : 0;
        if (aa !== ab) return ab - aa;

        // 4. AI score
        if (a.aiScore !== b.aiScore) return b.aiScore - a.aiScore;

        // 5. Newer is better
        return (b.created || '').localeCompare(a.created || '');
    })[0];
}

async function main() {
    var args = process.argv.slice(2);
    var dryRun = args.includes('--dry-run');
    var limitArg = args.find(function(a) { return a.startsWith('--limit='); });
    var limit = limitArg ? parseInt(limitArg.split('=')[1]) : 0;

    await authenticate();
    console.log('Loading all leads...');
    var allLeads = await loadAllLeads();
    console.log('Total leads: ' + allLeads.length);

    // 1. Find spam
    var spamLeads = allLeads.filter(function(l) {
        return SPAM_NAMES.some(function(s) { return (l.name || '').includes(s); });
    });
    console.log('\nSpam leads found: ' + spamLeads.length);

    // 2. Find duplicates by phone
    var phoneMap = {};
    allLeads.forEach(function(l) {
        if (!l.phone || l.phone.length < 7) return;
        if (spamLeads.some(function(s) { return s.id === l.id; })) return;
        if (!phoneMap[l.phone]) phoneMap[l.phone] = [];
        phoneMap[l.phone].push(l);
    });

    var dupeGroups = Object.entries(phoneMap).filter(function(e) { return e[1].length > 1; });
    console.log('Duplicate phone groups: ' + dupeGroups.length);

    // 3. Determine which to keep and which to delete
    var toDelete = [];

    // Spam → all delete
    spamLeads.forEach(function(l) { toDelete.push({ id: l.id, reason: 'spam: ' + l.name }); });

    // Duplicates → keep best, delete rest
    dupeGroups.forEach(function(entry) {
        var phone = entry[0];
        var records = entry[1];
        var best = pickBest(records);
        records.forEach(function(r) {
            if (r.id !== best.id) {
                toDelete.push({ id: r.id, reason: 'dup ' + phone + ' (keeping ' + (best.name || best.id).substring(0, 20) + ')' });
            }
        });
    });

    console.log('\nTotal to delete: ' + toDelete.length);
    console.log('  Spam: ' + spamLeads.length);
    console.log('  Duplicates: ' + (toDelete.length - spamLeads.length));
    console.log('  Remaining after cleanup: ' + (allLeads.length - toDelete.length));

    if (dryRun) {
        console.log('\n--- DRY RUN — no changes made ---');
        console.log('Sample deletions:');
        toDelete.slice(0, 20).forEach(function(d) { console.log('  DELETE ' + d.id + ' — ' + d.reason); });
        return;
    }

    // Execute deletions
    var toProcess = limit > 0 ? toDelete.slice(0, limit) : toDelete;
    console.log('\nDeleting ' + toProcess.length + ' records...');

    var success = 0, failed = 0;
    var BATCH = 10;
    for (var i = 0; i < toProcess.length; i += BATCH) {
        var batch = toProcess.slice(i, Math.min(i + BATCH, toProcess.length));
        await Promise.all(batch.map(function(d) {
            return deleteDoc(d.id).then(function(ok) {
                if (ok) success++; else failed++;
            }).catch(function() { failed++; });
        }));

        var total = i + batch.length;
        if (total % 100 === 0 || total === toProcess.length) {
            console.log('Progress: ' + total + '/' + toProcess.length + ' (ok: ' + success + ', fail: ' + failed + ')');
        }
        if (i + BATCH < toProcess.length) await new Promise(function(r) { setTimeout(r, 50); });
    }

    console.log('\n=== Dedup Complete ===');
    console.log('Deleted: ' + success);
    console.log('Failed: ' + failed);
    console.log('Remaining: ' + (allLeads.length - success));
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1); });
