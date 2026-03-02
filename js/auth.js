// ========== Authentication ==========

var usersList = []; // [{displayName, email}] loaded from public_users

// Load users list for login dropdown (public — no auth needed)
async function loadUsersList() {
    try {
        var snapshot = await db.collection('public_users').get();
        usersList = [];
        snapshot.forEach(function(doc) {
            var d = doc.data();
            if (d.displayName && d.email) {
                usersList.push({ displayName: d.displayName, email: d.email });
            }
        });
        usersList.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName, 'he');
        });

        var select = document.getElementById('loginUser');
        if (select) {
            var html = '<option value="">בחר שם...</option>';
            usersList.forEach(function(u) {
                html += '<option value="' + escapeHTML(u.displayName) + '">' + escapeHTML(u.displayName) + '</option>';
            });
            select.innerHTML = html;
        }
    } catch (e) {
        console.error('Failed to load users list:', e);
    }
}

// Run on page load
loadUsersList();

async function handleLogin() {
    var selectedName = document.getElementById('loginUser').value;
    var password = document.getElementById('loginPassword').value;
    var errorEl = document.getElementById('loginError');
    var btn = document.getElementById('loginBtn');

    errorEl.textContent = '';

    if (!selectedName) {
        errorEl.textContent = 'נא לבחור שם משתמש';
        return;
    }
    if (!password) {
        errorEl.textContent = 'נא להזין סיסמה';
        return;
    }

    // Find email for selected name
    var userEntry = usersList.find(function(u) { return u.displayName === selectedName; });
    if (!userEntry) {
        errorEl.textContent = 'משתמש לא נמצא';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'מתחבר...';

    try {
        await auth.signInWithEmailAndPassword(userEntry.email, password);
        // onAuthStateChanged in firebase-init.js will handle the rest
    } catch (error) {
        var messages = {
            'auth/wrong-password': 'סיסמה שגויה',
            'auth/user-not-found': 'משתמש לא נמצא במערכת',
            'auth/too-many-requests': 'יותר מדי ניסיונות, נסה שוב מאוחר יותר',
            'auth/invalid-credential': 'סיסמה שגויה',
            'auth/user-disabled': 'החשבון הושבת — פנה למנהל'
        };
        errorEl.textContent = messages[error.code] || 'שגיאת התחברות. נסה שנית.';
        logAuditEvent('login_failed', { user: selectedName, reason: error.code });
    }

    btn.disabled = false;
    btn.textContent = 'כניסה';
}

// Enter key handlers
document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
});
document.getElementById('loginUser').addEventListener('keydown', function(e) {
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
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').textContent = '';
    auth.signOut();
}
