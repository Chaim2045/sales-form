// ========== User Management (Master Only) ==========

var umUsers = []; // loaded from Firestore
var _resetPwUid = null; // uid for password reset

var ROLE_LABELS = {
    master: 'מנהל ראשי',
    office_manager: 'מנהל/ת משרד',
    salesperson: 'איש מכירות',
    accountant: 'הנה"ח'
};

var DEFAULT_PERMISSIONS = {
    master: { salesForm: true, billingManagement: true, salesManagement: true, activityLog: true, userManagement: true },
    office_manager: { salesForm: true, billingManagement: true, salesManagement: true, activityLog: false, userManagement: false },
    salesperson: { salesForm: true, billingManagement: false, salesManagement: true, activityLog: false, userManagement: false },
    accountant: { salesForm: false, billingManagement: true, salesManagement: true, activityLog: false, userManagement: false }
};

function showUserManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('mainForm').classList.add('hidden');
    document.getElementById('userManagement').classList.add('active');
    loadUsersForManagement();
}

async function loadUsersForManagement() {
    var loading = document.getElementById('umLoading');
    var tableView = document.getElementById('umTableView');
    var empty = document.getElementById('umEmpty');

    loading.style.display = '';
    tableView.style.display = 'none';
    empty.style.display = 'none';

    try {
        var snapshot = await db.collection('users').get();
        umUsers = [];
        snapshot.forEach(function(doc) {
            var d = doc.data();
            d._uid = doc.id;
            umUsers.push(d);
        });
        umUsers.sort(function(a, b) {
            return (a.displayName || '').localeCompare(b.displayName || '', 'he');
        });

        loading.style.display = 'none';

        if (umUsers.length === 0) {
            empty.style.display = '';
        } else {
            tableView.style.display = '';
            renderUsersTable();
        }
    } catch (err) {
        console.error('Error loading users:', err);
        loading.style.display = 'none';
        empty.style.display = '';
        document.getElementById('umEmpty').querySelector('p').textContent = 'שגיאה בטעינת משתמשים';
    }
}

function renderUsersTable() {
    var tbody = document.getElementById('umTableBody');
    var html = '';

    umUsers.forEach(function(u) {
        var perms = u.permissions || {};
        var isActive = u.isActive !== false;

        html += '<tr class="' + (isActive ? '' : 'um-inactive-row') + '">';

        // Name + email
        html += '<td><strong>' + escapeHTML(u.displayName || '') + '</strong><br><span style="font-size:11px;color:#94a3b8;">' + escapeHTML(u.email || '') + '</span></td>';

        // Role — editable dropdown
        html += '<td>';
        html += '<select class="um-role-select" onchange="changeUserRole(\'' + u._uid + '\', this.value)">';
        var roles = ['master', 'office_manager', 'salesperson', 'accountant'];
        roles.forEach(function(r) {
            var sel = (u.role === r) ? ' selected' : '';
            html += '<option value="' + r + '"' + sel + '>' + escapeHTML(ROLE_LABELS[r]) + '</option>';
        });
        html += '</select>';
        html += '</td>';

        // Permission toggles
        var permKeys = ['salesForm', 'billingManagement', 'salesManagement', 'activityLog', 'userManagement'];
        permKeys.forEach(function(perm) {
            var checked = perms[perm] ? 'checked' : '';
            html += '<td style="text-align:center;">';
            html += '<label class="um-toggle">';
            html += '<input type="checkbox" ' + checked + ' onchange="toggleUserPermission(\'' + u._uid + '\', \'' + perm + '\', this.checked)">';
            html += '<span class="um-toggle-slider"></span>';
            html += '</label>';
            html += '</td>';
        });

        // Active toggle
        html += '<td style="text-align:center;">';
        html += '<label class="um-toggle">';
        html += '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' onchange="toggleUserActive(\'' + u._uid + '\', this.checked)">';
        html += '<span class="um-toggle-slider"></span>';
        html += '</label>';
        html += '</td>';

        // Actions — reset password
        html += '<td style="text-align:center;">';
        html += '<button class="um-action-btn" onclick="openResetPasswordModal(\'' + u._uid + '\', \'' + escapeHTML(u.displayName || '') + '\')" title="איפוס סיסמה">';
        html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        html += '</button>';
        html += '</td>';
        html += '</tr>';
    });

    tbody.innerHTML = html;
}

// ─── Change Role ───

async function changeUserRole(uid, newRole) {
    try {
        var newPerms = DEFAULT_PERMISSIONS[newRole] || DEFAULT_PERMISSIONS.salesperson;
        await db.collection('users').doc(uid).update({
            role: newRole,
            permissions: newPerms
        });

        // Update local cache
        var u = umUsers.find(function(x) { return x._uid === uid; });
        if (u) {
            u.role = newRole;
            u.permissions = Object.assign({}, newPerms);
        }

        // Re-render to update the toggles
        renderUsersTable();

        logAuditEvent('role_changed', {
            targetUser: u ? u.displayName : uid,
            newRole: newRole
        });
    } catch (err) {
        console.error('Error changing role:', err);
        alert('שגיאה בשינוי תפקיד');
        loadUsersForManagement();
    }
}

// ─── Toggle Permission ───

async function toggleUserPermission(uid, perm, value) {
    try {
        var update = {};
        update['permissions.' + perm] = value;
        await db.collection('users').doc(uid).update(update);

        // Update local cache
        var u = umUsers.find(function(x) { return x._uid === uid; });
        if (u) {
            if (!u.permissions) u.permissions = {};
            u.permissions[perm] = value;
        }

        logAuditEvent('permission_changed', {
            targetUser: u ? u.displayName : uid,
            permission: perm,
            newValue: value
        });
    } catch (err) {
        console.error('Error updating permission:', err);
        alert('שגיאה בעדכון הרשאה');
        loadUsersForManagement();
    }
}

// ─── Toggle Active ───

async function toggleUserActive(uid, isActive) {
    try {
        await db.collection('users').doc(uid).update({ isActive: isActive });

        // Update public_users accordingly
        if (!isActive) {
            await db.collection('public_users').doc(uid).delete();
        } else {
            var u = umUsers.find(function(x) { return x._uid === uid; });
            if (u) {
                await db.collection('public_users').doc(uid).set({
                    displayName: u.displayName,
                    email: u.email
                });
            }
        }

        // Update local cache
        var user = umUsers.find(function(x) { return x._uid === uid; });
        if (user) user.isActive = isActive;

        renderUsersTable();

        logAuditEvent('user_status_changed', {
            targetUser: user ? user.displayName : uid,
            isActive: isActive
        });
    } catch (err) {
        console.error('Error toggling user active:', err);
        alert('שגיאה בעדכון סטטוס משתמש');
        loadUsersForManagement();
    }
}

// ─── Add User Modal ───

function openAddUserModal() {
    document.getElementById('umNewName').value = '';
    document.getElementById('umNewEmail').value = '';
    document.getElementById('umNewPassword').value = '';
    document.getElementById('umNewPhone').value = '';
    document.getElementById('umNewRole').value = 'salesperson';
    document.getElementById('umSendSms').checked = true;
    document.getElementById('umNewError').style.display = 'none';
    document.getElementById('umCreateBtn').disabled = false;
    document.getElementById('umCreateBtn').textContent = 'צור משתמש';
    document.getElementById('addUserModal').classList.add('show');
}

function closeAddUserModal() {
    document.getElementById('addUserModal').classList.remove('show');
}

async function createNewUser() {
    var name = document.getElementById('umNewName').value.trim();
    var email = document.getElementById('umNewEmail').value.trim();
    var password = document.getElementById('umNewPassword').value;
    var phone = document.getElementById('umNewPhone').value.trim();
    var role = document.getElementById('umNewRole').value;
    var sendSms = document.getElementById('umSendSms').checked;
    var errorEl = document.getElementById('umNewError');
    var btn = document.getElementById('umCreateBtn');

    errorEl.style.display = 'none';

    if (!name) { errorEl.textContent = 'נא להזין שם תצוגה'; errorEl.style.display = ''; return; }
    if (!email) { errorEl.textContent = 'נא להזין אימייל'; errorEl.style.display = ''; return; }
    if (!password || password.length < 6) { errorEl.textContent = 'סיסמה חייבת להכיל לפחות 6 תווים'; errorEl.style.display = ''; return; }
    if (sendSms && !phone) { errorEl.textContent = 'נא להזין טלפון לשליחת SMS'; errorEl.style.display = ''; return; }

    btn.disabled = true;
    btn.textContent = 'יוצר משתמש...';

    try {
        // Create user via secondary Firebase App instance (doesn't sign out admin)
        var secondaryApp;
        try {
            secondaryApp = firebase.app('Secondary');
        } catch (e) {
            secondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary');
        }
        var secondaryAuth = secondaryApp.auth();

        var userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        var uid = userCredential.user.uid;

        // Sign out from secondary (doesn't affect main app)
        await secondaryAuth.signOut();

        // Create user doc in Firestore
        var perms = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.salesperson;
        await db.collection('users').doc(uid).set({
            displayName: name,
            email: email,
            phone: phone || '',
            role: role,
            permissions: perms,
            isActive: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: currentUser
        });

        // Also create public_users entry
        await db.collection('public_users').doc(uid).set({
            displayName: name,
            email: email
        });

        logAuditEvent('user_created', { name: name, email: email, role: role });

        // Send SMS with access details (non-blocking)
        if (sendSms && phone) {
            try {
                var idToken = await authUser.getIdToken();
                var smsRes = await fetch('/api/send-sms', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + idToken
                    },
                    body: JSON.stringify({
                        phone: phone,
                        displayName: name,
                        password: password,
                        appUrl: window.location.origin
                    })
                });
                var smsData = await smsRes.json();
                if (smsData.success) {
                    logAuditEvent('sms_sent', { targetUser: name, phone: phone });
                } else {
                    console.warn('SMS send failed:', smsData.error);
                    showToast('המשתמש נוצר אך SMS לא נשלח', '#f59e0b');
                }
            } catch (smsErr) {
                console.warn('SMS send error:', smsErr);
                showToast('המשתמש נוצר אך SMS לא נשלח', '#f59e0b');
            }
        }

        closeAddUserModal();
        loadUsersForManagement();

    } catch (err) {
        console.error('Error creating user:', err);
        var msg = 'שגיאה ביצירת משתמש';
        if (err.code === 'auth/email-already-in-use') msg = 'אימייל כבר קיים במערכת';
        if (err.code === 'auth/invalid-email') msg = 'אימייל לא תקין';
        if (err.code === 'auth/weak-password') msg = 'סיסמה חלשה מדי';
        errorEl.textContent = msg;
        errorEl.style.display = '';
    }

    btn.disabled = false;
    btn.textContent = 'צור משתמש';
}

function showToast(message, color) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:' + (color || '#059669') + ';color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-family:Heebo,sans-serif;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
}

// ─── Reset Password Modal ───

function openResetPasswordModal(uid, displayName) {
    _resetPwUid = uid;
    document.getElementById('resetPwUser').textContent = 'איפוס סיסמה עבור: ' + displayName;
    document.getElementById('resetPwInput').value = '';
    document.getElementById('resetPwError').style.display = 'none';
    document.getElementById('resetPwBtn').disabled = false;
    document.getElementById('resetPwBtn').textContent = 'שנה סיסמה';
    document.getElementById('resetPasswordModal').classList.add('show');
}

function closeResetPasswordModal() {
    document.getElementById('resetPasswordModal').classList.remove('show');
    _resetPwUid = null;
}

async function confirmResetPassword() {
    var newPassword = document.getElementById('resetPwInput').value;
    var errorEl = document.getElementById('resetPwError');
    var btn = document.getElementById('resetPwBtn');

    errorEl.style.display = 'none';

    if (!newPassword || newPassword.length < 6) {
        errorEl.textContent = 'סיסמה חייבת להכיל לפחות 6 תווים';
        errorEl.style.display = '';
        return;
    }

    if (!_resetPwUid) return;

    btn.disabled = true;
    btn.textContent = 'משנה סיסמה...';

    try {
        var idToken = await authUser.getIdToken();

        // Call Netlify Function to reset password (server-side with admin privileges)
        var response = await fetch('/api/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + idToken
            },
            body: JSON.stringify({
                targetUid: _resetPwUid,
                newPassword: newPassword
            })
        });

        var data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'שגיאה בשרת');
        }

        var u = umUsers.find(function(x) { return x._uid === _resetPwUid; });

        logAuditEvent('password_reset', {
            targetUser: u ? u.displayName : _resetPwUid
        });

        closeResetPasswordModal();
        alert('הסיסמה שונתה בהצלחה' + (u ? ' עבור ' + u.displayName : ''));

    } catch (err) {
        console.error('Error resetting password:', err);
        errorEl.textContent = 'שגיאה באיפוס סיסמה: ' + (err.message || '');
        errorEl.style.display = '';
    }

    btn.disabled = false;
    btn.textContent = 'שנה סיסמה';
}
