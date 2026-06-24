// ========== File Upload Handler ==========

// Security: allowed file types and size limit
var ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf'];
var MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

// File Upload Preview Handler
document.getElementById('checksPhoto').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (file) {
        // Validate file type before preview
        if (ALLOWED_UPLOAD_TYPES.indexOf(file.type) === -1) {
            alert('סוג קובץ לא מורשה. ניתן להעלות תמונות (JPEG, PNG, GIF, WebP, HEIC) ו-PDF בלבד.');
            e.target.value = '';
            return;
        }

        // Validate file size before preview
        if (file.size > MAX_UPLOAD_SIZE) {
            alert('הקובץ גדול מדי. גודל מקסימלי: 10MB. גודל הקובץ: ' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
            e.target.value = '';
            return;
        }

        var container = document.getElementById('checksUploadContainer');
        var preview = document.getElementById('checksPreview');
        var fileName = document.getElementById('checksFileName');
        var image = document.getElementById('checksImage');

        container.classList.add('has-file');
        fileName.textContent = '\u2713 ' + file.name;

        var reader = new FileReader();
        reader.onload = function(ev) {
            image.src = ev.target.result;
            preview.classList.add('show');
        };
        reader.readAsDataURL(file);

        // Show OCR button after file upload
        var ocrArea = document.getElementById('ocrActionArea');
        if (ocrArea) {
            ocrArea.style.display = 'block';
        }
    }
});

function clearChecksFile() {
    var fileInput = document.getElementById('checksPhoto');
    var container = document.getElementById('checksUploadContainer');
    var preview = document.getElementById('checksPreview');
    var ocrArea = document.getElementById('ocrActionArea');

    if (fileInput) fileInput.value = '';
    if (container) container.classList.remove('has-file');
    if (preview) preview.classList.remove('show');
    if (ocrArea) ocrArea.style.display = 'none';
}

// Generate UUID for secure filenames
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Upload File to Firebase Storage
async function uploadFile(file, path) {
    if (!file) return null;

    // Validate file type
    if (ALLOWED_UPLOAD_TYPES.indexOf(file.type) === -1) {
        alert('סוג קובץ לא מורשה. ניתן להעלות תמונות ו-PDF בלבד.');
        throw new Error('Invalid file type');
    }

    // Validate file size
    if (file.size > MAX_UPLOAD_SIZE) {
        alert('הקובץ גדול מדי. גודל מקסימלי: 10MB.');
        throw new Error('File too large');
    }

    // Generate secure filename with UUID
    var uuid = generateUUID();
    var ext = file.name.split('.').pop().toLowerCase();
    var safeExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'pdf'];
    if (safeExtensions.indexOf(ext) === -1) ext = 'bin';
    var safePath = path.split('/')[0] + '/' + uuid + '.' + ext;

    try {
        var storageRef = storage.ref();
        var fileRef = storageRef.child(safePath);

        var uploadTask = await fileRef.put(file, {
            contentType: file.type,
            customMetadata: {
                'uploadedBy': authUser ? authUser.email : 'unauthenticated',
                'uploadDate': new Date().toISOString(),
                'originalName': file.name.substring(0, 100)
            }
        });

        var downloadURL = await uploadTask.ref.getDownloadURL();
        return downloadURL;
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('שגיאה בהעלאת הקובץ. נסה שנית.');
        throw error;
    }
}

// Form Submission
var _submittingForm = false;
document.getElementById('salesForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    // מניעת שליחה כפולה
    if (_submittingForm) return;

    if (!validateStep(4)) return;

    // ולידציה מחדש של כל השלבים — ניווט לשלב הבעייתי אם נכשל
    for (var vStep = 1; vStep <= 3; vStep++) {
        if (!validateStep(vStep)) {
            showStep(vStep);
            return;
        }
    }

    // ולידציית טלפון ות.ז
    var phoneVal = (document.getElementById('phone').value || '').trim();
    if (phoneVal && !validateIsraeliPhone(phoneVal)) {
        await tofesAlert('מספר טלפון לא תקין. נא להזין מספר ישראלי (לדוגמה: 0501234567)', { icon: 'error', title: 'טלפון שגוי' });
        showStep(1);
        return;
    }
    var idVal = (document.getElementById('idNumber').value || '').trim();
    if (idVal && !validateIsraeliId(idVal)) {
        await tofesAlert('מספר ת.ז/ח.פ לא תקין. נא לבדוק את המספר ולנסות שוב.', { icon: 'error', title: 'ת.ז שגוי' });
        showStep(1);
        return;
    }

    // ולידציית תשלום מפוצל
    var selectedPayment = document.querySelector('input[name="paymentMethod"]:checked');
    if (selectedPayment && selectedPayment.value === 'פיצול תשלום') {
        var splitRows = document.querySelectorAll('.split-payment-row');
        var splitTotal = 0;
        splitRows.forEach(function(row) {
            splitTotal += parseAmount(row.querySelector('.split-payment-amount').value);
        });
        splitTotal = roundMoney(splitTotal);
        var amountForCheck = parseAmount(document.getElementById('amount').value);
        var totalRequiredForCheck = roundMoney(amountForCheck * (1 + VAT_RATE));
        if (Math.abs(totalRequiredForCheck - splitTotal) > 0.01) {
            await tofesAlert('סכום התשלומים המפוצלים (₪' + formatMoney(splitTotal) + ') לא תואם את סה"כ העסקה (₪' + formatMoney(totalRequiredForCheck) + ')', { icon: 'error', title: 'אי-התאמת סכומים' });
            showStep(3);
            return;
        }
    }

    _submittingForm = true;
    const submitBtn = document.getElementById('submitBtn');
    const submitText = document.getElementById('submitText');
    const submitSpinner = document.getElementById('submitSpinner');

    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitSpinner.classList.remove('hidden');

    try {
        const transactionType = document.getElementById('transactionType').value;
        const amountBeforeVat = roundMoney(parseAmount(document.getElementById('amount').value));
        const vatAmount = roundMoney(amountBeforeVat * VAT_RATE);
        const amountWithVat = roundMoney(amountBeforeVat + vatAmount);

        let transactionDescription = document.getElementById('transactionDescription').value;

        // If hours package, build description from hours and rate
        if (transactionType === '\u05EA\u05D5\u05DB\u05E0\u05D9\u05EA \u05E9\u05E2\u05D5\u05EA') {
            const hours = document.getElementById('hoursQuantity').value;
            const rate = document.getElementById('hourlyRate').value;
            transactionDescription = `\u05EA\u05D5\u05DB\u05E0\u05D9\u05EA ${hours} \u05E9\u05E2\u05D5\u05EA \u05D1\u05DE\u05D7\u05D9\u05E8 \u20AA${rate} \u05DC\u05E9\u05E2\u05D4`;
        }

        // Upload checks photo if exists
        let checksPhotoURL = '';
        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || '';

        if (paymentMethod === '\u05E9\u05D9\u05E7\u05D9\u05DD \u05D3\u05D7\u05D5\u05D9\u05D9\u05DD') {
            const checksPhotoFile = document.getElementById('checksPhoto').files[0];
            if (checksPhotoFile) {
                const fileName = `checks/${checksPhotoFile.name}`;
                checksPhotoURL = await uploadFile(checksPhotoFile, fileName);
            }
        }

        // Handle split payment data
        let paymentBreakdown = '';
        let paymentBreakdownText = '';
        let isSplitPayment = false;

        if (paymentMethod === '\u05E4\u05D9\u05E6\u05D5\u05DC \u05EA\u05E9\u05DC\u05D5\u05DD') {
            isSplitPayment = true;
            const splitPayments = await getSplitPaymentData();
            paymentBreakdown = JSON.stringify(splitPayments);

            // Create detailed readable text for payment breakdown
            paymentBreakdownText = splitPayments.map(p => {
                let text = `${p.method}: \u20AA${p.amount.toLocaleString('he-IL', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

                // Add additional details
                if (p.method === '\u05DB\u05E8\u05D8\u05D9\u05E1 \u05D0\u05E9\u05E8\u05D0\u05D9' && p.creditCardStatus) {
                    if (p.creditCardStatus === '\u05D7\u05D9\u05D5\u05D1 \u05DE\u05DC\u05D0' && p.paymentsCount) {
                        text += ` (${p.paymentsCount} \u05EA\u05E9\u05DC\u05D5\u05DE\u05D9\u05DD)`;
                    } else if (p.creditCardStatus === '\u05E4\u05D9\u05E7\u05D3\u05D5\u05DF' && p.monthlyCharge) {
                        text += ` (\u20AA${p.monthlyCharge} \u00D7 ${p.monthsCount} \u05D7\u05D5\u05D3\u05E9\u05D9\u05DD)`;
                    }
                } else if (p.method === '\u05E9\u05D9\u05E7\u05D9\u05DD \u05D3\u05D7\u05D5\u05D9\u05D9\u05DD' && p.checksCount) {
                    text += ` (${p.checksCount} \u05E6'\u05E7\u05D9\u05DD)`;
                }

                return text;
            }).join(' + ');
        }

        // תאריך עסקה: שדה משתמש (יכול להיות אחורה), fallback להיום
        var todayIL = getTodayIL();
        var userTransactionDate = document.getElementById('transactionDate').value || todayIL;
        // הגנה: לא לאפשר עתיד גם ב-submit
        if (userTransactionDate > todayIL) userTransactionDate = todayIL;
        var isBackdated = userTransactionDate !== todayIL;

        const formData = {
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            date: userTransactionDate,
            reportedDate: todayIL,
            isBackdated: isBackdated,
            formFillerName: currentUser,
            clientName: document.getElementById('clientName').value,
            phone: document.getElementById('phone').value,
            email: document.getElementById('email').value,
            idNumber: document.getElementById('idNumber').value,
            address: document.getElementById('address').value || '',
            clientStatus: document.querySelector('input[name="clientStatus"]:checked')?.value || '\u05D7\u05D3\u05E9',
            transactionType: transactionType,
            transactionDescription: transactionDescription,
            hoursQuantity: document.getElementById('hoursQuantity').value || '',
            hourlyRate: document.getElementById('hourlyRate').value || '',
            amountBeforeVat: amountBeforeVat,
            vatAmount: vatAmount,
            amountWithVat: amountWithVat,
            amount: amountBeforeVat, // Keep for backwards compatibility
            paymentMethod: paymentMethod,
            isSplitPayment: isSplitPayment,
            paymentBreakdown: paymentBreakdown,
            paymentBreakdownText: paymentBreakdownText,
            // Credit Card fields
            creditCardStatus: document.querySelector('input[name="creditCardStatus"]:checked')?.value || '',
            paymentsCount: document.getElementById('paymentsCount').value || '',
            monthlyCharge: document.getElementById('monthlyCharge').value || '',
            monthsCount: document.getElementById('monthsCount').value || '',
            depositDetails: document.getElementById('depositDetailsText').value || '',
            temporaryCreditDetails: document.getElementById('temporaryCreditText').value || '',
            // Recurring billing fields
            recurringBilling: document.querySelector('input[name="creditCardStatus"]:checked')?.value === '\u05D7\u05D9\u05D5\u05D1 \u05D7\u05D5\u05D3\u05E9\u05D9',
            recurringMonthlyAmount: document.getElementById('recurringMonthlyAmount').value || '',
            recurringMonthsCount: document.getElementById('recurringMonthsCount').value || '',
            recurringStartDate: document.getElementById('recurringStartDate').value || '',
            recurringDayOfMonth: document.getElementById('recurringDayOfMonth').value || '1',
            recurringNotes: document.getElementById('recurringNotes').value || '',
            // Checks fields
            checksCount: document.getElementById('checksCount').value || '',
            checksTotalAmount: document.getElementById('checksTotalAmount').value || '',
            checksPhotoURL: checksPhotoURL,
            checksDetailedList: collectChecksDetails(),
            checksDetails: document.getElementById('checksDetailsText').value || '',
            checkWillChange: document.querySelector('input[name="checkWillChange"]:checked')?.value || '',
            checkReplacementDetails: document.getElementById('checkReplacementText').value || '',
            attorney: document.getElementById('attorney').value,
            caseNumber: document.getElementById('caseNumber').value || '',
            branch: document.getElementById('branch').value,
            notes: document.getElementById('notes').value || '',
            invoiceNumber: '',
            receiptNumber: ''
        };

        // Link to clients collection
        var clientId = await getOrCreateClient({
            name: formData.clientName,
            phone: formData.phone,
            email: formData.email,
            idNumber: formData.idNumber,
            address: formData.address,
            attorney: formData.attorney,
            branch: formData.branch,
            caseNumber: formData.caseNumber,
            source: 'sales_form'
        });
        if (clientId) formData.clientId = clientId;
        formData.phone = normalizePhone(formData.phone);

        // Save to Firestore
        var docRef = await db.collection('sales_records').add(formData);
        logAuditEvent('sale_submitted', { clientName: formData.clientName, amount: formData.amountBeforeVat, type: formData.transactionType });

        // הפקת חשבונית (אוטומציה) — לא-חוסם: הטופס מצליח כרגיל גם אם ההפקה נכשלת.
        // השרת מחליט אם להפיק/לדחות/להמתין-לאישור (issue-invoice.js, fail-closed).
        if (typeof issueInvoiceForSale === 'function') {
            issueInvoiceForSale(docRef.id).catch(function(e) { console.error('auto-invoice (form) failed:', e && e.message); });
        }

        // Sync to Google Sheets (include Firebase doc ID for future updates)
        formData.firebaseDocId = docRef.id;
        syncToSheets(formData);

        // Remember last used attorney and branch for next time
        if (formData.attorney) localStorage.setItem('tofes_lastAttorney', formData.attorney);
        if (formData.branch) localStorage.setItem('tofes_lastBranch', formData.branch);

        // Update success screen with sale details
        document.getElementById('summaryClientName').textContent = formData.clientName;
        document.getElementById('summaryTransactionType').textContent = formData.transactionType;

        // Handle payment method display for split payment
        if (formData.isSplitPayment) {
            const splitPayments = JSON.parse(formData.paymentBreakdown);
            const paymentSummary = splitPayments.map(p => `${p.method}: \u20AA${p.amount.toLocaleString('he-IL')}`).join(', ');
            document.getElementById('summaryPaymentMethod').textContent = `\u05E4\u05D9\u05E6\u05D5\u05DC \u05EA\u05E9\u05DC\u05D5\u05DD (${paymentSummary})`;
        } else {
            document.getElementById('summaryPaymentMethod').textContent = formData.paymentMethod;
        }

        document.getElementById('summaryAmount').textContent = formData.amountWithVat.toLocaleString('he-IL', {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // הצגת תאריך עסקה + badge backdated
        var sumDateRow = document.getElementById('summaryDateRow');
        var sumDate = document.getElementById('summaryDate');
        var sumBackdated = document.getElementById('summaryBackdatedBadge');
        var sumBackdatedDate = document.getElementById('summaryBackdatedDate');
        if (sumDateRow && sumDate) {
            sumDate.textContent = formData.date;
            sumDateRow.style.display = '';
        }
        if (formData.isBackdated && sumBackdated && sumBackdatedDate) {
            sumBackdatedDate.textContent = formData.date;
            sumBackdated.style.display = 'block';
        } else if (sumBackdated) {
            sumBackdated.style.display = 'none';
        }

        // Clear draft after successful submission
        if (typeof clearDraft === 'function') clearDraft();

        // Show success
        document.getElementById('mainForm').classList.add('hidden');
        document.getElementById('successScreen').classList.add('show');

    } catch (error) {
        console.error('Error submitting form:', error);
        alert('\u05D0\u05D9\u05E8\u05E2\u05D4 \u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E9\u05DC\u05D9\u05D7\u05EA \u05D4\u05D8\u05D5\u05E4\u05E1. \u05E0\u05E1\u05D4 \u05E9\u05E0\u05D9\u05EA.');
    } finally {
        _submittingForm = false;
        submitBtn.disabled = false;
        submitText.classList.remove('hidden');
        submitSpinner.classList.add('hidden');
    }
});

// Reset Form
function resetForm() {
    if (typeof clearDraft === 'function') clearDraft();
    document.getElementById('salesForm').reset();
    document.getElementById('successScreen').classList.remove('show');
    document.getElementById('mainForm').classList.remove('hidden');

    // Reset conditional fields
    document.getElementById('hoursPackageFields').classList.remove('show');
    document.getElementById('transactionDescriptionGroup').style.display = 'block';
    document.getElementById('vatDisplay').classList.remove('show');
    document.getElementById('creditCardConfirmation').classList.remove('show');
    document.getElementById('fullChargeDetails').classList.remove('show');
    document.getElementById('monthlyChargeDetails').classList.remove('show');
    document.getElementById('depositDetails').classList.remove('show');
    document.getElementById('temporaryCreditDetails').classList.remove('show');

    // Reset recurring billing fields
    document.getElementById('recurringMonthlyAmount').value = '';
    document.getElementById('recurringMonthsCount').value = '';
    document.getElementById('recurringStartDate').value = '';
    document.getElementById('recurringDayOfMonth').value = '1';
    document.getElementById('recurringNotes').value = '';
    document.getElementById('checksDetails').classList.remove('show');
    document.getElementById('checkReplacementDetails').classList.remove('show');
    document.getElementById('splitPaymentDetails').classList.remove('show');
    document.getElementById('encouragementMessage').classList.add('hide');

    // Reset split payment rows
    document.getElementById('splitPaymentRows').innerHTML = '';
    splitPaymentRowCounter = 0;
    document.getElementById('splitPaymentSummary').style.display = 'none';

    // Reset file upload
    document.getElementById('checksUploadContainer').classList.remove('has-file');
    document.getElementById('checksPreview').classList.remove('show');
    document.getElementById('checksImage').src = '';
    document.getElementById('checksPhoto').value = '';
    var ocrArea = document.getElementById('ocrActionArea');
    if (ocrArea) ocrArea.style.display = 'none';

    // Reset dynamic check fields
    var checksContainer = document.getElementById('checksDetailsContainer');
    if (checksContainer) checksContainer.innerHTML = '';

    // Reset credit card sub-fields
    document.querySelectorAll('.conditional-subfield').forEach(function(el) {
        el.style.display = 'none';
    });

    // Reset error highlights
    document.querySelectorAll('.error, .error-highlight').forEach(function(el) {
        el.classList.remove('error');
        el.classList.remove('error-highlight');
    });

    // Remove validation toast if visible
    var toast = document.getElementById('validationErrorToast');
    if (toast) toast.remove();

    // Reset transactionDate ל-היום (Asia/Jerusalem)
    var dateEl = document.getElementById('transactionDate');
    if (dateEl) {
        var todayIL = getTodayIL();
        dateEl.value = todayIL;
        dateEl.setAttribute('max', todayIL);
    }

    // Reset to step 1
    showStep(1);
}
