// Firebase Admin SDK integration v5
// Saves parsed transactions to Firestore, uploads checks to Storage, OCR via Vision+Claude

const admin = require('firebase-admin');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');
const { israelNow } = require('./israel-time');
const { lookupPhone } = require('./phone-lookup');
const { normalizePhone: sharedNormalizePhone, getLast7: sharedGetLast7 } = require('./phone-utils');

var db = null;
var bucket = null;

function initFirebase() {
    if (db) return db;

    var serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
    var serviceAccount = require(path.resolve(serviceAccountPath));

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://law-office-sales-form.firebaseio.com',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'law-office-sales-form.firebasestorage.app'
    });

    db = admin.firestore();
    bucket = admin.storage().bucket();
    console.log('[Firebase] Connected to Firestore + Storage ✅');
    return db;
}

// Save a transaction record — same structure as sales-form.js submitForm()
async function saveTransaction(data, senderName) {
    var firestore = initFirebase();

    var now = new Date();
    var VAT_RATE = 0.18;

    // Calculate amounts — amount is ALWAYS before VAT
    // Strip commas/spaces from amount (Claude may return "3,317" or "3 317")
    var amountStr = String(data.amount || '0').replace(/[,\s]/g, '');
    var rawAmount = parseFloat(amountStr) || 0;
    if (rawAmount <= 0) {
        throw new Error('סכום חייב להיות גדול מ-0');
    }

    var amountBeforeVat = rawAmount;
    var vatAmount = Math.round(rawAmount * VAT_RATE);
    var amountWithVat = amountBeforeVat + vatAmount;

    // Validate required fields
    if (!data.clientName || data.clientName.length < 2) {
        throw new Error('שם לקוח חסר');
    }

    // Check for incomplete but non-blocking fields
    var incompleteFields = [];

    var phoneDigits = (data.phone || '').replace(/\D/g, '');
    if (!phoneDigits || phoneDigits.length < 9) {
        incompleteFields.push('phone');
    }

    if (!data.transactionType || data.transactionType.trim() === '') {
        incompleteFields.push('transactionType');
    }

    if (!data.paymentMethod || data.paymentMethod.trim() === '') {
        incompleteFields.push('paymentMethod');
    }

    var record = {
        // Metadata
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        date: now.toISOString().split('T')[0],
        formFillerName: data.attorney || senderName || process.env.DEFAULT_ATTORNEY || 'WhatsApp Bot',
        source: 'whatsapp-bot',

        // Client details
        clientName: (data.clientName || '').trim(),
        phone: (data.phone || '').trim(),
        email: (data.email || '').trim(),
        idNumber: (data.idNumber || '').trim(),
        address: (data.address || '').trim(),
        clientStatus: data.clientStatus || 'קיים',

        // Transaction details
        transactionType: data.transactionType || 'אחר',
        transactionDescription: data.transactionDescription || '',
        hoursQuantity: data.hoursQuantity || '',
        hourlyRate: data.hourlyRate || '',

        // Amounts
        amountBeforeVat: amountBeforeVat,
        vatAmount: vatAmount,
        amountWithVat: amountWithVat,

        // Payment
        paymentMethod: data.paymentMethod || '',
        isSplitPayment: data.paymentMethod === 'פיצול תשלום',
        creditCardStatus: data.creditCardStatus || '',
        paymentsCount: data.paymentsCount || '',
        monthlyCharge: data.monthlyCharge || '',
        monthsCount: data.monthsCount || '',
        recurringStartDate: data.recurringStartDate || '',
        recurringDayOfMonth: data.recurringDayOfMonth || '',
        temporaryCreditText: data.temporaryCreditText || '',
        checksCount: data.checksCount || '',
        checksPhotoURL: data.checksPhotoURL || '',

        // Additional
        attorney: data.attorney || process.env.DEFAULT_ATTORNEY || '',
        branch: data.branch || process.env.DEFAULT_BRANCH || 'תל אביב',
        caseNumber: data.caseNumber || '',
        notes: 'נוצר מ-WhatsApp Bot\nשולח: ' + (senderName || '') + (data.originalMessage ? '\n\nהודעה מקורית: ' + data.originalMessage : '')
    };

    // Flag record with missing fields for later review (non-blocking)
    if (incompleteFields.length > 0) {
        record.incompleteFields = incompleteFields;
    }

    // Save split payments if present
    if (data.splitPayments && Array.isArray(data.splitPayments)) {
        record.paymentBreakdown = JSON.stringify(data.splitPayments);
    }

    // Save check details if present
    if (data.checksDetails && Array.isArray(data.checksDetails)) {
        record.checksDetails = JSON.stringify(data.checksDetails);
    }

    // Link to clients collection
    if (record.phone) {
        try {
            var clientId = await getOrCreateClient({
                name: record.clientName,
                phone: record.phone,
                email: record.email,
                idNumber: record.idNumber,
                address: record.address,
                attorney: record.attorney,
                branch: record.branch,
                caseNumber: record.caseNumber,
                source: 'whatsapp_bot'
            });
            if (clientId) record.clientId = clientId;
        } catch (clientErr) {
            console.error('[Firebase] Client link failed (non-blocking):', clientErr.message);
        }
    }
    record.phone = normalizePhone(record.phone);

    var docRef = await firestore.collection('sales_records').add(record);

    // Log audit event
    try {
        await firestore.collection('audit_log').add({
            action: 'sales_record_created',
            details: {
                docId: docRef.id,
                clientName: data.clientName,
                amount: amountWithVat,
                paymentMethod: data.paymentMethod || '',
                source: 'whatsapp-bot'
            },
            performedBy: senderName || 'WhatsApp Bot',
            authEmail: 'whatsapp-bot@system',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            clientTimestamp: now.toISOString()
        });
    } catch (auditErr) {
        console.error('[Firebase] Audit log failed (non-blocking):', auditErr.message);
    }

    return docRef.id;
}

// Sync to Google Sheets (same webhook as web form)
async function syncToSheets(data, senderName) {
    var webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK;
    if (!webhookUrl) {
        console.log('[Sheets] No webhook URL configured — skipping');
        return;
    }

    try {
        // Build complete payload with all fields Sheets expects
        var VAT_RATE = 0.18;
        var rawAmount = parseFloat(String(data.amount || '0').replace(/[,\s]/g, '')) || 0;
        var amountBeforeVat = rawAmount;
        var vatAmount = Math.round(rawAmount * VAT_RATE);
        var amountWithVat = amountBeforeVat + vatAmount;

        var payload = Object.assign({}, data, {
            formFillerName: data.attorney || senderName || data.formFillerName || 'WhatsApp Bot',
            source: 'whatsapp-bot',
            date: data.date || new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString(),
            clientStatus: data.clientStatus || 'קיים',
            amountBeforeVat: amountBeforeVat,
            vatAmount: vatAmount,
            amountWithVat: amountWithVat,
            transactionType: data.transactionType || 'אחר',
            transactionDescription: data.transactionDescription || '',
            paymentMethod: data.paymentMethod || '',
            isSplitPayment: data.paymentMethod === 'פיצול תשלום',
            attorney: data.attorney || process.env.DEFAULT_ATTORNEY || '',
            branch: data.branch || process.env.DEFAULT_BRANCH || 'תל אביב',
            checksPhotoURL: data.checksPhotoURL || '',
            checksCount: data.checksCount || '',
            checksDetails: data.checksDetails || '',
            notes: 'נוצר מ-WhatsApp Bot | שולח: ' + (senderName || '')
        });

        var response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });

        if (!response.ok) {
            console.error('[Sheets] HTTP error:', response.status);
            return false;
        }

        // Parse response body — Google Apps Script returns { success: true/false }
        try {
            var body = await response.text();
            var result = JSON.parse(body);
            if (result.success === false) {
                console.error('[Sheets] Script error:', result.error || 'unknown');
                return false;
            }
        } catch (e) {
            // Can't parse response — but HTTP was 200, assume ok
        }

        console.log('[Sheets] Synced ✅');
        return true;
    } catch (err) {
        console.error('[Sheets] Sync failed:', err.message);
        return false;
    }
}

// Look up client by name in existing records
async function findClient(clientName) {
    var firestore = initFirebase();

    try {
        // Search sales_records
        var snapshot = await firestore.collection('sales_records')
            .orderBy('timestamp', 'desc')
            .limit(200)
            .get();

        var searchLower = clientName.toLowerCase().trim();
        if (searchLower.length < 2) return null;

        var match = null;

        snapshot.forEach(function(doc) {
            if (match) return;
            var d = doc.data();
            var name = (d.clientName || '').toLowerCase();
            if (name.includes(searchLower) || searchLower.includes(name)) {
                match = {
                    clientName: d.clientName,
                    phone: d.phone || '',
                    email: d.email || '',
                    idNumber: d.idNumber || '',
                    address: d.address || '',
                    clientStatus: 'קיים'
                };
            }
        });

        // Also search recurring_billing if not found
        if (!match) {
            try {
                var billingSnapshot = await firestore.collection('recurring_billing')
                    .orderBy('createdAt', 'desc')
                    .limit(100)
                    .get();

                billingSnapshot.forEach(function(doc) {
                    if (match) return;
                    var d = doc.data();
                    var name = (d.clientName || '').toLowerCase();
                    if (name.includes(searchLower) || searchLower.includes(name)) {
                        match = {
                            clientName: d.clientName,
                            phone: d.phone || '',
                            email: d.email || '',
                            idNumber: d.idNumber || '',
                            address: d.address || '',
                            clientStatus: 'קיים'
                        };
                    }
                });
            } catch (e) {}
        }

        return match;
    } catch (err) {
        console.error('[Firebase] Client lookup error:', err.message);
        return null;
    }
}

// Verify if a transaction was recorded for a specific client + amount
// Used to check if user filled the form manually after declining the bot
// Smart matching: splits search into words and checks if any significant word appears in the record
async function verifyTransaction(clientName, amount) {
    var firestore = initFirebase();

    try {
        // Only look at records from today and yesterday (not older)
        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        var sinceDate = yesterday.toISOString().split('T')[0];

        var snapshot = await firestore.collection('sales_records')
            .where('date', '>=', sinceDate)
            .orderBy('date', 'desc')
            .get();

        var searchLower = (clientName || '').toLowerCase().trim();
        var targetAmount = parseFloat(String(amount || '0').replace(/[,\s]/g, '')) || 0;
        var match = null;

        // Split search into significant words (skip common short words)
        var skipWords = ['בע"מ', 'בעמ', 'בע״מ', 'ltd', 'inc', 'llc', 'את', 'של', 'על'];
        var searchWords = searchLower.split(/[\s\-]+/).filter(function(w) {
            return w.length >= 2 && skipWords.indexOf(w) === -1;
        });

        snapshot.forEach(function(doc) {
            if (match) return;
            var d = doc.data();
            var name = (d.clientName || '').toLowerCase();
            var recordAmount = parseFloat(d.amountBeforeVat) || 0;

            // Match by full name (either direction)
            var nameMatch = name.includes(searchLower) || searchLower.includes(name);

            // Match by any significant word
            if (!nameMatch && searchWords.length > 0) {
                for (var i = 0; i < searchWords.length; i++) {
                    if (name.includes(searchWords[i])) {
                        nameMatch = true;
                        break;
                    }
                }
            }

            if (nameMatch) {
                // Match by amount (exact or close) or no amount to compare
                if (targetAmount === 0 || Math.abs(recordAmount - targetAmount) < 100) {
                    match = {
                        clientName: d.clientName,
                        amount: recordAmount,
                        date: d.date,
                        formFillerName: d.formFillerName || '',
                        idNumber: d.idNumber || ''
                    };
                }
            }
        });

        return match; // null if not found, object with details if found
    } catch (err) {
        console.error('[Firebase] Verify error:', err.message);
        return false;
    }
}

// ==================== Find Record for Edit ====================

// Find a sales record by client name, return full record + docId
async function findRecordForEdit(clientName) {
    var firestore = initFirebase();

    try {
        var snapshot = await firestore.collection('sales_records')
            .orderBy('timestamp', 'desc')
            .limit(100)
            .get();

        var searchLower = (clientName || '').toLowerCase().trim();
        var skipWords = ['בע"מ', 'בעמ', 'בע״מ', 'ltd', 'תעדכן', 'תעלה', 'שיקים', 'את', 'של', 'על'];
        var searchWords = searchLower.split(/[\s\-]+/).filter(function(w) {
            return w.length >= 2 && skipWords.indexOf(w) === -1;
        });

        var matches = [];

        snapshot.forEach(function(doc) {
            var d = doc.data();
            var name = (d.clientName || '').toLowerCase();

            var nameMatch = name.includes(searchLower) || searchLower.includes(name);
            if (!nameMatch && searchWords.length > 0) {
                for (var i = 0; i < searchWords.length; i++) {
                    if (name.includes(searchWords[i])) {
                        nameMatch = true;
                        break;
                    }
                }
            }

            if (nameMatch) {
                matches.push({
                    docId: doc.id,
                    clientName: d.clientName || '',
                    phone: d.phone || '',
                    email: d.email || '',
                    idNumber: d.idNumber || '',
                    amount: parseFloat(d.amountBeforeVat) || 0,
                    paymentMethod: d.paymentMethod || '',
                    transactionType: d.transactionType || '',
                    checksPhotoURL: d.checksPhotoURL || '',
                    date: d.date || '',
                    formFillerName: d.formFillerName || ''
                });
            }
        });

        return matches; // array — may have 0, 1, or multiple
    } catch (err) {
        console.error('[Firebase] Find for edit error:', err.message);
        return [];
    }
}

// Update specific fields on a sales record
async function updateRecord(docId, updates) {
    var firestore = initFirebase();

    try {
        // Clean amount if provided
        if (updates.amountBeforeVat !== undefined) {
            var rawAmount = parseFloat(String(updates.amountBeforeVat).replace(/[,\s]/g, '')) || 0;
            updates.amountBeforeVat = rawAmount;
            updates.vatAmount = Math.round(rawAmount * 0.18);
            updates.amountWithVat = rawAmount + updates.vatAmount;
        }

        updates.lastUpdated = require('firebase-admin').firestore.FieldValue.serverTimestamp();
        updates.updatedBy = updates.updatedBy || 'whatsapp-bot';

        await firestore.collection('sales_records').doc(docId).update(updates);
        console.log('[Firebase] Updated record: ' + docId);

        // Sync update to Google Sheets (update existing row, not append)
        try {
            var webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK;
            if (webhookUrl) {
                var doc = await firestore.collection('sales_records').doc(docId).get();
                if (doc.exists) {
                    var fullRecord = doc.data();
                    var sheetPayload = Object.assign({}, fullRecord, {
                        action: 'updateSaleRow',
                        firebaseDocId: docId,
                        checksPhotoURL: fullRecord.checksPhotoURL || '',
                        checksCount: fullRecord.checksCount || '',
                        checksDetails: fullRecord.checksDetails || ''
                    });
                    var response = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(sheetPayload),
                        redirect: 'follow'
                    });
                    if (response.ok) {
                        console.log('[Firebase] Update synced to Sheets');
                    } else {
                        console.error('[Firebase] Sheets update returned:', response.status);
                    }
                }
            }
        } catch (sheetErr) {
            console.error('[Firebase] Update Sheets sync failed:', sheetErr.message);
        }

        return true;
    } catch (err) {
        console.error('[Firebase] Update error:', err.message);
        return false;
    }
}

// ==================== Monthly Revenue Summary ====================

async function getMonthlySummary() {
    var firestore = initFirebase();

    try {
        var now = new Date();
        var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        var snapshot = await firestore.collection('sales_records')
            .where('date', '>=', firstOfMonth.toISOString().split('T')[0])
            .orderBy('date', 'desc')
            .get();

        var totalBeforeVat = 0;
        var totalWithVat = 0;
        var count = 0;
        var skippedRecurring = 0;
        var byAttorney = {};

        snapshot.forEach(function(doc) {
            var d = doc.data();

            // Skip recurring billing — identified by transactionType containing "גבייה" or "ריטיינר"
            var type = (d.transactionType || '').trim();
            if (type.includes('גבייה') || type === 'ריטיינר') {
                skippedRecurring++;
                return;
            }

            var before = parseFloat(d.amountBeforeVat) || 0;
            var withVat = parseFloat(d.amountWithVat) || 0;
            totalBeforeVat += before;
            totalWithVat += withVat;
            count++;

            var att = d.attorney || d.formFillerName || 'לא צוין';
            if (!byAttorney[att]) byAttorney[att] = { count: 0, total: 0 };
            byAttorney[att].count++;
            byAttorney[att].total += before;
        });

        // Format month name in Hebrew
        var monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
        var monthName = monthNames[now.getMonth()];

        // Format date range
        var todayStr = now.getDate() + '/' + (now.getMonth() + 1);
        var fromStr = '1/' + (now.getMonth() + 1);

        return {
            month: monthName,
            year: now.getFullYear(),
            fromDate: fromStr,
            toDate: todayStr,
            count: count,
            skippedRecurring: skippedRecurring,
            totalBeforeVat: totalBeforeVat,
            totalWithVat: totalWithVat,
            byAttorney: byAttorney
        };
    } catch (err) {
        console.error('[Firebase] Summary error:', err.message);
        return null;
    }
}

// ==================== Weekly Revenue Summary ====================

async function getWeeklySummary() {
    var firestore = initFirebase();

    try {
        var now = israelNow();
        var weekAgo = new Date(now.getTime());
        weekAgo.setDate(weekAgo.getUTCDate() - 7);

        var snapshot = await firestore.collection('sales_records')
            .where('date', '>=', weekAgo.toISOString().split('T')[0])
            .orderBy('date', 'desc')
            .get();

        var totalBeforeVat = 0;
        var totalWithVat = 0;
        var count = 0;
        var skippedRecurring = 0;
        var byAttorney = {};

        snapshot.forEach(function(doc) {
            var d = doc.data();

            // Skip recurring billing
            var type = (d.transactionType || '').trim();
            if (type.includes('גבייה') || type === 'ריטיינר') {
                skippedRecurring++;
                return;
            }

            var before = parseFloat(d.amountBeforeVat) || 0;
            var withVat = parseFloat(d.amountWithVat) || 0;
            totalBeforeVat += before;
            totalWithVat += withVat;
            count++;

            var att = d.attorney || d.formFillerName || 'לא צוין';
            if (!byAttorney[att]) byAttorney[att] = { count: 0, total: 0 };
            byAttorney[att].count++;
            byAttorney[att].total += before;
        });

        var fromStr = weekAgo.getDate() + '/' + (weekAgo.getMonth() + 1);
        var toStr = now.getDate() + '/' + (now.getMonth() + 1);

        return {
            fromDate: fromStr,
            toDate: toStr,
            count: count,
            skippedRecurring: skippedRecurring,
            totalBeforeVat: totalBeforeVat,
            totalWithVat: totalWithVat,
            byAttorney: byAttorney
        };
    } catch (err) {
        console.error('[Firebase] Weekly summary error:', err.message);
        return null;
    }
}

// ==================== Check Photo Upload ====================

// Upload check image to Firebase Storage, return public URL
async function uploadCheckPhoto(base64Data, mimetype) {
    initFirebase();

    var ext = (mimetype || 'image/jpeg').split('/')[1] || 'jpg';
    if (ext === 'jpeg') ext = 'jpg';
    var uuid = crypto.randomUUID();
    var filePath = 'checks/' + uuid + '.' + ext;

    var buffer = Buffer.from(base64Data, 'base64');
    var file = bucket.file(filePath);

    await file.save(buffer, {
        metadata: {
            contentType: mimetype || 'image/jpeg',
            metadata: { uploadedBy: 'whatsapp-bot', uploadedAt: new Date().toISOString() }
        }
    });

    // Make publicly readable
    await file.makePublic();
    var url = 'https://storage.googleapis.com/' + bucket.name + '/' + filePath;

    console.log('[Storage] Uploaded check: ' + filePath);
    return url;
}

// ==================== OCR Check Extraction ====================

// Helper for HTTPS requests
function httpRequest(options, data) {
    return new Promise(function(resolve, reject) {
        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, data: body }); }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, function() { req.destroy(new Error('HTTP timeout')); });
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

// Extract text from image using Google Vision API
async function visionOCR(base64Image) {
    var apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
        console.error('[OCR] GOOGLE_VISION_API_KEY not configured');
        return null;
    }

    var requestBody = JSON.stringify({
        requests: [{
            image: { content: base64Image },
            features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
            imageContext: { languageHints: ['he', 'en'] }
        }]
    });

    var res = await httpRequest({
        hostname: 'vision.googleapis.com',
        path: '/v1/images:annotate?key=' + apiKey,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
        }
    }, requestBody);

    if (res.status !== 200) {
        console.error('[OCR] Vision API error:', res.status);
        return null;
    }

    var responses = res.data.responses;
    if (!responses || !responses[0] || !responses[0].textAnnotations || !responses[0].textAnnotations[0]) {
        return '';
    }

    return responses[0].textAnnotations[0].description || '';
}

// Parse OCR text into check details using Claude
async function parseChecksWithClaude(ocrText) {
    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return [];

    var pageCount = (ocrText.match(/--- עמוד/g) || []).length + 1;

    var prompt = 'You are parsing OCR output from scanned Israeli bank checks (שיקים). ' +
        'The text contains ' + pageCount + ' check(s). Each check is on a separate page, ' +
        'separated by "--- עמוד X ---". Extract the date and amount from EACH check.\n\n' +
        'CRITICAL RULES:\n' +
        '1. DATE: Located near "DATE" or "תאריך" at the bottom of each check. ' +
        'Format is DAY/MONTH/YEAR (Israeli). Year is 2-digit (26 = 2026). ' +
        'OCR smashes digits: "304 26"=30/4/26, "30626"=30/6/26, "3826"=30/8/26. ' +
        'Look BEFORE the word DATE/תאריך.\n' +
        '2. AMOUNT: Near ₪ or N.I.S. Format: X,XXX. ' +
        'OCR adds leading "1" (18,850→8,850) or "$". Cross-reference with Hebrew words. ' +
        'Dot can replace comma (8.850=8,850).\n' +
        '3. IGNORE: account/branch/phone/check/ID numbers.\n\n' +
        'Respond with ONLY a JSON array:\n' +
        '[{"date":"YYYY-MM-DD","amount":8850},...]\n\n' +
        'Return exactly ' + pageCount + ' objects.\n\n' +
        'OCR Text:\n' + ocrText;

    var requestBody = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
    });

    var res = await httpRequest({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(requestBody)
        }
    }, requestBody);

    if (res.status !== 200) {
        console.error('[OCR] Claude API error:', res.status);
        return [];
    }

    try {
        var responseText = res.data.content[0].text.trim();
        console.log('[OCR] Claude parsed:', responseText.substring(0, 200));
        var jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            var objMatch = responseText.match(/\{[\s\S]*\}/);
            if (objMatch) return [JSON.parse(objMatch[0])];
            return [];
        }
        return JSON.parse(jsonMatch[0]);
    } catch (e) {
        console.error('[OCR] Parse failed:', e.message);
        return [];
    }
}

// Full OCR pipeline: Vision → Claude → structured check data
// Also uploads image to Storage and returns the URL
async function processCheckPhoto(base64Data, mimetype) {
    try {
        console.log('[OCR] Processing check photo (' + Math.round(base64Data.length / 1024) + 'KB)...');

        // Step 1: Upload to Firebase Storage
        var photoUrl = await uploadCheckPhoto(base64Data, mimetype);

        // Step 2: Vision OCR
        var ocrText = await visionOCR(base64Data);
        if (!ocrText) {
            console.error('[OCR] No text extracted');
            return { photoUrl: photoUrl, checks: [], rawText: '' };
        }

        console.log('[OCR] Raw text: ' + ocrText.substring(0, 150) + '...');

        // Step 3: Claude parsing
        var checks = await parseChecksWithClaude(ocrText);

        return {
            photoUrl: photoUrl,
            checks: checks.map(function(c, i) {
                return { date: c.date || '', amount: parseFloat(c.amount) || 0, index: i + 1 };
            }),
            rawText: ocrText
        };
    } catch (err) {
        console.error('[OCR] Pipeline error:', err.message);
        return { photoUrl: '', checks: [], rawText: '' };
    }
}

// ==================== PDF Check Processing ====================

// Convert PDF to images using pdftoppm, run OCR on each page, parse all with Claude
async function processCheckPDF(base64Data) {
    var tmpDir = '/tmp/checks-' + crypto.randomUUID();
    var pdfPath = tmpDir + '/input.pdf';

    try {
        console.log('[PDF] Processing PDF (' + Math.round(base64Data.length / 1024) + 'KB)...');

        // Write PDF to temp file
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(pdfPath, Buffer.from(base64Data, 'base64'));

        // Upload PDF to Storage
        initFirebase();
        var uuid = crypto.randomUUID();
        var storagePath = 'checks/' + uuid + '.pdf';
        var file = bucket.file(storagePath);
        await file.save(Buffer.from(base64Data, 'base64'), {
            metadata: {
                contentType: 'application/pdf',
                metadata: { uploadedBy: 'whatsapp-bot', uploadedAt: new Date().toISOString() }
            }
        });
        await file.makePublic();
        var photoUrl = 'https://storage.googleapis.com/' + bucket.name + '/' + storagePath;
        console.log('[PDF] Uploaded: ' + storagePath);

        // Convert PDF pages to images (max 10 pages, 200 DPI for speed)
        try {
            execSync('pdftoppm -jpeg -r 200 -l 10 "' + pdfPath + '" "' + tmpDir + '/page"', { timeout: 30000 });
        } catch (e) {
            console.error('[PDF] pdftoppm failed:', e.message);
            return { photoUrl: photoUrl, checks: [], rawText: '' };
        }

        // Find generated page images
        var pageFiles = fs.readdirSync(tmpDir)
            .filter(function(f) { return f.startsWith('page') && f.endsWith('.jpg'); })
            .sort();

        console.log('[PDF] Converted ' + pageFiles.length + ' pages');

        if (pageFiles.length === 0) {
            return { photoUrl: photoUrl, checks: [], rawText: '' };
        }

        // OCR each page with Vision API
        var allTexts = [];
        for (var i = 0; i < pageFiles.length; i++) {
            var imgBuffer = fs.readFileSync(tmpDir + '/' + pageFiles[i]);
            var imgBase64 = imgBuffer.toString('base64');

            console.log('[PDF] OCR page ' + (i + 1) + '/' + pageFiles.length + ' (' + Math.round(imgBase64.length / 1024) + 'KB)...');

            var pageText = await visionOCR(imgBase64);
            if (pageText) {
                allTexts.push(pageText);
                console.log('[PDF] Page ' + (i + 1) + ': ' + pageText.substring(0, 80) + '...');
            } else {
                console.log('[PDF] Page ' + (i + 1) + ': no text found');
            }
        }

        if (allTexts.length === 0) {
            return { photoUrl: photoUrl, checks: [], rawText: '' };
        }

        // Combine all page texts with separators, then parse all at once with Claude
        var combinedText = allTexts.map(function(t, i) {
            return (i > 0 ? '\n--- עמוד ' + (i + 1) + ' ---\n' : '') + t;
        }).join('');

        console.log('[PDF] Combined OCR: ' + allTexts.length + ' pages, sending to Claude...');

        var checks = await parseChecksWithClaude(combinedText);

        return {
            photoUrl: photoUrl,
            checks: checks.map(function(c, i) {
                return { date: c.date || '', amount: parseFloat(c.amount) || 0, index: i + 1 };
            }),
            rawText: combinedText,
            pageCount: pageFiles.length
        };

    } catch (err) {
        console.error('[PDF] Pipeline error:', err.message);
        return { photoUrl: '', checks: [], rawText: '' };
    } finally {
        // Cleanup temp files
        try {
            var files = fs.readdirSync(tmpDir);
            files.forEach(function(f) { fs.unlinkSync(tmpDir + '/' + f); });
            fs.rmdirSync(tmpDir);
        } catch (e) {}
    }
}

// ==================== Leads Management ====================

async function saveLead(leadData) {
    var firestore = initFirebase();

    // Phone lookup — enrich name if missing
    var leadName = (leadData.name || '').trim();
    var leadPhone = (leadData.phone || '').trim();
    var nameSource = '';

    if ((!leadName || /^\d+$/.test(leadName)) && leadPhone) {
        try {
            var lookup = await lookupPhone(leadPhone, firestore);
            if (lookup && lookup.name) {
                leadName = lookup.name;
                nameSource = lookup.source;
                console.log('[Leads] Phone lookup: ' + leadPhone + ' → ' + leadName + ' (' + nameSource + ')');
            }
        } catch (e) {
            console.error('[Leads] Phone lookup failed:', e.message);
        }
    }

    var record = {
        name: leadName,
        phone: leadPhone,
        phoneLast7: getLast7(leadData.phone),
        subject: (leadData.subject || '').trim(),
        source: leadData.type || 'unknown',
        status: 'new',
        statusNote: '',
        priority: leadData.priority || 'normal',
        assignedTo: null,
        assignedAt: null,
        followupAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        originalMessage: (leadData.raw || '').substring(0, 500),
        crmUpdated: false,
        escalated: false,
        nameSource: nameSource || null,
        history: [{
            action: 'created',
            by: 'bot',
            at: new Date().toISOString(),
            note: 'ליד נקלט מ-' + (leadData.type || 'unknown') + (nameSource ? ' (שם מ-' + nameSource + ')' : '')
        }]
    };

    // Link to clients collection
    if (record.phone) {
        try {
            var clientId = await getOrCreateClient({
                name: record.name,
                phone: record.phone,
                source: 'whatsapp_lead'
            });
            if (clientId) record.clientId = clientId;
        } catch (e) {
            console.error('[Leads] Client link failed:', e.message);
        }
    }

    try {
        var docRef = await firestore.collection('leads').add(record);
        console.log('[Leads] Saved: ' + (record.name || record.phone) + ' — ' + docRef.id);
        return docRef.id;
    } catch (err) {
        console.error('[Leads] Save failed:', err.message);
        return null;
    }
}

async function assignLead(docId, assigneeName) {
    var firestore = initFirebase();

    try {
        await firestore.collection('leads').doc(docId).update({
            assignedTo: assigneeName,
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'assigned',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion({
                action: 'assigned',
                by: assigneeName,
                at: new Date().toISOString(),
                note: 'שויך ל-' + assigneeName
            })
        });
        console.log('[Leads] Assigned: ' + docId + ' → ' + assigneeName);
        return true;
    } catch (err) {
        console.error('[Leads] Assign failed:', err.message);
        return false;
    }
}

async function updateLeadStatus(docId, status, updatedBy, note, followupAt) {
    var firestore = initFirebase();

    try {
        var updates = {
            status: status,
            statusNote: note || '',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion({
                action: status,
                by: updatedBy || 'unknown',
                at: new Date().toISOString(),
                note: note || ''
            })
        };

        if (followupAt) {
            updates.followupAt = new Date(followupAt);
        }

        if (status === 'closed' || status === 'not_relevant') {
            updates.followupAt = null;
        }

        await firestore.collection('leads').doc(docId).update(updates);
        console.log('[Leads] Status: ' + docId + ' → ' + status);
        return true;
    } catch (err) {
        console.error('[Leads] Status update failed:', err.message);
        return false;
    }
}

async function getLeadStats(daysBack) {
    var firestore = initFirebase();

    try {
        var since = new Date();
        since.setDate(since.getDate() - (daysBack || 7));

        var snapshot = await firestore.collection('leads')
            .where('createdAt', '>=', since)
            .orderBy('createdAt', 'desc')
            .get();

        var stats = {
            total: 0,
            byStatus: {},
            byAssignee: {},
            unassigned: 0
        };

        snapshot.forEach(function(doc) {
            var d = doc.data();
            stats.total++;

            var st = d.status || 'new';
            stats.byStatus[st] = (stats.byStatus[st] || 0) + 1;

            if (d.assignedTo) {
                if (!stats.byAssignee[d.assignedTo]) {
                    stats.byAssignee[d.assignedTo] = { total: 0, closed: 0, not_relevant: 0 };
                }
                stats.byAssignee[d.assignedTo].total++;
                if (st === 'closed') stats.byAssignee[d.assignedTo].closed++;
                if (st === 'not_relevant') stats.byAssignee[d.assignedTo].not_relevant++;
            } else {
                stats.unassigned++;
            }
        });

        return stats;
    } catch (err) {
        console.error('[Leads] Stats error:', err.message);
        return null;
    }
}

async function getDueFollowups() {
    var firestore = initFirebase();

    try {
        var now = new Date();
        // Only look at leads created in the last 14 days (older = expired)
        var maxAge = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        // Simple query without orderBy to avoid composite index requirement
        var snapshot = await firestore.collection('leads')
            .where('status', 'in', ['assigned', 'contacted', 'followup', 'no_answer'])
            .limit(200)
            .get();

        var due = [];
        snapshot.forEach(function(doc) {
            var d = doc.data();

            // Skip imported leads — they don't get followup reminders
            if (d.importedFromCRM === true) return;

            // Skip leads without followupAt or where followup isn't due yet
            if (!d.followupAt) return;
            var followupTime = d.followupAt.toDate ? d.followupAt.toDate() : new Date(d.followupAt);
            if (followupTime > now) return;

            // Skip if no assignee
            if (!d.assignedTo) return;

            // Calculate lead age
            var createdTime = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt || 0);
            var ageHours = (now - createdTime) / (1000 * 60 * 60);
            var ageDays = ageHours / 24;

            // Followup escalation rules:
            // Day 0-1: remind every check (every 10 min)
            // Day 1-3: remind once per day
            // Day 3-7: remind once at day 3 and day 7
            // Day 7-14: final reminder at day 7, then expired
            // Day 14+: no reminders (expired)
            var reminderLevel = 'normal';
            if (ageDays > 14) return; // expired
            if (ageDays > 7) reminderLevel = 'final';
            else if (ageDays > 3) reminderLevel = 'weekly';
            else if (ageDays > 1) reminderLevel = 'daily';

            due.push({
                docId: doc.id,
                name: d.name,
                phone: d.phone,
                assignedTo: d.assignedTo,
                status: d.status,
                statusNote: d.statusNote,
                ageDays: Math.round(ageDays * 10) / 10,
                reminderLevel: reminderLevel,
                followupAt: followupTime
            });
        });

        // Sort by followup time ascending (most urgent first)
        due.sort(function(a, b) {
            return (a.followupAt ? a.followupAt.getTime() : 0) - (b.followupAt ? b.followupAt.getTime() : 0);
        });

        return due;
    } catch (err) {
        console.error('[Leads] Followup query error:', err.message);
        return [];
    }
}

// ==================== Cross-Collection Phone Lookup ====================

// Phone normalization — delegated to shared phone-utils.js
var normalizePhone = sharedNormalizePhone;
var normalizePhoneForSearch = normalizePhone;
var getLast7 = sharedGetLast7;

// ==================== Client Identity — getOrCreateClient ====================
// SHARED LOGIC — keep in sync with js/client-utils.js

async function getOrCreateClient(data) {
    var firestore = initFirebase();
    try {
        var phone = normalizePhone(data.phone);
        var last7 = getLast7(data.phone);
        var name = (data.name || '').trim();

        if (!last7 && !data.idNumber) return null;

        var found = null;

        // 1. חיפוש ראשי לפי phoneLast7
        if (last7) {
            var snap = await firestore.collection('clients')
                .where('phoneLast7', '==', last7)
                .limit(5)
                .get();

            if (!snap.empty) {
                snap.forEach(function(doc) {
                    if (!found) {
                        var d = doc.data();
                        if (d.phone === phone || snap.size === 1) {
                            found = { id: doc.id, data: d };
                        }
                    }
                });
                if (!found) {
                    var firstDoc = snap.docs[0];
                    found = { id: firstDoc.id, data: firstDoc.data() };
                }
            }
        }

        // 2. fallback לפי ת.ז.
        if (!found && data.idNumber) {
            var idDigits = data.idNumber.replace(/\D/g, '');
            if (idDigits.length >= 5) {
                var idSnap = await firestore.collection('clients')
                    .where('idNumber', '==', idDigits)
                    .limit(1)
                    .get();
                if (!idSnap.empty) {
                    found = { id: idSnap.docs[0].id, data: idSnap.docs[0].data() };
                }
            }
        }

        // 3. נמצא — עדכון שדות ריקים בלבד (merge up)
        if (found) {
            var updates = {};
            var existing = found.data;

            if (!existing.phone && phone) updates.phone = phone;
            if (!existing.phoneLast7 && last7) updates.phoneLast7 = last7;
            if (!existing.name && name) updates.name = name;
            if (!existing.email && data.email) updates.email = data.email;
            if (!existing.idNumber && data.idNumber) updates.idNumber = data.idNumber.replace(/\D/g, '');
            if (!existing.address && data.address) updates.address = data.address;
            if (data.attorney) updates.attorney = data.attorney;
            if (data.branch) updates.branch = data.branch;
            if (data.caseNumber && !existing.caseNumber) updates.caseNumber = data.caseNumber;

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                await firestore.collection('clients').doc(found.id).update(updates);
            }

            return found.id;
        }

        // 4. לא נמצא — יצירת לקוח חדש
        var clientDoc = {
            name: name,
            phone: phone,
            phoneLast7: last7,
            email: data.email || '',
            idNumber: data.idNumber ? data.idNumber.replace(/\D/g, '') : '',
            address: data.address || '',
            attorney: data.attorney || '',
            branch: data.branch || '',
            caseNumber: data.caseNumber || '',
            source: data.source || 'unknown',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: data.createdBy || 'whatsapp-bot'
        };

        var docRef = await firestore.collection('clients').add(clientDoc);
        console.log('[Clients] Created: ' + (name || phone) + ' — ' + docRef.id);
        return docRef.id;

    } catch (err) {
        console.error('[Clients] getOrCreateClient error:', err.message);
        return null;
    }
}

// ==================== Cross-Collection Phone Lookup ====================

async function findClientAcrossCollections(phone) {
    var firestore = initFirebase();
    var normalized = normalizePhone(phone);
    var last7 = getLast7(phone);
    if (!last7 || last7.length < 7) return { client: null, lead: null, sales: [], billing: null };

    var result = { client: null, lead: null, sales: [], billing: null };

    try {
        // 0. Fast path — check clients collection first (indexed query)
        var clientSnap = await firestore.collection('clients')
            .where('phoneLast7', '==', last7)
            .limit(1)
            .get();

        if (!clientSnap.empty) {
            var cDoc = clientSnap.docs[0];
            result.client = { docId: cDoc.id, data: cDoc.data() };
        }

        // 1. Search leads by phoneLast7 (indexed)
        var leadsSnap = await firestore.collection('leads')
            .where('phoneLast7', '==', last7)
            .limit(5)
            .get();

        leadsSnap.forEach(function(doc) {
            if (!result.lead) {
                result.lead = { docId: doc.id, data: doc.data() };
            }
        });

        // 2. Search sales_records — get recent 300 and match by last 7 digits
        var salesSnap = await firestore.collection('sales_records')
            .orderBy('timestamp', 'desc')
            .limit(300)
            .get();

        salesSnap.forEach(function(doc) {
            var d = doc.data();
            if (getLast7(d.phone) === last7) {
                result.sales.push({
                    docId: doc.id,
                    clientName: d.clientName,
                    amount: d.amountWithVat || d.amountBeforeVat || 0,
                    type: d.transactionType,
                    date: d.date || d.timestamp,
                    attorney: d.formFillerName || d.attorney
                });
            }
        });

        // 3. Search recurring_billing — get all and match
        var billingSnap = await firestore.collection('recurring_billing')
            .limit(200)
            .get();

        billingSnap.forEach(function(doc) {
            var d = doc.data();
            if (getLast7(d.phone) === last7) {
                result.billing = {
                    docId: doc.id,
                    clientName: d.clientName,
                    monthlyAmount: d.recurringMonthlyAmount,
                    status: d.status
                };
            }
        });

        console.log('[CrossLookup] ' + last7 + ': client=' + (result.client ? 'YES' : 'no') + ' lead=' + (result.lead ? 'YES' : 'no') + ' sales=' + result.sales.length + ' billing=' + (result.billing ? 'YES' : 'no'));

    } catch (err) {
        console.error('[CrossLookup] Error:', err.message);
    }

    return result;
}

// Save or update lead (dedup by phone — phoneLast7 field or full scan)
async function saveOrUpdateLead(leadData) {
    var firestore = initFirebase();
    var last7 = getLast7(leadData.phone);
    var normalized = normalizePhoneForSearch(leadData.phone);

    if (!last7 || last7.length < 7) return saveLead(leadData); // No phone, just save new

    // Search for existing lead: first try phoneLast7 field (fast), then fallback to full scan
    try {
        var found = null;

        // Method 1: Direct query on phoneLast7 field (if exists)
        var exactSnap = await firestore.collection('leads')
            .where('phoneLast7', '==', last7)
            .limit(5)
            .get();

        if (!exactSnap.empty) {
            exactSnap.forEach(function(doc) {
                if (!found) found = { docId: doc.id, data: doc.data() };
            });
        }

        // Method 2: If not found, try normalized phone
        if (!found) {
            var normSnap = await firestore.collection('leads')
                .where('phone', '==', normalized)
                .limit(5)
                .get();

            if (!normSnap.empty) {
                normSnap.forEach(function(doc) {
                    if (!found) found = { docId: doc.id, data: doc.data() };
                });
            }
        }

        // Method 3: Broader search with phone prefix
        if (!found) {
            var prefix = normalized.substring(0, 7);
            var prefixSnap = await firestore.collection('leads')
                .where('phone', '>=', prefix)
                .where('phone', '<=', prefix + '\uf8ff')
                .limit(20)
                .get();

            prefixSnap.forEach(function(doc) {
                if (!found) {
                    var d = doc.data();
                    if (getLast7(d.phone) === last7) {
                        found = { docId: doc.id, data: d };
                    }
                }
            });
        }

        if (found) {
            // Update existing lead — not creating a new one!
            console.log('[Leads] Dedup match: ' + last7 + ' → ' + found.docId);
            var updates = {
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                phoneLast7: last7  // ensure field exists for future queries
            };
            // Update name if we have one and existing doesn't
            var enrichedName = leadData.name;
            if ((!enrichedName || /^\d+$/.test(enrichedName)) && (!found.data.name || /^\d+$/.test(found.data.name))) {
                // Neither lead data nor existing has a name — try phone lookup
                try {
                    var lookupResult = await lookupPhone(leadData.phone, firestore);
                    if (lookupResult && lookupResult.name) {
                        enrichedName = lookupResult.name;
                        updates.nameSource = lookupResult.source;
                        console.log('[Leads] Dedup enriched: ' + leadData.phone + ' → ' + enrichedName);
                    }
                } catch (e) {}
            }
            if (enrichedName && (!found.data.name || /^\d+$/.test(found.data.name))) {
                updates.name = enrichedName.trim();
            }
            if (leadData.subject && !found.data.subject) updates.subject = leadData.subject;
            if (leadData.raw) updates.originalMessage = (leadData.raw || '').substring(0, 500);

            updates.history = admin.firestore.FieldValue.arrayUnion({
                action: 'updated',
                by: 'bot',
                at: new Date().toISOString(),
                note: 'עדכון מ-' + (leadData.type || 'unknown') + (leadData.name ? ' — ' + leadData.name : '')
            });

            await firestore.collection('leads').doc(found.docId).update(updates);
            console.log('[Leads] Updated existing: ' + normalized + ' — ' + found.docId);
            return found.docId;
        }
    } catch (err) {
        console.error('[Leads] Dedup search error:', err.message);
    }

    // Not found — create new
    return saveLead(leadData);
}

// Set meeting date on a lead
async function setMeetingDate(docId, meetingDate, note, meetingType, meetLink) {
    var firestore = initFirebase();

    try {
        var updates = {
            meetingDate: new Date(meetingDate),
            meetingType: meetingType || 'physical',
            meetingReminder1Sent: false,
            meetingReminder2Sent: false,
            status: 'closed',
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion({
                action: 'meeting_set',
                by: 'bot',
                at: new Date().toISOString(),
                note: note || 'פגישה נקבעה'
            })
        };
        if (meetLink) updates.meetLink = meetLink;
        await firestore.collection('leads').doc(docId).update(updates);
        console.log('[Leads] Meeting set: ' + docId + ' → ' + meetingDate);
        return true;
    } catch (err) {
        console.error('[Leads] Set meeting failed:', err.message);
        return false;
    }
}

// Get leads with upcoming meetings that need reminders
async function getUpcomingMeetings() {
    var firestore = initFirebase();

    try {
        var now = new Date();
        var in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

        var snapshot = await firestore.collection('leads')
            .where('meetingDate', '>=', now)
            .where('meetingDate', '<=', in48h)
            .get();

        var meetings = [];
        snapshot.forEach(function(doc) {
            var d = doc.data();
            if (d.meetingReminder1Sent && d.meetingReminder2Sent) return; // Already sent both
            meetings.push({
                docId: doc.id,
                name: d.name,
                phone: d.phone,
                meetingDate: d.meetingDate.toDate ? d.meetingDate.toDate() : new Date(d.meetingDate),
                meetingType: d.meetingType || 'physical',
                meetLink: d.meetLink || null,
                reminder1Sent: d.meetingReminder1Sent || false,
                reminder2Sent: d.meetingReminder2Sent || false,
                assignedTo: d.assignedTo
            });
        });

        return meetings;
    } catch (err) {
        console.error('[Leads] Meeting query error:', err.message);
        return [];
    }
}

// Mark meeting reminder as sent (or reset both with reminderNum=0)
async function markMeetingReminderSent(docId, reminderNum) {
    var firestore = initFirebase();
    try {
        if (reminderNum === 0) {
            // Reset both — enable reminders
            await firestore.collection('leads').doc(docId).update({
                meetingReminder1Sent: false,
                meetingReminder2Sent: false
            });
        } else {
            var field = reminderNum === 1 ? 'meetingReminder1Sent' : 'meetingReminder2Sent';
            var update = {};
            update[field] = true;
            await firestore.collection('leads').doc(docId).update(update);
        }
        return true;
    } catch (err) {
        return false;
    }
}

// ==================== OCR Lead Image ====================

async function ocrLeadImage(base64Data, mimetype) {
    try {
        console.log('[OCR Lead] Processing image (' + Math.round(base64Data.length / 1024) + 'KB)...');

        // Step 1: Vision OCR
        var ocrText = await visionOCR(base64Data);
        if (!ocrText || ocrText.length < 5) {
            console.log('[OCR Lead] No text extracted');
            return { name: null, phone: null, subject: null, rawText: '' };
        }

        console.log('[OCR Lead] Raw text: ' + ocrText.substring(0, 200));

        // Step 2: Claude extracts lead details
        var anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicKey) return { name: null, phone: null, subject: null, rawText: ocrText };

        var prompt = 'חלץ מהטקסט הבא פרטי ליד (פנייה למשרד עורכי דין).\n\n' +
            'טקסט OCR:\n' + ocrText.substring(0, 1500) + '\n\n' +
            'החזר JSON בלבד:\n' +
            '{\n' +
            '  "name": "שם הלקוח הפוטנציאלי (לא שם האתר/המערכת)",\n' +
            '  "phone": "מספר טלפון ישראלי (05X-XXXXXXX) — null אם אין",\n' +
            '  "subject": "נושא הפנייה (3-5 מילים) — null אם לא ברור"\n' +
            '}\n' +
            'אם אין שום מידע רלוונטי, החזר name: null, phone: null, subject: null.\n' +
            'JSON בלבד.';

        var requestBody = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }]
        });

        var res = await httpRequest({
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        }, requestBody);

        if (res.status !== 200) {
            console.error('[OCR Lead] Claude error:', res.status);
            return { name: null, phone: null, subject: null, rawText: ocrText };
        }

        var responseText = res.data.content[0].text.trim();
        var jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { name: null, phone: null, subject: null, rawText: ocrText };

        var parsed = JSON.parse(jsonMatch[0]);
        console.log('[OCR Lead] Parsed:', JSON.stringify(parsed));
        parsed.rawText = ocrText;
        return parsed;
    } catch (err) {
        console.error('[OCR Lead] Error:', err.message);
        return { name: null, phone: null, subject: null, rawText: '' };
    }
}

// ==================== DM Lead Queries ====================

async function getMyLeads(assigneeName) {
    var firestore = initFirebase();
    try {
        var snapshot = await firestore.collection('leads')
            .where('assignedTo', '==', assigneeName)
            .limit(50)
            .get();

        var leads = [];
        snapshot.forEach(function(doc) {
            var d = doc.data();
            var st = d.status || 'new';
            // Only active leads — exclude closed and not_relevant
            if (st === 'not_relevant' || st === 'closed') return;
            leads.push({
                docId: doc.id,
                name: d.name || '',
                phone: d.phone || '',
                status: st,
                subject: d.subject || '',
                source: d.source || '',
                createdAt: d.createdAt,
                followupAt: d.followupAt
            });
        });

        // Sort by createdAt desc (newest first)
        leads.sort(function(a, b) {
            var ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
            var tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
            return tb - ta;
        });

        return leads.slice(0, 20);
    } catch (err) {
        console.error('[Leads] getMyLeads error:', err.message);
        return [];
    }
}

async function searchLead(query) {
    if (!query || query.trim().length < 2) return null;
    var firestore = initFirebase();
    try {
        var digits = query.replace(/\D/g, '');
        var isPhone = digits.length >= 7;

        var found = null;

        if (isPhone) {
            // Search by phone (last 7 digits)
            var last7 = digits.slice(-7);
            var snap = await firestore.collection('leads')
                .where('phoneLast7', '==', last7)
                .limit(5)
                .get();

            snap.forEach(function(doc) {
                if (!found) found = { docId: doc.id, data: doc.data() };
            });
        }

        if (!found) {
            // Search by name — load recent 300 and filter
            var nameSnap = await firestore.collection('leads')
                .orderBy('createdAt', 'desc')
                .limit(300)
                .get();

            var queryLower = query.trim().toLowerCase();
            nameSnap.forEach(function(doc) {
                if (found) return;
                var d = doc.data();
                var name = (d.name || '').toLowerCase();
                if (name.indexOf(queryLower) !== -1) {
                    found = { docId: doc.id, data: d };
                }
            });
        }

        if (!found) return null;

        // Cross-lookup for enrichment
        var result = { lead: found, sales: [], billing: null };
        var leadPhone = found.data.phone;
        if (leadPhone) {
            var cross = await findClientAcrossCollections(leadPhone);
            result.sales = cross.sales || [];
            result.billing = cross.billing || null;
        }

        return result;
    } catch (err) {
        console.error('[Leads] searchLead error:', err.message);
        return null;
    }
}

module.exports = {
    initFirebase,
    saveTransaction,
    syncToSheets,
    findClient,
    verifyTransaction,
    getMonthlySummary,
    findRecordForEdit,
    updateRecord,
    uploadCheckPhoto,
    processCheckPhoto,
    processCheckPDF,
    getWeeklySummary,
    saveLead,
    saveOrUpdateLead,
    assignLead,
    updateLeadStatus,
    getLeadStats,
    getDueFollowups,
    findClientAcrossCollections,
    setMeetingDate,
    getUpcomingMeetings,
    markMeetingReminderSent,
    ocrLeadImage,
    getOrCreateClient,
    normalizePhone,
    getLast7,
    getMyLeads,
    searchLead
};
