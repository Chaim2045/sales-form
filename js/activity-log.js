// ========== לוג פעילות — מקובץ לפי משתמשים ==========

var activityLogRecords = [];
var alDataLoaded = false;
var alSelectedUser = null; // null = תצוגת משתמשים, string = תצוגת פעולות של משתמש
var alCurrentPage = 1;
var AL_PAGE_SIZE = 25;

// --- Action labels (Hebrew) ---
var ACTION_LABELS = {
    login_success: 'כניסה למערכת',
    login_failed: 'כניסה נכשלה',
    logout: 'יציאה מהמערכת',
    session_timeout: 'פג תוקף ההתחברות',
    nav_home: 'ניווט — ראשי',
    nav_billing_mgmt: 'ניווט — ניהול גבייה',
    nav_sales_mgmt: 'ניווט — מכירות',
    nav_add_billing: 'ניווט — הוספת גבייה',
    nav_activity_log: 'ניווט — לוג פעילות',
    nav_user_mgmt: 'ניווט — ניהול משתמשים',
    form_step_change: 'מעבר בין שלבי טופס',
    sale_submitted: 'שליחת טופס מכר',
    billing_created: 'יצירת רשומת גבייה',
    billing_updated: 'עדכון רשומת גבייה',
    billing_deleted: 'מחיקת רשומת גבייה',
    payment_marked: 'סימון תשלום',
    billing_export_csv: 'ייצוא גבייה ל-CSV',
    card_details_viewed: 'צפייה בפרטי כרטיס',
    sale_detail_viewed: 'צפייה בפרטי מכירה',
    sale_edited: 'עריכת מכירה',
    invoice_marked: 'סימון חשבונית',
    sales_export_csv: 'ייצוא מכירות ל-CSV',
    client_details_copied: 'העתקת פרטי לקוח',
    card_decrypted: 'פענוח כרטיס אשראי',
    card_decrypt_failed: 'כשלון פענוח כרטיס',
    client_autocomplete_used: 'השלמה אוטומטית — לקוח',
    card_view: 'צפייה בכרטיס',
    card_copy: 'העתקת מספר כרטיס',
    decrypt_failed: 'כשלון פענוח',
    csv_export: 'ייצוא CSV',
    billing_cancelled: 'ביטול סדרת גבייה',
    billing_paused: 'השהיית סדרת גבייה',
    payment_deleted: 'מחיקת תשלום',
    activity_log_exported: 'ייצוא לוג פעילות',
    role_changed: 'שינוי תפקיד',
    permission_changed: 'שינוי הרשאה',
    user_status_changed: 'שינוי סטטוס משתמש',
    user_created: 'יצירת משתמש',
    password_reset: 'איפוס סיסמה',
    sale_deleted: 'מחיקת מכירה'
};

// --- Action badge colors ---
function getActionBadgeClass(action) {
    if (action === 'login_success' || action === 'logout' || action === 'session_timeout') return 'al-badge-blue';
    if (action === 'login_failed' || action === 'billing_deleted' || action === 'card_decrypt_failed' || action === 'decrypt_failed' || action === 'billing_cancelled' || action === 'payment_deleted' || action === 'sale_deleted') return 'al-badge-red';
    if (action === 'sale_submitted' || action === 'billing_created' || action === 'payment_marked' || action === 'invoice_marked' || action === 'user_created') return 'al-badge-green';
    if (action === 'sale_edited' || action === 'billing_updated' || action === 'billing_paused' || action === 'role_changed' || action === 'permission_changed') return 'al-badge-orange';
    if (action === 'card_decrypted' || action === 'card_details_viewed' || action === 'card_view' || action === 'card_copy') return 'al-badge-purple';
    return 'al-badge-gray';
}

function getActionLabel(action) {
    return ACTION_LABELS[action] || action;
}

// --- Show / Hide ---
function showActivityLog() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('activityLogManagement').classList.add('active');
    loadActivityLog();
}

function hideActivityLog() {
    document.getElementById('activityLogManagement').classList.remove('active');
    alSelectedUser = null;
}

// --- Load all audit_log from Firestore ---
async function loadActivityLog() {
    var loading = document.getElementById('alLoading');
    var empty = document.getElementById('alEmpty');
    var contentArea = document.getElementById('alContent');

    loading.style.display = '';
    if (contentArea) contentArea.style.display = 'none';
    empty.style.display = 'none';
    alSelectedUser = null;
    alCurrentPage = 1;

    try {
        var snapshot = await db.collection('audit_log')
            .orderBy('timestamp', 'desc')
            .get();

        activityLogRecords = [];
        snapshot.forEach(function(doc) {
            activityLogRecords.push(Object.assign({ id: doc.id }, doc.data()));
        });

        alDataLoaded = true;
        loading.style.display = 'none';

        if (activityLogRecords.length === 0) {
            empty.style.display = '';
            return;
        }

        if (contentArea) contentArea.style.display = '';
        renderUsersView();
    } catch (error) {
        console.error('Error loading activity log:', error);
        loading.innerHTML = '<p style="color:#ef4444;">שגיאה בטעינת הלוג</p>';
    }
}

// --- Check if action is minor (nav/browse) ---
function isNavAction(action) {
    return action && (action.indexOf('nav_') === 0 || action === 'form_step_change' || action === 'client_autocomplete_used');
}

// --- Build user summary data ---
function buildUserSummaries() {
    var users = {};

    activityLogRecords.forEach(function(r) {
        var name = r.performedBy || 'לא ידוע';
        if (!users[name]) {
            users[name] = {
                name: name,
                email: r.authEmail || '',
                totalActions: 0,
                significantActions: 0,
                lastActivity: null,
                actionCounts: {}
            };
        }
        var u = users[name];
        u.totalActions++;
        if (!isNavAction(r.action)) u.significantActions++;

        // Count per action type
        var actionKey = r.action || 'unknown';
        u.actionCounts[actionKey] = (u.actionCounts[actionKey] || 0) + 1;

        // Track latest activity
        var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
        if (ts && (!u.lastActivity || ts > u.lastActivity)) {
            u.lastActivity = ts;
        }
    });

    // Sort by last activity (most recent first)
    return Object.values(users).sort(function(a, b) {
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return b.lastActivity - a.lastActivity;
    });
}

// --- Render: Users overview (cards) ---
function renderUsersView() {
    var container = document.getElementById('alContent');
    if (!container) return;

    var users = buildUserSummaries();
    var dateFilter = getDateFilterRange();

    // Apply date filter to counts if dates are set
    if (dateFilter.from || dateFilter.to) {
        users = buildFilteredUserSummaries(dateFilter);
    }

    var html = '<div class="al-users-grid">';

    users.forEach(function(u) {
        var lastStr = u.lastActivity
            ? u.lastActivity.toLocaleDateString('he-IL') + ' ' + u.lastActivity.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
            : 'לא ידוע';

        // Top 3 significant actions
        var topActions = getTopActions(u.actionCounts, 3);

        html += '<div class="al-user-card" onclick="alSelectUser(\'' + escapeHTML(u.name) + '\')">';
        html += '<div class="al-user-card-header">';
        html += '<div class="al-user-avatar">' + escapeHTML(u.name.charAt(0)) + '</div>';
        html += '<div class="al-user-info">';
        html += '<div class="al-user-name">' + escapeHTML(u.name) + '</div>';
        if (u.email) html += '<div class="al-user-email">' + escapeHTML(u.email) + '</div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="al-user-stats">';
        html += '<div class="al-user-stat"><span class="al-stat-num">' + u.significantActions + '</span><span class="al-stat-label">פעולות</span></div>';
        html += '<div class="al-user-stat"><span class="al-stat-num">' + u.totalActions + '</span><span class="al-stat-label">סה"כ</span></div>';
        html += '</div>';

        html += '<div class="al-user-top-actions">';
        topActions.forEach(function(a) {
            html += '<span class="al-action-badge ' + getActionBadgeClass(a.action) + '" style="font-size:11px;margin:2px;">' + escapeHTML(getActionLabel(a.action)) + ' (' + a.count + ')</span>';
        });
        html += '</div>';

        html += '<div class="al-user-last">פעילות אחרונה: ' + lastStr + '</div>';
        html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;

    // Hide pagination in users view
    var pagination = document.getElementById('alPagination');
    if (pagination) pagination.innerHTML = '';
}

function getDateFilterRange() {
    var from = document.getElementById('alFilterDateFrom') ? document.getElementById('alFilterDateFrom').value : '';
    var to = document.getElementById('alFilterDateTo') ? document.getElementById('alFilterDateTo').value : '';
    return {
        from: from ? new Date(from + 'T00:00:00') : null,
        to: to ? new Date(to + 'T23:59:59') : null
    };
}

function buildFilteredUserSummaries(dateFilter) {
    var filtered = activityLogRecords.filter(function(r) {
        var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
        if (!ts) return false;
        if (dateFilter.from && ts < dateFilter.from) return false;
        if (dateFilter.to && ts > dateFilter.to) return false;
        return true;
    });

    var users = {};
    filtered.forEach(function(r) {
        var name = r.performedBy || 'לא ידוע';
        if (!users[name]) {
            users[name] = { name: name, email: r.authEmail || '', totalActions: 0, significantActions: 0, lastActivity: null, actionCounts: {} };
        }
        var u = users[name];
        u.totalActions++;
        if (!isNavAction(r.action)) u.significantActions++;
        var actionKey = r.action || 'unknown';
        u.actionCounts[actionKey] = (u.actionCounts[actionKey] || 0) + 1;
        var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
        if (ts && (!u.lastActivity || ts > u.lastActivity)) u.lastActivity = ts;
    });

    return Object.values(users).sort(function(a, b) {
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return b.lastActivity - a.lastActivity;
    });
}

function getTopActions(actionCounts, limit) {
    return Object.keys(actionCounts)
        .filter(function(a) { return !isNavAction(a); })
        .map(function(a) { return { action: a, count: actionCounts[a] }; })
        .sort(function(a, b) { return b.count - a.count; })
        .slice(0, limit);
}

// --- Select user → show their actions ---
function alSelectUser(userName) {
    alSelectedUser = userName;
    alCurrentPage = 1;
    renderUserActions();
}

// --- Back to users view ---
function alBackToUsers() {
    alSelectedUser = null;
    renderUsersView();
}

// --- Render: Single user's actions (table) ---
function renderUserActions() {
    var container = document.getElementById('alContent');
    if (!container) return;

    var userRecords = activityLogRecords.filter(function(r) {
        return r.performedBy === alSelectedUser;
    });

    // Apply date filters
    var dateFilter = getDateFilterRange();
    if (dateFilter.from) {
        userRecords = userRecords.filter(function(r) {
            var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
            return ts && ts >= dateFilter.from;
        });
    }
    if (dateFilter.to) {
        userRecords = userRecords.filter(function(r) {
            var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
            return ts && ts <= dateFilter.to;
        });
    }

    // Apply action filter
    var actionFilter = document.getElementById('alFilterAction') ? document.getElementById('alFilterAction').value : '';
    if (actionFilter) {
        userRecords = userRecords.filter(function(r) { return r.action === actionFilter; });
    }

    // Group consecutive nav actions
    var grouped = groupConsecutiveNav(userRecords);

    var totalGrouped = grouped.length;
    var totalPages = Math.ceil(totalGrouped / AL_PAGE_SIZE);
    if (alCurrentPage > totalPages) alCurrentPage = totalPages;
    if (alCurrentPage < 1) alCurrentPage = 1;

    var startIdx = (alCurrentPage - 1) * AL_PAGE_SIZE;
    var pageRecords = grouped.slice(startIdx, startIdx + AL_PAGE_SIZE);

    // Header with back button
    var html = '<div class="al-user-detail-header">';
    html += '<button class="al-back-btn" onclick="alBackToUsers()">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    html += ' חזרה לכל המשתמשים';
    html += '</button>';
    html += '<h3>' + escapeHTML(alSelectedUser) + ' — ' + totalGrouped + ' פעולות</h3>';
    html += '</div>';

    // Action filter dropdown (inline)
    html += '<div style="margin-bottom:12px;">';
    html += '<select id="alFilterAction" class="sm-filter-select" onchange="alCurrentPage=1;renderUserActions();" style="max-width:220px;">';
    html += '<option value="">כל הפעולות</option>';
    var actionSet = {};
    activityLogRecords.filter(function(r) { return r.performedBy === alSelectedUser; }).forEach(function(r) {
        if (r.action) actionSet[r.action] = true;
    });
    Object.keys(actionSet).sort().forEach(function(a) {
        html += '<option value="' + escapeHTML(a) + '"' + (actionFilter === a ? ' selected' : '') + '>' + escapeHTML(getActionLabel(a)) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    if (pageRecords.length === 0) {
        html += '<div style="text-align:center;padding:40px;color:var(--text-secondary);">אין פעולות להצגה</div>';
        container.innerHTML = html;
        var pagination = document.getElementById('alPagination');
        if (pagination) pagination.innerHTML = '';
        return;
    }

    // Table
    html += '<div class="bm-table-wrapper"><table class="bm-table"><thead><tr>';
    html += '<th style="width:50px;text-align:center;">#</th>';
    html += '<th style="width:150px;">תאריך ושעה</th>';
    html += '<th style="width:160px;">פעולה</th>';
    html += '<th>פרטים</th>';
    html += '</tr></thead><tbody>';

    pageRecords.forEach(function(r, i) {
        var rowNum = startIdx + i + 1;
        var dateStr = formatAlDate(r);

        if (r._grouped) {
            html += '<tr class="al-grouped-row">';
            html += '<td style="text-align:center;color:#94a3b8;font-size:12px;">' + rowNum + '</td>';
            html += '<td style="white-space:nowrap;font-size:13px;">' + dateStr + '</td>';
            html += '<td><span class="al-action-badge al-badge-gray">ניווט (' + r._count + ')</span></td>';
            html += '<td style="font-size:12px;color:#94a3b8;">' + escapeHTML(r._labels) + '</td>';
            html += '</tr>';
        } else {
            var badgeClass = getActionBadgeClass(r.action);
            var actionLabel = getActionLabel(r.action);
            var detailsStr = formatAlDetails(r.details);

            html += '<tr>';
            html += '<td style="text-align:center;color:#94a3b8;font-size:12px;">' + rowNum + '</td>';
            html += '<td style="white-space:nowrap;font-size:13px;">' + dateStr + '</td>';
            html += '<td><span class="al-action-badge ' + badgeClass + '">' + escapeHTML(actionLabel) + '</span></td>';
            html += '<td style="font-size:12px;color:#64748b;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHTML(detailsStr) + '">' + detailsStr + '</td>';
            html += '</tr>';
        }
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    renderAlPagination(totalGrouped, totalPages);
}

// --- Group consecutive nav actions by same user ---
function groupConsecutiveNav(records) {
    var grouped = [];
    var i = 0;
    while (i < records.length) {
        var r = records[i];
        if (isNavAction(r.action)) {
            var navGroup = [r];
            var j = i + 1;
            while (j < records.length && isNavAction(records[j].action)) {
                navGroup.push(records[j]);
                j++;
            }
            if (navGroup.length > 1) {
                var labels = [];
                navGroup.forEach(function(nr) {
                    var lbl = getActionLabel(nr.action).replace('ניווט — ', '');
                    if (labels.indexOf(lbl) === -1) labels.push(lbl);
                });
                grouped.push({
                    _grouped: true,
                    _count: navGroup.length,
                    performedBy: r.performedBy,
                    action: 'nav_group',
                    clientTimestamp: r.clientTimestamp,
                    timestamp: r.timestamp,
                    _labels: labels.join(', '),
                    details: {}
                });
            } else {
                grouped.push(r);
            }
            i = j;
        } else {
            grouped.push(r);
            i++;
        }
    }
    return grouped;
}

// --- Format date helper ---
function formatAlDate(r) {
    if (r.clientTimestamp) {
        var d = new Date(r.clientTimestamp);
        return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (r.timestamp && r.timestamp.toDate) {
        var d2 = r.timestamp.toDate();
        return d2.toLocaleDateString('he-IL') + ' ' + d2.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return '';
}

// --- Format details helper ---
function formatAlDetails(details) {
    if (!details || typeof details !== 'object') return '';
    var parts = [];
    Object.keys(details).forEach(function(k) {
        var v = details[k];
        if (v !== null && v !== undefined && v !== '') {
            parts.push(escapeHTML(k) + ': ' + escapeHTML(String(v)));
        }
    });
    return parts.join(' | ');
}

// --- Pagination ---
function renderAlPagination(totalFiltered, totalPages) {
    var container = document.getElementById('alPagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = totalFiltered > 0
            ? '<span class="sm-page-info">' + totalFiltered + ' רשומות</span>'
            : '';
        return;
    }

    var html = '<div class="sm-pagination">';

    html += '<button class="sm-page-btn" onclick="alGoToPage(' + (alCurrentPage - 1) + ')" ' + (alCurrentPage <= 1 ? 'disabled' : '') + '>';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    html += '</button>';

    for (var i = 1; i <= totalPages; i++) {
        if (i === alCurrentPage) {
            html += '<button class="sm-page-btn active">' + i + '</button>';
        } else if (i <= 2 || i > totalPages - 2 || Math.abs(i - alCurrentPage) <= 1) {
            html += '<button class="sm-page-btn" onclick="alGoToPage(' + i + ')">' + i + '</button>';
        } else if (i === 3 && alCurrentPage > 4) {
            html += '<span class="sm-page-dots">...</span>';
        } else if (i === totalPages - 2 && alCurrentPage < totalPages - 3) {
            html += '<span class="sm-page-dots">...</span>';
        }
    }

    html += '<button class="sm-page-btn" onclick="alGoToPage(' + (alCurrentPage + 1) + ')" ' + (alCurrentPage >= totalPages ? 'disabled' : '') + '>';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    html += '</button>';

    html += '<span class="sm-page-info">' + totalFiltered + ' רשומות | עמוד ' + alCurrentPage + ' מתוך ' + totalPages + '</span>';
    html += '</div>';

    container.innerHTML = html;
}

function alGoToPage(page) {
    alCurrentPage = page;
    if (alSelectedUser) {
        renderUserActions();
    } else {
        renderUsersView();
    }
    var el = document.getElementById('activityLogManagement');
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterActivityLog() {
    alCurrentPage = 1;
    if (alSelectedUser) {
        renderUserActions();
    } else {
        renderUsersView();
    }
}

// --- Export CSV ---
function exportActivityLog() {
    var filtered = alSelectedUser
        ? activityLogRecords.filter(function(r) { return r.performedBy === alSelectedUser; })
        : activityLogRecords;

    // Apply date filters
    var dateFilter = getDateFilterRange();
    if (dateFilter.from) {
        filtered = filtered.filter(function(r) {
            var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
            return ts && ts >= dateFilter.from;
        });
    }
    if (dateFilter.to) {
        filtered = filtered.filter(function(r) {
            var ts = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null);
            return ts && ts <= dateFilter.to;
        });
    }

    if (filtered.length === 0) {
        alert('אין נתונים לייצוא');
        return;
    }

    var BOM = '\uFEFF';
    var headers = ['#', 'תאריך ושעה', 'משתמש', 'פעולה', 'קוד פעולה', 'פרטים'];
    var rows = [headers.join(',')];

    filtered.forEach(function(r, i) {
        var dateStr = formatAlDate(r);
        var detailsStr = formatAlDetails(r.details);

        var row = [
            i + 1,
            '"' + dateStr + '"',
            '"' + (r.performedBy || '') + '"',
            '"' + getActionLabel(r.action) + '"',
            '"' + (r.action || '') + '"',
            '"' + detailsStr.replace(/"/g, '""') + '"'
        ];
        rows.push(row.join(','));
    });

    var csv = BOM + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    var suffix = alSelectedUser ? '_' + alSelectedUser.replace(/\s/g, '_') : '';
    link.download = 'activity_log' + suffix + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);

    logAuditEvent('activity_log_exported', { count: filtered.length, user: alSelectedUser || 'all' });
}
