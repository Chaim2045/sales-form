// ========== File Upload Handler ==========

// File Upload Handler
document.getElementById('checksPhoto').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const container = document.getElementById('checksUploadContainer');
        const preview = document.getElementById('checksPreview');
        const fileName = document.getElementById('checksFileName');
        const image = document.getElementById('checksImage');

        container.classList.add('has-file');
        fileName.textContent = '\u2713 ' + file.name;

        const reader = new FileReader();
        reader.onload = function(e) {
            image.src = e.target.result;
            preview.classList.add('show');
        };
        reader.readAsDataURL(file);
    }
});

// Upload File to Firebase Storage
async function uploadFile(file, path) {
    if (!file) return null;

    try {
        const storageRef = storage.ref();
        const fileRef = storageRef.child(path);

        // Upload file
        const uploadTask = await fileRef.put(file, {
            contentType: file.type,
            customMetadata: {
                'uploadedBy': currentUser,
                'uploadDate': new Date().toISOString()
            }
        });

        // Get download URL
        const downloadURL = await uploadTask.ref.getDownloadURL();
        return downloadURL;
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D4\u05E2\u05DC\u05D0\u05EA \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4: ' + error.message);
        throw error;
    }
}

// Form Submission
document.getElementById('salesForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!validateStep(4)) return;

    const submitBtn = document.getElementById('submitBtn');
    const submitText = document.getElementById('submitText');
    const submitSpinner = document.getElementById('submitSpinner');

    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitSpinner.classList.remove('hidden');

    try {
        const transactionType = document.getElementById('transactionType').value;
        const amountBeforeVat = parseFloat(document.getElementById('amount').value);
        const vatAmount = amountBeforeVat * 0.18;
        const amountWithVat = amountBeforeVat + vatAmount;

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
                const timestamp = Date.now();
                const fileName = `checks/${timestamp}_${checksPhotoFile.name}`;
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

            // Create detailed readable text for Google Sheets
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

        const formData = {
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            date: new Date().toISOString().split('T')[0],
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

        // Save to Firestore
        await db.collection('sales_records').add(formData);

        // Sync to Google Sheets
        await syncToSheets(formData);

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

        // Show success
        document.getElementById('mainForm').classList.add('hidden');
        document.getElementById('successScreen').classList.add('show');

    } catch (error) {
        console.error('Error submitting form:', error);
        alert('\u05D0\u05D9\u05E8\u05E2\u05D4 \u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E9\u05DC\u05D9\u05D7\u05EA \u05D4\u05D8\u05D5\u05E4\u05E1. \u05E0\u05E1\u05D4 \u05E9\u05E0\u05D9\u05EA.');
    } finally {
        submitBtn.disabled = false;
        submitText.classList.remove('hidden');
        submitSpinner.classList.add('hidden');
    }
});

// Reset Form
function resetForm() {
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

    // Reset to step 1
    showStep(1);
}
