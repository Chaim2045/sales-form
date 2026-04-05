// Migration script: Create clients collection from existing data
// Usage: node scripts/migrate-clients.js [--dry-run]
//
// Prerequisites:
//   - firebase-service-account.json in project root (or set FIREBASE_SERVICE_ACCOUNT_PATH)
//   - npm install firebase-admin (if not already installed in whatsapp-bot)
//
// Priority: recurring_billing > sales_records > leads
// Dedup key: phoneLast7 (last 7 digits of phone)

var admin = require('firebase-admin');
var path = require('path');

var DRY_RUN = process.argv.includes('--dry-run');
var BATCH_SIZE = 400; // Firestore max is 500, keep margin

function normalizePhone(phone) {
    if (!phone) return '';
    var d = phone.replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.substring(3);
    if (d.length === 9 && /^[5]/.test(d)) d = '0' + d;
    return d;
}

function getLast7(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-7);
}

// Init Firebase Admin
var serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
var serviceAccount = require(path.resolve(serviceAccountPath));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://law-office-sales-form.firebaseio.com'
});

var db = admin.firestore();

async function run() {
    console.log(DRY_RUN ? '\n=== DRY RUN MODE ===\n' : '\n=== LIVE MIGRATION ===\n');

    // 1. Fetch all collections
    console.log('Fetching recurring_billing...');
    var billingSnap = await db.collection('recurring_billing').get();
    console.log('  Found: ' + billingSnap.size + ' docs');

    console.log('Fetching sales_records...');
    var salesSnap = await db.collection('sales_records').get();
    console.log('  Found: ' + salesSnap.size + ' docs');

    console.log('Fetching leads...');
    var leadsSnap = await db.collection('leads').get();
    console.log('  Found: ' + leadsSnap.size + ' docs');

    // 2. Build clients map: phoneLast7 -> merged client data
    var clientsMap = new Map(); // key: phoneLast7, value: { client data + sourceDocIds }
    var noPhoneDocs = [];

    // Process billing first (cleanest data, highest priority)
    billingSnap.forEach(function(doc) {
        var d = doc.data();
        var phone = normalizePhone(d.phone);
        var last7 = getLast7(d.phone);

        if (!last7 || last7.length < 7) {
            noPhoneDocs.push({ collection: 'recurring_billing', docId: doc.id, name: d.clientName });
            return;
        }

        if (!clientsMap.has(last7)) {
            clientsMap.set(last7, {
                name: (d.clientName || '').trim(),
                phone: phone,
                phoneLast7: last7,
                email: d.email || '',
                idNumber: d.idNumber ? d.idNumber.replace(/\D/g, '') : '',
                address: d.address || '',
                attorney: d.attorney || '',
                branch: d.branch || '',
                caseNumber: d.caseNumber || '',
                source: 'migration',
                billingDocIds: [doc.id],
                salesDocIds: [],
                leadDocIds: []
            });
        } else {
            clientsMap.get(last7).billingDocIds.push(doc.id);
            // Fill empty fields from this billing doc
            var existing = clientsMap.get(last7);
            if (!existing.email && d.email) existing.email = d.email;
            if (!existing.idNumber && d.idNumber) existing.idNumber = d.idNumber.replace(/\D/g, '');
            if (!existing.address && d.address) existing.address = d.address;
            if (!existing.name && d.clientName) existing.name = (d.clientName || '').trim();
        }
    });

    // Process sales_records (fill gaps)
    salesSnap.forEach(function(doc) {
        var d = doc.data();
        var phone = normalizePhone(d.phone);
        var last7 = getLast7(d.phone);

        if (!last7 || last7.length < 7) {
            noPhoneDocs.push({ collection: 'sales_records', docId: doc.id, name: d.clientName });
            return;
        }

        if (!clientsMap.has(last7)) {
            clientsMap.set(last7, {
                name: (d.clientName || '').trim(),
                phone: phone,
                phoneLast7: last7,
                email: d.email || '',
                idNumber: d.idNumber ? d.idNumber.replace(/\D/g, '') : '',
                address: d.address || '',
                attorney: d.attorney || d.formFillerName || '',
                branch: d.branch || '',
                caseNumber: d.caseNumber || '',
                source: 'migration',
                billingDocIds: [],
                salesDocIds: [doc.id],
                leadDocIds: []
            });
        } else {
            clientsMap.get(last7).salesDocIds.push(doc.id);
            var existing = clientsMap.get(last7);
            if (!existing.email && d.email) existing.email = d.email;
            if (!existing.idNumber && d.idNumber) existing.idNumber = d.idNumber.replace(/\D/g, '');
            if (!existing.address && d.address) existing.address = d.address;
            if (!existing.attorney && (d.attorney || d.formFillerName)) existing.attorney = d.attorney || d.formFillerName;
            if (!existing.name && d.clientName) existing.name = (d.clientName || '').trim();
        }
    });

    // Process leads (fill gaps)
    leadsSnap.forEach(function(doc) {
        var d = doc.data();
        var phone = normalizePhone(d.phone);
        var last7 = getLast7(d.phone) || d.phoneLast7;

        if (!last7 || last7.length < 7) {
            noPhoneDocs.push({ collection: 'leads', docId: doc.id, name: d.name });
            return;
        }

        if (!clientsMap.has(last7)) {
            clientsMap.set(last7, {
                name: (d.name || '').trim(),
                phone: phone,
                phoneLast7: last7,
                email: '',
                idNumber: '',
                address: '',
                attorney: '',
                branch: '',
                caseNumber: '',
                source: 'migration',
                billingDocIds: [],
                salesDocIds: [],
                leadDocIds: [doc.id]
            });
        } else {
            clientsMap.get(last7).leadDocIds.push(doc.id);
            var existing = clientsMap.get(last7);
            if (!existing.name && d.name) existing.name = (d.name || '').trim();
        }
    });

    // 3. Summary
    console.log('\n--- Summary ---');
    console.log('Unique clients (by phone): ' + clientsMap.size);
    console.log('Records without phone: ' + noPhoneDocs.length);

    if (noPhoneDocs.length > 0) {
        console.log('\nRecords without phone (skipped):');
        noPhoneDocs.forEach(function(d) {
            console.log('  [' + d.collection + '] ' + d.docId + ' — ' + (d.name || '(no name)'));
        });
    }

    // 4. Create clients and backfill clientId
    console.log('\n--- Creating clients ---');
    var created = 0;
    var linkedBilling = 0;
    var linkedSales = 0;
    var linkedLeads = 0;

    var entries = Array.from(clientsMap.values());

    for (var i = 0; i < entries.length; i += BATCH_SIZE) {
        var chunk = entries.slice(i, i + BATCH_SIZE);
        var batch = db.batch();
        var clientIds = []; // { clientId, entry }

        // Create client docs
        for (var j = 0; j < chunk.length; j++) {
            var entry = chunk[j];
            var clientRef = db.collection('clients').doc();
            var clientDoc = {
                name: entry.name,
                phone: entry.phone,
                phoneLast7: entry.phoneLast7,
                email: entry.email,
                idNumber: entry.idNumber,
                address: entry.address,
                attorney: entry.attorney,
                branch: entry.branch,
                caseNumber: entry.caseNumber,
                source: 'migration',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'migration-script'
            };

            if (!DRY_RUN) {
                batch.set(clientRef, clientDoc);
            }
            clientIds.push({ clientId: clientRef.id, entry: entry });
            created++;
        }

        if (!DRY_RUN) {
            await batch.commit();
        }

        // Backfill clientId to source documents (separate batches because of 500 limit)
        for (var k = 0; k < clientIds.length; k++) {
            var ci = clientIds[k];
            var allDocs = [];

            ci.entry.billingDocIds.forEach(function(docId) {
                allDocs.push({ collection: 'recurring_billing', docId: docId });
                linkedBilling++;
            });
            ci.entry.salesDocIds.forEach(function(docId) {
                allDocs.push({ collection: 'sales_records', docId: docId });
                linkedSales++;
            });
            ci.entry.leadDocIds.forEach(function(docId) {
                allDocs.push({ collection: 'leads', docId: docId });
                linkedLeads++;
            });

            // Batch update source docs
            for (var m = 0; m < allDocs.length; m += BATCH_SIZE) {
                var docChunk = allDocs.slice(m, m + BATCH_SIZE);
                var updateBatch = db.batch();
                docChunk.forEach(function(d) {
                    var ref = db.collection(d.collection).doc(d.docId);
                    updateBatch.update(ref, { clientId: ci.clientId });
                });
                if (!DRY_RUN) {
                    await updateBatch.commit();
                }
            }
        }

        console.log('  Batch ' + Math.floor(i / BATCH_SIZE + 1) + ': ' + chunk.length + ' clients');
    }

    console.log('\n--- Results ---');
    console.log('Clients created: ' + created);
    console.log('Billing docs linked: ' + linkedBilling);
    console.log('Sales docs linked: ' + linkedSales);
    console.log('Leads docs linked: ' + linkedLeads);
    console.log('Skipped (no phone): ' + noPhoneDocs.length);
    console.log(DRY_RUN ? '\n(DRY RUN — no changes made)' : '\nMigration complete!');
}

run().then(function() {
    process.exit(0);
}).catch(function(err) {
    console.error('Migration failed:', err);
    process.exit(1);
});
