var invoicesList = [];
var invSearchTimeout = null;

function showInvoicesManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('billingManagement').classList.remove('active');
    document.getElementById('invoicesManagement').classList.add('active');
    loadInvoicesData();
}

function hideInvoicesManagement() {
    document.getElementById('invoicesManagement').classList.remove('active');
    document.getElementById('mainContainer').style.display = '';
}

async function loadInvoicesData() {
    var loading = document.getElementById('invLoading');
    var empty = document.getElementById('invEmpty');
    var tableView = document.getElementById('invTableView');

    loading.style.display = '';
    empty.style.display = 'none';
    tableView.style.display = 'none';

    try {
        var snapshot = await db.collection('invoices').orderBy('createdAt', 'desc').get();
        invoicesList = [];
        snapshot.forEach(function(doc) {
            invoicesList.push({ id: doc.id, ...doc.data() });
        });

        loading.style.display = 'none';

        if (invoicesList.length === 0) {
            empty.style.display = '';
            tableView.style.display = 'none';
        } else {
            empty.style.display = 'none';
            tableView.style.display = '';
        }

        updateInvoicesSummary();
        renderInvoicesTable(invoicesList);
    } catch (error) {
        console.error('Error loading invoices:', error);
        loading.style.display = 'none';
        empty.style.display = '';
    }
}

function updateInvoicesSummary() {
    var totalCount = invoicesList.length;
    var totalAmount = 0;
    var thisMonth = new Date().toISOString().slice(0, 7);
    var monthCount = 0;

    invoicesList.forEach(function(inv) {
        totalAmount += parseFloat(inv.total) || 0;
        if (inv.date && inv.date.slice(0, 7) === thisMonth) monthCount++;
    });

    document.getElementById('invStatTotal').textContent = totalCount;
    document.getElementById('invStatAmount').textContent = '₪' + totalAmount.toLocaleString('he-IL');
    document.getElementById('invStatMonth').textContent = monthCount;
}

function filterInvoices() {
    clearTimeout(invSearchTimeout);
    invSearchTimeout = setTimeout(function() {
        var term = (document.getElementById('invSearch').value || '').trim().toLowerCase();
        var monthFilter = document.getElementById('invMonthFilter').value || '';

        var filtered = invoicesList.filter(function(inv) {
            var matchSearch = !term ||
                (inv.clientName || '').toLowerCase().indexOf(term) > -1 ||
                String(inv.invoiceNumber || '').indexOf(term) > -1;
            var matchMonth = !monthFilter || (inv.date || '').slice(0, 7) === monthFilter;
            return matchSearch && matchMonth;
        });

        renderInvoicesTable(filtered);
    }, 200);
}

function renderInvoicesTable(list) {
    var tbody = document.getElementById('invTableBody');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:24px;">לא נמצאו חשבונות</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(function(inv) {
        var subtotal = parseFloat(inv.subtotal) || 0;
        var vat = parseFloat(inv.vatAmount) || 0;
        var total = parseFloat(inv.total) || 0;
        var statusClass = inv.status === 'שולם' ? 'paid' : (inv.status === 'נשלח' ? 'sent' : 'draft');
        var statusText = inv.status || 'טיוטה';
        var dateStr = inv.date ? new Date(inv.date).toLocaleDateString('he-IL') : '';

        return '<tr>' +
            '<td><strong>' + (inv.invoiceNumber || '') + '</strong></td>' +
            '<td>' + dateStr + '</td>' +
            '<td>' + (inv.clientName || '') + '</td>' +
            '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (inv.subject || '') + '</td>' +
            '<td style="font-weight:600;">₪' + subtotal.toLocaleString('he-IL') + '</td>' +
            '<td>₪' + vat.toLocaleString('he-IL') + '</td>' +
            '<td style="font-weight:700;color:#0f172a;">₪' + total.toLocaleString('he-IL') + '</td>' +
            '<td><span class="inv-badge ' + statusClass + '">' + statusText + '</span></td>' +
            '<td style="white-space:nowrap;">' +
                '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
                    '<button class="inv-action-btn primary" onclick="downloadInvoicePDF(\'' + inv.id + '\')">PDF</button>' +
                    '<button class="inv-action-btn whatsapp" onclick="sendInvoiceWhatsApp(\'' + inv.id + '\')">WhatsApp</button>' +
                    '<button class="inv-action-btn" onclick="sendInvoiceEmail(\'' + inv.id + '\')">מייל</button>' +
                    '<button class="inv-action-btn" onclick="toggleInvoiceStatus(\'' + inv.id + '\')">' +
                        (inv.status === 'שולם' ? 'בטל שולם' : 'סמן שולם') +
                    '</button>' +
                    '<button class="inv-action-btn danger" onclick="deleteInvoice(\'' + inv.id + '\')">מחק</button>' +
                '</div>' +
            '</td>' +
        '</tr>';
    }).join('');
}

// ========== Invoice Modal ==========
var invClientSearchTimeout = null;

function openInvoiceModal() {
    document.getElementById('invModalOverlay').classList.add('show');
    // Reset form
    document.getElementById('invClientSearch').value = '';
    document.getElementById('invClientName').value = '';
    document.getElementById('invClientIdNumber').value = '';
    document.getElementById('invClientPhone').value = '';
    document.getElementById('invClientEmail').value = '';
    document.getElementById('invBillingClientId').value = '';
    document.getElementById('invDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('invDueDate').value = '';
    document.getElementById('invAttorney').value = '';
    document.getElementById('invSubject').value = '';
    document.getElementById('invAutocomplete').style.display = 'none';

    // Reset line items to one empty row
    document.getElementById('invLineItems').innerHTML =
        '<tr class="inv-line-row">' +
            '<td><input type="text" class="inv-line-desc" placeholder="תיאור השירות"></td>' +
            '<td><input type="number" class="inv-line-qty" value="1" min="0" step="0.01" onchange="calcInvoiceTotals()" oninput="calcInvoiceTotals()"></td>' +
            '<td><input type="number" class="inv-line-price" value="0" min="0" step="0.01" onchange="calcInvoiceTotals()" oninput="calcInvoiceTotals()"></td>' +
            '<td class="inv-line-total">₪0</td>' +
            '<td><button class="inv-remove-line" onclick="removeInvoiceLine(this)" title="הסר שורה">✕</button></td>' +
        '</tr>';
    calcInvoiceTotals();

    // Get next invoice number
    getNextInvoiceNumber();

    // Restore form view
    document.getElementById('invModalBody').style.display = '';
    document.getElementById('invModalFooter').style.display = '';
    document.getElementById('invModalTitle').textContent = 'חשבון עסקה חדש';
}

function closeInvoiceModal() {
    document.getElementById('invModalOverlay').classList.remove('show');
}

async function getNextInvoiceNumber() {
    try {
        var snap = await db.collection('invoices')
            .orderBy('invoiceNumber', 'desc')
            .limit(1)
            .get();

        var nextNum = 1; // default - start from 1
        if (!snap.empty) {
            var lastNum = parseInt(snap.docs[0].data().invoiceNumber) || 0;
            nextNum = lastNum + 1;
        }
        document.getElementById('invNumber').value = nextNum;
    } catch (e) {
        document.getElementById('invNumber').value = 1;
    }
}

// Autocomplete from billing clients
document.getElementById('invClientSearch').addEventListener('input', function(e) {
    var term = e.target.value.trim();
    clearTimeout(invClientSearchTimeout);
    var autocomplete = document.getElementById('invAutocomplete');

    if (term.length < 2) {
        autocomplete.style.display = 'none';
        return;
    }

    invClientSearchTimeout = setTimeout(async function() {
        try {
            var snap = await db.collection('recurring_billing').get();
            var results = [];
            snap.forEach(function(doc) {
                var d = doc.data();
                if ((d.clientName || '').indexOf(term) > -1 ||
                    (d.idNumber || '').indexOf(term) > -1 ||
                    (d.phone || '').indexOf(term) > -1) {
                    results.push({ id: doc.id, ...d });
                }
            });

            if (results.length === 0) {
                autocomplete.style.display = 'none';
                return;
            }

            autocomplete.innerHTML = results.slice(0, 8).map(function(r) {
                return '<div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:13px;" ' +
                    'onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'white\'" ' +
                    'onclick="selectInvClient(\'' + r.id + '\',\'' + (r.clientName || '').replace(/'/g, "\\'") + '\',\'' + (r.idNumber || '') + '\',\'' + (r.phone || '') + '\',\'' + (r.email || '') + '\')">' +
                    '<strong>' + (r.clientName || '') + '</strong>' +
                    (r.idNumber ? ' <span style="color:#94a3b8;">(' + r.idNumber + ')</span>' : '') +
                '</div>';
            }).join('');
            autocomplete.style.display = 'block';
        } catch (err) {
            autocomplete.style.display = 'none';
        }
    }, 300);
});

function selectInvClient(id, name, idNumber, phone, email) {
    document.getElementById('invClientName').value = name;
    document.getElementById('invClientIdNumber').value = idNumber;
    document.getElementById('invClientPhone').value = phone;
    document.getElementById('invClientEmail').value = email;
    document.getElementById('invBillingClientId').value = id;
    document.getElementById('invClientSearch').value = name;
    document.getElementById('invAutocomplete').style.display = 'none';
}

function addInvoiceLine() {
    var tbody = document.getElementById('invLineItems');
    var row = document.createElement('tr');
    row.className = 'inv-line-row';
    row.innerHTML =
        '<td><input type="text" class="inv-line-desc" placeholder="תיאור השירות"></td>' +
        '<td><input type="number" class="inv-line-qty" value="1" min="0" step="0.01" onchange="calcInvoiceTotals()" oninput="calcInvoiceTotals()"></td>' +
        '<td><input type="number" class="inv-line-price" value="0" min="0" step="0.01" onchange="calcInvoiceTotals()" oninput="calcInvoiceTotals()"></td>' +
        '<td class="inv-line-total">₪0</td>' +
        '<td><button class="inv-remove-line" onclick="removeInvoiceLine(this)" title="הסר שורה">✕</button></td>';
    tbody.appendChild(row);
}

function removeInvoiceLine(btn) {
    var rows = document.querySelectorAll('.inv-line-row');
    if (rows.length <= 1) return; // keep at least one row
    btn.closest('tr').remove();
    calcInvoiceTotals();
}

function calcInvoiceTotals() {
    var rows = document.querySelectorAll('.inv-line-row');
    var subtotal = 0;

    rows.forEach(function(row) {
        var qty = parseFloat(row.querySelector('.inv-line-qty').value) || 0;
        var price = parseFloat(row.querySelector('.inv-line-price').value) || 0;
        var lineTotal = qty * price;
        row.querySelector('.inv-line-total').textContent = '₪' + lineTotal.toLocaleString('he-IL');
        subtotal += lineTotal;
    });

    var vatRate = 18;
    var vatAmount = Math.round(subtotal * vatRate / 100);
    var grandTotal = subtotal + vatAmount;

    document.getElementById('invSubtotal').textContent = '₪' + subtotal.toLocaleString('he-IL');
    document.getElementById('invVatAmount').textContent = '₪' + vatAmount.toLocaleString('he-IL');
    document.getElementById('invGrandTotal').textContent = '₪' + grandTotal.toLocaleString('he-IL');
}

async function submitInvoice() {
    var clientName = document.getElementById('invClientName').value.trim();
    var invDate = document.getElementById('invDate').value;
    var subject = document.getElementById('invSubject').value.trim();

    if (!clientName || !invDate || !subject) {
        alert('נא למלא שם לקוח, תאריך ונושא');
        return;
    }

    var btn = document.getElementById('invSubmitBtn');
    btn.disabled = true;
    document.getElementById('invSubmitText').textContent = 'שומר...';

    try {
        // Collect line items
        var rows = document.querySelectorAll('.inv-line-row');
        var lineItems = [];
        var subtotal = 0;

        rows.forEach(function(row) {
            var desc = row.querySelector('.inv-line-desc').value.trim();
            var qty = parseFloat(row.querySelector('.inv-line-qty').value) || 0;
            var price = parseFloat(row.querySelector('.inv-line-price').value) || 0;
            var total = qty * price;
            if (desc || total > 0) {
                lineItems.push({ description: desc, quantity: qty, unitPrice: price, total: total });
                subtotal += total;
            }
        });

        if (lineItems.length === 0) {
            alert('נא להוסיף לפחות שורת פירוט אחת');
            btn.disabled = false;
            document.getElementById('invSubmitText').textContent = 'שמור ויצור PDF';
            return;
        }

        var vatRate = 18;
        var vatAmount = Math.round(subtotal * vatRate / 100);
        var grandTotal = subtotal + vatAmount;
        var invoiceNumber = parseInt(document.getElementById('invNumber').value) || 1;

        var invoiceData = {
            invoiceNumber: invoiceNumber,
            date: invDate,
            dueDate: document.getElementById('invDueDate').value || '',
            clientName: clientName,
            clientIdNumber: document.getElementById('invClientIdNumber').value || '',
            clientPhone: document.getElementById('invClientPhone').value || '',
            clientEmail: document.getElementById('invClientEmail').value || '',
            billingClientId: document.getElementById('invBillingClientId').value || null,
            attorney: document.getElementById('invAttorney').value || '',
            subject: subject,
            lineItems: lineItems,
            subtotal: subtotal,
            vatRate: vatRate,
            vatAmount: vatAmount,
            total: grandTotal,
            status: 'טיוטה',
            createdBy: authUser ? authUser.email : (currentUser || 'לא ידוע'),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        var docRef = await db.collection('invoices').add(invoiceData);

        // Show success + generate PDF
        document.getElementById('invModalBody').innerHTML =
            '<div style="text-align:center;padding:30px 0;">' +
                '<div style="width:60px;height:60px;background:#d1fae5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;color:#16a34a;">✓</div>' +
                '<h3 style="margin:0 0 8px;color:#1f2937;">חשבון עסקה ' + invoiceNumber + ' נוצר בהצלחה!</h3>' +
                '<p style="color:#6b7280;margin:0 0 4px;">' + clientName + '</p>' +
                '<p style="color:#0f172a;font-weight:700;font-size:18px;margin:0;">סה"כ לתשלום: ₪' + grandTotal.toLocaleString('he-IL') + '</p>' +
                '<div style="margin-top:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
                    '<button class="inv-new-btn" onclick="downloadInvoicePDF(\'' + docRef.id + '\')" style="font-size:13px;padding:8px 16px;">הורד PDF</button>' +
                    '<button class="inv-action-btn whatsapp" onclick="sendInvoiceWhatsApp(\'' + docRef.id + '\')" style="padding:8px 16px;">שלח WhatsApp</button>' +
                    '<button class="inv-action-btn" onclick="sendInvoiceEmail(\'' + docRef.id + '\')" style="padding:8px 16px;">שלח מייל</button>' +
                '</div>' +
            '</div>';
        document.getElementById('invModalFooter').innerHTML =
            '<button class="inv-new-btn" onclick="closeInvoiceModal();loadInvoicesData();" style="width:100%;">סגור</button>';

    } catch (error) {
        console.error('Error saving invoice:', error);
        alert('שגיאה בשמירה: ' + error.message);
        btn.disabled = false;
        document.getElementById('invSubmitText').textContent = 'שמור ויצור PDF';
    }
}

// ========== Invoice Actions ==========
async function toggleInvoiceStatus(docId) {
    var inv = invoicesList.find(function(i) { return i.id === docId; });
    if (!inv) return;
    var newStatus = inv.status === 'שולם' ? 'נשלח' : 'שולם';
    try {
        await db.collection('invoices').doc(docId).update({ status: newStatus });
        loadInvoicesData();
    } catch (e) {
        alert('שגיאה: ' + e.message);
    }
}

async function deleteInvoice(docId) {
    if (!confirm('האם למחוק חשבון עסקה זה? פעולה זו לא ניתנת לביטול.')) return;
    try {
        await db.collection('invoices').doc(docId).delete();
        loadInvoicesData();
    } catch (e) {
        alert('שגיאה: ' + e.message);
    }
}

function sendInvoiceWhatsApp(docId) {
    var inv = invoicesList.find(function(i) { return i.id === docId; });
    if (!inv) return;
    var phone = (inv.clientPhone || '').replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '972' + phone.slice(1);
    var text = 'שלום ' + (inv.clientName || '') + ',\n' +
        'מצורף חשבון עסקה מספר ' + inv.invoiceNumber + '\n' +
        'סה"כ לתשלום: ₪' + (inv.total || 0).toLocaleString('he-IL') + '\n' +
        'בברכה, משרד עו"ד גיא הרשקוביץ';
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank');

    // Update status to sent
    if (inv.status === 'טיוטה') {
        db.collection('invoices').doc(docId).update({ status: 'נשלח' });
        inv.status = 'נשלח';
        renderInvoicesTable(invoicesList);
    }
}

function sendInvoiceEmail(docId) {
    var inv = invoicesList.find(function(i) { return i.id === docId; });
    if (!inv) return;
    var email = inv.clientEmail || '';
    var subject = 'חשבון עסקה ' + inv.invoiceNumber + ' - משרד עו"ד גיא הרשקוביץ';
    var body = 'שלום ' + (inv.clientName || '') + ',\n\n' +
        'מצורף חשבון עסקה מספר ' + inv.invoiceNumber + '\n' +
        'נושא: ' + (inv.subject || '') + '\n' +
        'סה"כ לתשלום: ₪' + (inv.total || 0).toLocaleString('he-IL') + '\n\n' +
        'בברכה,\nמשרד עו"ד גיא הרשקוביץ\n' +
        'טלפון: 03-685-55-58\n' +
        'מייל: ACC@ghlawoffice.co.il';
    window.open('mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank');

    if (inv.status === 'טיוטה') {
        db.collection('invoices').doc(docId).update({ status: 'נשלח' });
        inv.status = 'נשלח';
        renderInvoicesTable(invoicesList);
    }
}

// ========== Invoice PDF Generation ==========
// Logo as base64 data URI
var INV_LOGO_BASE64 = 'data:image/png;base64,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';

async function downloadInvoicePDF(docId) {
    var inv = invoicesList.find(function(i) { return i.id === docId; });
    if (!inv) {
        var doc = await db.collection('invoices').doc(docId).get();
        if (!doc.exists) { alert('חשבון לא נמצא'); return; }
        inv = { id: doc.id, ...doc.data() };
    }

    var dateStr = inv.date ? new Date(inv.date).toLocaleDateString('he-IL') : '';
    var dueDateStr = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('he-IL') : '';
    var nowStr = new Date().toLocaleString('he-IL');

    var gold = '#c5a14e';

    var linesHtml = '';
    (inv.lineItems || []).forEach(function(item) {
        linesHtml +=
            '<tr>' +
                '<td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:right;font-size:14px;">' + (item.description || '') + '</td>' +
                '<td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:center;font-size:14px;">' + (item.quantity || 0) + '</td>' +
                '<td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:center;font-size:14px;">' + Number(item.unitPrice || 0).toLocaleString('he-IL') + ' &#8362;</td>' +
                '<td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:center;font-size:14px;font-weight:600;">' + Number(item.total || 0).toLocaleString('he-IL') + ' &#8362;</td>' +
            '</tr>';
    });

    var html =
    '<div style="font-family:Heebo,Arial,sans-serif;direction:rtl;width:760px;background:#fff;overflow:hidden;">' +

        // Header
        '<div style="padding:36px 36px 24px;">' +
            '<table style="width:100%;border-collapse:collapse;"><tr>' +
                '<td style="width:110px;vertical-align:top;">' +
                    '<img src="' + INV_LOGO_BASE64 + '" style="width:95px;">' +
                '</td>' +
                '<td style="vertical-align:top;text-align:center;padding:0 12px;">' +
                    '<div style="font-size:17px;font-weight:700;color:#222;margin-bottom:8px;">גיא הרשקוביץ חברת עורכי דין</div>' +
                    '<div style="font-size:11px;color:#888;line-height:1.9;">' +
                        'עוסק מורשה (ח.פ): 515577161<br>' +
                        'מנחם בגין 144, מגדל מידטאון, תל אביב - יפו<br>' +
                        'טל: 03-685-55-58 | פקס: 03-620-77-71<br>' +
                        'ACC@ghlawoffice.co.il | ghlawoffice.co.il' +
                    '</div>' +
                '</td>' +
                '<td style="width:180px;vertical-align:top;text-align:right;">' +
                    '<div style="font-size:10px;color:#999;margin-bottom:8px;">לכבוד</div>' +
                    '<div style="font-size:16px;font-weight:700;color:#222;margin-bottom:4px;">' + (inv.clientName || '') + '</div>' +
                    (inv.clientIdNumber ? '<div style="font-size:12px;color:#888;margin-bottom:2px;">ח.פ/ת.ז: ' + inv.clientIdNumber + '</div>' : '') +
                    (inv.clientPhone ? '<div style="font-size:12px;color:#888;">טלפון: ' + inv.clientPhone + '</div>' : '') +
                '</td>' +
            '</tr></table>' +
        '</div>' +

        // Thin gold line
        '<div style="height:2px;background:' + gold + ';margin:0 36px;"></div>' +

        // Title + date
        '<div style="padding:22px 36px;">' +
            '<table style="width:100%;border-collapse:collapse;"><tr>' +
                '<td style="text-align:right;">' +
                    '<span style="font-size:24px;font-weight:700;color:#222;">חשבון עסקה ' + inv.invoiceNumber + '</span>' +
                    '<span style="font-size:12px;color:#aaa;margin-right:14px;">מקור</span>' +
                '</td>' +
                '<td style="text-align:left;font-size:13px;color:#888;">' +
                    dateStr +
                    (dueDateStr ? '<br>לתשלום עד: ' + dueDateStr : '') +
                '</td>' +
            '</tr></table>' +
        '</div>' +

        // Subject
        (inv.subject ? '<div style="padding:0 36px 20px;font-size:14px;color:#555;">בגין: ' + inv.subject + '</div>' : '') +

        // Table - clean, no colored header
        '<div style="padding:0 36px;">' +
            '<table style="width:100%;border-collapse:collapse;">' +
                '<thead><tr style="border-bottom:2px solid #222;">' +
                    '<th style="padding:12px 16px;text-align:right;font-size:13px;font-weight:600;color:#222;">פירוט</th>' +
                    '<th style="padding:12px 16px;text-align:center;font-size:13px;font-weight:600;color:#222;width:70px;">כמות</th>' +
                    '<th style="padding:12px 16px;text-align:center;font-size:13px;font-weight:600;color:#222;width:100px;">מחיר ליחידה</th>' +
                    '<th style="padding:12px 16px;text-align:center;font-size:13px;font-weight:600;color:#222;width:100px;">סה"כ</th>' +
                '</tr></thead>' +
                '<tbody>' + linesHtml + '</tbody>' +
            '</table>' +
        '</div>' +

        // Totals - LEFT side (for numbers in RTL)
        '<div style="padding:24px 36px 20px;">' +
            '<table style="width:280px;border-collapse:collapse;margin-left:0;margin-right:auto;">' +
                '<tr><td style="padding:8px 16px;font-size:14px;color:#888;text-align:right;">סה"כ לפני מע"מ</td><td style="padding:8px 16px;font-size:14px;font-weight:600;text-align:left;width:110px;">' + Number(inv.subtotal || 0).toLocaleString('he-IL') + ' &#8362;</td></tr>' +
                '<tr><td style="padding:8px 16px;font-size:14px;color:#888;text-align:right;">מע"מ 18%</td><td style="padding:8px 16px;font-size:14px;text-align:left;">' + Number(inv.vatAmount || 0).toLocaleString('he-IL') + ' &#8362;</td></tr>' +
                '<tr><td colspan="2" style="padding:0;"><div style="border-top:1px solid #ddd;margin:6px 0;"></div></td></tr>' +
                '<tr><td style="padding:10px 16px;font-size:17px;font-weight:700;color:#222;text-align:right;">סה"כ לתשלום</td><td style="padding:10px 16px;font-size:20px;font-weight:700;color:' + gold + ';text-align:left;">' + Number(inv.total || 0).toLocaleString('he-IL') + ' &#8362;</td></tr>' +
            '</table>' +
        '</div>' +

        // Separator
        '<div style="padding:0 36px;"><div style="border-top:1px solid #eee;margin:10px 0 24px;"></div></div>' +

        // Payment info - plain text, no boxes
        '<div style="padding:0 36px 30px;font-size:13px;color:#666;line-height:2.2;">' +
            '<div style="font-size:15px;font-weight:700;color:#222;margin-bottom:10px;">שלום, ' + (inv.clientName || '').split(' ')[0] + '</div>' +
            'מצורף חשבון עסקה בגין ' + (inv.subject || '') + '.<br>' +
            'ניתן להסדיר את התשלום באחת מהדרכים הבאות:<br><br>' +
            '<b>כרטיס אשראי</b> - עד 4 תשלומים<br>' +
            '<b>העברה בנקאית</b> - בנק מזרחי טפחות, סניף 421, חשבון 333177<br>' +
            'ע"ש: גיא הרשקוביץ חברת עורכי דין<br><br>' +
            '<span style="font-size:11px;color:#bbb;">* לאחר ביצוע העברה בנקאית, יש להעביר אסמכתא למשרד לצורך שיוך התשלום.</span>' +
        '</div>' +

        // Footer
        '<div style="border-top:1px solid #eee;padding:14px 36px;font-size:10px;color:#ccc;">' +
            '<table style="width:100%;border-collapse:collapse;"><tr>' +
                '<td>הופק ב-' + nowStr + ' | חשבון עסקה ' + inv.invoiceNumber + '</td>' +
                '<td style="text-align:left;">חתימה דיגיטלית מאובטחת</td>' +
            '</tr></table>' +
        '</div>' +

    '</div>';

    var preview = document.getElementById('invPdfPreview');
    preview.innerHTML = html;
    preview.style.display = 'block';

    try {
        var canvas = await html2canvas(preview, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 760,
            windowWidth: 760
        });

        var imgData = canvas.toDataURL('image/jpeg', 0.95);
        var jsPDFLib = window.jspdf || window.jsPDF;
        if (!jsPDFLib) { throw new Error('jsPDF library not loaded'); }
        var jsPDFClass = jsPDFLib.jsPDF || jsPDFLib;
        var pdf = new jsPDFClass('p', 'mm', 'a4');
        var pdfWidth = pdf.internal.pageSize.getWidth();
        var pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        var pageHeight = pdf.internal.pageSize.getHeight();
        if (pdfHeight <= pageHeight) {
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        } else {
            var position = 0;
            var remaining = pdfHeight;
            while (remaining > 0) {
                pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
                remaining -= pageHeight;
                if (remaining > 0) {
                    position -= pageHeight;
                    pdf.addPage();
                }
            }
        }

        pdf.save('חשבון_עסקה_' + inv.invoiceNumber + '.pdf');
    } catch (err) {
        console.error('Error generating PDF:', err);
        alert('שגיאה ביצירת PDF: ' + err.message);
    }

    preview.style.display = 'none';
    preview.innerHTML = '';
}
