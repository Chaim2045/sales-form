// Firebase Configuration - Using environment variables
var firebaseConfig = {
    apiKey: window.ENV_CONFIG.FIREBASE_API_KEY,
    authDomain: window.ENV_CONFIG.FIREBASE_AUTH_DOMAIN,
    databaseURL: window.ENV_CONFIG.FIREBASE_DATABASE_URL,
    projectId: window.ENV_CONFIG.FIREBASE_PROJECT_ID,
    storageBucket: window.ENV_CONFIG.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: window.ENV_CONFIG.FIREBASE_MESSAGING_SENDER_ID,
    appId: window.ENV_CONFIG.FIREBASE_APP_ID,
    measurementId: window.ENV_CONFIG.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
var auth = firebase.auth();
var db = firebase.firestore();
var storage = firebase.storage();

// ========== Global Variables ==========

var VAT_RATE = 0.18; // שיעור מע"מ — מקום אחד מרכזי

// ========== ולידציית סיסמה חזקה ==========

// 6+ תווים, אות גדולה, מספר, תו מיוחד
function validateStrongPassword(password) {
    if (!password || password.length < 6) return 'סיסמה חייבת להכיל לפחות 6 תווים';
    if (!/[A-Z]/.test(password)) return 'סיסמה חייבת להכיל אות גדולה באנגלית';
    if (!/[0-9]/.test(password)) return 'סיסמה חייבת להכיל מספר';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return 'סיסמה חייבת להכיל תו מיוחד (!@#$%...)';
    return null; // valid
}

// ========== ולידציות ישראליות (משותף) ==========

function validateIsraeliPhone(phone) {
    var digits = phone.replace(/\D/g, '');
    return /^0[2-9]\d{7,8}$/.test(digits);
}

function validateIsraeliId(id) {
    var digits = id.replace(/\D/g, '');
    if (digits.length < 5 || digits.length > 9) return false;
    digits = digits.padStart(9, '0');
    var sum = 0;
    for (var i = 0; i < 9; i++) {
        var d = parseInt(digits[i], 10) * ((i % 2) + 1);
        sum += d > 9 ? d - 9 : d;
    }
    return sum % 10 === 0;
}

var authUser = null;
var currentStep = 1;
var currentUser = '';
var currentUserPermissions = {};
var currentUserRole = '';
var totalSteps = 4;
var searchTimeout = null;

// ========== Firebase Authentication ==========

auth.onAuthStateChanged(async function(user) {
    if (user) {
        authUser = user;

        try {
            // Load user data from Firestore
            var userDoc = await db.collection('users').doc(user.uid).get();

            if (!userDoc.exists || !userDoc.data().isActive) {
                // User doc missing or deactivated
                auth.signOut();
                return;
            }

            var userData = userDoc.data();
            currentUser = userData.displayName || '';
            currentUserPermissions = userData.permissions || {};
            currentUserRole = userData.role || '';

            // Save to sessionStorage for page reloads
            sessionStorage.setItem('currentUser', currentUser);
            sessionStorage.setItem('permissions', JSON.stringify(currentUserPermissions));
            sessionStorage.setItem('userRole', currentUserRole);

            // Show main UI
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('mainContainer').style.display = '';

            // Show user greeting
            if (typeof showUserGreeting === 'function') {
                showUserGreeting(currentUser);
            }

            // Show mainForm only if user has salesForm permission
            if (currentUserPermissions.salesForm) {
                document.getElementById('mainForm').classList.remove('hidden');
                // Auto-select attorney
                var attSelect = document.getElementById('attorney');
                if (attSelect) {
                    for (var i = 0; i < attSelect.options.length; i++) {
                        if (attSelect.options[i].value === currentUser) {
                            attSelect.value = currentUser;
                            break;
                        }
                    }
                }
                if (typeof prefillFromLocalStorage === 'function') prefillFromLocalStorage();
            } else {
                document.getElementById('mainForm').classList.add('hidden');
            }

            // Update navigation visibility based on permissions
            if (typeof updateNavVisibility === 'function') {
                updateNavVisibility();
            }

            logAuditEvent('login_success', { user: currentUser, role: currentUserRole });

            // עדכון lastLogin ב-user doc
            db.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(function(e) { console.error('lastLogin update error:', e); });

        } catch (err) {
            console.error('Error loading user data:', err);
            // Security: do not fallback to sessionStorage — sign out
            auth.signOut();
        }
    } else {
        authUser = null;
        currentUser = '';
        currentUserPermissions = {};
        currentUserRole = '';
        sessionStorage.removeItem('currentUser');
        sessionStorage.removeItem('permissions');
        sessionStorage.removeItem('userRole');
        document.getElementById('loginScreen').style.display = '';
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('billingManagement').classList.remove('active');
        if (document.getElementById('salesManagement')) {
            document.getElementById('salesManagement').classList.remove('active');
        }
        if (document.getElementById('activityLogManagement')) {
            document.getElementById('activityLogManagement').classList.remove('active');
        }
        if (document.getElementById('userManagement')) {
            document.getElementById('userManagement').classList.remove('active');
        }
    }
});

// ========== Session Timeout (30 min idle) ==========

var _sessionTimeoutId = null;
var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function resetSessionTimeout() {
    if (_sessionTimeoutId) clearTimeout(_sessionTimeoutId);
    if (authUser) {
        _sessionTimeoutId = setTimeout(function() {
            logAuditEvent('session_timeout', { user: currentUser });
            auth.signOut();
            alert('פג תוקף ההתחברות עקב חוסר פעילות. נא להתחבר מחדש.');
        }, SESSION_TIMEOUT_MS);
    }
}

['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(function(evt) {
    document.addEventListener(evt, resetSessionTimeout, { passive: true });
});

auth.onAuthStateChanged(function(user) {
    if (user) {
        resetSessionTimeout();
    } else {
        if (_sessionTimeoutId) clearTimeout(_sessionTimeoutId);
    }
});

// ========== Audit Log ==========

var _lastAuditAction = '';
var _lastAuditTime = 0;
var AUDIT_DEDUP_MS = 5000;

function logAuditEvent(action, details) {
    try {
        var now = Date.now();
        if (action === _lastAuditAction && (now - _lastAuditTime) < AUDIT_DEDUP_MS) {
            return;
        }
        _lastAuditAction = action;
        _lastAuditTime = now;

        db.collection('audit_log').add({
            action: action,
            details: details || {},
            performedBy: currentUser || 'unknown',
            authEmail: authUser ? authUser.email : null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            clientTimestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        });
    } catch (e) {
        console.error('Audit log error:', e);
    }
}

function logCardView(docId, clientName) {
    logAuditEvent('card_view', { docId: docId, clientName: clientName || '' });
}
