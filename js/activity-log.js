// ========== לוג פעילות ==========

var activityLogRecords = [];
var alCurrentPage = 1;
var AL_PAGE_SIZE = 20;
var alDataLoaded = false;

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
    nav_group: 'ניווט'
};

// --- Action badge colors ---
function getActionBadgeClass(action) {
    if (action === 'login_success' || action === 'logout' || action === 'session_timeout') return 'al-badge-blue';
    if (action === 'login_failed' || action === 'billing_deleted' || action === 'card_decrypt_failed' || action === 'decrypt_failed' || action === 'billing_cancelled' || action === 'payment_deleted') return 'al-badge-red';
    if (action === 'sale_submitted' || action === 'billing_created' || action === 'payment_marked' || action === 'invoice_marked') return 'al-badge-green';
    if (action === 'sale_edited' || action === 'billing_updated' || action === 'billing_paused') return 'al-badge-orange';
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
}

// --- Load all audit_log from Firestore ---
async function loadActivityLog() {
    var loading = document.getElementById('alLoading');
    var empty = document.getElementById('alEmpty');
    var tableView = document.getElementById('alTableView');

    loading.style.display = '';
    tableView.style.display = 'none';
    empty.style.display = 'none';
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

        populateAlFilterDropdowns();
        renderActivityLog();
    } catch (error) {
        console.error('Error loading activity log:', error);
        loading.innerHTML = '<p style="color:#ef4444;">שגיאה בטעינת הלוג</p>';
    }
}

// --- Populate filter dropdowns ---
function populateAlFilterDropdowns() {
    // Users
    var userSet = {};
    var actionSet = {};
    activityLogRecords.forEach(function(r) {
        if (r.performedBy) userSet[r.performedBy] = true;
        if (r.action) actionSet[r.action] = true;
    });

    var userSelect = document.getElementById('alFilterUser');
    if (userSelect) {
        var userHtml = '<option value="">כל המשתמשים</option>';
        Object.keys(userSet).sort().forEach(function(u) {
            userHtml += '<option value="' + escapeHTML(u) + '">' + escapeHTML(u) + '</option>';
        });
        userSelect.innerHTML = userHtml;
    }

    var actionSelect = document.getElementById('alFilterAction');
    if (actionSelect) {
        var actionHtml = '<option value="">כל הפעולות</option>';
        Object.keys(actionSet).sort().forEach(function(a) {
            actionHtml += '<option value="' + escapeHTML(a) + '">' + escapeHTML(getActionLabel(a)) + '</option>';
        });
        actionSelect.innerHTML = actionHtml;
    }
}

// --- Filter records ---
function getFilteredActivityLog() {
    var filtered = activityLogRecords.slice();

    var userFilter = document.getElementById('alFilterUser').value;
    if (userFilter) {
        filtered = filtered.filter(function(r) { return r.performedBy === userFilter; });
    }

    var actionFilter = document.getElementById('alFilterAction').value;
    if (actionFilter) {
        filtered = filtered.filter(function(r) { return r.action === actionFilter; });
    }

    var dateFrom = document.getElementById('alFilterDateFrom').value;
    if (dateFrom) {
        var fromDate = new Date(dateFrom);
        filtered = filtered.filter(function(r) {
            var d = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp ? r.timestamp.toDate() : null);
            return d && d >= fromDate;
        });
    }

    var dateTo = document.getElementById('alFilterDateTo').value;
    if (dateTo) {
        var toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(function(r) {
            var d = r.clientTimestamp ? new Date(r.clientTimestamp) : (r.timestamp ? r.timestamp.toDate() : null);
            return d && d <= toDate;
        });
    }

    return filtered;
}

// --- Check if action is a "minor" nav/browse action ---
function isNavAction(action) {
    return action && (action.indexOf('nav_') === 0 || action === 'form_step_change');
}

// --- Group consecutive nav actions by same user ---
function groupFilteredRecords(filtered) {
    var grouped = [];
    var i = 0;
    while (i < filtered.length) {
        var r = filtered[i];
        if (isNavAction(r.action)) {
            // Collect consecutive nav actions by the same user
            var navGroup = [r];
            var j = i + 1;
            while (j < filtered.length &&
                   isNavAction(filtered[j].action) &&
                   filtered[j].performedBy === r.performedBy) {
                navGroup.push(filtered[j]);
                j++;
            }
            if (navGroup.length > 1) {
                // Merge into one grouped row
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

// --- Render ---
function renderActivityLog() {
    var filtered = getFilteredActivityLog();
    var tableView = document.getElementById('alTableView');
    var empty = document.getElementById('alEmpty');

    if (filtered.length === 0) {
        tableView.style.display = 'none';
        empty.style.display = '';
        renderAlPagination(0, 0);
        return;
    }

    empty.style.display = 'none';
    tableView.style.display = '';

    // Group consecutive nav actions
    var grouped = groupFilteredRecords(filtered);

    var totalGrouped = grouped.length;
    var totalPages = Math.ceil(totalGrouped / AL_PAGE_SIZE);
    if (alCurrentPage > totalPages) alCurrentPage = totalPages;
    if (alCurrentPage < 1) alCurrentPage = 1;

    var startIdx = (alCurrentPage - 1) * AL_PAGE_SIZE;
    var pageRecords = grouped.slice(startIdx, startIdx + AL_PAGE_SIZE);

    var tbody = document.getElementById('alTableBody');
    var html = '';
    pageRecords.forEach(function(r, i) {
        var rowNum = startIdx + i + 1;
        var dateStr = formatAlDate(r);
        var user = escapeHTML(r.performedBy || '—');

        if (r._grouped) {
            // Grouped nav row
            html += '<tr class="al-grouped-row">' +
                '<td style="text-align:center;color:#94a3b8;font-size:12px;">' + rowNum + '</td>' +
                '<td style="white-space:nowrap;font-size:13px;">' + dateStr + '</td>' +
                '<td>' + user + '</td>' +
                '<td><span class="al-action-badge al-badge-gray">ניווט (' + r._count + ')</span></td>' +
                '<td style="font-size:12px;color:#94a3b8;">' + escapeHTML(r._labels) + '</td>' +
                '</tr>';
        } else {
            var badgeClass = getActionBadgeClass(r.action);
            var actionLabel = getActionLabel(r.action);
            var detailsStr = formatAlDetails(r.details);

            html += '<tr>' +
                '<td style="text-align:center;color:#94a3b8;font-size:12px;">' + rowNum + '</td>' +
                '<td style="white-space:nowrap;font-size:13px;">' + dateStr + '</td>' +
                '<td>' + user + '</td>' +
                '<td><span class="al-action-badge ' + badgeClass + '">' + escapeHTML(actionLabel) + '</span></td>' +
                '<td style="font-size:12px;color:#64748b;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHTML(detailsStr) + '">' + detailsStr + '</td>' +
                '</tr>';
        }
    });

    tbody.innerHTML = html;
    renderAlPagination(totalGrouped, totalPages);
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
    renderActivityLog();
    var el = document.getElementById('activityLogManagement');
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterActivityLog() {
    alCurrentPage = 1;
    renderActivityLog();
}

// --- Export CSV ---
function exportActivityLog() {
    var filtered = getFilteredActivityLog();
    if (filtered.length === 0) {
        alert('אין נתונים לייצוא');
        return;
    }

    var BOM = '\uFEFF';
    var headers = ['#', 'תאריך ושעה', 'משתמש', 'פעולה', 'קוד פעולה', 'פרטים'];
    var rows = [headers.join(',')];

    filtered.forEach(function(r, i) {
        var dateStr = '';
        if (r.clientTimestamp) {
            var d = new Date(r.clientTimestamp);
            dateStr = d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL');
        } else if (r.timestamp && r.timestamp.toDate) {
            var d2 = r.timestamp.toDate();
            dateStr = d2.toLocaleDateString('he-IL') + ' ' + d2.toLocaleTimeString('he-IL');
        }

        var detailsStr = '';
        if (r.details && typeof r.details === 'object') {
            var parts = [];
            Object.keys(r.details).forEach(function(k) {
                var v = r.details[k];
                if (v !== null && v !== undefined && v !== '') {
                    parts.push(k + ': ' + String(v));
                }
            });
            detailsStr = parts.join(' | ');
        }

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
    link.download = 'activity_log_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);

    logAuditEvent('activity_log_exported', { count: filtered.length });
}
