// ========== Authentication ==========

var _quickLoginAvailable = false; // true if saved credentials exist

function togglePasswordVisibility() {
    var input = document.getElementById('loginPassword');
    var wrapper = input.closest('.password-wrapper');
    var eyeOpen = wrapper.querySelector('.eye-open');
    var eyeClosed = wrapper.querySelector('.eye-closed');
    if (input.type === 'password') {
        input.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = '';
    } else {
        input.type = 'password';
        eyeOpen.style.display = '';
        eyeClosed.style.display = 'none';
    }
    input.focus();
}

function setLoginLoading(btn, loading) {
    if (loading) {
        btn.classList.add('is-loading');
        btn.querySelector('.login-btn-text').textContent = 'מתחבר...';
        btn.disabled = true;
    } else {
        btn.classList.remove('is-loading');
        btn.querySelector('.login-btn-text').textContent = 'כניסה';
        btn.disabled = false;
    }
}

async function handleLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    var errorEl = document.getElementById('loginError');
    var btn = document.getElementById('loginBtn');

    errorEl.textContent = '';

    if (!email) {
        errorEl.textContent = 'נא להזין אימייל';
        document.getElementById('loginEmail').focus();
        return;
    }
    if (!password) {
        errorEl.textContent = 'נא להזין סיסמה';
        document.getElementById('loginPassword').focus();
        return;
    }

    setLoginLoading(btn, true);

    try {
        await auth.signInWithEmailAndPassword(email, password);
        // Save credentials for quick login (biometric)
        storeCredentials(email, password);
        // onAuthStateChanged in firebase-init.js will handle the rest
    } catch (error) {
        var messages = {
            'auth/wrong-password': 'אימייל או סיסמה שגויים',
            'auth/user-not-found': 'אימייל או סיסמה שגויים',
            'auth/too-many-requests': 'יותר מדי ניסיונות, נסה שוב מאוחר יותר',
            'auth/invalid-credential': 'אימייל או סיסמה שגויים',
            'auth/user-disabled': 'החשבון הושבת — פנה למנהל',
            'auth/invalid-email': 'כתובת אימייל לא תקינה'
        };
        errorEl.textContent = messages[error.code] || 'שגיאת התחברות. נסה שנית.';
        logAuditEvent('login_failed', { email: email, reason: error.code });
    }

    setLoginLoading(btn, false);
}

// Enter key handlers
document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
});
document.getElementById('loginEmail').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('loginPassword').focus();
});

function handleLogout() {
    logAuditEvent('logout', { user: currentUser });
    currentUser = '';
    currentUserPermissions = {};
    currentUserRole = '';
    sessionStorage.removeItem('currentUser');
    sessionStorage.removeItem('permissions');
    sessionStorage.removeItem('userRole');
    // Reset UI
    document.getElementById('loginScreen').style.display = '';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('mainForm').classList.add('hidden');
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
    // Reset login form
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').textContent = '';
    // Clear draft on logout for security
    if (typeof clearDraft === 'function') clearDraft();
    // Show quick login button if credentials are saved
    checkQuickLoginAvailable();
    auth.signOut();
}

// ========== Quick Login (Biometric / Credential Management) ==========

function storeCredentials(email, password) {
    if (!window.PasswordCredential) return;
    try {
        var cred = new PasswordCredential({
            id: email,
            password: password,
            name: email
        });
        navigator.credentials.store(cred);
    } catch (e) {
        // Silently fail — not all browsers support this
    }
}

async function checkQuickLoginAvailable() {
    var btn = document.getElementById('quickLoginBtn');
    if (!btn) return;
    if (!window.PasswordCredential) {
        btn.style.display = 'none';
        return;
    }
    try {
        var cred = await navigator.credentials.get({
            password: true,
            mediation: 'silent'
        });
        if (cred) {
            _quickLoginAvailable = true;
            btn.style.display = '';
            btn.querySelector('.quick-login-name').textContent = cred.name || '';
        } else {
            btn.style.display = 'none';
        }
    } catch (e) {
        btn.style.display = 'none';
    }
}

async function handleQuickLogin() {
    if (!window.PasswordCredential) return;
    var errorEl = document.getElementById('loginError');
    var btn = document.getElementById('quickLoginBtn');

    try {
        var cred = await navigator.credentials.get({
            password: true,
            mediation: 'optional'
        });
        if (!cred || !cred.id || !cred.password) {
            errorEl.textContent = 'לא נמצאו פרטי כניסה שמורים';
            return;
        }

        btn.disabled = true;
        btn.querySelector('.quick-login-text').textContent = 'מתחבר...';

        await auth.signInWithEmailAndPassword(cred.id, cred.password);
        // onAuthStateChanged handles the rest
    } catch (error) {
        var messages = {
            'auth/wrong-password': 'סיסמה שגויה — נא להתחבר ידנית',
            'auth/user-not-found': 'משתמש לא נמצא',
            'auth/too-many-requests': 'יותר מדי ניסיונות',
            'auth/invalid-credential': 'פרטי כניסה שגויים — נא להתחבר ידנית',
            'auth/user-disabled': 'החשבון הושבת'
        };
        errorEl.textContent = messages[error.code] || 'שגיאה בכניסה מהירה. נסה ידנית.';
    }

    btn.disabled = false;
    btn.querySelector('.quick-login-text').textContent = 'כניסה מהירה';
}

// Check on page load if quick login is available
checkQuickLoginAvailable();
