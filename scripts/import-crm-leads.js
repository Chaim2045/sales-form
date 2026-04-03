// Import leads from old CRM CSV (lawguide) into Firestore 'leads' collection
// Usage: node scripts/import-crm-leads.js
//
// Requires: FIREBASE_API_KEY env var or uses default from env-config.js

const fs = require('fs');
const https = require('https');
const path = require('path');

// Firebase config
const PROJECT_ID = 'law-office-sales-form';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAkRGg1HUaJhimwIhRir7wQ0vrZRUuqIy8';
const AUTH_EMAIL = process.env.FIREBASE_AUTH_EMAIL || 'haim@ghlawoffice.co.il';
const AUTH_PASSWORD = process.env.FIREBASE_AUTH_PASSWORD || '';
var authIdToken = null;

// Status mapping: old CRM status_type → our leads status
const STATUS_MAP = {
    'new': 'new',
    'in_progress': 'contacted',
    'nurture': 'followup',
    'pending': 'followup',
    'closed_won': 'closed',
    'closed_lost': 'not_relevant',
    'irrelevant': 'not_relevant',
    'draft': 'new'
};

// Parse DD-MM-YYYY (HH:MM) format to ISO string
function parseDate(dateStr) {
    if (!dateStr) return null;
    var clean = dateStr.replace(/"/g, '').trim();
    if (!clean) return null;
    // Format: "30-03-2026 (19:32)" or "30-03-2026"
    var match = clean.match(/(\d{2})-(\d{2})-(\d{4})(?:\s*\((\d{2}):(\d{2})\))?/);
    if (!match) return null;
    var day = match[1], month = match[2], year = match[3];
    var hour = match[4] || '00', min = match[5] || '00';
    return year + '-' + month + '-' + day + 'T' + hour + ':' + min + ':00.000Z';
}

// Clean quoted CSV value
function clean(val) {
    if (!val) return '';
    return val.replace(/^"/, '').replace(/"$/, '').trim();
}

// Normalize phone number
function normalizePhone(phone) {
    if (!phone) return '';
    var p = phone.replace(/["\s\-()]/g, '').trim();
    if (!p || p.length < 7) return '';
    // Add leading 0 if missing
    if (p.length === 9 && !p.startsWith('0')) p = '0' + p;
    // Format: 05X-XXXXXXX
    if (p.length === 10 && p.startsWith('0')) {
        return p.substring(0, 3) + '-' + p.substring(3);
    }
    return p;
}

// HTTP request helper
function httpRequest(options, data) {
    return new Promise((resolve, reject) => {
        var req = https.request(options, (res) => {
            var body = '';
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

// Convert lead object to Firestore document format
function toFirestoreDoc(lead) {
    var fields = {};

    // String fields
    var strFields = ['name', 'phone', 'email', 'subject', 'source', 'status',
        'statusNote', 'priority', 'originalMessage', 'city', 'category',
        'businessName', 'crmId', 'oldStatusTitle', 'oldStatusReason'];
    for (var i = 0; i < strFields.length; i++) {
        var key = strFields[i];
        fields[key] = { stringValue: lead[key] || '' };
    }

    // Assignee — string or null
    if (lead.assignedTo) {
        fields.assignedTo = { stringValue: lead.assignedTo };
    } else {
        fields.assignedTo = { nullValue: null };
    }

    // Timestamps
    if (lead.createdAt) {
        fields.createdAt = { timestampValue: lead.createdAt };
    } else {
        fields.createdAt = { timestampValue: new Date().toISOString() };
    }
    fields.lastUpdated = { timestampValue: lead.statusDate || lead.createdAt || new Date().toISOString() };

    if (lead.assignedAt) {
        fields.assignedAt = { timestampValue: lead.assignedAt };
    } else {
        fields.assignedAt = { nullValue: null };
    }

    if (lead.followupAt) {
        fields.followupAt = { timestampValue: lead.followupAt };
    } else {
        fields.followupAt = { nullValue: null };
    }

    // Booleans
    fields.crmUpdated = { booleanValue: false };
    fields.escalated = { booleanValue: false };
    fields.importedFromCRM = { booleanValue: true };

    // AI fields (empty for imported)
    fields.aiScore = { integerValue: '0' };
    fields.aiReason = { stringValue: '' };

    // History
    fields.history = {
        arrayValue: {
            values: [{
                mapValue: {
                    fields: {
                        action: { stringValue: 'imported' },
                        by: { stringValue: 'csv-import' },
                        at: { stringValue: new Date().toISOString() },
                        note: { stringValue: 'יובא ממערכת CRM קודמת (lawguide). ID מקורי: ' + (lead.crmId || '') }
                    }
                }
            }]
        }
    };

    return { fields: fields };
}

// Authenticate with Firebase Auth REST API
async function authenticate() {
    if (!AUTH_PASSWORD) {
        console.error('ERROR: Set FIREBASE_AUTH_PASSWORD env var');
        console.error('Usage: FIREBASE_AUTH_PASSWORD=yourpass node scripts/import-crm-leads.js');
        process.exit(1);
    }

    var postData = JSON.stringify({
        email: AUTH_EMAIL,
        password: AUTH_PASSWORD,
        returnSecureToken: true
    });

    var res = await httpRequest({
        hostname: 'identitytoolkit.googleapis.com',
        path: '/v1/accounts:signInWithPassword?key=' + API_KEY,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    }, postData);

    if (res.status !== 200 || !res.data.idToken) {
        console.error('Auth failed:', res.status, JSON.stringify(res.data).substring(0, 200));
        process.exit(1);
    }

    authIdToken = res.data.idToken;
    console.log('Authenticated as:', AUTH_EMAIL);
    return authIdToken;
}

// Save one lead to Firestore via REST API (with auth)
async function saveToFirestore(doc) {
    var postData = JSON.stringify(doc);
    var headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    };
    if (authIdToken) {
        headers['Authorization'] = 'Bearer ' + authIdToken;
    }

    var res = await httpRequest({
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/leads?key=' + API_KEY,
        method: 'POST',
        headers: headers
    }, postData);

    if (res.status === 200 || res.status === 201) {
        return true;
    } else {
        console.error('Firestore error:', res.status, JSON.stringify(res.data).substring(0, 200));
        return false;
    }
}

// Parse the CSV file
function parseCSV(filePath) {
    // Read as UTF-16LE (the file encoding)
    var buffer = fs.readFileSync(filePath);
    var content;

    // Detect BOM: UTF-16LE starts with FF FE
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
        content = buffer.toString('utf16le');
    } else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
        // UTF-16BE
        content = buffer.swap16().toString('utf16le');
    } else {
        content = buffer.toString('utf8');
    }

    // Remove BOM
    content = content.replace(/^\uFEFF/, '');

    var lines = content.split(/\r?\n/);
    var headers = lines[0].split('\t').map(h => clean(h));

    console.log('Headers found:', headers.length);
    console.log('Total lines (including header + label row):', lines.length);

    var leads = [];
    // Skip line 0 (headers) and line 1 (Hebrew labels)
    for (var i = 2; i < lines.length; i++) {
        var line = lines[i];
        if (!line.trim()) continue;

        var cols = line.split('\t');
        var row = {};
        for (var j = 0; j < headers.length; j++) {
            row[headers[j]] = clean(cols[j] || '');
        }

        // Skip deleted records
        if (row.deleted && row.deleted !== '0' && row.deleted !== '') continue;

        // Skip if no name AND no phone
        var name = row.full_name || '';
        var phone = row.phone || '';
        if (!name && !phone) continue;

        // If name is just a phone number, use it as phone
        if (/^\d{7,}$/.test(name.replace(/\s/g, '')) && !phone) {
            phone = name;
            name = '';
        }

        // Map status
        var statusType = row.status_type || '';
        var status = STATUS_MAP[statusType] || 'new';

        // Determine source
        var source = row.utm_source || '';
        if (!source && row.utm_medium) source = row.utm_medium;
        if (!source) source = 'crm-import';

        // Build lead object
        var lead = {
            crmId: row.id || '',
            name: name,
            phone: normalizePhone(phone),
            email: row.email || '',
            subject: row.subject || '',
            originalMessage: row.body || '',
            source: source,
            status: status,
            statusNote: row._status_reason || '',
            oldStatusTitle: row.status_title || '',
            oldStatusReason: row._status_reason || '',
            assignedTo: row.user_full_name || '',
            priority: row.priority || 'normal',
            category: row.job_essence_copy || '',
            city: row.city || '',
            businessName: row['business-name'] || '',
            createdAt: parseDate(row.created),
            statusDate: parseDate(row.status_date),
            followupAt: parseDate(row['folowup-date']),
            assignedAt: row.user_full_name ? (parseDate(row.status_date) || parseDate(row.created)) : null
        };

        leads.push(lead);
    }

    return leads;
}

// Main import function
async function main() {
    var csvPath = path.join(__dirname, '..', 'יצירות_קשר.csv');

    if (!fs.existsSync(csvPath)) {
        console.error('CSV file not found:', csvPath);
        process.exit(1);
    }

    console.log('Parsing CSV...');
    var leads = parseCSV(csvPath);
    console.log('Parsed ' + leads.length + ' leads from CSV');

    // Stats
    var statusCounts = {};
    for (var i = 0; i < leads.length; i++) {
        var s = leads[i].status;
        statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    console.log('\nStatus distribution:');
    for (var key in statusCounts) {
        console.log('  ' + key + ': ' + statusCounts[key]);
    }

    // Ask for confirmation
    var args = process.argv.slice(2);
    var dryRun = args.includes('--dry-run');
    var limitArg = args.find(a => a.startsWith('--limit='));
    var limit = limitArg ? parseInt(limitArg.split('=')[1]) : 0;

    if (dryRun) {
        console.log('\n--- DRY RUN --- No data will be written to Firestore');
        console.log('Sample leads:');
        for (var i = 0; i < Math.min(5, leads.length); i++) {
            console.log(JSON.stringify(leads[i], null, 2));
        }
        return;
    }

    // Authenticate before writing
    await authenticate();

    var toImport = limit > 0 ? leads.slice(0, limit) : leads;
    console.log('\nImporting ' + toImport.length + ' leads to Firestore...');

    var success = 0;
    var failed = 0;
    var BATCH_SIZE = 10; // Parallel batch size

    for (var i = 0; i < toImport.length; i += BATCH_SIZE) {
        var batch = toImport.slice(i, Math.min(i + BATCH_SIZE, toImport.length));
        var promises = batch.map(lead => {
            var doc = toFirestoreDoc(lead);
            return saveToFirestore(doc).then(ok => {
                if (ok) success++;
                else failed++;
            }).catch(err => {
                console.error('Error saving lead:', err.message);
                failed++;
            });
        });

        await Promise.all(promises);

        // Progress
        var total = i + batch.length;
        if (total % 100 === 0 || total === toImport.length) {
            console.log('Progress: ' + total + '/' + toImport.length + ' (success: ' + success + ', failed: ' + failed + ')');
        }

        // Small delay to avoid rate limiting
        if (i + BATCH_SIZE < toImport.length) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    console.log('\n=== Import Complete ===');
    console.log('Total: ' + toImport.length);
    console.log('Success: ' + success);
    console.log('Failed: ' + failed);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
