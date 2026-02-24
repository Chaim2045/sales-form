// ========== מודאל גבייה חודשית ==========

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function safeChargeDate(year, month, dayOfMonth) {
    var lastDay = new Date(year, month + 1, 0).getDate();
    var day = Math.min(dayOfMonth, lastDay);
    return new Date(year, month, day);
}

let billingSearchTimeout = null;

function openBillingModal() {
    document.getElementById('billingModalOverlay').classList.add('show');
    // Reset form
    document.getElementById('billingClientSearch').value = '';
    document.getElementById('billingClientName').value = '';
    document.getElementById('billingPhone').value = '';
    document.getElementById('billingEmail').value = '';
    document.getElementById('billingIdNumber').value = '';
    document.getElementById('billingAddress').value = '';
    document.getElementById('billingTotalDeal').value = '';
    document.getElementById('billingAmount').value = '';
    document.getElementById('billingMonths').value = '';
    document.getElementById('billingStartDate').value = '';
    document.getElementById('billingDayOfMonth').value = '1';
    document.getElementById('billingPaidMonths').value = '0';
    document.getElementById('billingAttorney').value = '';
    document.getElementById('billingCaseNumber').value = '';
    document.getElementById('billingTransactionType').value = 'ריטיינר';
    document.getElementById('billingNotes').value = '';
    document.getElementById('billingCardNumber').value = '';
    document.getElementById('billingCardExpiry').value = '';
    document.getElementById('billingCardHolder').value = '';
    document.getElementById('billingCardType').value = '';
    document.getElementById('billingAutocomplete').classList.remove('show');

    // Reset amounts preview
    document.getElementById('billingAmountsPreview').style.display = 'none';
    document.getElementById('billingAmountsTable').style.display = 'none';
    document.getElementById('billingAmountsTable').innerHTML = '';
    document.getElementById('billingAmountsSummary').innerHTML = '';
    var toggleBtn = document.getElementById('billingAmountsToggle');
    if (toggleBtn) {
        toggleBtn.textContent = 'ערוך סכומים';
        toggleBtn.style.background = 'none';
        toggleBtn.style.color = 'var(--primary-blue)';
    }

    // Restore form view (in case success was shown)
    document.getElementById('billingModalBody').style.display = '';
    document.getElementById('billingModalFooter').style.display = '';
}

function closeBillingModal() {
    document.getElementById('billingModalOverlay').classList.remove('show');
}

// Autocomplete for billing modal
document.getElementById('billingClientSearch').addEventListener('input', function(e) {
    const term = e.target.value.trim();
    clearTimeout(billingSearchTimeout);

    if (term.length < 2) {
        document.getElementById('billingAutocomplete').classList.remove('show');
        return;
    }

    billingSearchTimeout = setTimeout(async () => {
        const dropdown = document.getElementById('billingAutocomplete');
        dropdown.innerHTML = '<div class="billing-autocomplete-item" style="color:#6b7280;cursor:default;">מחפש...</div>';
        dropdown.classList.add('show');

        const clients = await searchClients(term);

        if (clients.length === 0) {
            dropdown.innerHTML = '<div class="billing-autocomplete-item" style="color:#6b7280;cursor:default;">לא נמצאו לקוחות</div>';
            return;
        }

        dropdown.innerHTML = clients.map(client =>
            `<div class="billing-autocomplete-item" onclick='fillBillingClientData(${JSON.stringify(client).replace(/'/g, "&#39;")})'>
                <div class="billing-autocomplete-name">${escapeHTML(client.clientName)}</div>
                <div class="billing-autocomplete-details">${escapeHTML(client.phone || '')} ${client.email ? '| ' + escapeHTML(client.email) : ''}</div>
            </div>`
        ).join('');
    }, 300);
});

// Close autocomplete when clicking outside
document.addEventListener('click', function(e) {
    const search = document.getElementById('billingClientSearch');
    const dropdown = document.getElementById('billingAutocomplete');
    if (search && dropdown && !search.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

window.fillBillingClientData = function(client) {
    document.getElementById('billingClientName').value = client.clientName || '';
    document.getElementById('billingPhone').value = client.phone || '';
    document.getElementById('billingEmail').value = client.email || '';
    document.getElementById('billingIdNumber').value = client.idNumber || '';
    document.getElementById('billingAddress').value = client.address || '';
    document.getElementById('billingClientSearch').value = client.clientName || '';
    document.getElementById('billingAutocomplete').classList.remove('show');
};

async function submitBillingForm() {
    // Validation
    const clientName = document.getElementById('billingClientName').value.trim();
    const totalDeal = document.getElementById('billingTotalDeal').value;
    const amount = document.getElementById('billingAmount').value;
    const months = document.getElementById('billingMonths').value;
    const startDate = document.getElementById('billingStartDate').value;
    const attorney = document.getElementById('billingAttorney').value;

    if (!clientName || !totalDeal || !months || !startDate || !attorney) {
        alert('נא למלא את כל השדות המסומנים בכוכבית');
        return;
    }

    const submitBtn = document.getElementById('billingSubmitBtn');
    submitBtn.disabled = true;
    document.getElementById('billingSubmitText').textContent = 'שומר...';

    try {
        // הצפנת פרטי כרטיס אשראי
        const cardNumber = (document.getElementById('billingCardNumber').value || '').replace(/\s/g, '');
        const cardExpiry = document.getElementById('billingCardExpiry').value || '';
        const cardHolder = document.getElementById('billingCardHolder').value || '';
        const cardType = document.getElementById('billingCardType').value || '';
        let cardEncrypted = '';
        let cardLast4 = '';

        if (cardNumber) {
            if (!validateCardNumber(cardNumber)) {
                alert('מספר כרטיס אשראי לא תקין');
                submitBtn.disabled = false;
                document.getElementById('billingSubmitText').textContent = 'שמור וצור תזכורות';
                return;
            }
            if (cardExpiry && !validateCardExpiry(cardExpiry)) {
                alert('תוקף כרטיס לא תקין או שפג תוקפו');
                submitBtn.disabled = false;
                document.getElementById('billingSubmitText').textContent = 'שמור וצור תזכורות';
                return;
            }
            const passphrase = await requestPassword('encrypt');
            if (!passphrase) {
                submitBtn.disabled = false;
                document.getElementById('billingSubmitText').textContent = 'שמור וצור תזכורות';
                return;
            }
            cardEncrypted = encryptCardData(cardNumber, passphrase);
            cardLast4 = cardNumber.slice(-4);
        }

        const billingIdPrefix = 'BIL-' + Date.now();

        // בדיקה אם יש סכומים מותאמים לכל חודש
        const monthlyAmounts = getMonthlyAmountsFromTable();

        const totalDealNum = parseFloat(totalDeal);
        const monthsNum = parseInt(months);
        const perPayment = amount ? parseFloat(amount) : Math.round(totalDealNum / monthsNum);

        const billingData = {
            clientName: clientName,
            phone: document.getElementById('billingPhone').value || '',
            email: document.getElementById('billingEmail').value || '',
            idNumber: document.getElementById('billingIdNumber').value || '',
            address: document.getElementById('billingAddress').value || '',
            totalPlannedAmount: totalDealNum,
            recurringMonthlyAmount: perPayment,
            recurringMonthsCount: months,
            recurringStartDate: startDate,
            recurringDayOfMonth: document.getElementById('billingDayOfMonth').value || '1',
            paidMonthsAlready: parseInt(document.getElementById('billingPaidMonths').value) || 0,
            attorney: attorney,
            caseNumber: document.getElementById('billingCaseNumber').value || '',
            branch: document.getElementById('billingBranch').value || 'תל אביב',
            transactionType: document.getElementById('billingTransactionType').value || 'ריטיינר',
            transactionDescription: 'חיוב חודשי - ' + clientName,
            recurringNotes: document.getElementById('billingNotes').value || '',
            recurringBilling: true,
            creditCardStatus: 'חיוב חודשי',
            paymentMethod: 'כרטיס אשראי',
            status: 'פעיל',
            cardEncrypted: cardEncrypted,
            cardLast4: cardLast4,
            cardExpiry: cardExpiry,
            cardHolder: cardHolder,
            cardType: cardType,
            createdBy: currentUser || 'לא ידוע',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            billingIdPrefix: billingIdPrefix,
            totalActualPaid: 0,
            completedPaymentsCount: 0,
            lastPaymentDate: null,
            monthlyAmounts: monthlyAmounts || null
        };

        // שמירה ב-Firestore (מקור אמת יחיד לגבייה)
        await db.collection('recurring_billing').add(billingData);

        // הצגת הודעת הצלחה
        document.getElementById('billingModalBody').innerHTML =
            '<div class="billing-success-msg">' +
                '<div class="check-icon">&#10004;</div>' +
                '<h3 style="margin:0 0 8px;color:#1f2937;">הלקוח נוסף לגבייה בהצלחה!</h3>' +
                '<p style="color:#6b7280;margin:0 0 4px;">' + escapeHTML(clientName) + '</p>' +
                '<p style="color:#6b7280;margin:0;">סה"כ ₪' + totalDealNum.toLocaleString('he-IL') + ' ב-' + monthsNum + ' תשלומים</p>' +
                '<p style="color:#9ca3af;font-size:12px;margin-top:12px;">תזכורות יישלחו אוטומטית יום לפני כל חיוב</p>' +
            '</div>';
        document.getElementById('billingModalFooter').innerHTML =
            '<button class="billing-btn-submit" onclick="closeBillingModal()" style="width:100%;">סגור</button>';

    } catch (error) {
        console.error('Error saving billing data:', error);
        alert('שגיאה בשמירה: ' + error.message);
        submitBtn.disabled = false;
        document.getElementById('billingSubmitText').textContent = 'שמור וצור תזכורות';
    }
}

// ========== ניהול גבייה חודשית - Management View ==========

let billingClients = [];
let billingFilter = 'all';
let billingViewMode = 'table';

function showBillingManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('billingManagement').classList.add('active');
    loadBillingData();
}

function hideBillingManagement() {
    document.getElementById('billingManagement').classList.remove('active');
    document.getElementById('mainContainer').style.display = '';
}

// ייצוא דוח גבייה ל-CSV
async function exportBillingReport() {
    var btn = document.getElementById('bmExportBtn');
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> מייצא...';

    try {
        var snapshot = await db.collection('recurring_billing').get();
        var rows = [];

        for (var doc of snapshot.docs) {
            var c = doc.data();
            var amount = parseFloat(c.recurringMonthlyAmount) || 0;
            var totalMonths = parseInt(c.recurringMonthsCount) || 0;
            var paidMonths = parseInt(c.completedPaymentsCount) || parseInt(c.paidMonthsAlready) || 0;
            var totalDeal = (c.totalPlannedAmount !== undefined && c.totalPlannedAmount !== null)
                ? parseFloat(c.totalPlannedAmount) : amount * totalMonths;
            var totalPaid = c.totalActualPaid !== undefined ? parseFloat(c.totalActualPaid) : amount * paidMonths;
            var remaining = totalDeal - totalPaid;

            // טעינת פירוט תשלומים
            var paymentsSnap = await db.collection('recurring_billing').doc(doc.id)
                .collection('payments').orderBy('monthNumber').get();

            if (paymentsSnap.empty) {
                // לקוח ללא subcollection - שורה אחת
                rows.push({
                    clientName: c.clientName || '',
                    attorney: c.attorney || '',
                    caseNumber: c.caseNumber || '',
                    phone: c.phone || '',
                    email: c.email || '',
                    monthlyAmount: amount,
                    totalMonths: totalMonths,
                    totalDeal: totalDeal,
                    paidMonths: paidMonths,
                    totalPaid: totalPaid,
                    remaining: remaining,
                    status: c.status || 'פעיל',
                    startDate: c.recurringStartDate || '',
                    monthNumber: '',
                    plannedDate: '',
                    plannedAmount: '',
                    actualPaid: '',
                    actualDate: '',
                    paymentStatus: ''
                });
            } else {
                // לקוח עם subcollection - שורה לכל תשלום
                paymentsSnap.forEach(function(pDoc) {
                    var p = pDoc.data();
                    rows.push({
                        clientName: c.clientName || '',
                        attorney: c.attorney || '',
                        caseNumber: c.caseNumber || '',
                        phone: c.phone || '',
                        email: c.email || '',
                        monthlyAmount: amount,
                        totalMonths: totalMonths,
                        totalDeal: totalDeal,
                        paidMonths: paidMonths,
                        totalPaid: totalPaid,
                        remaining: remaining,
                        status: c.status || 'פעיל',
                        startDate: c.recurringStartDate || '',
                        monthNumber: p.monthNumber || '',
                        plannedDate: p.plannedDate || '',
                        plannedAmount: p.plannedAmount || '',
                        actualPaid: p.actualAmountPaid || '',
                        actualDate: p.actualPaymentDate || '',
                        paymentStatus: p.status || ''
                    });
                });
            }
        }

        // יצירת CSV עם BOM לתמיכה בעברית באקסל
        var headers = [
            'שם לקוח', 'עו"ד מטפל', 'מספר תיק', 'טלפון', 'מייל',
            'סכום חודשי', 'סה"כ חודשים', 'סה"כ עסקה',
            'חודשים ששולמו', 'סה"כ שולם', 'יתרה',
            'סטטוס לקוח', 'תאריך התחלה',
            'מספר תשלום', 'תאריך מתוכנן', 'סכום מתוכנן',
            'סכום ששולם', 'תאריך תשלום', 'סטטוס תשלום'
        ];

        var csvContent = '\uFEFF' + headers.join(',') + '\n';
        rows.forEach(function(r) {
            var line = [
                '"' + (r.clientName || '').replace(/"/g, '""') + '"',
                '"' + (r.attorney || '').replace(/"/g, '""') + '"',
                '"' + (r.caseNumber || '').replace(/"/g, '""') + '"',
                '"' + (r.phone || '').replace(/"/g, '""') + '"',
                '"' + (r.email || '').replace(/"/g, '""') + '"',
                r.monthlyAmount,
                r.totalMonths,
                r.totalDeal,
                r.paidMonths,
                r.totalPaid,
                r.remaining,
                '"' + (r.status || '').replace(/"/g, '""') + '"',
                '"' + (r.startDate || '').replace(/"/g, '""') + '"',
                r.monthNumber,
                '"' + (r.plannedDate || '').replace(/"/g, '""') + '"',
                r.plannedAmount,
                r.actualPaid,
                '"' + (r.actualDate || '').replace(/"/g, '""') + '"',
                '"' + (r.paymentStatus || '').replace(/"/g, '""') + '"'
            ].join(',');
            csvContent += line + '\n';
        });

        // הורדת הקובץ
        var today = new Date().toISOString().split('T')[0];
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'דוח_גבייה_' + today + '.csv';
        link.click();
        URL.revokeObjectURL(link.href);

        logAuditEvent('csv_export', { type: 'billing_report', date: today });

    } catch (error) {
        console.error('Export error:', error);
        alert('שגיאה בייצוא: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ייצוא דוח';
    }
}

async function loadBillingData() {
    const loading = document.getElementById('bmLoading');
    const empty = document.getElementById('bmEmpty');
    const tableView = document.getElementById('bmTableView');
    const cardsView = document.getElementById('bmCardsView');

    loading.style.display = '';
    tableView.style.display = 'none';
    cardsView.style.display = 'none';
    empty.style.display = 'none';

    try {
        const snapshot = await db.collection('recurring_billing')
            .orderBy('createdAt', 'desc')
            .get();

        billingClients = [];
        snapshot.forEach(doc => {
            billingClients.push({ id: doc.id, ...doc.data() });
        });

        // טעינת כל הנתונים מ-subcollection לכל לקוח (query אחד בלבד - ללא index מורכב)
        var subPromises = billingClients.map(function(c) {
            return db.collection('recurring_billing').doc(c.id)
                .collection('payments').get()
                .then(function(snap) {
                    if (!snap.empty) {
                        var totalPlanned = 0;
                        var totalActual = 0;
                        var paidCount = 0;
                        var activeCount = 0;
                        var allPayments = [];
                        snap.forEach(function(d) {
                            var p = d.data();
                            allPayments.push(p);
                            if (p.status !== 'בוטל') {
                                totalPlanned += parseFloat(p.plannedAmount) || 0;
                                activeCount++;
                            }
                            if (p.status === 'בוצע') {
                                totalActual += parseFloat(p.actualAmountPaid) || parseFloat(p.plannedAmount) || 0;
                                paidCount++;
                            }
                        });

                        // מציאת התשלום הבא הממתין (מיון לפי monthNumber)
                        var pendingPayments = allPayments
                            .filter(function(p) { return p.status === 'ממתין' || p.status === 'באיחור'; })
                            .sort(function(a, b) { return (a.monthNumber || 0) - (b.monthNumber || 0); });

                        if (pendingPayments.length > 0) {
                            c.nextPaymentAmount = parseFloat(pendingPayments[0].plannedAmount) || 0;
                            c.nextPaymentDate = pendingPayments[0].plannedDate || '';
                        }

                        c._realTotalPlanned = totalPlanned;
                        c._realTotalActual = totalActual;
                        c._realPaidCount = paidCount;
                        c._realActiveCount = activeCount;
                        c._hasSubcollection = true;
                    }
                })
                .catch(function(err) { console.error('Error loading payments for', c.id, err); });
        });
        await Promise.all(subPromises);

        loading.style.display = 'none';

        if (billingClients.length === 0) {
            empty.style.display = '';
            return;
        }

        updateBillingSummary();
        renderBillingView();
    } catch (error) {
        console.error('Error loading billing data:', error);
        loading.innerHTML = '<p style="color:var(--error);">שגיאה בטעינת הנתונים</p>';
    }
}

function updateBillingSummary() {
    const active = billingClients.filter(c => c.status === 'פעיל' || !c.status);
    const totalMonthly = active.reduce((sum, c) => sum + (parseFloat(c.recurringMonthlyAmount) || 0), 0);

    let totalPaid = 0;
    let totalRemaining = 0;

    billingClients.forEach(c => {
        const amount = parseFloat(c.recurringMonthlyAmount) || 0;
        const totalMonths = parseInt(c.recurringMonthsCount) || 0;
        const totalDeal = c._hasSubcollection ? c._realTotalPlanned
            : ((c.totalPlannedAmount !== undefined && c.totalPlannedAmount !== null)
                ? parseFloat(c.totalPlannedAmount) : amount * totalMonths);
        const paid = c._hasSubcollection ? c._realTotalActual
            : ((c.totalActualPaid !== undefined && c.totalActualPaid !== null)
                ? parseFloat(c.totalActualPaid) || 0 : amount * calculatePaidMonths(c));

        totalPaid += paid;
        totalRemaining += totalDeal - paid;
    });

    document.getElementById('bmStatTotal').textContent = active.length;
    document.getElementById('bmStatMonthly').textContent = '₪' + totalMonthly.toLocaleString('he-IL');
    document.getElementById('bmStatPaid').textContent = '₪' + totalPaid.toLocaleString('he-IL');
    document.getElementById('bmStatRemaining').textContent = '₪' + Math.max(0, totalRemaining).toLocaleString('he-IL');
}

function calculatePaidMonths(client) {
    const alreadyPaid = parseInt(client.paidMonthsAlready) || 0;
    if (!client.recurringStartDate) return alreadyPaid;
    const start = new Date(client.recurringStartDate);
    const now = new Date();
    const totalMonths = parseInt(client.recurringMonthsCount) || 0;

    if (client.status === 'בוטל') return alreadyPaid;

    // diffMonths = כמה חודשים עברו מתאריך ההתחלה המקורי
    let diffMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (now.getDate() >= (parseInt(client.recurringDayOfMonth) || 1)) {
        diffMonths += 1;
    }
    diffMonths = Math.max(0, diffMonths);

    // alreadyPaid משמש כרצפה - למקרה שתאריך ההתחלה עתידי
    // אבל לא מצטבר מעל diffMonths כי הוא כבר נכלל בספירת החודשים
    return Math.min(Math.max(diffMonths, alreadyPaid), totalMonths);
}

function getNextReminderDate(client) {
    if (client.status === 'בוטל' || client.status === 'מושהה') return null;
    const start = new Date(client.recurringStartDate);
    const totalMonths = parseInt(client.recurringMonthsCount) || 0;
    const dayOfMonth = parseInt(client.recurringDayOfMonth) || 1;
    const now = new Date();

    for (let i = 0; i < totalMonths; i++) {
        const chargeDate = new Date(start.getFullYear(), start.getMonth() + i, dayOfMonth);
        if (chargeDate > now) {
            return chargeDate;
        }
    }
    return null;
}

function formatDate(date) {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getStatusBadge(status) {
    const s = status || 'פעיל';
    const map = { 'פעיל': 'active', 'מושהה': 'paused', 'בוטל': 'cancelled' };
    const cls = map[s] || 'active';
    return '<span class="bm-badge ' + cls + '">' + s + '</span>';
}

function setBillingFilter(filter, btn) {
    billingFilter = filter;
    document.querySelectorAll('.bm-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderBillingView();
}

function setBillingViewMode(mode) {
    billingViewMode = mode;
    document.getElementById('bmViewTable').classList.toggle('active', mode === 'table');
    document.getElementById('bmViewCards').classList.toggle('active', mode === 'cards');
    document.getElementById('bmTableView').style.display = mode === 'table' ? '' : 'none';
    document.getElementById('bmCardsView').style.display = mode === 'cards' ? '' : 'none';
}

function filterBillingView() {
    renderBillingView();
}

function getFilteredClients() {
    let filtered = billingClients;

    if (billingFilter !== 'all') {
        filtered = filtered.filter(c => (c.status || 'פעיל') === billingFilter);
    }

    const search = (document.getElementById('bmSearch').value || '').trim().toLowerCase();
    if (search) {
        filtered = filtered.filter(c =>
            (c.clientName || '').toLowerCase().includes(search) ||
            (c.attorney || '').toLowerCase().includes(search) ||
            (c.caseNumber || '').toLowerCase().includes(search) ||
            (c.phone || '').includes(search)
        );
    }

    return filtered;
}

function renderBillingView() {
    const filtered = getFilteredClients();
    const tableView = document.getElementById('bmTableView');
    const cardsView = document.getElementById('bmCardsView');
    const empty = document.getElementById('bmEmpty');

    if (filtered.length === 0) {
        tableView.style.display = 'none';
        cardsView.style.display = 'none';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';
    tableView.style.display = billingViewMode === 'table' ? '' : 'none';
    cardsView.style.display = billingViewMode === 'cards' ? '' : 'none';

    if (billingViewMode === 'table') renderTableView(filtered);
    else renderCardsView(filtered);
}

function renderTableView(clients) {
    const tbody = document.getElementById('bmTableBody');
    tbody.innerHTML = clients.map(c => {
        const amount = parseFloat(c.recurringMonthlyAmount) || 0;
        const totalMonths = c._hasSubcollection ? c._realActiveCount : (parseInt(c.recurringMonthsCount) || 0);
        const totalDeal = c._hasSubcollection ? c._realTotalPlanned
            : ((c.totalPlannedAmount !== undefined && c.totalPlannedAmount !== null)
                ? parseFloat(c.totalPlannedAmount) : amount * totalMonths);
        const paidMonths = c._hasSubcollection ? c._realPaidCount
            : ((c.completedPaymentsCount !== undefined && c.completedPaymentsCount !== null)
                ? parseInt(c.completedPaymentsCount) : calculatePaidMonths(c));
        const paidAmount = c._hasSubcollection ? c._realTotalActual
            : ((c.totalActualPaid !== undefined && c.totalActualPaid !== null)
                ? parseFloat(c.totalActualPaid) : amount * paidMonths);
        const progressPct = totalMonths > 0 ? Math.round((paidMonths / totalMonths) * 100) : 0;
        const progressClass = progressPct >= 80 ? ' high' : '';
        const nextDate = getNextReminderDate(c);
        const paidColor = paidAmount > 0 ? '#16a34a' : '#94a3b8';
        const uid = 'menu-' + c.id.replace(/[^a-zA-Z0-9]/g, '');

        // חיוב הבא: מ-subcollection, אם הכל בוצע - "הושלם", אם אין subcollection - חישוב מ-parent
        var nextPayDisplay;
        if (c.nextPaymentAmount !== undefined && c.nextPaymentAmount !== null) {
            nextPayDisplay = '₪' + c.nextPaymentAmount.toLocaleString('he-IL');
        } else if (c._hasSubcollection) {
            nextPayDisplay = '<span style="color:#16a34a;font-size:11px;">\u2713 הושלם</span>';
        } else {
            nextPayDisplay = '₪' + amount.toLocaleString('he-IL');
        }

        return '<tr>' +
            '<td><strong style="color:#0f172a;">' + escapeHTML(c.clientName || '') + '</strong>' +
                (c.caseNumber ? '<br><span style="font-size:11px;color:#94a3b8;">תיק ' + escapeHTML(c.caseNumber) + '</span>' : '') +
            '</td>' +
            '<td style="color:#64748b;">' + escapeHTML(c.attorney || '—') + '</td>' +
            '<td class="bm-amount">' + nextPayDisplay + '</td>' +
            '<td class="bm-amount" style="color:#0f172a;">₪' + totalDeal.toLocaleString('he-IL') + '</td>' +
            '<td class="bm-amount" style="color:' + paidColor + ';">₪' + paidAmount.toLocaleString('he-IL') + '</td>' +
            '<td style="min-width:100px;">' +
                '<span class="bm-progress-text">' + paidMonths + '/' + totalMonths + '</span>' +
                '<div class="bm-progress-bar"><div class="bm-progress-fill' + progressClass + '" style="width:' + progressPct + '%"></div></div>' +
            '</td>' +
            '<td>' + getStatusBadge(c.status) + '</td>' +
            '<td style="font-size:12px;">' + formatDate(nextDate) + '</td>' +
            '<td style="white-space:nowrap;">' +
                '<div style="display:flex;gap:6px;align-items:center;">' +
                    '<button class="bm-action-primary" onclick="openPaymentModal(\'' + c.id + '\')">תשלומים</button>' +
                    ((c.status || 'פעיל') === 'פעיל'
                        ? '<button class="bm-action-primary" onclick="quickMarkPayment(\'' + c.id + '\')" style="background:#16a34a;">סמן תשלום</button>'
                        : '') +
                    '<div class="bm-actions-dropdown">' +
                        '<button class="bm-actions-toggle" onclick="toggleActionsMenu(\'' + uid + '\', event)">\u22EE</button>' +
                        '<div class="bm-actions-menu" id="' + uid + '">' +
                            '<button onclick="openEditModal(\'' + c.id + '\');closeAllMenus()">עריכה</button>' +
                            '<a href="https://merchant.sensepass.com/apps/transactions/list" target="_blank" onclick="closeAllMenus()">סליקת אשראי</a>' +
                            (c.cardLast4 ? '<button onclick="revealCard(\'' + c.id + '\');closeAllMenus()">הצג כרטיס</button>' : '') +
                            (c.cardEncrypted ? '<button onclick="revealAndCopy(\'' + c.id + '\');closeAllMenus()">העתק כרטיס</button>' : '') +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function toggleActionsMenu(menuId, event) {
    event.stopPropagation();
    var menu = document.getElementById(menuId);
    var isOpen = menu.classList.contains('show');
    closeAllMenus();
    if (!isOpen) menu.classList.add('show');
}
function closeAllMenus() {
    document.querySelectorAll('.bm-actions-menu.show').forEach(function(m) {
        m.classList.remove('show');
    });
}
document.addEventListener('click', function() { closeAllMenus(); });

function renderCardsView(clients) {
    const container = document.getElementById('bmCardsContainer');
    container.innerHTML = clients.map(c => {
        const amount = parseFloat(c.recurringMonthlyAmount) || 0;
        const totalMonths = c._hasSubcollection ? c._realActiveCount : (parseInt(c.recurringMonthsCount) || 0);
        const totalDeal = c._hasSubcollection ? c._realTotalPlanned
            : ((c.totalPlannedAmount !== undefined && c.totalPlannedAmount !== null)
                ? parseFloat(c.totalPlannedAmount) : amount * totalMonths);
        const paidMonths = c._hasSubcollection ? c._realPaidCount
            : ((c.completedPaymentsCount !== undefined && c.completedPaymentsCount !== null)
                ? parseInt(c.completedPaymentsCount) : calculatePaidMonths(c));
        const paidAmount = c._hasSubcollection ? c._realTotalActual
            : ((c.totalActualPaid !== undefined && c.totalActualPaid !== null)
                ? parseFloat(c.totalActualPaid) : amount * paidMonths);
        const remainingAmount = Math.max(0, totalDeal - paidAmount);
        const progressPct = totalMonths > 0 ? Math.round((paidMonths / totalMonths) * 100) : 0;
        const nextDate = getNextReminderDate(c);
        const progressClass = progressPct >= 80 ? ' high' : '';
        const paidColor = paidAmount > 0 ? '#16a34a' : '#94a3b8';
        const remainColor = remainingAmount > 0 ? '#dc2626' : '#16a34a';

        // חיוב הבא: מ-subcollection, אם הכל בוצע - "הושלם"
        var nextPayDisplay;
        if (c.nextPaymentAmount !== undefined && c.nextPaymentAmount !== null) {
            nextPayDisplay = '₪' + c.nextPaymentAmount.toLocaleString('he-IL');
        } else if (c._hasSubcollection) {
            nextPayDisplay = '<span style="color:#16a34a;font-size:11px;">\u2713 הושלם</span>';
        } else {
            nextPayDisplay = '₪' + amount.toLocaleString('he-IL');
        }

        return '<div class="bm-card">' +
            '<div class="bm-card-top">' +
                '<div>' +
                    '<div class="bm-card-name">' + escapeHTML(c.clientName || '') + '</div>' +
                    '<div class="bm-card-case">' + (c.caseNumber ? 'תיק ' + escapeHTML(c.caseNumber) : '') + (c.attorney ? ' | ' + escapeHTML(c.attorney) : '') + '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:6px;">' +
                    getStatusBadge(c.status) +
                    '<button class="bm-action-secondary" onclick="openEditModal(\'' + c.id + '\')" style="padding:3px 8px;">עריכה</button>' +
                '</div>' +
            '</div>' +
            '<div class="bm-card-body">' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">חיוב הבא <span style="font-size:9px;color:#94a3b8;">(כולל מע"מ)</span></div>' +
                    '<div class="bm-card-field-value">' + nextPayDisplay + '</div>' +
                '</div>' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">סה"כ עסקה</div>' +
                    '<div class="bm-card-field-value">₪' + totalDeal.toLocaleString('he-IL') + '</div>' +
                '</div>' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">שולם</div>' +
                    '<div class="bm-card-field-value" style="color:' + paidColor + ';">₪' + paidAmount.toLocaleString('he-IL') + '</div>' +
                '</div>' +
                '<div class="bm-card-field">' +
                    '<div class="bm-card-field-label">נותר</div>' +
                    '<div class="bm-card-field-value" style="color:' + remainColor + ';">₪' + remainingAmount.toLocaleString('he-IL') + '</div>' +
                '</div>' +
            '</div>' +
            (c.cardLast4 ?
                '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid #f1f5f9;margin-bottom:6px;">' +
                    '<span style="font-size:12px;color:#64748b;font-variant-numeric:tabular-nums;">\u2022\u2022\u2022\u2022 ' + escapeHTML(c.cardLast4) +
                        (c.cardType ? ' <span style="color:#94a3b8;">(' + escapeHTML(c.cardType) + ')</span>' : '') +
                        (c.cardExpiry ? ' <span style="color:#94a3b8;">' + escapeHTML(c.cardExpiry) + '</span>' : '') +
                    '</span>' +
                    '<button class="bm-action-secondary" onclick="revealCard(\'' + c.id + '\')" style="padding:3px 10px;">הצג מספר</button>' +
                '</div>' : '') +
            '<div class="bm-card-progress">' +
                '<div class="bm-card-progress-text">' +
                    '<span>' + paidMonths + ' מתוך ' + totalMonths + ' תשלומים</span>' +
                    '<span>' + progressPct + '%</span>' +
                '</div>' +
                '<div class="bm-card-progress-bar"><div class="bm-card-progress-fill' + progressClass + '" style="width:' + progressPct + '%"></div></div>' +
            '</div>' +
            (nextDate ? '<div style="margin-top:10px;font-size:11px;color:#94a3b8;">חיוב הבא: ' + formatDate(nextDate) + '</div>' : '') +
            '<div style="display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #f1f5f9;">' +
                '<button class="bm-action-primary" onclick="openPaymentModal(\'' + c.id + '\')" style="flex:1;text-align:center;padding:10px;">תשלומים</button>' +
                ((c.status || 'פעיל') === 'פעיל'
                    ? '<button class="bm-action-primary" onclick="quickMarkPayment(\'' + c.id + '\')" style="flex:1;text-align:center;padding:10px;background:#16a34a;">סמן תשלום</button>'
                    : '') +
            '</div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
                '<a class="bm-action-secondary" href="https://merchant.sensepass.com/apps/transactions/list" target="_blank" style="flex:1;justify-content:center;padding:7px;">סליקת אשראי</a>' +
                (c.cardEncrypted ? '<button class="bm-action-secondary" onclick="revealAndCopy(\'' + c.id + '\')" style="flex:1;justify-content:center;padding:7px;">העתק כרטיס</button>' : '') +
            '</div>' +
        '</div>';
    }).join('');
}

// ========== חשיפת מספר כרטיס מוצפן ==========

async function revealCard(docId) {
    const passphrase = await requestPassword('decrypt');
    if (!passphrase) return;

    try {
        const doc = await db.collection('recurring_billing').doc(docId).get();
        if (!doc.exists) {
            alert('הרשומה לא נמצאה');
            return;
        }

        const data = doc.data();
        if (!data.cardEncrypted) {
            alert('אין מספר כרטיס מוצפן לרשומה זו');
            return;
        }

        const decrypted = decryptCardData(data.cardEncrypted, passphrase);
        if (!decrypted) {
            logAuditEvent('decrypt_failed', { docId: docId, clientName: data.clientName || '' });
            alert('סיסמה שגויה');
            return;
        }

        // רישום לוג צפייה
        logCardView(docId, data.clientName);

        // הצגת המספר בחלון מעוצב שנסגר אוטומטית
        var formatted = decrypted.replace(/(\d{4})(?=\d)/g, '$1 ');
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="background:white;border-radius:16px;padding:28px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="margin-bottom:16px;">' +
                    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>' +
                '</div>' +
                '<div style="font-size:13px;color:#6b7280;margin-bottom:8px;">' + escapeHTML(data.cardHolder || data.clientName || '') + '</div>' +
                '<div style="font-size:22px;font-weight:700;letter-spacing:3px;direction:ltr;font-variant-numeric:tabular-nums;color:#1f2937;margin-bottom:6px;">' + formatted + '</div>' +
                '<div style="display:flex;justify-content:center;gap:20px;margin-top:10px;">' +
                    (data.cardExpiry ? '<div><div style="font-size:11px;color:#9ca3af;">תוקף</div><div style="font-size:15px;font-weight:600;color:#374151;direction:ltr;">' + escapeHTML(data.cardExpiry) + '</div></div>' : '') +
                '</div>' +
                (data.cardType ? '<div style="font-size:12px;color:#9ca3af;margin-top:8px;">' + escapeHTML(data.cardType) + '</div>' : '') +
                '<div style="font-size:11px;color:#ef4444;margin-top:14px;">החלון ייסגר אוטומטית בעוד 30 שניות</div>' +
                '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="margin-top:14px;background:#2563eb;color:white;border:none;padding:8px 28px;border-radius:8px;font-family:Heebo,sans-serif;font-size:14px;font-weight:600;cursor:pointer;">סגור</button>' +
            '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        // סגירה אוטומטית אחרי 30 שניות
        setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 30000);

    } catch (error) {
        console.error('Error revealing card:', error);
        alert('שגיאה בטעינת הנתונים');
    }
}

// ========== העתקת פרטי כרטיס ==========

async function revealAndCopy(docId) {
    const passphrase = await requestPassword('decrypt');
    if (!passphrase) return;

    try {
        const doc = await db.collection('recurring_billing').doc(docId).get();
        if (!doc.exists) { alert('הרשומה לא נמצאה'); return; }

        const data = doc.data();
        if (!data.cardEncrypted) { alert('אין פרטי כרטיס לרשומה זו'); return; }

        const decrypted = decryptCardData(data.cardEncrypted, passphrase);
        if (!decrypted) {
            logAuditEvent('decrypt_failed', { docId: docId, clientName: data.clientName || '' });
            alert('סיסמה שגויה');
            return;
        }

        logAuditEvent('card_copy', { docId: docId, clientName: data.clientName || '' });

        var formatted = decrypted.replace(/(\d{4})(?=\d)/g, '$1 ');

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML =
            '<div style="background:white;border-radius:16px;padding:28px;max-width:400px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="text-align:center;margin-bottom:18px;">' +
                    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>' +
                    '<div style="font-size:15px;font-weight:700;color:#1f2937;margin-top:8px;">' + escapeHTML(data.clientName || '') + '</div>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;gap:8px;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;">' +
                        '<div><div style="font-size:10px;color:#9ca3af;">מספר כרטיס</div><div style="font-size:16px;font-weight:600;direction:ltr;font-variant-numeric:tabular-nums;color:#1f2937;">' + formatted + '</div></div>' +
                        '<button onclick="copyToClipboard(\'' + decrypted + '\', this)" style="background:#2563eb;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-family:Heebo,sans-serif;font-weight:600;cursor:pointer;white-space:nowrap;">העתק</button>' +
                    '</div>' +
                    (data.cardExpiry ? '<div style="display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;">' +
                        '<div><div style="font-size:10px;color:#9ca3af;">תוקף</div><div style="font-size:15px;font-weight:600;direction:ltr;color:#1f2937;">' + data.cardExpiry + '</div></div>' +
                        '<button onclick="copyToClipboard(\'' + data.cardExpiry + '\', this)" style="background:#2563eb;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-family:Heebo,sans-serif;font-weight:600;cursor:pointer;">העתק</button>' +
                    '</div>' : '') +
                    (data.cardHolder ? '<div style="display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;">' +
                        '<div><div style="font-size:10px;color:#9ca3af;">שם בעל הכרטיס</div><div style="font-size:14px;font-weight:600;color:#1f2937;">' + data.cardHolder + '</div></div>' +
                        '<button onclick="copyToClipboard(\'' + (data.cardHolder || '').replace(/'/g, "\\'") + '\', this)" style="background:#2563eb;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-family:Heebo,sans-serif;font-weight:600;cursor:pointer;">העתק</button>' +
                    '</div>' : '') +
                '</div>' +
                '<div style="text-align:center;margin-top:16px;">' +
                    '<div style="font-size:11px;color:#ef4444;margin-bottom:10px;">החלון ייסגר אוטומטית בעוד 30 שניות</div>' +
                    '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:#2563eb;color:white;border:none;padding:8px 28px;border-radius:8px;font-family:Heebo,sans-serif;font-size:14px;font-weight:600;cursor:pointer;">סגור</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 30000);

    } catch (error) {
        console.error('Error:', error);
        alert('שגיאה בטעינת הנתונים');
    }
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(function() {
        var original = btn.textContent;
        btn.textContent = 'הועתק!';
        btn.style.background = '#10b981';
        setTimeout(function() {
            btn.textContent = original;
            btn.style.background = '#2563eb';
        }, 1500);
    }).catch(function() {
        // fallback
        var input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        var original = btn.textContent;
        btn.textContent = 'הועתק!';
        btn.style.background = '#10b981';
        setTimeout(function() {
            btn.textContent = original;
            btn.style.background = '#2563eb';
        }, 1500);
    });
}

// ========== עריכת לקוח גבייה ==========

let editingDocId = null;

async function openEditModal(docId) {
    editingDocId = docId;
    editPaymentsCache = []; // איפוס cache
    try {
        const doc = await db.collection('recurring_billing').doc(docId).get();
        if (!doc.exists) {
            alert('הרשומה לא נמצאה');
            return;
        }
        const d = doc.data();

        document.getElementById('editDocId').value = docId;
        document.getElementById('editClientName').value = d.clientName || '';
        document.getElementById('editPhone').value = d.phone || '';
        document.getElementById('editEmail').value = d.email || '';
        document.getElementById('editIdNumber').value = d.idNumber || '';
        document.getElementById('editAddress').value = d.address || '';
        // טעינת סכום כולל אמיתי מ-subcollection (מקור אמת יחיד)
        var realTotalPlanned = 0;
        var realActiveCount = 0;
        var subSnap = await db.collection('recurring_billing').doc(docId)
            .collection('payments').get();
        if (!subSnap.empty) {
            subSnap.forEach(function(sd) {
                var sp = sd.data();
                if (sp.status !== 'בוטל') {
                    realTotalPlanned += parseFloat(sp.plannedAmount) || 0;
                    realActiveCount++;
                }
            });
        }

        var editTotalDeal = realTotalPlanned > 0 ? realTotalPlanned
            : (d.totalPlannedAmount || (parseFloat(d.recurringMonthlyAmount || 0) * parseInt(d.recurringMonthsCount || 1)));
        document.getElementById('editTotalDeal').value = editTotalDeal || '';
        var editMonthsNum = realActiveCount > 0 ? realActiveCount : (parseInt(d.recurringMonthsCount) || 1);
        document.getElementById('editMonths').value = editMonthsNum;
        document.getElementById('editAmount').value = editTotalDeal ? Math.round(editTotalDeal / editMonthsNum) : (d.recurringMonthlyAmount || '');
        document.getElementById('editStartDate').value = d.recurringStartDate || '';
        document.getElementById('editDayOfMonth').value = d.recurringDayOfMonth || '1';
        document.getElementById('editPaidMonths').value = d.paidMonthsAlready || '0';
        document.getElementById('editStatus').value = d.status || 'פעיל';
        document.getElementById('editAttorney').value = d.attorney || '';
        document.getElementById('editCaseNumber').value = d.caseNumber || '';
        document.getElementById('editNotes').value = d.recurringNotes || '';

        // Card fields
        document.getElementById('editCardNumber').value = '';
        document.getElementById('editCardExpiry').value = d.cardExpiry || '';
        document.getElementById('editCardHolder').value = d.cardHolder || '';
        document.getElementById('editCardType').value = d.cardType || '';
        document.getElementById('editCardStatus').textContent = d.cardLast4
            ? 'כרטיס קיים: \u2022\u2022\u2022\u2022 ' + escapeHTML(d.cardLast4) + (d.cardType ? ' (' + escapeHTML(d.cardType) + ')' : '')
            : 'לא הוזן כרטיס';

        // טעינת תשלומים מ-subcollection להצגה בטבלת עריכה
        await loadEditAmountsTable(docId, d);

        document.getElementById('editModalOverlay').classList.add('show');
    } catch (error) {
        console.error('Error loading client:', error);
        alert('שגיאה בטעינת הנתונים');
    }
}

function closeEditModal() {
    document.getElementById('editModalOverlay').classList.remove('show');
    editingDocId = null;
}

async function saveEditBilling() {
    const docId = document.getElementById('editDocId').value;
    const clientName = document.getElementById('editClientName').value.trim();
    const editTotalDeal = document.getElementById('editTotalDeal').value;
    const amount = document.getElementById('editAmount').value;
    const months = document.getElementById('editMonths').value;

    if (!clientName || !editTotalDeal || !months) {
        alert('נא למלא שם לקוח, סכום כולל ומספר תשלומים');
        return;
    }

    const saveBtn = document.getElementById('editSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'שומר...';

    try {
        const editTotalDealNum = parseFloat(editTotalDeal);
        const editMonthsNum = parseInt(months);
        const editPerPayment = amount ? parseFloat(amount) : Math.round(editTotalDealNum / editMonthsNum);

        const updateData = {
            clientName: clientName,
            phone: document.getElementById('editPhone').value || '',
            email: document.getElementById('editEmail').value || '',
            idNumber: document.getElementById('editIdNumber').value || '',
            address: document.getElementById('editAddress').value || '',
            totalPlannedAmount: editTotalDealNum,
            recurringMonthlyAmount: editPerPayment,
            recurringMonthsCount: months,
            recurringStartDate: document.getElementById('editStartDate').value || '',
            recurringDayOfMonth: document.getElementById('editDayOfMonth').value || '1',
            paidMonthsAlready: parseInt(document.getElementById('editPaidMonths').value) || 0,
            status: document.getElementById('editStatus').value || 'פעיל',
            attorney: document.getElementById('editAttorney').value || '',
            caseNumber: document.getElementById('editCaseNumber').value || '',
            recurringNotes: document.getElementById('editNotes').value || '',
            cardExpiry: document.getElementById('editCardExpiry').value || '',
            cardHolder: document.getElementById('editCardHolder').value || '',
            cardType: document.getElementById('editCardType').value || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: authUser ? authUser.email : (currentUser || 'לא ידוע')
        };

        // הצפנת כרטיס חדש אם הוזן
        const newCardNumber = (document.getElementById('editCardNumber').value || '').replace(/\s/g, '');
        if (newCardNumber && newCardNumber.length >= 13) {
            if (!validateCardNumber(newCardNumber)) {
                alert('מספר כרטיס אשראי לא תקין');
                saveBtn.disabled = false;
                saveBtn.textContent = 'שמור שינויים';
                return;
            }
            var editExpiry = document.getElementById('editCardExpiry').value || '';
            if (editExpiry && !validateCardExpiry(editExpiry)) {
                alert('תוקף כרטיס לא תקין או שפג תוקפו');
                saveBtn.disabled = false;
                saveBtn.textContent = 'שמור שינויים';
                return;
            }
            const passphrase = await requestPassword('encrypt');
            if (!passphrase) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'שמור שינויים';
                return;
            }
            updateData.cardEncrypted = encryptCardData(newCardNumber, passphrase);
            updateData.cardLast4 = newCardNumber.slice(-4);
        }

        // קריאת נתוני הלקוח הישנים לפני העדכון (לצורך השוואה בסנכרון)
        const oldClientDoc = await db.collection('recurring_billing').doc(docId).get();
        const oldClientData = oldClientDoc.data();

        await db.collection('recurring_billing').doc(docId).update(updateData);

        // עדכון סכומים ישירות ב-subcollection (מקור אמת יחיד)
        var editedAmounts = getEditMonthlyAmountsFromTable();
        if (editedAmounts) {
            var batch = db.batch();
            Object.keys(editedAmounts).forEach(function(payId) {
                var ref = db.collection('recurring_billing').doc(docId)
                    .collection('payments').doc(payId);
                batch.update(ref, { plannedAmount: editedAmounts[payId] });
            });
            await batch.commit();
        }

        // סנכרון שאר שינויים (תאריכים, מספר תשלומים וכו')
        await syncPaymentsAfterEdit(docId, oldClientData, updateData);

        // חישוב מחדש של כל הסיכומים מ-subcollection
        await recalcClientSummary(docId);

        closeEditModal();
        loadBillingData(); // רענון התצוגה
    } catch (error) {
        console.error('Error saving edit:', error);
        alert('שגיאה בשמירה: ' + error.message);
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'שמור שינויים';
}

// סנכרון subcollection payments אחרי עריכה - מטפל בכל השדות
async function syncPaymentsAfterEdit(docId, oldData, newData) {
    try {
        var paymentsSnap = await db.collection('recurring_billing').doc(docId)
            .collection('payments').orderBy('monthNumber').get();

        // אם אין subcollection - אין מה לסנכרן, יווצר בפתיחת מודאל
        if (paymentsSnap.empty) return;

        var oldAmount = parseFloat(oldData.recurringMonthlyAmount) || 0;
        var newAmount = parseFloat(newData.recurringMonthlyAmount) || 0;
        var newMonths = parseInt(newData.recurringMonthsCount) || 0;
        var oldStartDate = oldData.recurringStartDate || '';
        var newStartDate = newData.recurringStartDate || oldStartDate;
        var oldDayOfMonth = parseInt(oldData.recurringDayOfMonth) || 1;
        var newDayOfMonth = parseInt(newData.recurringDayOfMonth) || oldDayOfMonth;
        var newPaidAlready = parseInt(newData.paidMonthsAlready) || 0;
        var oldPaid = parseInt(oldData.paidMonthsAlready) || 0;
        var billingPrefix = oldData.billingIdPrefix || '';

        // בדיקה אם תאריכים השתנו (תאריך התחלה או יום בחודש)
        var datesChanged = (newStartDate !== oldStartDate) || (newDayOfMonth !== oldDayOfMonth);

        var existingPayments = [];
        paymentsSnap.forEach(function(doc) {
            existingPayments.push({ id: doc.id, data: doc.data() });
        });

        var batch = db.batch();
        var hasChanges = false;
        var start = newStartDate ? new Date(newStartDate) : new Date();

        // 1. עדכון תאריכים לתשלומים שלא בוצעו (אם שונה תאריך התחלה או יום בחודש)
        if (datesChanged) {
            existingPayments.forEach(function(p) {
                if (p.data.status !== 'בוצע' && p.data.status !== 'בוטל') {
                    var monthIdx = p.data.monthNumber - 1;
                    var newChargeDate = safeChargeDate(start.getFullYear(), start.getMonth() + monthIdx, newDayOfMonth);
                    var newDateStr = newChargeDate.toISOString().split('T')[0];
                    if (newDateStr !== p.data.plannedDate) {
                        var ref = db.collection('recurring_billing').doc(docId)
                            .collection('payments').doc(p.id);
                        batch.update(ref, { plannedDate: newDateStr });
                        hasChanges = true;
                    }
                }
            });
        }

        // 2. עדכון סכום מתוכנן לתשלומים שלא בוצעו
        if (oldAmount !== newAmount) {
            existingPayments.forEach(function(p) {
                if (p.data.status !== 'בוצע' && p.data.status !== 'בוטל') {
                    var pAmount = parseFloat(p.data.plannedAmount) || 0;
                    if (pAmount === oldAmount) {
                        var ref = db.collection('recurring_billing').doc(docId)
                            .collection('payments').doc(p.id);
                        batch.update(ref, { plannedAmount: newAmount });
                        hasChanges = true;
                    }
                }
            });
        }

        // 3. עדכון סטטוס paidMonthsAlready
        if (newPaidAlready !== oldPaid) {
            existingPayments.forEach(function(p) {
                var monthNum = p.data.monthNumber;
                var ref = db.collection('recurring_billing').doc(docId)
                    .collection('payments').doc(p.id);
                if (monthNum <= newPaidAlready && p.data.status !== 'בוצע') {
                    batch.update(ref, {
                        status: 'בוצע',
                        actualAmountPaid: parseFloat(p.data.plannedAmount) || newAmount,
                        actualPaymentDate: p.data.plannedDate,
                        completedBy: 'עריכה ידנית',
                        completedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    hasChanges = true;
                } else if (monthNum > newPaidAlready && p.data.status === 'בוצע' && (p.data.completedBy === 'מיגרציה' || p.data.completedBy === 'עריכה ידנית')) {
                    batch.update(ref, {
                        status: 'ממתין',
                        actualAmountPaid: null,
                        actualPaymentDate: null,
                        completedBy: null,
                        completedAt: null
                    });
                    hasChanges = true;
                }
            });
        }

        // 4. הפחתת חודשים - ביטול תשלומים עודפים
        if (newMonths < existingPayments.length) {
            existingPayments.forEach(function(p) {
                if (p.data.monthNumber > newMonths && p.data.status !== 'בוצע') {
                    var ref = db.collection('recurring_billing').doc(docId)
                        .collection('payments').doc(p.id);
                    batch.update(ref, {
                        status: 'בוטל',
                        notes: 'בוטל - הופחת מספר תשלומים'
                    });
                    hasChanges = true;
                }
            });
        }

        // 5. הוספת חודשים חדשים אם מספר החודשים גדל
        if (newMonths > existingPayments.length) {
            for (var i = existingPayments.length; i < newMonths; i++) {
                var chargeDate = safeChargeDate(start.getFullYear(), start.getMonth() + i, newDayOfMonth);
                var payRef = db.collection('recurring_billing').doc(docId)
                    .collection('payments').doc();
                batch.set(payRef, {
                    monthNumber: i + 1,
                    plannedAmount: newAmount,
                    plannedDate: chargeDate.toISOString().split('T')[0],
                    billingIdSuffix: billingPrefix ? billingPrefix + '-' + (i + 1) : '',
                    status: i < newPaidAlready ? 'בוצע' : 'ממתין',
                    actualAmountPaid: i < newPaidAlready ? newAmount : null,
                    actualPaymentDate: i < newPaidAlready ? chargeDate.toISOString().split('T')[0] : null,
                    completedBy: i < newPaidAlready ? 'עריכה ידנית' : null,
                    completedAt: i < newPaidAlready ? firebase.firestore.FieldValue.serverTimestamp() : null,
                    notes: ''
                });
                hasChanges = true;
            }
        }

        // 6. שחזור תשלומים שבוטלו אם מספר החודשים חזר לגדול
        if (newMonths >= existingPayments.length) {
            existingPayments.forEach(function(p) {
                if (p.data.status === 'בוטל' && p.data.monthNumber <= newMonths && (p.data.notes || '').indexOf('הופחת מספר תשלומים') > -1) {
                    var ref = db.collection('recurring_billing').doc(docId)
                        .collection('payments').doc(p.id);
                    batch.update(ref, {
                        status: p.data.monthNumber <= newPaidAlready ? 'בוצע' : 'ממתין',
                        notes: ''
                    });
                    hasChanges = true;
                }
            });
        }

        if (hasChanges) {
            await batch.commit();

            // עדכון שדות סיכום בלקוח
            await recalcClientSummary(docId);
        }
    } catch (error) {
        console.error('Error syncing payments after edit:', error);
    }
}
