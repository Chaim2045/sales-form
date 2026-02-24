// ========== מודאל פירוט תשלומים ==========

function roundMoney(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }

function safeChargeDate(year, month, dayOfMonth) {
    var lastDay = new Date(year, month + 1, 0).getDate();
    var day = Math.min(dayOfMonth, lastDay);
    return new Date(year, month, day);
}

function showInputModal(title, defaultValue, type, validate) {
    return new Promise(function(resolve) {
        var overlay = document.getElementById('inputModalOverlay');
        var input = document.getElementById('inputModalInput');
        var errorEl = document.getElementById('inputModalError');
        var titleEl = document.getElementById('inputModalTitle');
        var descEl = document.getElementById('inputModalDesc');

        titleEl.textContent = title;
        descEl.textContent = '';
        errorEl.textContent = '';
        input.value = defaultValue || '';
        input.type = type === 'date' ? 'date' : (type === 'number' ? 'number' : 'text');
        if (type === 'number') { input.min = '0'; input.step = '0.01'; }
        else { input.removeAttribute('min'); input.removeAttribute('step'); }

        overlay.classList.add('show');
        setTimeout(function() { input.focus(); input.select(); }, 100);

        function cleanup() {
            overlay.classList.remove('show');
            document.getElementById('inputModalConfirm').removeEventListener('click', onConfirm);
            document.getElementById('inputModalCancel').removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeydown);
        }

        function onConfirm() {
            var val = input.value;
            if (!val && val !== '0') { errorEl.textContent = 'נא להזין ערך'; return; }
            if (type === 'number') {
                val = parseFloat(val);
                if (isNaN(val)) { errorEl.textContent = 'נא להזין מספר תקין'; return; }
            }
            if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                errorEl.textContent = 'נא להזין תאריך תקין'; return;
            }
            if (validate && !validate(val)) { errorEl.textContent = 'ערך לא תקין'; return; }
            cleanup();
            resolve(type === 'number' ? val : input.value);
        }

        function onCancel() { cleanup(); resolve(null); }
        function onKeydown(e) {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
        }

        document.getElementById('inputModalConfirm').addEventListener('click', onConfirm);
        document.getElementById('inputModalCancel').addEventListener('click', onCancel);
        input.addEventListener('keydown', onKeydown);
    });
}

let currentPaymentDocId = null;
let currentPayments = [];

async function openPaymentModal(docId) {
    currentPaymentDocId = docId;
    if (typeof closeNotificationPanel === 'function') closeNotificationPanel();
    const overlay = document.getElementById('pmOverlay');

    try {
        const clientDoc = await db.collection('recurring_billing').doc(docId).get();
        if (!clientDoc.exists) {
            alert('הלקוח לא נמצא');
            return;
        }
        const client = { id: docId, ...clientDoc.data() };
        document.getElementById('pmTitle').textContent = 'תשלומים - ' + (client.clientName || '');

        // טעינת תשלומים מ-Firebase subcollection
        const paymentsSnap = await db.collection('recurring_billing').doc(docId)
            .collection('payments').orderBy('monthNumber', 'asc').get();

        if (paymentsSnap.empty) {
            // מיגרציה חד-פעמית: יצירת מסמכי תשלומים מנתוני הלקוח
            await generatePaymentDocs(docId, client);
            const snap2 = await db.collection('recurring_billing').doc(docId)
                .collection('payments').orderBy('monthNumber', 'asc').get();
            currentPayments = [];
            snap2.forEach(function(d) { currentPayments.push({ id: d.id, ...d.data() }); });
        } else {
            currentPayments = [];
            paymentsSnap.forEach(function(d) { currentPayments.push({ id: d.id, ...d.data() }); });
        }

        // Auto-update overdue status in DB
        var overdueIds = [];
        var today = new Date(); today.setHours(0,0,0,0);
        currentPayments.forEach(function(p) {
            if (p.status === 'ממתין' && p.plannedDate) {
                var pDate = new Date(p.plannedDate + 'T00:00:00');
                if (pDate < today) overdueIds.push(p.id);
            }
        });
        if (overdueIds.length > 0) {
            var overdueBatch = db.batch();
            overdueIds.forEach(function(id) {
                overdueBatch.update(
                    db.collection('recurring_billing').doc(docId).collection('payments').doc(id),
                    { status: 'באיחור' }
                );
            });
            await overdueBatch.commit();
            // Refresh payments after update
            currentPayments.forEach(function(p) {
                if (overdueIds.indexOf(p.id) !== -1) p.status = 'באיחור';
            });
        }

        renderPaymentModal(client, currentPayments);
        overlay.classList.add('show');

    } catch (error) {
        console.error('Error opening payment modal:', error);
        alert('שגיאה בטעינת תשלומים: ' + error.message);
    }
}



async function generatePaymentDocs(docId, client) {
    const amount = roundMoney(client.recurringMonthlyAmount);
    const totalMonths = parseInt(client.recurringMonthsCount) || 0;
    const startStr = client.recurringStartDate;
    if (!startStr || !totalMonths) return;

    const start = new Date(startStr);
    const dayOfMonth = parseInt(client.recurringDayOfMonth) || 1;
    const paidAlready = parseInt(client.paidMonthsAlready) || 0;
    const billingPrefix = client.billingIdPrefix || '';

    // בדיקה אם יש סכומים מותאמים לכל חודש
    let monthlyAmounts = null;
    if (client.monthlyAmounts && Array.isArray(client.monthlyAmounts)) {
        monthlyAmounts = client.monthlyAmounts;
    }

    const batch = db.batch();

    for (let i = 0; i < totalMonths; i++) {
        const chargeDate = safeChargeDate(start.getFullYear(), start.getMonth() + i, dayOfMonth);

        const thisMonthAmount = (monthlyAmounts && monthlyAmounts[i] !== undefined)
            ? roundMoney(monthlyAmounts[i]) : amount;
        const isAlreadyPaid = i < paidAlready;
        const payRef = db.collection('recurring_billing').doc(docId)
            .collection('payments').doc();

        batch.set(payRef, {
            monthNumber: i + 1,
            plannedAmount: thisMonthAmount,
            plannedDate: chargeDate.toISOString().split('T')[0],
            billingIdSuffix: billingPrefix ? billingPrefix + '-' + (i + 1) : '',
            status: isAlreadyPaid ? 'בוצע' : 'ממתין',
            actualAmountPaid: isAlreadyPaid ? thisMonthAmount : null,
            actualPaymentDate: isAlreadyPaid ? chargeDate.toISOString().split('T')[0] : null,
            completedBy: isAlreadyPaid ? 'מיגרציה' : null,
            completedAt: isAlreadyPaid ? firebase.firestore.FieldValue.serverTimestamp() : null,
            notes: ''
        });
    }

    await batch.commit();

    // עדכון שדות סיכום בלקוח
    let paidTotal = 0;
    let plannedTotal = 0;
    for (let i = 0; i < totalMonths; i++) {
        let thisAmount = (monthlyAmounts && monthlyAmounts[i] !== undefined)
            ? roundMoney(monthlyAmounts[i]) : amount;
        plannedTotal += thisAmount;
        if (i < paidAlready) paidTotal += thisAmount;
    }
    plannedTotal = roundMoney(plannedTotal);
    paidTotal = roundMoney(paidTotal);
    await db.collection('recurring_billing').doc(docId).update({
        totalActualPaid: paidTotal,
        totalPlannedAmount: plannedTotal,
        completedPaymentsCount: paidAlready,
        billingIdPrefix: billingPrefix || ''
    });
}

function formatDateHebrew(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return day + '/' + month + '/' + year;
    } catch(e) {
        return dateStr;
    }
}

function renderPaymentModal(client, payments) {
    const amount = roundMoney(client.recurringMonthlyAmount);
    const totalPlanned = roundMoney(payments.reduce(function(sum, p) { return sum + (roundMoney(p.plannedAmount) || amount); }, 0));
    const completedPayments = payments.filter(function(p) { return p.status === 'בוצע'; });
    const totalActualPaid = completedPayments.reduce(function(sum, p) {
        return sum + (parseFloat(p.actualAmountPaid) || parseFloat(p.plannedAmount) || 0);
    }, 0);
    const remaining = totalPlanned - totalActualPaid;
    const completedCount = completedPayments.length;
    const totalMonths = payments.length;

    // סרגל סיכום
    document.getElementById('pmClientSummary').innerHTML =
        '<div class="pm-summary-item">' +
            '<div class="pm-summary-label">סה"כ עסקה <span style="font-size:10px;color:#94a3b8;">(כולל מע"מ)</span></div>' +
            '<div class="pm-summary-value">₪' + totalPlanned.toLocaleString('he-IL') + '</div>' +
        '</div>' +
        '<div class="pm-summary-item">' +
            '<div class="pm-summary-label">שולם בפועל</div>' +
            '<div class="pm-summary-value" style="color:#10b981;">₪' + totalActualPaid.toLocaleString('he-IL') + '</div>' +
        '</div>' +
        '<div class="pm-summary-item">' +
            '<div class="pm-summary-label">יתרה</div>' +
            '<div class="pm-summary-value" style="color:#ef4444;">₪' + Math.max(0, remaining).toLocaleString('he-IL') + '</div>' +
        '</div>' +
        '<div class="pm-summary-item">' +
            '<div class="pm-summary-label">תשלומים</div>' +
            '<div class="pm-summary-value">' + completedCount + '/' + totalMonths + '</div>' +
        '</div>';

    // רשימת תשלומים
    var container = document.getElementById('pmPaymentsList');
    container.innerHTML = payments.map(function(p) {
        var isCompleted = p.status === 'בוצע';
        var isOverdue = p.status === 'באיחור';
        var isCancelled = p.status === 'בוטל';
        var rowClass = isCompleted ? 'completed' : (isOverdue ? 'overdue' : (isCancelled ? 'cancelled' : ''));
        var plannedAmt = parseFloat(p.plannedAmount) || amount;

        // בדיקה אם תאריך חלף (לסימון אוטומטי כבאיחור)
        if (!isCompleted && !isCancelled && !isOverdue && p.plannedDate) {
            var pDate = new Date(p.plannedDate);
            var today = new Date();
            today.setHours(0,0,0,0);
            if (pDate < today) {
                rowClass = 'overdue';
            }
        }

        var actualAmt = parseFloat(p.actualAmountPaid) || plannedAmt;

        return '<div class="pm-payment-row ' + rowClass + '" data-payment-id="' + p.id + '">' +
            '<div class="pm-month-num">' + p.monthNumber + '</div>' +
            '<div style="font-size:13px;">' +
                formatDateHebrew(p.plannedDate) +
                (isCompleted && p.actualPaymentDate ?
                    '<br><span style="font-size:11px;color:var(--gray-400);">שולם: ' + formatDateHebrew(p.actualPaymentDate) + '</span>' : '') +
            '</div>' +
            '<div style="text-align:center;">' +
                (isCancelled
                    ? '<span style="font-size:13px;">₪' + plannedAmt.toLocaleString('he-IL') + '</span>'
                    : '<input type="number" class="pm-amount-input" value="' + plannedAmt + '" ' +
                      'onchange="updatePlannedAmount(\'' + p.id + '\', this.value)" min="0" step="0.01">') +
            '</div>' +
            '<div style="text-align:center;">' +
                (isCompleted
                    ? '<input type="number" class="pm-amount-input" value="' + actualAmt + '" ' +
                      'onchange="updateActualAmount(\'' + p.id + '\', this.value)" min="0" step="0.01" ' +
                      'style="color:#10b981;font-weight:600;">'
                    : '<span style="color:var(--gray-300);font-size:13px;">—</span>') +
            '</div>' +
            '<div style="text-align:center;display:flex;gap:4px;align-items:center;justify-content:center;">' +
                (isCompleted
                    ? '<button class="pm-mark-btn already-done" onclick="editCompletedPayment(\'' +
                      currentPaymentDocId + '\',\'' + p.id + '\')" style="cursor:pointer;" title="לחץ לעריכה">&#10004; בוצע</button>'
                    : (isCancelled
                        ? '<span style="color:var(--gray-400);font-size:11px;">בוטל</span>'
                        : '<button class="pm-mark-btn mark-done" onclick="markSinglePayment(\'' +
                          currentPaymentDocId + '\',\'' + p.id + '\')">סמן כבוצע</button>')) +
                '<button onclick="deletePayment(\'' + currentPaymentDocId + '\',\'' + p.id + '\',' + p.monthNumber + ')" ' +
                    'style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:14px;padding:2px 4px;line-height:1;" ' +
                    'title="הסר תשלום מהסדרה">&#10005;</button>' +
            '</div>' +
        '</div>';
    }).join('');

    // סיכום חשבונאי
    renderAccountingSummary(client, payments);

    // עדכון כפתור "סמן הבא"
    var nextPending = payments.find(function(p) { return p.status === 'ממתין' || p.status === 'באיחור'; });
    var markBtn = document.getElementById('pmMarkAllBtn');
    if (!nextPending) {
        markBtn.disabled = true;
        markBtn.textContent = 'כל התשלומים בוצעו';
    } else {
        markBtn.disabled = false;
        markBtn.textContent = 'סמן תשלום #' + nextPending.monthNumber + ' כבוצע';
    }
}

function renderAccountingSummary(client, payments) {
    var amount = roundMoney(client.recurringMonthlyAmount);
    var totalPlanned = roundMoney(payments.reduce(function(sum, p) { return sum + (roundMoney(p.plannedAmount) || amount); }, 0));
    var completedPayments = payments.filter(function(p) { return p.status === 'בוצע'; });
    var totalActualPaid = roundMoney(completedPayments.reduce(function(sum, p) {
        return sum + (roundMoney(p.actualAmountPaid) || roundMoney(p.plannedAmount));
    }, 0));
    var totalPlannedForCompleted = roundMoney(completedPayments.reduce(function(sum, p) {
        return sum + roundMoney(p.plannedAmount);
    }, 0));
    var difference = roundMoney(totalActualPaid - totalPlannedForCompleted);
    var remaining = roundMoney(totalPlanned - totalActualPaid);

    document.getElementById('pmAccounting').innerHTML =
        '<div class="pm-accounting-title">סיכום חשבונאי <span style="font-size:11px;font-weight:400;color:#94a3b8;">(כל הסכומים כוללים מע"מ)</span></div>' +
        '<div class="pm-accounting-row">' +
            '<span>סה"כ מתוכנן (כל התשלומים)</span>' +
            '<span>₪' + totalPlanned.toLocaleString('he-IL') + '</span>' +
        '</div>' +
        '<div class="pm-accounting-row">' +
            '<span>סה"כ שולם בפועל</span>' +
            '<span style="color:#10b981;">₪' + totalActualPaid.toLocaleString('he-IL') + '</span>' +
        '</div>' +
        (difference !== 0 ?
        '<div class="pm-accounting-row">' +
            '<span>הפרש (בפועל לעומת מתוכנן)</span>' +
            '<span style="color:' + (difference >= 0 ? '#10b981' : '#ef4444') + ';">₪' +
            difference.toLocaleString('he-IL') + '</span>' +
        '</div>' : '') +
        '<div class="pm-accounting-row total">' +
            '<span>יתרת גבייה</span>' +
            '<span style="color:#ef4444;">₪' + Math.max(0, remaining).toLocaleString('he-IL') + '</span>' +
        '</div>';
}

var _markingPayment = false;
async function markSinglePayment(clientDocId, paymentDocId) {
    if (_markingPayment) return;
    var paymentRow = document.querySelector('[data-payment-id="' + paymentDocId + '"]');
    var markBtn = paymentRow ? paymentRow.querySelector('.pm-mark-btn') : null;
    var amountInput = paymentRow ? paymentRow.querySelector('.pm-amount-input') : null;
    var payData = currentPayments.find(function(p) { return p.id === paymentDocId; });
    var plannedAmount = amountInput ? parseFloat(amountInput.value) : (payData ? parseFloat(payData.plannedAmount) : 0);

    // modal לסכום בפועל
    var actualAmount = await showInputModal('סכום ששולם בפועל', plannedAmount ? plannedAmount.toString() : '', 'number', function(v) { return v >= 0; });
    if (actualAmount === null) return;

    if (plannedAmount && actualAmount > plannedAmount * 1.1) {
        if (!confirm('הסכום גבוה ב-' + Math.round((actualAmount / plannedAmount - 1) * 100) + '% מהסכום המתוכנן. להמשיך?')) return;
    }

    // modal לתאריך תשלום
    var today = new Date().toISOString().split('T')[0];
    var actualDate = await showInputModal('תאריך תשלום', today, 'date');
    if (actualDate === null) return;

    _markingPayment = true;
    if (markBtn) markBtn.disabled = true;
    try {
        // 1. עדכון Firebase subcollection
        var payRef = db.collection('recurring_billing').doc(clientDocId)
            .collection('payments').doc(paymentDocId);

        await payRef.update({
            status: 'בוצע',
            actualAmountPaid: actualAmount,
            actualPaymentDate: actualDate,
            completedBy: currentUser || 'webapp',
            completedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 2. חישוב מחדש של כל הסיכומים מ-subcollection (מקור אמת יחיד)
        await recalcClientSummary(clientDocId);

        // 3. רענון המודאל
        await openPaymentModal(clientDocId);

    } catch (error) {
        console.error('Error marking payment:', error);
        alert('שגיאה בסימון תשלום: ' + error.message);
    } finally {
        _markingPayment = false;
        if (markBtn) markBtn.disabled = false;
    }
}

var _updatingAmount = {};
async function updatePlannedAmount(paymentDocId, newValue) {
    var newAmount = roundMoney(newValue);
    if (isNaN(newAmount) || newAmount < 0) return;
    if (_updatingAmount[paymentDocId]) return;
    _updatingAmount[paymentDocId] = true;
    try {
        var payRef = db.collection('recurring_billing').doc(currentPaymentDocId)
            .collection('payments').doc(paymentDocId);

        await payRef.update({ plannedAmount: newAmount });

        // עדכון סיכומים - תמיד מ-subcollection (מקור אמת יחיד)
        await recalcClientSummary(currentPaymentDocId);
    } catch (error) {
        console.error('Error updating amount:', error);
    } finally {
        delete _updatingAmount[paymentDocId];
    }
}

// עדכון סכום ששולם בפועל (עבור תשלום שכבר בוצע)
var _updatingActual = {};
async function updateActualAmount(paymentDocId, newValue) {
    var newAmount = roundMoney(newValue);
    if (isNaN(newAmount) || newAmount < 0) return;
    if (_updatingActual[paymentDocId]) return;
    _updatingActual[paymentDocId] = true;
    try {
        var payRef = db.collection('recurring_billing').doc(currentPaymentDocId)
            .collection('payments').doc(paymentDocId);
        await payRef.update({ actualAmountPaid: newAmount });

        // עדכון סיכומי הלקוח
        await recalcClientSummary(currentPaymentDocId);

        // רענון סיכום חשבונאי במודאל
        var clientDoc = await db.collection('recurring_billing').doc(currentPaymentDocId).get();
        var refreshSnap = await db.collection('recurring_billing').doc(currentPaymentDocId)
            .collection('payments').orderBy('monthNumber').get();
        var refreshPayments = [];
        refreshSnap.forEach(function(d) { refreshPayments.push({ id: d.id, ...d.data() }); });
        currentPayments = refreshPayments;
        renderAccountingSummary({ id: currentPaymentDocId, ...clientDoc.data() }, refreshPayments);

        // עדכון סרגל סיכום
        var completedP = refreshPayments.filter(function(p) { return p.status === 'בוצע'; });
        var totalActual = completedP.reduce(function(s, p) { return s + (parseFloat(p.actualAmountPaid) || 0); }, 0);
        var totalPlanned = refreshPayments.reduce(function(s, p) { return s + (parseFloat(p.plannedAmount) || 0); }, 0);
        var remaining = totalPlanned - totalActual;
        var summaryItems = document.querySelectorAll('.pm-summary-value');
        if (summaryItems.length >= 3) {
            summaryItems[1].innerHTML = '₪' + totalActual.toLocaleString('he-IL');
            summaryItems[2].innerHTML = '₪' + Math.max(0, remaining).toLocaleString('he-IL');
        }
    } catch (error) {
        console.error('Error updating actual amount:', error);
    } finally {
        delete _updatingActual[paymentDocId];
    }
}

// עריכת תשלום שכבר בוצע (שינוי תאריך תשלום)
async function editCompletedPayment(clientDocId, paymentDocId) {
    var payData = currentPayments.find(function(p) { return p.id === paymentDocId; });
    if (!payData) return;

    var currentDate = payData.actualPaymentDate || payData.plannedDate || '';
    var newDate = await showInputModal('תאריך תשלום בפועל', currentDate, 'date');
    if (newDate === null) {
        // ביטול — אפשרות לבטל סימון
        if (confirm('האם לבטל סימון תשלום זה כבוצע?')) {
            try {
                var payRef = db.collection('recurring_billing').doc(clientDocId)
                    .collection('payments').doc(paymentDocId);
                await payRef.update({
                    status: 'ממתין',
                    actualAmountPaid: null,
                    actualPaymentDate: null,
                    completedBy: null,
                    completedAt: null
                });
                await recalcClientSummary(clientDocId);
                await openPaymentModal(clientDocId);
            } catch (error) {
                console.error('Error reverting payment:', error);
                alert('שגיאה בביטול: ' + error.message);
            }
        }
        return;
    }

    // עדכון תאריך
    try {
        var payRef = db.collection('recurring_billing').doc(clientDocId)
            .collection('payments').doc(paymentDocId);
        await payRef.update({ actualPaymentDate: newDate });
        await recalcClientSummary(clientDocId);
        await openPaymentModal(clientDocId);
    } catch (error) {
        console.error('Error updating payment date:', error);
        alert('שגיאה בעדכון: ' + error.message);
    }
}

// חישוב מחדש של סיכומי הלקוח מתוך subcollection
async function recalcClientSummary(docId) {
    var snap = await db.collection('recurring_billing').doc(docId)
        .collection('payments').get();
    var totalPaid = 0;
    var totalPlanned = 0;
    var paidCount = 0;
    var activeCount = 0;
    var lastDate = null;
    snap.forEach(function(d) {
        var p = d.data();
        if (p.status !== 'בוטל') {
            totalPlanned += roundMoney(p.plannedAmount);
            activeCount++;
        }
        if (p.status === 'בוצע') {
            totalPaid += roundMoney(p.actualAmountPaid) || roundMoney(p.plannedAmount);
            paidCount++;
            if (p.actualPaymentDate && (!lastDate || p.actualPaymentDate > lastDate)) {
                lastDate = p.actualPaymentDate;
            }
        }
    });
    totalPlanned = roundMoney(totalPlanned);
    totalPaid = roundMoney(totalPaid);
    await db.collection('recurring_billing').doc(docId).update({
        totalActualPaid: totalPaid,
        totalPlannedAmount: totalPlanned,
        completedPaymentsCount: paidCount,
        activePaymentsCount: activeCount,
        lastPaymentDate: lastDate || ''
    });
}

// מחיקת תשלום מהסדרה
var _deletingPayment = false;
async function deletePayment(clientDocId, paymentDocId, monthNumber) {
    if (_deletingPayment) return;
    if (!confirm('האם להסיר את תשלום #' + monthNumber + ' מהסדרה?\nפעולה זו לא ניתנת לביטול.')) return;

    _deletingPayment = true;
    try {
        await db.collection('recurring_billing').doc(clientDocId)
            .collection('payments').doc(paymentDocId).delete();
        await recalcClientSummary(clientDocId);
        await openPaymentModal(clientDocId);
    } catch (error) {
        console.error('Error deleting payment:', error);
        alert('שגיאה במחיקה: ' + error.message);
    } finally {
        _deletingPayment = false;
    }
}

async function markNextPayment() {
    var nextPending = currentPayments.find(function(p) { return p.status === 'ממתין' || p.status === 'באיחור'; });
    if (!nextPending) {
        alert('אין תשלומים ממתינים');
        return;
    }
    await markSinglePayment(currentPaymentDocId, nextPending.id);
}

async function markAllDuePayments() {
    if (!currentPaymentDocId) return;
    var today = new Date().toISOString().split('T')[0];
    var duePayments = currentPayments.filter(function(p) {
        return (p.status === 'ממתין' || p.status === 'באיחור') && p.plannedDate <= today;
    });
    if (duePayments.length === 0) {
        alert('אין תשלומים שהגיע מועד פירעונם');
        return;
    }
    if (!confirm('יש ' + duePayments.length + ' תשלומים שהגיע מועדם. לסמן הכל כבוצע?')) return;

    var btn = document.getElementById('pmBatchMarkBtn');
    if (btn) btn.disabled = true;
    try {
        var batch = db.batch();
        var nowISO = new Date().toISOString().split('T')[0];
        duePayments.forEach(function(p) {
            var ref = db.collection('recurring_billing').doc(currentPaymentDocId)
                .collection('payments').doc(p.id);
            batch.update(ref, {
                status: 'בוצע',
                actualAmountPaid: roundMoney(p.plannedAmount),
                actualPaymentDate: nowISO,
                completedBy: currentUser || (authUser ? authUser.email : 'לא ידוע'),
                completedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        await recalcClientSummary(currentPaymentDocId);
        alert(duePayments.length + ' תשלומים סומנו כבוצעו');
        await openPaymentModal(currentPaymentDocId);
    } catch (error) {
        console.error('Error batch marking:', error);
        alert('שגיאה בסימון קבוצתי: ' + error.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function closePaymentModal() {
    document.getElementById('pmOverlay').classList.remove('show');
    currentPaymentDocId = null;
    currentPayments = [];
    loadBillingData();
}

async function quickMarkPayment(docId) {
    try {
        var snap = await db.collection('recurring_billing').doc(docId)
            .collection('payments').orderBy('monthNumber', 'asc').get();

        if (snap.empty) {
            openPaymentModal(docId);
            return;
        }

        var payments = [];
        snap.forEach(function(d) { payments.push({ id: d.id, ...d.data() }); });

        var next = payments.find(function(p) { return p.status === 'ממתין' || p.status === 'באיחור'; });
        if (!next) {
            alert('אין תשלומים ממתינים');
            return;
        }

        var planned = parseFloat(next.plannedAmount) || 0;
        if (!confirm('לסמן תשלום #' + next.monthNumber + ' (₪' + planned.toLocaleString('he-IL') + ') כבוצע?')) {
            return;
        }

        currentPaymentDocId = docId;
        currentPayments = payments;
        await markSinglePayment(docId, next.id);
        currentPaymentDocId = null;
        currentPayments = [];

    } catch (error) {
        console.error('Error in quick mark:', error);
        alert('שגיאה: ' + error.message);
    }
}

var _cancellingOrPausing = false;
async function cancelBillingSeriesUI() {
    if (!currentPaymentDocId || _cancellingOrPausing) return;
    var pendingCount = currentPayments.filter(function(p) { return p.status === 'ממתין' || p.status === 'באיחור'; }).length;
    if (pendingCount === 0) {
        alert('אין תשלומים ממתינים לביטול');
        return;
    }

    // בחירה: השהיה או ביטול
    var choice = prompt('יש ' + pendingCount + ' תשלומים ממתינים.\nהקלד "השהה" להשהיית הסדרה (ניתן לחידוש), או "בטל" לביטול סופי:');
    if (!choice) return;
    choice = choice.trim();
    var isPause = (choice === 'השהה' || choice === 'השהיה');
    var isCancel = (choice === 'בטל' || choice === 'ביטול');
    if (!isPause && !isCancel) {
        alert('נא להקליד "השהה" או "בטל"');
        return;
    }

    _cancellingOrPausing = true;
    try {
        if (isCancel) {
            var batch = db.batch();
            currentPayments.forEach(function(p) {
                if (p.status === 'ממתין' || p.status === 'באיחור') {
                    var ref = db.collection('recurring_billing').doc(currentPaymentDocId)
                        .collection('payments').doc(p.id);
                    batch.update(ref, { status: 'בוטל' });
                }
            });
            await batch.commit();
            await db.collection('recurring_billing').doc(currentPaymentDocId).update({
                status: 'בוטל'
            });
            await recalcClientSummary(currentPaymentDocId);
            alert('הסדרה בוטלה בהצלחה');
        } else {
            // השהיה — התשלומים נשארים, הסטטוס משתנה למושהה
            await db.collection('recurring_billing').doc(currentPaymentDocId).update({
                status: 'מושהה'
            });
            alert('הסדרה הושהתה. ניתן לחדש אותה בכל עת דרך עריכת הלקוח.');
        }
        await openPaymentModal(currentPaymentDocId);
    } catch (error) {
        console.error('Error cancelling/pausing series:', error);
        alert('שגיאה: ' + error.message);
    } finally {
        _cancellingOrPausing = false;
    }
}

var _extendingSeries = false;
async function extendBillingSeriesUI() {
    if (_extendingSeries) return;
    if (!currentPaymentDocId) return;

    var additionalMonths = await showInputModal('כמה חודשים להוסיף?', '', 'number', function(v) { return v > 0 && v <= 60 && v === Math.floor(v); });
    if (additionalMonths === null) return;
    additionalMonths = Math.floor(additionalMonths);

    var clientDoc = await db.collection('recurring_billing').doc(currentPaymentDocId).get();
    var client = clientDoc.data();
    var amount = roundMoney(client.recurringMonthlyAmount);

    var monthlyAmount = await showInputModal('סכום חודשי לחודשים החדשים', amount.toString(), 'number', function(v) { return v > 0; });
    if (monthlyAmount === null) return;
    monthlyAmount = roundMoney(monthlyAmount);

    _extendingSeries = true;
    try {
        var currentTotal = parseInt(client.recurringMonthsCount) || currentPayments.length;
        var newTotal = currentTotal + additionalMonths;

        // עדכון סטטוס לפעיל (מספר חודשים יתעדכן ב-recalcClientSummary)
        await db.collection('recurring_billing').doc(currentPaymentDocId).update({
            status: 'פעיל'
        });

        // חישוב התאריך הבא לפי התשלום האחרון
        var lastPayment = currentPayments[currentPayments.length - 1];
        var lastDate = lastPayment ? new Date(lastPayment.plannedDate) : new Date();
        var dayOfMonth = parseInt(client.recurringDayOfMonth) || lastDate.getDate();
        var billingPrefix = client.billingIdPrefix || '';

        // יצירת מסמכי תשלום חדשים ב-Firebase
        var batch = db.batch();
        for (var i = 0; i < additionalMonths; i++) {
            var monthIndex = currentTotal + i;
            var chargeDate = safeChargeDate(lastDate.getFullYear(), lastDate.getMonth() + i + 1, dayOfMonth);

            var payRef = db.collection('recurring_billing').doc(currentPaymentDocId)
                .collection('payments').doc();
            batch.set(payRef, {
                monthNumber: monthIndex + 1,
                plannedAmount: monthlyAmount,
                plannedDate: chargeDate.toISOString().split('T')[0],
                billingIdSuffix: billingPrefix ? billingPrefix + '-' + (monthIndex + 1) : '',
                status: 'ממתין',
                actualAmountPaid: null,
                actualPaymentDate: null,
                completedBy: null,
                completedAt: null,
                notes: ''
            });
        }
        await batch.commit();

        // חישוב מחדש של סיכומים מ-subcollection (מקור אמת יחיד)
        await recalcClientSummary(currentPaymentDocId);

        alert('נוספו ' + additionalMonths + ' חודשים בהצלחה');
        await openPaymentModal(currentPaymentDocId);
    } catch (error) {
        console.error('Error extending series:', error);
        alert('שגיאה בהוספת חודשים: ' + error.message);
    } finally {
        _extendingSeries = false;
    }
}

// === טבלת סכומים לכל חודש בטופס הוספה ===
function generateAmountsPreview() {
    var totalDealInput = document.getElementById('billingTotalDeal');
    var monthsInput = document.getElementById('billingMonths');
    var amountInput = document.getElementById('billingAmount');
    var preview = document.getElementById('billingAmountsPreview');
    var tableDiv = document.getElementById('billingAmountsTable');
    var summaryDiv = document.getElementById('billingAmountsSummary');

    var totalDeal = parseFloat(totalDealInput.value);
    var months = parseInt(monthsInput.value);

    if (!totalDeal || !months || months < 1) {
        preview.style.display = 'none';
        amountInput.value = '';
        return;
    }

    // חישוב סכום לכל תשלום (חלוקה שווה)
    var perMonth = Math.round((totalDeal / months) * 100) / 100;
    amountInput.value = perMonth;

    preview.style.display = 'block';
    summaryDiv.innerHTML = '<strong>סה"כ לגבייה:</strong> ₪' + totalDeal.toLocaleString('he-IL') + ' (' + months + ' תשלומים × ₪' + perMonth.toLocaleString('he-IL') + ')';

    // Generate table rows
    var startDate = document.getElementById('billingStartDate').value;
    var dayOfMonth = parseInt(document.getElementById('billingDayOfMonth').value) || 1;
    var baseDate = startDate ? new Date(startDate) : new Date();

    // חלוקה: תשלומים שווים, עם השלמה בתשלום האחרון
    var amounts = [];
    var runningTotal = 0;
    for (var i = 0; i < months; i++) {
        if (i === months - 1) {
            // תשלום אחרון - השלמה למלוא הסכום
            amounts.push(Math.round((totalDeal - runningTotal) * 100) / 100);
        } else {
            amounts.push(perMonth);
            runningTotal += perMonth;
        }
    }

    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="background:#0f172a;color:#fff;">';
    html += '<th style="padding:6px 8px;border-radius:0 6px 0 0;text-align:center;">תשלום</th>';
    html += '<th style="padding:6px 8px;text-align:center;">תאריך חיוב</th>';
    html += '<th style="padding:6px 8px;border-radius:6px 0 0 0;text-align:center;">סכום (₪)</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < months; i++) {
        var chargeDate = safeChargeDate(baseDate.getFullYear(), baseDate.getMonth() + i, dayOfMonth);
        var dateStr = chargeDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        var bgColor = i % 2 === 0 ? '#fff' : '#f8fafc';
        html += '<tr style="background:' + bgColor + ';">';
        html += '<td style="padding:6px 8px;text-align:center;font-weight:600;color:#0f172a;">' + (i + 1) + '</td>';
        html += '<td style="padding:6px 8px;text-align:center;color:#64748b;">' + dateStr + '</td>';
        html += '<td style="padding:4px 6px;text-align:center;">';
        html += '<input type="number" class="billing-month-amount" data-month="' + i + '" value="' + amounts[i] + '" ';
        html += 'style="width:90px;text-align:center;border:1px solid #e2e8f0;border-radius:4px;padding:4px 6px;font-size:12px;font-family:Heebo,sans-serif;" ';
        html += 'onchange="balanceAmounts(' + i + ')">';
        html += '</td></tr>';
    }
    html += '</tbody></table>';
    tableDiv.innerHTML = html;
    tableDiv.style.display = 'block';
    document.getElementById('billingAmountsToggle').textContent = 'הסתר טבלה';
    document.getElementById('billingAmountsToggle').style.background = '#0f172a';
    document.getElementById('billingAmountsToggle').style.color = '#fff';

    updateAmountsSummary();
}

function toggleAmountsTable() {
    var tableDiv = document.getElementById('billingAmountsTable');
    var toggleBtn = document.getElementById('billingAmountsToggle');
    if (tableDiv.style.display === 'none' || !tableDiv.style.display) {
        tableDiv.style.display = 'block';
        toggleBtn.textContent = 'הסתר טבלה';
        toggleBtn.style.background = 'var(--primary-blue)';
        toggleBtn.style.color = '#fff';
    } else {
        tableDiv.style.display = 'none';
        toggleBtn.textContent = 'ערוך סכומים';
        toggleBtn.style.background = 'none';
        toggleBtn.style.color = 'var(--primary-blue)';
    }
}

// השלמה אוטומטית - כשמשנים תשלום אחד, האחרון מתאזן
function balanceAmounts(changedIndex) {
    var inputs = document.querySelectorAll('.billing-month-amount');
    var totalDeal = parseFloat(document.getElementById('billingTotalDeal').value) || 0;
    if (!totalDeal || inputs.length === 0) return;

    // חישוב סכום כל התשלומים חוץ מהאחרון
    var sumExceptLast = 0;
    for (var i = 0; i < inputs.length - 1; i++) {
        sumExceptLast += parseFloat(inputs[i].value) || 0;
    }

    // עדכון התשלום האחרון כהשלמה
    var lastAmount = Math.round((totalDeal - sumExceptLast) * 100) / 100;
    inputs[inputs.length - 1].value = lastAmount;

    // אם האחרון יצא שלילי - התראה
    if (lastAmount < 0) {
        inputs[inputs.length - 1].style.borderColor = '#ef4444';
        inputs[inputs.length - 1].style.color = '#ef4444';
    } else {
        inputs[inputs.length - 1].style.borderColor = '#e2e8f0';
        inputs[inputs.length - 1].style.color = '';
    }

    updateAmountsSummary();
}

function updateAmountsSummary() {
    var inputs = document.querySelectorAll('.billing-month-amount');
    var summaryDiv = document.getElementById('billingAmountsSummary');
    var totalDeal = parseFloat(document.getElementById('billingTotalDeal').value) || 0;
    var total = 0;
    var allSame = true;
    var firstVal = inputs.length > 0 ? parseFloat(inputs[0].value) : 0;

    inputs.forEach(function(inp) {
        var val = parseFloat(inp.value) || 0;
        total += val;
        if (Math.abs(val - firstVal) > 0.01) allSame = false;
    });

    var diff = Math.round((total - totalDeal) * 100) / 100;
    var text = '<strong>סה"כ לגבייה:</strong> ₪' + total.toLocaleString('he-IL') + ' (' + inputs.length + ' תשלומים)';
    if (!allSame) {
        text += ' <span style="color:#0f172a;font-weight:600;">⚡ תשלומים לא שווים</span>';
    }
    if (diff !== 0) {
        text += ' <span style="color:#ef4444;font-weight:600;">⚠ הפרש: ₪' + diff.toLocaleString('he-IL') + '</span>';
    } else {
        text += ' <span style="color:#16a34a;">✓ מאוזן</span>';
    }
    summaryDiv.innerHTML = text;
}

// === טבלת סכומים לכל חודש בטופס עריכה ===
var editPaymentsCache = []; // שמירת תשלומים שנטענו מ-Firebase

async function loadEditAmountsTable(docId, clientData) {
    var preview = document.getElementById('editAmountsPreview');
    var tableDiv = document.getElementById('editAmountsTable');
    var summaryDiv = document.getElementById('editAmountsSummary');

    // טעינת תשלומים מ-subcollection
    var snap = await db.collection('recurring_billing').doc(docId)
        .collection('payments').orderBy('monthNumber', 'asc').get();

    if (snap.empty) {
        // אין subcollection - הצגת חישוב מהנתוני לקוח
        var totalDeal = parseFloat(document.getElementById('editTotalDeal').value) || 0;
        var months = parseInt(document.getElementById('editMonths').value) || 0;
        if (totalDeal && months) {
            generateEditAmountsPreview();
        } else {
            preview.style.display = 'none';
        }
        return;
    }

    editPaymentsCache = [];
    snap.forEach(function(d) {
        editPaymentsCache.push({ id: d.id, ...d.data() });
    });

    preview.style.display = 'block';

    var startDate = document.getElementById('editStartDate').value;
    var dayOfMonth = parseInt(document.getElementById('editDayOfMonth').value) || 1;

    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="background:#0f172a;color:#fff;">';
    html += '<th style="padding:6px 8px;border-radius:0 6px 0 0;text-align:center;">תשלום</th>';
    html += '<th style="padding:6px 8px;text-align:center;">תאריך חיוב</th>';
    html += '<th style="padding:6px 8px;text-align:center;">סטטוס</th>';
    html += '<th style="padding:6px 8px;border-radius:6px 0 0 0;text-align:center;">סכום (₪)</th>';
    html += '</tr></thead><tbody>';

    editPaymentsCache.forEach(function(p, i) {
        var dateStr = p.plannedDate ? new Date(p.plannedDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        var bgColor = i % 2 === 0 ? '#fff' : '#f8fafc';
        var statusColor = p.status === 'בוצע' ? '#16a34a' : (p.status === 'באיחור' ? '#ef4444' : (p.status === 'בוטל' ? '#9ca3af' : '#f59e0b'));
        var isEditable = p.status !== 'בוצע' && p.status !== 'בוטל';

        html += '<tr style="background:' + bgColor + ';">';
        html += '<td style="padding:6px 8px;text-align:center;font-weight:600;color:#0f172a;">' + p.monthNumber + '</td>';
        html += '<td style="padding:6px 8px;text-align:center;color:#64748b;">' + dateStr + '</td>';
        html += '<td style="padding:6px 8px;text-align:center;"><span style="color:' + statusColor + ';font-size:11px;font-weight:600;">' + (p.status || 'ממתין') + '</span></td>';
        html += '<td style="padding:4px 6px;text-align:center;">';
        if (isEditable) {
            html += '<input type="number" class="edit-month-amount" data-index="' + i + '" data-payment-id="' + p.id + '" value="' + (parseFloat(p.plannedAmount) || 0) + '" ';
            html += 'style="width:90px;text-align:center;border:1px solid #e2e8f0;border-radius:4px;padding:4px 6px;font-size:12px;font-family:Heebo,sans-serif;" ';
            html += 'onchange="balanceEditAmounts(' + i + ')">';
        } else {
            html += '<span style="color:' + statusColor + ';font-weight:600;">₪' + (parseFloat(p.plannedAmount) || 0).toLocaleString('he-IL') + '</span>';
        }
        html += '</td></tr>';
    });

    html += '</tbody></table>';
    tableDiv.innerHTML = html;
    tableDiv.style.display = 'block';

    var toggleBtn = document.getElementById('editAmountsToggle');
    toggleBtn.textContent = 'הסתר טבלה';
    toggleBtn.style.background = '#0f172a';
    toggleBtn.style.color = '#fff';

    updateEditAmountsSummary();
}

function generateEditAmountsPreview() {
    var totalDeal = parseFloat(document.getElementById('editTotalDeal').value) || 0;
    var months = parseInt(document.getElementById('editMonths').value) || 0;
    var preview = document.getElementById('editAmountsPreview');
    var tableDiv = document.getElementById('editAmountsTable');

    if (!totalDeal || !months) {
        preview.style.display = 'none';
        return;
    }

    // אם יש כבר תשלומים מ-subcollection, לא ליצור חדשים
    if (editPaymentsCache.length > 0) {
        updateEditAmountsSummary();
        return;
    }

    var perMonth = Math.round((totalDeal / months) * 100) / 100;
    document.getElementById('editAmount').value = perMonth;
    preview.style.display = 'block';

    var startDate = document.getElementById('editStartDate').value;
    var dayOfMonth = parseInt(document.getElementById('editDayOfMonth').value) || 1;
    var baseDate = startDate ? new Date(startDate) : new Date();

    var amounts = [];
    var runningTotal = 0;
    for (var i = 0; i < months; i++) {
        if (i === months - 1) {
            amounts.push(Math.round((totalDeal - runningTotal) * 100) / 100);
        } else {
            amounts.push(perMonth);
            runningTotal += perMonth;
        }
    }

    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="background:#0f172a;color:#fff;">';
    html += '<th style="padding:6px 8px;border-radius:0 6px 0 0;text-align:center;">תשלום</th>';
    html += '<th style="padding:6px 8px;text-align:center;">תאריך חיוב</th>';
    html += '<th style="padding:6px 8px;border-radius:6px 0 0 0;text-align:center;">סכום (₪)</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < months; i++) {
        var chargeDate = safeChargeDate(baseDate.getFullYear(), baseDate.getMonth() + i, dayOfMonth);
        var dateStr = chargeDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        var bgColor = i % 2 === 0 ? '#fff' : '#f8fafc';
        html += '<tr style="background:' + bgColor + ';">';
        html += '<td style="padding:6px 8px;text-align:center;font-weight:600;color:#0f172a;">' + (i + 1) + '</td>';
        html += '<td style="padding:6px 8px;text-align:center;color:#64748b;">' + dateStr + '</td>';
        html += '<td style="padding:4px 6px;text-align:center;">';
        html += '<input type="number" class="edit-month-amount" data-index="' + i + '" value="' + amounts[i] + '" ';
        html += 'style="width:90px;text-align:center;border:1px solid #e2e8f0;border-radius:4px;padding:4px 6px;font-size:12px;font-family:Heebo,sans-serif;" ';
        html += 'onchange="balanceEditAmounts(' + i + ')">';
        html += '</td></tr>';
    }
    html += '</tbody></table>';
    tableDiv.innerHTML = html;
    tableDiv.style.display = 'block';
    document.getElementById('editAmountsToggle').textContent = 'הסתר טבלה';
    document.getElementById('editAmountsToggle').style.background = '#0f172a';
    document.getElementById('editAmountsToggle').style.color = '#fff';
    updateEditAmountsSummary();
}

function toggleEditAmountsTable() {
    var tableDiv = document.getElementById('editAmountsTable');
    var toggleBtn = document.getElementById('editAmountsToggle');
    if (tableDiv.style.display === 'none' || !tableDiv.style.display) {
        tableDiv.style.display = 'block';
        toggleBtn.textContent = 'הסתר טבלה';
        toggleBtn.style.background = '#0f172a';
        toggleBtn.style.color = '#fff';
    } else {
        tableDiv.style.display = 'none';
        toggleBtn.textContent = 'ערוך סכומים';
        toggleBtn.style.background = 'none';
        toggleBtn.style.color = 'var(--primary-blue)';
    }
}

function balanceEditAmounts(changedIndex) {
    var inputs = document.querySelectorAll('.edit-month-amount');
    var totalDeal = parseFloat(document.getElementById('editTotalDeal').value) || 0;
    if (!totalDeal || inputs.length === 0) return;

    // סכום כל התשלומים חוץ מהאחרון הניתן לעריכה
    var editableInputs = [];
    inputs.forEach(function(inp) { editableInputs.push(inp); });

    var sumExceptLast = 0;
    for (var i = 0; i < editableInputs.length - 1; i++) {
        sumExceptLast += parseFloat(editableInputs[i].value) || 0;
    }

    // הוספת סכום תשלומים שבוצעו (לא ניתנים לעריכה)
    var completedSum = 0;
    editPaymentsCache.forEach(function(p) {
        if (p.status === 'בוצע' || p.status === 'בוטל') {
            if (p.status === 'בוצע') completedSum += parseFloat(p.plannedAmount) || 0;
        }
    });

    var lastAmount = Math.round((totalDeal - completedSum - sumExceptLast) * 100) / 100;
    editableInputs[editableInputs.length - 1].value = lastAmount;

    if (lastAmount < 0) {
        editableInputs[editableInputs.length - 1].style.borderColor = '#ef4444';
        editableInputs[editableInputs.length - 1].style.color = '#ef4444';
    } else {
        editableInputs[editableInputs.length - 1].style.borderColor = '#e2e8f0';
        editableInputs[editableInputs.length - 1].style.color = '';
    }

    updateEditAmountsSummary();
}

function updateEditAmountsSummary() {
    var inputs = document.querySelectorAll('.edit-month-amount');
    var summaryDiv = document.getElementById('editAmountsSummary');
    var totalDeal = parseFloat(document.getElementById('editTotalDeal').value) || 0;

    // סכום תשלומים שניתנים לעריכה
    var editableTotal = 0;
    inputs.forEach(function(inp) {
        editableTotal += parseFloat(inp.value) || 0;
    });

    // סכום תשלומים שבוצעו
    var completedTotal = 0;
    editPaymentsCache.forEach(function(p) {
        if (p.status === 'בוצע') completedTotal += parseFloat(p.plannedAmount) || 0;
    });

    var grandTotal = editableTotal + completedTotal;
    var diff = Math.round((grandTotal - totalDeal) * 100) / 100;
    var totalPayments = (inputs.length || 0) + editPaymentsCache.filter(function(p) { return p.status === 'בוצע'; }).length;
    // if we have editPaymentsCache, total is its full length minus cancelled
    if (editPaymentsCache.length > 0) {
        totalPayments = editPaymentsCache.filter(function(p) { return p.status !== 'בוטל'; }).length;
    }

    var text = '<strong>סה"כ:</strong> ₪' + grandTotal.toLocaleString('he-IL') + ' (' + totalPayments + ' תשלומים)';
    if (diff !== 0) {
        text += ' <span style="color:#ef4444;font-weight:600;">⚠ הפרש: ₪' + diff.toLocaleString('he-IL') + '</span>';
    } else {
        text += ' <span style="color:#16a34a;">✓ מאוזן</span>';
    }
    summaryDiv.innerHTML = text;
}

function getEditMonthlyAmountsFromTable() {
    var inputs = document.querySelectorAll('.edit-month-amount');
    if (inputs.length === 0 && editPaymentsCache.length === 0) return null;

    var amounts = {};
    // סכומים מתשלומים שבוצעו (לא ניתנים לעריכה)
    editPaymentsCache.forEach(function(p) {
        if ((p.status === 'בוצע' || p.status === 'בוטל') && p.id) {
            amounts[p.id] = parseFloat(p.plannedAmount) || 0;
        }
    });
    // סכומים מ-inputs
    inputs.forEach(function(inp) {
        var payId = inp.getAttribute('data-payment-id');
        if (payId) {
            amounts[payId] = parseFloat(inp.value) || 0;
        }
    });

    return Object.keys(amounts).length > 0 ? amounts : null;
}

function getMonthlyAmountsFromTable() {
    var inputs = document.querySelectorAll('.billing-month-amount');
    if (inputs.length === 0) return null;

    var baseAmount = parseFloat(document.getElementById('billingAmount').value) || 0;
    var amounts = [];
    var hasCustom = false;

    inputs.forEach(function(inp) {
        var val = parseFloat(inp.value) || 0;
        amounts.push(val);
        if (val !== baseAmount) hasCustom = true;
    });

    return hasCustom ? amounts : null;
}

// Card number formatting in edit modal
document.addEventListener('DOMContentLoaded', function() {
    var editCardInput = document.getElementById('editCardNumber');
    if (editCardInput) {
        editCardInput.addEventListener('input', function(e) {
            var val = e.target.value.replace(/\D/g, '').substring(0, 16);
            e.target.value = val.replace(/(\d{4})(?=\d)/g, '$1 ');
        });
    }
    var editExpiryInput = document.getElementById('editCardExpiry');
    if (editExpiryInput) {
        editExpiryInput.addEventListener('input', function(e) {
            var val = e.target.value.replace(/\D/g, '').substring(0, 4);
            if (val.length >= 3) val = val.substring(0, 2) + '/' + val.substring(2);
            e.target.value = val;
        });
    }

    // Event listeners לטבלת סכומים בטופס הוספת גבייה
    var billingTotalDealField = document.getElementById('billingTotalDeal');
    var billingMonthsField = document.getElementById('billingMonths');
    var billingStartDateField = document.getElementById('billingStartDate');
    var billingDayOfMonthField = document.getElementById('billingDayOfMonth');

    if (billingTotalDealField) {
        billingTotalDealField.addEventListener('input', generateAmountsPreview);
    }
    if (billingMonthsField) {
        billingMonthsField.addEventListener('input', generateAmountsPreview);
    }
    if (billingStartDateField) {
        billingStartDateField.addEventListener('change', generateAmountsPreview);
    }
    if (billingDayOfMonthField) {
        billingDayOfMonthField.addEventListener('input', generateAmountsPreview);
    }

    // Edit modal - auto-calculate per-payment amount
    var editTotalDealField = document.getElementById('editTotalDeal');
    var editMonthsField = document.getElementById('editMonths');
    function calcEditPerPayment() {
        var total = parseFloat(editTotalDealField.value) || 0;
        var months = parseInt(editMonthsField.value) || 0;
        document.getElementById('editAmount').value = (total && months) ? Math.round(total / months) : '';
        // עדכון תצוגת טבלה אם אין subcollection קיים
        if (editPaymentsCache.length === 0) {
            generateEditAmountsPreview();
        } else {
            updateEditAmountsSummary();
        }
    }
    if (editTotalDealField) editTotalDealField.addEventListener('input', calcEditPerPayment);
    if (editMonthsField) editMonthsField.addEventListener('input', calcEditPerPayment);
});

// Initialize
updateProgress();
