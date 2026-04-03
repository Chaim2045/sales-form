// Quick script to check recent sales_records
require('dotenv').config();
var admin = require('firebase-admin');
var sa = require('./firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
var db = admin.firestore();

db.collection('sales_records').orderBy('timestamp', 'desc').limit(20).get().then(function(s) {
    console.log('Last 20 sales_records:\n');
    s.forEach(function(d) {
        var r = d.data();
        console.log([
            r.date || '?',
            (r.clientName || '?').substring(0, 25).padEnd(25),
            (r.transactionType || '?').padEnd(20),
            String(r.amountBeforeVat || '?').padStart(8),
            (r.paymentMethod || '?').padEnd(15),
            'src:' + (r.source || 'web')
        ].join(' | '));
    });
    process.exit(0);
}).catch(function(e) { console.error(e.message); process.exit(1); });
