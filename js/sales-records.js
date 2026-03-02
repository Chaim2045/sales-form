// ========== ניהול טבלת מכירות ==========

var salesRecords = [];
var salesViewMode = 'table';
var salesCurrentPage = 1;
var SALES_PAGE_SIZE = 15;
var salesDataLoaded = false;

// --- הצגה / הסתרה ---
function showSalesManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    if (typeof hideActivityLog === 'function') hideActivityLog();
    document.getElementById('salesManagement').classList.add('active');
    loadSalesData();
}

function hideSalesManagement() {
    document.getElementById('salesManagement').classList.remove('active');
}

// --- טעינת כל הנתונים מ-Firestore (קריאה אחת בלבד) ---
async function loadSalesData() {
    var loading = document.getElementById('smLoading');
    var empty = document.getElementById('smEmpty');
    var tableView = document.getElementById('smTableView');
    var cardsView = document.getElementById('smCardsView');

    loading.style.display = '';
    tableView.style.display = 'none';
    cardsView.style.display = 'none';
    empty.style.display = 'none';
    salesCurrentPage = 1;

    try {
        var snapshot = await db.collection('sales_records')
            .orderBy('timestamp', 'desc')
            .get();

        salesRecords = [];
        snapshot.forEach(function(doc) {
            salesRecords.push(Object.assign({ id: doc.id }, doc.data()));
        });

        salesDataLoaded = true;
        loading.style.display = 'none';

        if (salesRecords.length === 0) {
            empty.style.display = '';
            return;
        }

        populateSalesFilterDropdowns();
        updateSalesSummary(salesRecords);
        renderSalesView();
    } catch (error) {
        console.error('Error loading sales data:', error);
        loading.innerHTML = '<p style="color:#ef4444;">שגיאה בטעינת הנתונים</p>';
    }
}

// --- כרטיסי סיכום ---
function updateSalesSummary(records) {
    var now = new Date();
    var thisMonth = now.getMonth();
    var thisYear = now.getFullYear();

    var thisMonthCount = 0;
    var totalBeforeVat = 0;
    var totalWithVat = 0;

    records.forEach(function(r) {
        totalBeforeVat += (parseFloat(r.amountBeforeVat) || 0);
        totalWithVat += (parseFloat(r.amountWithVat) || 0);

        var d = r.date ? new Date(r.date) : null;
        if (d && d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
            thisMonthCount++;
        }
    });

    document.getElementById('smStatTotal').textContent = records.length;
    document.getElementById('smStatAmount').textContent = '₪' + totalBeforeVat.toLocaleString('he-IL');
    document.getElementById('smStatAmountVat').textContent = '₪' + totalWithVat.toLocaleString('he-IL');
    document.getElementById('smStatThisMonth').textContent = thisMonthCount;
}

// --- מילוי פילטרים ---
function populateSalesFilterDropdowns() {
    var attorneys = {};
    var types = {};
    var methods = {};
    var months = {};
    var years = {};

    var hebrewMonths = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

    salesRecords.forEach(function(r) {
        if (r.attorney) attorneys[r.attorney] = true;
        if (r.transactionType) types[r.transactionType] = true;
        if (r.paymentMethod) methods[r.paymentMethod] = true;
        if (r.date) {
            var d = new Date(r.date);
            if (!isNaN(d.getTime())) {
                var y = d.getFullYear();
                years[y] = true;
                var monthNum = d.getMonth();
                months[monthNum] = hebrewMonths[monthNum];
            }
        }
    });

    // Year filter — descending
    var yearSelect = document.getElementById('smFilterYear');
    yearSelect.innerHTML = '<option value="">כל השנים</option>';
    Object.keys(years).sort().reverse().forEach(function(y) {
        var opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
    });

    // Month filter — January to December
    var monthSelect = document.getElementById('smFilterMonth');
    monthSelect.innerHTML = '<option value="">כל החודשים</option>';
    Object.keys(months).sort(function(a, b) { return a - b; }).forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = months[m];
        monthSelect.appendChild(opt);
    });

    var attSelect = document.getElementById('smFilterAttorney');
    attSelect.innerHTML = '<option value="">כל העורכי דין</option>';
    Object.keys(attorneys).forEach(function(a) {
        var opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        attSelect.appendChild(opt);
    });

    var typeSelect = document.getElementById('smFilterType');
    typeSelect.innerHTML = '<option value="">כל סוגי העסקה</option>';
    Object.keys(types).forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        typeSelect.appendChild(opt);
    });

    var methodSelect = document.getElementById('smFilterPayment');
    methodSelect.innerHTML = '<option value="">כל אמצעי התשלום</option>';
    Object.keys(methods).forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        methodSelect.appendChild(opt);
    });
}

// --- סינון ---
function getFilteredSales() {
    var filtered = salesRecords;

    var search = (document.getElementById('smSearch').value || '').trim().toLowerCase();
    if (search) {
        filtered = filtered.filter(function(r) {
            return (r.clientName || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.attorney || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.phone || '').indexOf(search) !== -1 ||
                   (r.caseNumber || '').toLowerCase().indexOf(search) !== -1;
        });
    }

    var attFilter = document.getElementById('smFilterAttorney').value;
    if (attFilter) filtered = filtered.filter(function(r) { return r.attorney === attFilter; });

    var typeFilter = document.getElementById('smFilterType').value;
    if (typeFilter) filtered = filtered.filter(function(r) { return r.transactionType === typeFilter; });

    var methodFilter = document.getElementById('smFilterPayment').value;
    if (methodFilter) filtered = filtered.filter(function(r) { return r.paymentMethod === methodFilter; });

    var yearFilter = document.getElementById('smFilterYear').value;
    if (yearFilter) {
        var yearNum = parseInt(yearFilter);
        filtered = filtered.filter(function(r) {
            if (!r.date) return false;
            var d = new Date(r.date);
            return !isNaN(d.getTime()) && d.getFullYear() === yearNum;
        });
    }

    var monthFilter = document.getElementById('smFilterMonth').value;
    if (monthFilter !== '') {
        var monthNum = parseInt(monthFilter);
        filtered = filtered.filter(function(r) {
            if (!r.date) return false;
            var d = new Date(r.date);
            return !isNaN(d.getTime()) && d.getMonth() === monthNum;
        });
    }

    var invoiceFilter = document.getElementById('smFilterInvoice').value;
    if (invoiceFilter === 'yes') {
        filtered = filtered.filter(function(r) { return r.invoiceIssued === true; });
    } else if (invoiceFilter === 'no') {
        filtered = filtered.filter(function(r) { return !r.invoiceIssued; });
    }

    var dateFrom = document.getElementById('smFilterDateFrom').value;
    if (dateFrom) filtered = filtered.filter(function(r) { return (r.date || '') >= dateFrom; });

    var dateTo = document.getElementById('smFilterDateTo').value;
    if (dateTo) filtered = filtered.filter(function(r) { return (r.date || '') <= dateTo; });

    return filtered;
}

// --- מתג תצוגה ---
function setSalesViewMode(mode) {
    salesViewMode = mode;
    salesCurrentPage = 1;
    document.getElementById('smViewTable').classList.toggle('active', mode === 'table');
    document.getElementById('smViewCards').classList.toggle('active', mode === 'cards');
    renderSalesView();
}

// --- רינדור ---
function renderSalesView() {
    var filtered = getFilteredSales();
    var tableView = document.getElementById('smTableView');
    var cardsView = document.getElementById('smCardsView');
    var empty = document.getElementById('smEmpty');

    if (filtered.length === 0) {
        tableView.style.display = 'none';
        cardsView.style.display = 'none';
        empty.style.display = '';
        renderSalesPagination(0, 0);
        return;
    }

    empty.style.display = 'none';

    // Pagination — slice for current page
    var totalFiltered = filtered.length;
    var totalPages = Math.ceil(totalFiltered / SALES_PAGE_SIZE);
    if (salesCurrentPage > totalPages) salesCurrentPage = totalPages;
    if (salesCurrentPage < 1) salesCurrentPage = 1;

    var startIdx = (salesCurrentPage - 1) * SALES_PAGE_SIZE;
    var pageRecords = filtered.slice(startIdx, startIdx + SALES_PAGE_SIZE);

    if (salesViewMode === 'table') {
        tableView.style.display = '';
        cardsView.style.display = 'none';
        renderSalesTableView(pageRecords, startIdx);
    } else {
        tableView.style.display = 'none';
        cardsView.style.display = '';
        renderSalesCardsView(pageRecords, startIdx);
    }

    renderSalesPagination(totalFiltered, totalPages);
}

function renderSalesPagination(totalFiltered, totalPages) {
    var container = document.getElementById('smPagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = totalFiltered > 0
            ? '<span class="sm-page-info">' + totalFiltered + ' רשומות</span>'
            : '';
        return;
    }

    var html = '<div class="sm-pagination">';

    // Previous button
    html += '<button class="sm-page-btn" onclick="salesGoToPage(' + (salesCurrentPage - 1) + ')" ' + (salesCurrentPage <= 1 ? 'disabled' : '') + '>';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    html += '</button>';

    // Page numbers
    for (var i = 1; i <= totalPages; i++) {
        if (i === salesCurrentPage) {
            html += '<button class="sm-page-btn active">' + i + '</button>';
        } else if (i <= 2 || i > totalPages - 2 || Math.abs(i - salesCurrentPage) <= 1) {
            html += '<button class="sm-page-btn" onclick="salesGoToPage(' + i + ')">' + i + '</button>';
        } else if (i === 3 && salesCurrentPage > 4) {
            html += '<span class="sm-page-dots">...</span>';
        } else if (i === totalPages - 2 && salesCurrentPage < totalPages - 3) {
            html += '<span class="sm-page-dots">...</span>';
        }
    }

    // Next button
    html += '<button class="sm-page-btn" onclick="salesGoToPage(' + (salesCurrentPage + 1) + ')" ' + (salesCurrentPage >= totalPages ? 'disabled' : '') + '>';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    html += '</button>';

    html += '<span class="sm-page-info">' + totalFiltered + ' רשומות | עמוד ' + salesCurrentPage + ' מתוך ' + totalPages + '</span>';
    html += '</div>';

    container.innerHTML = html;
}

function salesGoToPage(page) {
    salesCurrentPage = page;
    renderSalesView();
    // Scroll to top of table
    var el = document.getElementById('salesManagement');
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterSalesView() {
    salesCurrentPage = 1;
    var filtered = getFilteredSales();
    updateSalesSummary(filtered);
    renderSalesView();
}

// --- טבלה ---
function renderSalesTableView(records, startIdx) {
    var tbody = document.getElementById('smTableBody');
    tbody.innerHTML = records.map(function(r, idx) {
        var rowNum = (startIdx || 0) + idx + 1;
        var amountBefore = parseFloat(r.amountBeforeVat) || 0;
        var amountWith = parseFloat(r.amountWithVat) || 0;
        var dateStr = formatDate(r.date);
        var paymentDisplay = r.isSplitPayment ? 'פיצול תשלום' : escapeHTML(r.paymentMethod || '—');

        // File badge — clean SVG icon
        var fileBadge = r.checksPhotoURL
            ? '<a href="' + escapeHTML(r.checksPhotoURL) + '" target="_blank" rel="noopener" class="sm-file-icon" onclick="event.stopPropagation();" title="צפה בקובץ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></a>'
            : '<span style="color:#e2e8f0;">—</span>';

        // Invoice status — red only on this cell
        var invoiceCell = '';
        var invoiceTdStyle = 'text-align:center;';
        if (r.invoiceIssued) {
            invoiceCell = '<span class="sm-invoice-badge issued" title="קבלה #' + escapeHTML(r.invoiceReceiptNumber || '') + ' | ' + escapeHTML(r.invoiceDate || '') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" style="vertical-align:-2px;margin-left:3px;"><polyline points="20 6 9 17 4 12"/></svg>יצאה</span>';
        } else {
            invoiceTdStyle += 'background:rgba(239,68,68,0.07);';
            invoiceCell = '<button class="sm-invoice-btn" onclick="event.stopPropagation();openInvoicePopup(\'' + escapeHTML(r.id) + '\')" title="סמן שיצאה חשבונית">לא יצאה</button>';
        }

        return '<tr onclick="openSaleDetailModal(\'' + escapeHTML(r.id) + '\')" style="cursor:pointer;">' +
            '<td style="font-size:12px;color:#94a3b8;font-weight:500;text-align:center;">' + rowNum + '</td>' +
            '<td style="font-size:12px;color:#64748b;">' + dateStr + '</td>' +
            '<td><strong style="color:#0f172a;">' + escapeHTML(r.clientName || '') + '</strong></td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.transactionType || '—') + '</td>' +
            '<td class="bm-amount">₪' + amountBefore.toLocaleString('he-IL') + '</td>' +
            '<td class="bm-amount" style="font-weight:600;">₪' + amountWith.toLocaleString('he-IL') + '</td>' +
            '<td style="color:#64748b;">' + paymentDisplay + '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.attorney || '—') + '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(r.branch || '—') + '</td>' +
            '<td style="text-align:center;">' + fileBadge + '</td>' +
            '<td style="' + invoiceTdStyle + '">' + invoiceCell + '</td>' +
            '<td><button class="bm-action-secondary" onclick="event.stopPropagation();openSaleDetailModal(\'' + escapeHTML(r.id) + '\')" style="padding:4px 12px;font-size:12px;">פרטים</button></td>' +
        '</tr>';
    }).join('');
}

// --- כרטיסים ---
function renderSalesCardsView(records, startIdx) {
    var container = document.getElementById('smCardsContainer');
    container.innerHTML = records.map(function(r, idx) {
        var rowNum = (startIdx || 0) + idx + 1;
        var amountBefore = parseFloat(r.amountBeforeVat) || 0;
        var amountWith = parseFloat(r.amountWithVat) || 0;
        var paymentDisplay = r.isSplitPayment ? 'פיצול תשלום' : escapeHTML(r.paymentMethod || '—');

        var fileBadge = r.checksPhotoURL
            ? '<a href="' + escapeHTML(r.checksPhotoURL) + '" target="_blank" rel="noopener" class="sm-file-icon" onclick="event.stopPropagation();" title="צפה בקובץ" style="display:inline-flex;align-items:center;gap:4px;color:#2563eb;font-size:12px;font-weight:500;text-decoration:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>קובץ</a>'
            : '';

        var invoiceHtml = '';
        var invoiceBg = '';
        if (r.invoiceIssued) {
            invoiceHtml = '<span class="sm-invoice-badge issued"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" style="vertical-align:-2px;margin-left:3px;"><polyline points="20 6 9 17 4 12"/></svg>חשבונית יצאה</span>';
        } else {
            invoiceBg = 'background:rgba(239,68,68,0.06);';
            invoiceHtml = '<button class="sm-invoice-btn" onclick="event.stopPropagation();openInvoicePopup(\'' + escapeHTML(r.id) + '\')">לא יצאה חשבונית</button>';
        }

        return '<div class="bm-card" onclick="openSaleDetailModal(\'' + escapeHTML(r.id) + '\')" style="cursor:pointer;">' +
            '<div class="bm-card-top">' +
                '<div>' +
                    '<div class="bm-card-name"><span style="color:#94a3b8;font-weight:400;font-size:12px;margin-left:6px;">#' + rowNum + '</span>' + escapeHTML(r.clientName || '') + '</div>' +
                    '<div class="bm-card-case">' + escapeHTML(r.transactionType || '') + ' | ' + formatDate(r.date) + '</div>' +
                '</div>' +
                '<span class="bm-badge active" style="font-size:11px;">' + escapeHTML(r.attorney || '') + '</span>' +
            '</div>' +
            '<div class="bm-card-body">' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">לפני מע״מ</div>' +
                    '<div class="bm-card-field-value">₪' + amountBefore.toLocaleString('he-IL') + '</div>' +
                '</div>' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">עם מע״מ</div>' +
                    '<div class="bm-card-field-value" style="font-weight:600;">₪' + amountWith.toLocaleString('he-IL') + '</div>' +
                '</div>' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">אמצעי תשלום</div>' +
                    '<div class="bm-card-field-value">' + paymentDisplay + '</div>' +
                '</div>' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">סניף</div>' +
                    '<div class="bm-card-field-value">' + escapeHTML(r.branch || '—') + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-top:1px solid rgba(0,0,0,0.06);gap:8px;border-radius:0 0 12px 12px;' + invoiceBg + '">' +
                fileBadge + invoiceHtml +
            '</div>' +
        '</div>';
    }).join('');
}

// --- מודאל פרטי מכירה ---
function openSaleDetailModal(saleId) {
    var record = null;
    for (var i = 0; i < salesRecords.length; i++) {
        if (salesRecords[i].id === saleId) { record = salesRecords[i]; break; }
    }
    if (!record) return;
    logAuditEvent('sale_detail_viewed', { saleId: saleId, clientName: record.clientName || '' });

    var body = document.getElementById('saleDetailBody');
    var html = '';

    // כפתור העתקת כל הפרטים
    html += '<div style="text-align:center;margin-bottom:12px;">';
    html += '<button onclick="copyAllClientDetails(salesRecords.find(function(r){return r.id===\'' + escapeHTML(record.id) + '\'}))" style="background:#2563eb;color:white;border:none;padding:8px 22px;border-radius:8px;font-family:Heebo,sans-serif;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> העתק את כל הפרטים לחשבונית</button>';
    html += '</div>';

    // פרטי לקוח
    html += '<div class="billing-section-title">פרטי לקוח</div>';
    html += saleDetailRow('שם לקוח', record.clientName, true);
    html += saleDetailRow('טלפון', record.phone, true);
    html += saleDetailRow('מייל', record.email, true);
    html += saleDetailRow('ת.ז / ח.פ', record.idNumber, true);
    html += saleDetailRow('כתובת', record.address, true);
    html += saleDetailRow('סטטוס לקוח', record.clientStatus);

    // פרטי עסקה
    html += '<div class="billing-section-title" style="margin-top:16px;">פרטי עסקה</div>';
    html += saleDetailRow('סוג עסקה', record.transactionType, true);
    html += saleDetailRow('תיאור', record.transactionDescription, true);
    if (record.hoursQuantity) {
        html += saleDetailRow('שעות', record.hoursQuantity);
        html += saleDetailRow('מחיר לשעה', '₪' + (parseFloat(record.hourlyRate) || 0).toLocaleString('he-IL'));
    }
    html += saleDetailRow('סכום לפני מע״מ', '₪' + (parseFloat(record.amountBeforeVat) || 0).toLocaleString('he-IL'), true);
    html += saleDetailRow('מע״מ', '₪' + (parseFloat(record.vatAmount) || 0).toLocaleString('he-IL'), true);
    html += saleDetailRow('סכום כולל מע״מ', '₪' + (parseFloat(record.amountWithVat) || 0).toLocaleString('he-IL'), true);

    // פרטי תשלום
    html += '<div class="billing-section-title" style="margin-top:16px;">פרטי תשלום</div>';
    html += saleDetailRow('אמצעי תשלום', record.paymentMethod);
    if (record.isSplitPayment && record.paymentBreakdownText) {
        html += saleDetailRow('פירוט פיצול', record.paymentBreakdownText);
    }
    if (record.creditCardStatus) html += saleDetailRow('סטטוס כרטיס', record.creditCardStatus);
    if (record.paymentsCount) html += saleDetailRow('מספר תשלומים', record.paymentsCount);
    if (record.checksCount) html += saleDetailRow('מספר שיקים', record.checksCount);
    if (record.checksTotalAmount) html += saleDetailRow('סה״כ שיקים', '₪' + (parseFloat(record.checksTotalAmount) || 0).toLocaleString('he-IL'));
    if (record.recurringMonthlyAmount) html += saleDetailRow('חיוב חודשי', '₪' + (parseFloat(record.recurringMonthlyAmount) || 0).toLocaleString('he-IL'));
    if (record.recurringMonthsCount) html += saleDetailRow('מספר חודשים', record.recurringMonthsCount);
    if (record.recurringStartDate) html += saleDetailRow('תאריך התחלה', formatDate(record.recurringStartDate));

    // חשבונית
    html += '<div class="billing-section-title" style="margin-top:16px;">חשבונית</div>';
    if (record.invoiceIssued) {
        html += saleDetailRow('סטטוס', '✓ חשבונית יצאה');
        html += saleDetailRow('תאריך חשבונית', formatDate(record.invoiceDate));
        html += saleDetailRow('מספר קבלה', record.invoiceReceiptNumber, true);
    } else {
        html += '<div style="padding:8px 0;">';
        html += '<button onclick="closeDetailAndOpenInvoice(\'' + escapeHTML(record.id) + '\')" style="background:#ef4444;color:white;border:none;padding:8px 18px;border-radius:8px;font-family:Heebo,sans-serif;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> לא יצאה חשבונית — לחץ לסימון</button>';
        html += '</div>';
    }

    // פרטים נוספים
    html += '<div class="billing-section-title" style="margin-top:16px;">פרטים נוספים</div>';
    html += saleDetailRow('עו״ד מטפל', record.attorney);
    html += saleDetailRow('מספר תיק', record.caseNumber, true);
    html += saleDetailRow('סניף', record.branch);
    html += saleDetailRow('ממלא הטופס', record.formFillerName);
    html += saleDetailRow('תאריך', formatDate(record.date));
    if (record.notes) html += saleDetailRow('הערות', record.notes);

    // קבצים מצורפים
    if (record.checksPhotoURL) {
        html += '<div class="billing-section-title" style="margin-top:16px;">קבצים מצורפים</div>';
        html += '<div style="padding:8px 0;">';
        html += '<a href="' + escapeHTML(record.checksPhotoURL) + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;color:#2563eb;font-size:13px;text-decoration:none;font-weight:500;">';
        html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        html += 'צפה בקובץ מצורף</a>';
        html += '</div>';
    }

    // כפתור עריכה
    html += '<div style="text-align:center;margin-top:18px;">';
    html += '<button onclick="openSaleEditModal(\'' + escapeHTML(record.id) + '\')" style="background:#2563eb;color:white;border:none;padding:10px 28px;border-radius:8px;font-family:Heebo,sans-serif;font-size:14px;font-weight:600;cursor:pointer;">עריכת רשומה</button>';
    html += '</div>';

    body.innerHTML = html;
    document.getElementById('saleDetailOverlay').classList.add('show');
}

function closeSaleDetailModal() {
    document.getElementById('saleDetailOverlay').classList.remove('show');
}

function saleDetailRow(label, value, copyable) {
    if (!value && value !== 0) return '';
    var copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var copyBtn = copyable
        ? ' <button onclick="copyToClipboard(\'' + escapeHTML(String(value)).replace(/'/g, "\\'") + '\',\'' + escapeHTML(label).replace(/'/g, "\\'") + '\')" class="sm-copy-btn" title="העתק">' + copyIcon + '</button>'
        : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(0,0,0,0.06);">' +
        '<span style="color:#6b7280;font-size:13px;flex-shrink:0;">' + escapeHTML(label) + '</span>' +
        '<span style="display:flex;align-items:center;gap:4px;color:#1f2937;font-size:13px;font-weight:500;text-align:left;max-width:65%;word-break:break-word;">' + escapeHTML(String(value)) + copyBtn + '</span>' +
    '</div>';
}

// --- ייצוא CSV ---
function exportSalesReport() {
    var btn = document.getElementById('smExportBtn');
    btn.disabled = true;
    var originalHTML = btn.innerHTML;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> מייצא...';

    try {
        var records = getFilteredSales();

        var headers = ['תאריך', 'לקוח', 'טלפון', 'מייל', 'ת.ז/ח.פ', 'סוג עסקה', 'תיאור', 'לפני מע״מ', 'מע״מ', 'עם מע״מ', 'אמצעי תשלום', 'עו״ד', 'סניף', 'מספר תיק', 'הערות'];

        var csvContent = '\uFEFF' + headers.join(',') + '\n';

        records.forEach(function(r) {
            var line = [
                '"' + (r.date || '').replace(/"/g, '""') + '"',
                '"' + (r.clientName || '').replace(/"/g, '""') + '"',
                '"' + (r.phone || '').replace(/"/g, '""') + '"',
                '"' + (r.email || '').replace(/"/g, '""') + '"',
                '"' + (r.idNumber || '').replace(/"/g, '""') + '"',
                '"' + (r.transactionType || '').replace(/"/g, '""') + '"',
                '"' + (r.transactionDescription || '').replace(/"/g, '""') + '"',
                parseFloat(r.amountBeforeVat) || 0,
                parseFloat(r.vatAmount) || 0,
                parseFloat(r.amountWithVat) || 0,
                '"' + (r.paymentMethod || '').replace(/"/g, '""') + '"',
                '"' + (r.attorney || '').replace(/"/g, '""') + '"',
                '"' + (r.branch || '').replace(/"/g, '""') + '"',
                '"' + (r.caseNumber || '').replace(/"/g, '""') + '"',
                '"' + (r.notes || '').replace(/"/g, '""') + '"'
            ].join(',');
            csvContent += line + '\n';
        });

        var today = new Date().toISOString().split('T')[0];
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'sales_report_' + today + '.csv';
        link.click();
        URL.revokeObjectURL(link.href);

        logAuditEvent('csv_export', { type: 'sales_report', date: today, count: records.length });
    } catch (error) {
        console.error('Export error:', error);
        alert('שגיאה בייצוא: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

// ========== עריכת רשומת מכירה ==========

function openSaleEditModal(saleId) {
    var record = null;
    for (var i = 0; i < salesRecords.length; i++) {
        if (salesRecords[i].id === saleId) { record = salesRecords[i]; break; }
    }
    if (!record) return;

    // Close detail modal
    closeSaleDetailModal();

    // Fill edit form
    document.getElementById('saleEditId').value = record.id;
    document.getElementById('saleEditClientName').value = record.clientName || '';
    document.getElementById('saleEditPhone').value = record.phone || '';
    document.getElementById('saleEditEmail').value = record.email || '';
    document.getElementById('saleEditIdNumber').value = record.idNumber || '';
    document.getElementById('saleEditAddress').value = record.address || '';
    document.getElementById('saleEditTransactionType').value = record.transactionType || '';
    document.getElementById('saleEditDescription').value = record.transactionDescription || '';
    document.getElementById('saleEditAmount').value = parseFloat(record.amountBeforeVat) || '';
    document.getElementById('saleEditPaymentMethod').value = record.paymentMethod || '';
    document.getElementById('saleEditAttorney').value = record.attorney || '';
    document.getElementById('saleEditCaseNumber').value = record.caseNumber || '';
    document.getElementById('saleEditBranch').value = record.branch || '';
    document.getElementById('saleEditNotes').value = record.notes || '';

    document.getElementById('saleEditOverlay').classList.add('show');
}

function closeSaleEditModal() {
    document.getElementById('saleEditOverlay').classList.remove('show');
}

async function saveSaleEdit() {
    var docId = document.getElementById('saleEditId').value;
    if (!docId) return;

    var clientName = document.getElementById('saleEditClientName').value.trim();
    if (!clientName) {
        alert('שם לקוח הוא שדה חובה');
        return;
    }

    var amountBefore = parseFloat(document.getElementById('saleEditAmount').value) || 0;
    var vatAmount = Math.round(amountBefore * 0.18 * 100) / 100;
    var amountWith = Math.round((amountBefore + vatAmount) * 100) / 100;

    var updateData = {
        clientName: clientName,
        phone: document.getElementById('saleEditPhone').value.trim(),
        email: document.getElementById('saleEditEmail').value.trim(),
        idNumber: document.getElementById('saleEditIdNumber').value.trim(),
        address: document.getElementById('saleEditAddress').value.trim(),
        transactionType: document.getElementById('saleEditTransactionType').value,
        transactionDescription: document.getElementById('saleEditDescription').value.trim(),
        amountBeforeVat: amountBefore,
        vatAmount: vatAmount,
        amountWithVat: amountWith,
        paymentMethod: document.getElementById('saleEditPaymentMethod').value,
        attorney: document.getElementById('saleEditAttorney').value,
        caseNumber: document.getElementById('saleEditCaseNumber').value.trim(),
        branch: document.getElementById('saleEditBranch').value,
        notes: document.getElementById('saleEditNotes').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: authUser ? authUser.email : 'unknown'
    };

    try {
        // Update Firestore
        await db.collection('sales_records').doc(docId).update(updateData);

        // Sync to Google Sheets (one-way: app → sheets)
        var record = null;
        for (var i = 0; i < salesRecords.length; i++) {
            if (salesRecords[i].id === docId) { record = salesRecords[i]; break; }
        }
        var mergedData = Object.assign({}, record || {}, updateData);
        await syncToSheets(mergedData);

        logAuditEvent('sale_edited', { docId: docId, clientName: clientName });

        closeSaleEditModal();
        loadSalesData(); // Reload table

        // Success feedback
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#059669;color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-family:Heebo,sans-serif;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        toast.textContent = 'הרשומה עודכנה בהצלחה';
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 2500);

    } catch (error) {
        console.error('Error saving edit:', error);
        alert('שגיאה בשמירה: ' + error.message);
    }
}

// ========== מעקב חשבוניות ==========

function openInvoicePopup(saleId) {
    var existing = document.getElementById('invoicePopupOverlay');
    if (existing) existing.remove();

    var today = new Date().toISOString().split('T')[0];

    var overlay = document.createElement('div');
    overlay.id = 'invoicePopupOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
        '<div style="background:white;border-radius:16px;padding:24px;max-width:380px;width:90%;font-family:Heebo,sans-serif;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.2);">' +
            '<h3 style="margin:0 0 16px;font-size:17px;color:#1e293b;text-align:center;">סימון הוצאת חשבונית</h3>' +
            '<div style="margin-bottom:12px;">' +
                '<label style="display:block;font-size:13px;color:#475569;margin-bottom:4px;font-weight:500;">תאריך הוצאת חשבונית</label>' +
                '<input type="date" id="invoicePopupDate" value="' + today + '" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:Heebo,sans-serif;box-sizing:border-box;">' +
            '</div>' +
            '<div style="margin-bottom:16px;">' +
                '<label style="display:block;font-size:13px;color:#475569;margin-bottom:4px;font-weight:500;">מספר קבלה / חשבונית</label>' +
                '<input type="text" id="invoicePopupReceipt" placeholder="הזן מספר קבלה..." style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:Heebo,sans-serif;box-sizing:border-box;">' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
                '<button onclick="saveInvoice(\'' + escapeHTML(saleId) + '\')" style="flex:1;padding:10px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;font-family:Heebo,sans-serif;cursor:pointer;">שמור</button>' +
                '<button onclick="closeInvoicePopup()" style="flex:1;padding:10px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:14px;font-weight:500;font-family:Heebo,sans-serif;cursor:pointer;">ביטול</button>' +
            '</div>' +
        '</div>';

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeInvoicePopup();
    });

    document.body.appendChild(overlay);
}

function closeInvoicePopup() {
    var el = document.getElementById('invoicePopupOverlay');
    if (el) el.remove();
}

function closeDetailAndOpenInvoice(saleId) {
    closeSaleDetailModal();
    openInvoicePopup(saleId);
}

async function saveInvoice(saleId) {
    var invoiceDate = document.getElementById('invoicePopupDate').value;
    var receiptNumber = document.getElementById('invoicePopupReceipt').value.trim();

    if (!invoiceDate) {
        alert('יש להזין תאריך חשבונית');
        return;
    }
    if (!receiptNumber) {
        alert('יש להזין מספר קבלה');
        return;
    }

    try {
        await db.collection('sales_records').doc(saleId).update({
            invoiceIssued: true,
            invoiceDate: invoiceDate,
            invoiceReceiptNumber: receiptNumber,
            invoiceUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            invoiceUpdatedBy: authUser ? authUser.email : 'unknown'
        });

        logAuditEvent('invoice_marked', { saleId: saleId, receiptNumber: receiptNumber });

        closeInvoicePopup();
        loadSalesData();

        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#059669;color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-family:Heebo,sans-serif;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        toast.textContent = 'חשבונית סומנה בהצלחה';
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 2500);

    } catch (error) {
        console.error('Error saving invoice:', error);
        alert('שגיאה בשמירה: ' + error.message);
    }
}

// ========== העתקת פרטים לחשבונית ==========

function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(function() {
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:8px 18px;border-radius:8px;font-size:13px;font-family:Heebo,sans-serif;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        toast.textContent = label + ' הועתק';
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 1500);
    });
}

function copyAllClientDetails(record) {
    var lines = [];
    if (record.clientName) lines.push('שם: ' + record.clientName);
    if (record.idNumber) lines.push('ת.ז/ח.פ: ' + record.idNumber);
    if (record.phone) lines.push('טלפון: ' + record.phone);
    if (record.email) lines.push('מייל: ' + record.email);
    if (record.address) lines.push('כתובת: ' + record.address);
    lines.push('');
    if (record.transactionType) lines.push('סוג עסקה: ' + record.transactionType);
    if (record.transactionDescription) lines.push('תיאור: ' + record.transactionDescription);
    lines.push('סכום לפני מע״מ: ₪' + (parseFloat(record.amountBeforeVat) || 0).toLocaleString('he-IL'));
    lines.push('מע״מ: ₪' + (parseFloat(record.vatAmount) || 0).toLocaleString('he-IL'));
    lines.push('סכום כולל מע״מ: ₪' + (parseFloat(record.amountWithVat) || 0).toLocaleString('he-IL'));

    copyToClipboard(lines.join('\n'), 'כל הפרטים');
    logAuditEvent('client_details_copied', { clientName: record.clientName || '' });
}
