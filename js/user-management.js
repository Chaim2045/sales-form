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
    master: { salesForm: true, billingManagement: true, salesManagement: true, activityLog: true, userManagement: true, leadsManagement: true },
    office_manager: { salesForm: true, billingManagement: true, salesManagement: true, activityLog: false, userManagement: false, leadsManagement: true },
    salesperson: { salesForm: true, billingManagement: false, salesManagement: true, activityLog: false, userManagement: false, leadsManagement: true },
    accountant: { salesForm: false, billingManagement: true, salesManagement: true, activityLog: false, userManagement: false, leadsManagement: false }
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
        var permKeys = ['salesForm', 'billingManagement', 'salesManagement', 'activityLog', 'userManagement', 'leadsManagement'];
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

        // Actions — reset password + send WhatsApp
        html += '<td style="text-align:center;white-space:nowrap;">';
        html += '<button class="um-action-btn" onclick="openResetPasswordModal(\'' + u._uid + '\', \'' + escapeHTML(u.displayName || '') + '\')" title="איפוס סיסמה">';
        html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        html += '</button> ';
        html += '<button class="um-action-btn" onclick="openSendWhatsAppModal(\'' + u._uid + '\', \'' + escapeHTML(u.displayName || '') + '\', \'' + escapeHTML(u.phone || '') + '\')" title="שלח פרטי גישה ב-WhatsApp" style="color:#25d366;">';
        html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
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
    var pwError = validateStrongPassword(password);
    if (pwError) { errorEl.textContent = pwError; errorEl.style.display = ''; return; }
    if (sendSms && !phone) { errorEl.textContent = 'נא להזין טלפון לשליחת WhatsApp'; errorEl.style.display = ''; return; }

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

        logAuditEvent('user_created', { name: name, email: email, role: role });

        closeAddUserModal();
        loadUsersForManagement();

        // Open WhatsApp with access details
        if (sendSms && phone) {
            sendWhatsApp(phone, name, password);
        }

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

// ─── WhatsApp — Send Access Details ───

function sendWhatsApp(phone, displayName, password) {
    var waPhone = phone.replace(/\D/g, '');
    if (waPhone.startsWith('0')) waPhone = '972' + waPhone.substring(1);
    var waMessage = 'שלום ' + displayName + ', קיבלת גישה למערכת המשרד.\n' +
        'סיסמה: ' + password + '\n' +
        'כניסה: ' + window.location.origin;
    window.open('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(waMessage), '_blank');
}

var _waUid = null;

function openSendWhatsAppModal(uid, displayName, phone) {
    _waUid = uid;
    document.getElementById('waUserName').textContent = displayName;
    document.getElementById('waPhone').value = phone || '';
    document.getElementById('waPassword').value = '';
    document.getElementById('waError').style.display = 'none';
    document.getElementById('sendWhatsAppModal').classList.add('show');
}

function closeSendWhatsAppModal() {
    document.getElementById('sendWhatsAppModal').classList.remove('show');
    _waUid = null;
}

function confirmSendWhatsApp() {
    var phone = document.getElementById('waPhone').value.trim();
    var password = document.getElementById('waPassword').value;
    var errorEl = document.getElementById('waError');

    errorEl.style.display = 'none';

    if (!phone) { errorEl.textContent = 'נא להזין מספר טלפון'; errorEl.style.display = ''; return; }
    if (!password) { errorEl.textContent = 'נא להזין סיסמה לשליחה'; errorEl.style.display = ''; return; }

    var u = umUsers.find(function(x) { return x._uid === _waUid; });
    var name = u ? u.displayName : '';

    // Save phone to user doc if changed
    if (u && phone !== (u.phone || '')) {
        u.phone = phone;
        db.collection('users').doc(_waUid).update({ phone: phone }).catch(function(err) {
            console.warn('Could not save phone:', err);
        });
    }

    sendWhatsApp(phone, name, password);
    closeSendWhatsAppModal();
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

    var pwError = validateStrongPassword(newPassword);
    if (pwError) {
        errorEl.textContent = pwError;
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
