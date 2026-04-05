// ========== Client Utils — getOrCreateClient ==========
// מקור אמת יחיד לזהות לקוח — clients collection
// SHARED LOGIC — keep in sync with whatsapp-bot/firebase.js getOrCreateClient()

/**
 * חיפוש או יצירת לקוח ב-clients collection
 * @param {Object} data - פרטי הלקוח
 * @param {string} data.name
 * @param {string} data.phone
 * @param {string} [data.email]
 * @param {string} [data.idNumber]
 * @param {string} [data.address]
 * @param {string} [data.attorney]
 * @param {string} [data.branch]
 * @param {string} [data.caseNumber]
 * @param {string} [data.source] - "sales_form" | "billing" | "whatsapp_lead"
 * @returns {Promise<string|null>} clientId or null on failure
 */
async function getOrCreateClient(data) {
    try {
        var phone = normalizePhone(data.phone);
        var last7 = getLast7(data.phone);
        var name = (data.name || '').trim();

        // חייבים לפחות טלפון או ת.ז.
        if (!last7 && !data.idNumber) return null;

        var found = null;

        // 1. חיפוש ראשי לפי phoneLast7
        if (last7) {
            var snap = await db.collection('clients')
                .where('phoneLast7', '==', last7)
                .limit(5)
                .get();

            if (!snap.empty) {
                // אם יש כמה תוצאות — מצא את זו עם הטלפון המלא התואם
                snap.forEach(function(doc) {
                    if (!found) {
                        var d = doc.data();
                        if (d.phone === phone || snap.size === 1) {
                            found = { id: doc.id, data: d };
                        }
                    }
                });
                // אם לא מצאנו exact match, ניקח את הראשון
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
                var idSnap = await db.collection('clients')
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
                updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('clients').doc(found.id).update(updates);
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
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: authUser ? authUser.email : 'unknown'
        };

        var docRef = await db.collection('clients').add(clientDoc);
        return docRef.id;

    } catch (err) {
        console.error('[ClientUtils] getOrCreateClient error:', err);
        return null;
    }
}
