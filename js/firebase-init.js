// Firebase Configuration - Using environment variables
const firebaseConfig = {
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
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ========== Global Variables ==========

let authUser = null;
let currentStep = 1;
let currentUser = '';
let currentUserPermissions = {};
let currentUserRole = '';
const totalSteps = 4;
let searchTimeout = null;

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

        } catch (err) {
            console.error('Error loading user data:', err);
            // Fallback: try restoring from sessionStorage
            var savedUser = sessionStorage.getItem('currentUser');
            var savedPerms = sessionStorage.getItem('permissions');
            var savedRole = sessionStorage.getItem('userRole');
            if (savedUser && savedPerms) {
                currentUser = savedUser;
                currentUserPermissions = JSON.parse(savedPerms);
                currentUserRole = savedRole || '';
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('mainContainer').style.display = '';
                if (currentUserPermissions.salesForm) {
                    document.getElementById('mainForm').classList.remove('hidden');
                }
                if (typeof updateNavVisibility === 'function') updateNavVisibility();
            }
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
