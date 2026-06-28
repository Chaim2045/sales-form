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
    master: { salesForm: true, billingManagement: true, salesManagement: true, activityLog: true, userManagement: true, leadsManagement: true, yfCashflow: false, invoiceSettings: true },
    office_manager: { salesForm: true, billingManagement: true, salesManagement: true, activityLog: false, userManagement: false, leadsManagement: true, yfCashflow: false, invoiceSettings: false },
    salesperson: { salesForm: true, billingManagement: false, salesManagement: true, activityLog: false, userManagement: false, leadsManagement: true, yfCashflow: false, invoiceSettings: false },
    accountant: { salesForm: false, billingManagement: true, salesManagement: true, activityLog: false, userManagement: false, leadsManagement: false, yfCashflow: false, invoiceSettings: false }
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
        html += '<td><strong>' + escapeHTML(u.displayName || '') + '</strong><br><span style="font-size:11px;color:var(--text-tertiary);">' + escapeHTML(u.email || '') + '</span></td>';

        // Role — editable dropdown
        html += '<td>';
        html += '<select class="um-role-select" onchange="onRoleChange(\'' + u._uid + '\', this.value, this)">';
        var roles = ['master', 'office_manager', 'salesperson', 'accountant'];
        roles.forEach(function(r) {
            var sel = (u.role === r) ? ' selected' : '';
            html += '<option value="' + r + '"' + sel + '>' + escapeHTML(ROLE_LABELS[r]) + '</option>';
        });
        html += '</select>';
        html += '</td>';

        // Permission toggles
        // Permissions — summary chip that opens the grouped editor (scales without adding table columns)
        html += '<td style="text-align:center;">';
        html += '<button class="um-perms-btn" onclick="openPermissionsModal(\'' + u._uid + '\')" aria-label="עריכת הרשאות עבור ' + escapeHTML(u.displayName || '') + '">';
        html += '<span class="um-perms-count">' + countActivePerms(u) + '</span><span class="um-perms-total"> / 7</span>';
        html += '<span class="um-perms-edit">הרשאות</span>';
        html += '</button>';
        html += '</td>';

        // Active toggle
        html += '<td style="text-align:center;">';
        html += '<label class="um-toggle">';
        html += '<input type="checkbox" ' + (isActive ? 'checked' : '') + ' aria-label="משתמש פעיל — ' + escapeHTML(u.displayName || '') + '" onchange="onActiveChange(\'' + u._uid + '\', this.checked, this)">';
        html += '<span class="um-toggle-slider"></span>';
        html += '</label>';
        html += '</td>';

        // Actions — reset password + send WhatsApp
        html += '<td style="text-align:center;white-space:nowrap;">';
        html += '<button class="um-action-btn" onclick="openResetPasswordModal(\'' + u._uid + '\', \'' + escapeHTML(u.displayName || '') + '\')" title="איפוס סיסמה" aria-label="איפוס סיסמה">';
        html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        html += '</button> ';
        html += '<button class="um-action-btn" onclick="openSendWhatsAppModal(\'' + u._uid + '\', \'' + escapeHTML(u.displayName || '') + '\', \'' + escapeHTML(u.phone || '') + '\')" title="שלח פרטי גישה ב-WhatsApp" aria-label="שלח פרטי גישה ב-WhatsApp" style="color:#25d366;">';
        html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
        html += '</button>';
        if (currentUserRole === 'master' && (!authUser || u._uid !== authUser.uid)) {
            html += ' <button class="um-action-btn um-action-danger" onclick="removeUser(\'' + u._uid + '\')" title="הסר משתמש (עזב את המשרד)" aria-label="הסר משתמש — ' + escapeHTML(u.displayName || '') + '">';
            html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            html += '</button>';
        }
        html += '</td>';
        html += '</tr>';
    });

    tbody.innerHTML = html;
}

// ─── Remove user (master only — disables login + deletes the record; server-enforced) ───
async function removeUser(uid) {
    if (currentUserRole !== 'master') { showToast('פעולה ל-master בלבד', '#ef4444'); return; }
    if (authUser && uid === authUser.uid) { showToast('אי אפשר למחוק את המשתמש שלך', '#ef4444'); return; }
    var u = umUsers.find(function(x) { return x._uid === uid; });
    var name = u ? (u.displayName || u.email || '') : '';
    if (u && u.role === 'master') {
        var otherMasters = umUsers.filter(function(x) { return x._uid !== uid && x.isActive !== false && x.role === 'master'; });
        if (otherMasters.length === 0) { showToast('לא ניתן למחוק את המנהל האחרון', '#ef4444'); return; }
    }
    var ok = await tofesConfirm('להסיר לצמיתות את "' + name + '"?\nהכניסה שלו תושבת והרשומה תימחק. פעולה זו בלתי-הפיכה.', {
        title: 'הסרת משתמש',
        okText: 'הסר לצמיתות',
        cancelText: 'ביטול',
        danger: true
    });
    if (!ok) return;
    try {
        var idToken = await authUser.getIdToken();
        var resp = await fetch('/api/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({ targetUid: uid })
        });
        var data = await resp.json();
        if (resp.ok && data.success) {
            umUsers = umUsers.filter(function(x) { return x._uid !== uid; });
            renderUsersTable();
            showToast('המשתמש הוסר');
            logAuditEvent('user_removed', { targetUser: name, targetUid: uid });
        } else {
            showToast(data.error || 'שגיאה בהסרת המשתמש', '#ef4444');
        }
    } catch (e) {
        console.error('removeUser error:', e);
        showToast('שגיאה בהסרת המשתמש', '#ef4444');
    }
}

// ─── Permissions editor (grouped drawer — scales without adding table columns) ───
var PERM_GROUPS = [
    { title: 'מכירות וגבייה', perms: [
        { key: 'salesForm', label: 'טופס מכר', desc: 'דיווח עסקאות חדשות' },
        { key: 'billingManagement', label: 'גבייה', desc: 'חיובים חוזרים וכרטיסי אשראי' },
        { key: 'salesManagement', label: 'ניהול מכירות', desc: 'צפייה ועריכת כל העסקאות' }
    ] },
    { title: 'ניהול ומערכת', perms: [
        { key: 'leadsManagement', label: 'לידים', desc: 'ניהול פניות ולקוחות פוטנציאליים' },
        { key: 'activityLog', label: 'לוג פעילות', desc: 'צפייה בהיסטוריית הפעולות' },
        { key: 'userManagement', label: 'ניהול משתמשים', desc: 'יצירה והרשאות של משתמשים' }
    ] },
    { title: 'כספים ותזרים', perms: [
        { key: 'yfCashflow', label: 'תזרים', desc: 'גישה לדשבורד התזרים', date: true }
    ] }
];
var _permKeys = ['salesForm', 'billingManagement', 'salesManagement', 'activityLog', 'userManagement', 'leadsManagement', 'yfCashflow'];
var _permUid = null;
var _permReturnFocus = null;
var _permKeyHandler = null;

function countActivePerms(u) {
    var perms = (u && u.permissions) || {};
    return _permKeys.filter(function(k) { return perms[k]; }).length;
}

function permSubText(u) {
    return (ROLE_LABELS[u.role] || '') + ' · ' + countActivePerms(u) + ' הרשאות פעילות';
}

function renderPermissionsBody(u) {
    var perms = u.permissions || {};
    var html = '';
    PERM_GROUPS.forEach(function(g) {
        html += '<div class="perm-group-title">' + escapeHTML(g.title) + '</div>';
        g.perms.forEach(function(p) {
            var checked = perms[p.key] ? 'checked' : '';
            html += '<div class="perm-row"><div class="perm-row-info">';
            html += '<div class="perm-row-label">' + escapeHTML(p.label) + '</div>';
            html += '<div class="perm-row-desc">' + escapeHTML(p.desc) + '</div>';
            if (p.date) {
                var _exp = u.yfCashflowExpiresAt ? new Date(u.yfCashflowExpiresAt).toISOString().split('T')[0] : '';
                html += '<input type="date" class="perm-date" value="' + _exp + '" title="גישה עד תאריך (ריק = קבועה)" aria-label="גישת תזרים עד תאריך" onchange="setYfExpiry(\'' + u._uid + '\', this.value)">';
            }
            html += '</div>';
            html += '<label class="um-toggle"><input type="checkbox" ' + checked + ' aria-label="הרשאת ' + escapeHTML(p.label) + '" onchange="onPermChange(\'' + u._uid + '\', \'' + p.key + '\', this.checked)"><span class="um-toggle-slider"></span></label>';
            html += '</div>';
        });
    });
    return html;
}

function openPermissionsModal(uid) {
    var u = umUsers.find(function(x) { return x._uid === uid; });
    if (!u) return;
    _permUid = uid;
    _permReturnFocus = document.activeElement;
    document.getElementById('permTitle').textContent = 'הרשאות — ' + (u.displayName || '');
    document.getElementById('permSub').textContent = permSubText(u);
    document.getElementById('permContainer').innerHTML = renderPermissionsBody(u);
    document.getElementById('permissionsModal').classList.add('show');
    _permKeyHandler = function(e) { if (e.key === 'Escape') closePermissionsModal(); };
    document.addEventListener('keydown', _permKeyHandler);
    var _cb = document.querySelector('#permissionsModal .billing-modal-close');
    if (_cb) _cb.focus();
}

function onPermChange(uid, perm, value) {
    var u = umUsers.find(function(x) { return x._uid === uid; });
    // Safety guard: never remove user-management from the last active admin
    if (perm === 'userManagement' && value === false) {
        var otherAdmins = umUsers.filter(function(x) {
            return x._uid !== uid && x.isActive !== false && x.permissions && x.permissions.userManagement;
        });
        if (otherAdmins.length === 0) {
            showToast('לא ניתן להסיר ניהול-משתמשים מהמנהל האחרון', '#ef4444');
            if (u && _permUid === uid) document.getElementById('permContainer').innerHTML = renderPermissionsBody(u);
            return;
        }
    }
    if (u) { if (!u.permissions) u.permissions = {}; u.permissions[perm] = value; }
    if (u && _permUid === uid) document.getElementById('permSub').textContent = permSubText(u);
    toggleUserPermission(uid, perm, value);
}

function closePermissionsModal() {
    var _uid = _permUid;
    document.getElementById('permissionsModal').classList.remove('show');
    if (_permKeyHandler) { document.removeEventListener('keydown', _permKeyHandler); _permKeyHandler = null; }
    _permUid = null;
    renderUsersTable();
    var _back = _uid ? document.querySelector('.um-perms-btn[onclick*="' + _uid + '"]') : null;
    if (_back) _back.focus();
    else if (_permReturnFocus && _permReturnFocus.focus) _permReturnFocus.focus();
    _permReturnFocus = null;
}

// ─── Role change (reset-warning) + Active toggle (self-lockout guard) ───
async function onRoleChange(uid, newRole, selectEl) {
    var u = umUsers.find(function(x) { return x._uid === uid; });
    var oldRole = u ? u.role : null;
    if (oldRole === newRole) return;
    var ok = await tofesConfirm('שינוי התפקיד יאפס את ההרשאות לברירת-המחדל של "' + (ROLE_LABELS[newRole] || newRole) + '". להמשיך?', {
        title: 'שינוי תפקיד',
        okText: 'שנה ואפס הרשאות',
        cancelText: 'ביטול',
        danger: true
    });
    if (!ok) { if (selectEl && oldRole) selectEl.value = oldRole; return; }
    changeUserRole(uid, newRole);
}

function onActiveChange(uid, isActive, el) {
    if (isActive === false) {
        if (authUser && uid === authUser.uid) {
            showToast('אי אפשר להשבית את המשתמש שלך', '#ef4444');
            if (el) el.checked = true;
            return;
        }
        var u = umUsers.find(function(x) { return x._uid === uid; });
        if (u && u.permissions && u.permissions.userManagement) {
            var otherAdmins = umUsers.filter(function(x) {
                return x._uid !== uid && x.isActive !== false && x.permissions && x.permissions.userManagement;
            });
            if (otherAdmins.length === 0) {
                showToast('לא ניתן להשבית את המנהל האחרון', '#ef4444');
                if (el) el.checked = true;
                return;
            }
        }
    }
    toggleUserActive(uid, isActive);
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
        showToast('נשמר');
    } catch (err) {
        console.error('Error updating permission:', err);
        alert('שגיאה בעדכון הרשאה');
        loadUsersForManagement();
    }
}

// ─── תאריך תפוגה לגישת תזרים (grant זמני; ריק = קבועה). נאכף בשרת (yf-totp / isAuthorized) ───
async function setYfExpiry(uid, dateStr) {
    try {
        var ms = dateStr ? new Date(dateStr + 'T23:59:59').getTime() : null;
        await db.collection('users').doc(uid).update({
            yfCashflowExpiresAt: ms === null ? firebase.firestore.FieldValue.delete() : ms
        });
        var u = umUsers.find(function(x) { return x._uid === uid; });
        if (u) u.yfCashflowExpiresAt = ms;
        logAuditEvent('yf_expiry_changed', { targetUser: u ? u.displayName : uid, expiresAt: dateStr || 'קבועה' });
    } catch (err) {
        console.error('Error setting yf expiry:', err);
        alert('שגיאה בעדכון תאריך תפוגה');
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
