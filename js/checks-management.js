// ========== ניהול שיקים (Phase 4c) ==========
// מסך מעקב שיקים-דחויים: קריאה בלבד מ-sales_records/{saleId}/checks (collection-group),
// ופעולות "נפרע"/"חזר" שעוברות אך ורק דרך netlify/functions/issue-invoice (service-account כותב).
//
// 🔒 אבטחה (firestore.rules:60-66): הקליינט יכול לקרוא שיקים (salesManagement/billingManagement/master)
//    אבל לעולם לא לכתוב (create/update/delete:false) — כל המוטציות עוברות בפונקציה.
//
// ⚠️ תלות-deploy: ה-query הוא collection-group על 'checks' עם where(status)+orderBy(dueDate) →
//    דורש אינדקס collection-group מורכב: checks (status ASC, dueDate ASC).
//    בריצה ראשונה Firestore יחזיר שגיאה עם קישור ליצירת האינדקס — חובה ליצור לפני שהמסך עובד.
//
// מירור דפוסים: js/sales-records.js (view/render/escapeHTML) + js/payments.js (טבלה+כפתורי-פעולה+סטטוס)
// + js/invoice-settings.js (issueInvoiceForSale token+fetch). אדיטיבי בלבד; vanilla JS; RTL.

var checksRecords = [];          // [{ saleId, checkId, ...fields }]
var _checksSaleNameCache = {};   // cache שם-לקוח לפי saleId (קריאת parent sale פעם אחת לכל saleId)
var checksFilterStatus = 'pending';
var _checksInFlight = {};        // נעילת-בקשה פר-שיק (key: saleId/checkId) — כפתור disabled בזמן בקשה
var checksDataLoaded = false;

var CHECKS_QUERY_LIMIT = 200;

// --- הצגה / הסתרה (מירור showSalesManagement) ---
function showChecksManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    if (typeof hideActivityLog === 'function') hideActivityLog();
    var view = document.getElementById('checksManagement');
    if (view) view.classList.add('active');
    loadChecksData();
}

function hideChecksManagement() {
    var el = document.getElementById('checksManagement');
    if (el) el.classList.remove('active');
}

// --- טעינת שיקים מ-Firestore (collection-group) ---
async function loadChecksData() {
    var loading = document.getElementById('cmLoading');
    var empty = document.getElementById('cmEmpty');
    var tableView = document.getElementById('cmTableView');
    var errorBox = document.getElementById('cmError');

    if (loading) loading.style.display = '';
    if (tableView) tableView.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (errorBox) errorBox.style.display = 'none';

    try {
        // ⚠️ collection-group + where(status)+orderBy(dueDate) → דורש אינדקס מורכב על checks (status ASC, dueDate ASC).
        var snapshot = await db.collectionGroup('checks')
            .where('status', '==', checksFilterStatus)
            .orderBy('dueDate', 'asc')
            .limit(CHECKS_QUERY_LIMIT)
            .get();

        checksRecords = [];
        snapshot.forEach(function(doc) {
            // saleId = ההורה-של-ההורה (sales_records/{saleId}/checks/{checkId})
            var parentSale = doc.ref.parent.parent;
            var rec = Object.assign({
                saleId: parentSale ? parentSale.id : '',
                checkId: doc.id
            }, doc.data());
            checksRecords.push(rec);
        });

        checksDataLoaded = true;
        if (loading) loading.style.display = 'none';

        if (checksRecords.length === 0) {
            if (empty) empty.style.display = '';
            updateChecksSummary(checksRecords);
            return;
        }

        // שליפת שם-לקוח פר-עסקה (פעם אחת לכל saleId, cache), ואז רינדור
        await hydrateChecksClientNames();
        updateChecksSummary(checksRecords);
        renderChecksTable();
        if (tableView) tableView.style.display = '';

    } catch (error) {
        console.error('Error loading checks data:', error);
        if (loading) loading.style.display = 'none';
        // אינדקס חסר → Firestore זורק failed-precondition עם קישור ליצירת האינדקס
        if (errorBox) {
            errorBox.style.display = '';
            var needsIndex = error && (error.code === 'failed-precondition' || /index/i.test(error.message || ''));
            errorBox.textContent = needsIndex
                ? 'נדרש אינדקס Firestore (collection-group על checks: status + dueDate). ראה קונסולה לקישור יצירה.'
                : 'שגיאה בטעינת שיקים';
        }
    }
}

// --- שליפת שם-לקוח לכל saleId ייחודי (קריאת parent sale פעם אחת, cache) ---
async function hydrateChecksClientNames() {
    var uniqueSaleIds = {};
    checksRecords.forEach(function(r) {
        if (r.saleId && _checksSaleNameCache[r.saleId] === undefined) uniqueSaleIds[r.saleId] = true;
    });
    var ids = Object.keys(uniqueSaleIds);
    if (ids.length === 0) return;

    await Promise.all(ids.map(async function(saleId) {
        try {
            var saleDoc = await db.collection('sales_records').doc(saleId).get();
            _checksSaleNameCache[saleId] = (saleDoc.exists && saleDoc.data().clientName) ? saleDoc.data().clientName : '';
        } catch (e) {
            _checksSaleNameCache[saleId] = '';
        }
    }));
}

// --- כרטיסי סיכום ---
function updateChecksSummary(records) {
    var today = getTodayIL();
    var count = records.length;
    var totalAmount = 0;
    var overdueCount = 0;
    records.forEach(function(r) {
        totalAmount += (parseFloat(r.amount) || 0);
        if (r.status === 'pending' && r.dueDate && r.dueDate < today) overdueCount++;
    });
    var elCount = document.getElementById('cmStatCount');
    var elAmount = document.getElementById('cmStatAmount');
    var elOverdue = document.getElementById('cmStatOverdue');
    if (elCount) elCount.textContent = count;
    if (elAmount) elAmount.textContent = '₪' + totalAmount.toLocaleString('he-IL');
    if (elOverdue) elOverdue.textContent = overdueCount;
}

// --- מתג פילטר סטטוס ---
function setChecksFilter(status) {
    checksFilterStatus = status;
    ['pending', 'cleared', 'bounced'].forEach(function(s) {
        var btn = document.getElementById('cmFilter_' + s);
        if (btn) btn.classList.toggle('active', s === status);
    });
    loadChecksData();
}

// --- מצב פירעון לתצוגה ---
function checksRowState(r) {
    var today = getTodayIL();
    if (r.status === 'bounced') return { label: 'חזר', cls: 'bounced', overdue: false };
    if (r.status === 'cleared') return { label: 'נפרע', cls: 'cleared', overdue: false };
    // pending
    if (r.dueDate && r.dueDate < today) return { label: 'באיחור', cls: 'overdue', overdue: true };
    return { label: 'ממתין', cls: 'pending', overdue: false };
}

// --- רינדור טבלה (מירור renderSalesTableView / payments.js) ---
function renderChecksTable() {
    var tbody = document.getElementById('cmTableBody');
    if (!tbody) return;

    tbody.innerHTML = checksRecords.map(function(r, idx) {
        var rowNum = idx + 1;
        var clientName = _checksSaleNameCache[r.saleId] || '';
        var clientDisplay = clientName ? escapeHTML(clientName) : ('<span style="color:#94a3b8;">' + escapeHTML(r.saleId || '—') + '</span>');
        var amount = parseFloat(r.amount) || 0;
        var dueStr = formatDate(r.dueDate);
        var st = checksRowState(r);

        var rowKey = r.saleId + '/' + r.checkId;
        var busy = !!_checksInFlight[rowKey];

        // כפתורי-פעולה — רק לשורות 'pending' (ממתין/באיחור). data-attributes + delegation (אין JSON ב-onclick).
        var actionsCell = '';
        if (r.status === 'pending') {
            actionsCell =
                '<button class="cm-action-clear" data-act="clear" data-sale="' + escapeHTML(r.saleId) + '" data-check="' + escapeHTML(r.checkId) + '"' + (busy ? ' disabled' : '') + '>נפרע ✅</button> ' +
                '<button class="cm-action-bounce" data-act="bounce" data-sale="' + escapeHTML(r.saleId) + '" data-check="' + escapeHTML(r.checkId) + '"' + (busy ? ' disabled' : '') + '>חזר ❌</button>';
        } else if (r.status === 'cleared') {
            var inv = r.invoiceNumber ? (' #' + escapeHTML(String(r.invoiceNumber))) : '';
            actionsCell = '<span style="font-size:11px;color:#64748b;">חשבונית' + inv + '</span>';
        } else {
            actionsCell = '<span style="font-size:11px;color:#94a3b8;">—</span>';
        }

        var dueTdStyle = 'color:#64748b;' + (st.overdue ? 'background:rgba(239,68,68,0.07);font-weight:600;' : '');

        return '<tr>' +
            '<td style="font-size:12px;color:#94a3b8;font-weight:500;text-align:center;">' + rowNum + '</td>' +
            '<td><strong style="color:#0f172a;">' + clientDisplay + '</strong></td>' +
            '<td style="' + dueTdStyle + '">' + dueStr + '</td>' +
            '<td class="bm-amount" style="font-weight:600;">₪' + amount.toLocaleString('he-IL') + '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.bankName || '—') + '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.bankBranch || '—') + '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.bankAccount || '—') + '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.chequeNum || '—') + '</td>' +
            '<td style="text-align:center;"><span class="cm-status-badge ' + st.cls + '">' + st.label + '</span></td>' +
            '<td style="text-align:center;white-space:nowrap;">' + actionsCell + '</td>' +
        '</tr>';
    }).join('');

    // event delegation — מתחבר פעם אחת (מירור גישה ללא onclick-with-JSON)
    if (!tbody._cmDelegated) {
        tbody.addEventListener('click', onChecksTableClick);
        tbody._cmDelegated = true;
    }
}

function onChecksTableClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    var saleId = btn.getAttribute('data-sale');
    var checkId = btn.getAttribute('data-check');
    if (!saleId || !checkId) return;
    if (act === 'clear') {
        clearCheque(saleId, checkId);
    } else if (act === 'bounce') {
        bounceCheque(saleId, checkId);
    }
}

// --- העברת כל הכפתורים של שיק למצב busy/disabled ומניעת double-click ---
function _setChequeRowBusy(saleId, checkId, busy) {
    var rowKey = saleId + '/' + checkId;
    if (busy) _checksInFlight[rowKey] = true; else delete _checksInFlight[rowKey];
    var sel = 'button[data-sale="' + (window.CSS && CSS.escape ? CSS.escape(saleId) : saleId) + '"][data-check="' + (window.CSS && CSS.escape ? CSS.escape(checkId) : checkId) + '"]';
    try {
        document.querySelectorAll(sel).forEach(function(b) { b.disabled = busy; });
    } catch (e) { /* selector edge-case — ignore */ }
}

// --- "נפרע ✅" — confirm → issue-invoice {saleId, checkId, approve:true} → 305 ---
async function clearCheque(saleId, checkId) {
    if (!saleId || !checkId) return;
    var rowKey = saleId + '/' + checkId;
    if (_checksInFlight[rowKey]) return;
    if (typeof issueInvoiceForSale !== 'function') { showToast('שירות החשבוניות לא זמין', '#ef4444'); return; }

    var ok = await tofesConfirm('לסמן את השיק כנפרע? פעולה זו תפיק חשבונית מס (305) ב-Green Invoice.', {
        title: 'פירעון שיק',
        okText: 'נפרע',
        cancelText: 'ביטול',
        danger: false
    });
    if (!ok) return;

    _setChequeRowBusy(saleId, checkId, true);
    showToast('מפיק חשבונית…', '#3b82f6');
    try {
        var res = await issueInvoiceForSale(saleId, { approve: true, checkId: checkId });

        if (res && res.success && res.issued) {
            showToast('חשבונית מס ' + (res.invoiceNumber || '') + ' הופקה');
        } else if (res && res.alreadyIssued) {
            showToast('השיק כבר נפרע (חשבונית ' + (res.invoiceNumber || '') + ')', '#f59e0b');
        } else if (res && res.needsApproval) {
            showToast('הפעולה דורשת אישור master', '#f59e0b');
        } else if (res && res.inProgress) {
            showToast('ההפקה כבר בתהליך', '#f59e0b');
        } else if (res && (res.disabled || res.prodLocked)) {
            showToast('מנוע החשבוניות כבוי כרגע', '#f59e0b');
        } else {
            showToast('ההפקה נכשלה: ' + ((res && res.error) || 'שגיאה'), '#ef4444');
        }
    } catch (err) {
        showToast('ההפקה נכשלה', '#ef4444');
    } finally {
        _setChequeRowBusy(saleId, checkId, false);
        loadChecksData(); // רענון — משקף את הסטטוס המעודכן
    }
}

// --- "חזר ❌" — confirm → issue-invoice {saleId, checkId, action:'bounce', approve:true} ---
async function bounceCheque(saleId, checkId) {
    if (!saleId || !checkId) return;
    var rowKey = saleId + '/' + checkId;
    if (_checksInFlight[rowKey]) return;
    if (typeof issueInvoiceForSale !== 'function') { showToast('שירות החשבוניות לא זמין', '#ef4444'); return; }

    var ok = await tofesConfirm('לסמן שהשיק חזר? לא תופק חשבונית. ניתן לבצע פעולה זו רק לפני שהשיק נפרע.', {
        title: 'שיק שחזר',
        okText: 'סמן שחזר',
        cancelText: 'ביטול',
        danger: true
    });
    if (!ok) return;

    _setChequeRowBusy(saleId, checkId, true);
    showToast('מסמן שיק שחזר…', '#3b82f6');
    try {
        var res = await issueInvoiceForSale(saleId, { approve: true, checkId: checkId, action: 'bounce' });

        if (res && res.success && res.bounced) {
            showToast('השיק סומן כחזר');
        } else if (res && res.error === 'already_cleared') {
            showToast('לא ניתן — השיק כבר נפרע', '#ef4444');
        } else {
            showToast('הפעולה נכשלה: ' + ((res && res.error) || 'שגיאה'), '#ef4444');
        }
    } catch (err) {
        showToast('הפעולה נכשלה', '#ef4444');
    } finally {
        _setChequeRowBusy(saleId, checkId, false);
        loadChecksData(); // רענון
    }
}

// חשיפה גלובלית מפורשת (מירור window.issueInvoiceForSale) — זמין גם אם הקובץ נטען לפני/אחרי קוראים
window.showChecksManagement = showChecksManagement;
window.hideChecksManagement = hideChecksManagement;
window.clearCheque = clearCheque;
window.bounceCheque = bounceCheque;
