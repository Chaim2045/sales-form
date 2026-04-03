require('dotenv').config();
var admin = require('firebase-admin');
var sa = require('./firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
var db = admin.firestore();

var search = process.argv[2] || 'אופיר';

db.collection('sales_records').orderBy('timestamp', 'desc').limit(50).get().then(function(s) {
    var found = false;
    s.forEach(function(d) {
        var r = d.data();
        if ((r.clientName || '').includes(search)) {
            console.log('FOUND:', r.date, '|', r.clientName, '|', r.amountBeforeVat, '|', r.source || 'web');
            found = true;
        }
    });
    if (!found) console.log('Not found: ' + search);
    process.exit(0);
});
