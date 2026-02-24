// User Selection
function selectUser(userName) {
    currentUser = userName;
    document.getElementById('userSelection').classList.add('hidden');
    document.getElementById('mainForm').classList.remove('hidden');
}

// Step Navigation
function updateProgress() {
    const progressLine = document.getElementById('progressLine');
    const percentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
    progressLine.style.width = `${100 - percentage}%`;

    document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
        indicator.classList.remove('active', 'completed');
        if (index + 1 < currentStep) {
            indicator.classList.add('completed');
            indicator.innerHTML = '✓';
        } else if (index + 1 === currentStep) {
            indicator.classList.add('active');
            indicator.innerHTML = index + 1;
        } else {
            indicator.innerHTML = index + 1;
        }
    });

    document.querySelectorAll('.step-label').forEach((label, index) => {
        label.classList.toggle('active', index + 1 === currentStep);
    });
}

function showStep(step) {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.querySelector(`.form-step[data-step="${step}"]`).classList.add('active');
    currentStep = step;
    updateProgress();
}

function validateStep(step) {
    const stepElement = document.querySelector(`.form-step[data-step="${step}"]`);
    const requiredFields = stepElement.querySelectorAll('[required]');
    let isValid = true;

    requiredFields.forEach(field => {
        if (!field.value) {
            field.classList.add('error');
            isValid = false;
        } else {
            field.classList.remove('error');
        }
    });

    // Special validation for radio buttons in step 3
    if (step === 3) {
        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked');
        if (!paymentMethod) {
            isValid = false;
        }
    }

    // Special validation for amount field in step 2
    if (step === 2) {
        const amountField = document.getElementById('amount');
        const amountValue = parseAmount(amountField.value);
        if (amountValue <= 0) {
            amountField.classList.add('error');
            isValid = false;
        } else {
            amountField.classList.remove('error');
        }
    }

    return isValid;
}

function nextStep() {
    if (validateStep(currentStep)) {
        if (currentStep < totalSteps) {
            showStep(currentStep + 1);
        }
    }
}

function prevStep() {
    if (currentStep > 1) {
        showStep(currentStep - 1);
    }
}

// Transaction Type Change Handler
document.getElementById('transactionType').addEventListener('change', function() {
    const hoursPackageFields = document.getElementById('hoursPackageFields');
    const descriptionGroup = document.getElementById('transactionDescriptionGroup');
    const hoursQuantity = document.getElementById('hoursQuantity');
    const hourlyRate = document.getElementById('hourlyRate');

    if (this.value === 'תוכנית שעות') {
        hoursPackageFields.classList.add('show');
        descriptionGroup.style.display = 'none';
        document.getElementById('transactionDescription').removeAttribute('required');
        hoursQuantity.setAttribute('required', 'required');
        hourlyRate.setAttribute('required', 'required');
    } else {
        hoursPackageFields.classList.remove('show');
        descriptionGroup.style.display = 'block';
        document.getElementById('transactionDescription').setAttribute('required', 'required');
        hoursQuantity.removeAttribute('required');
        hourlyRate.removeAttribute('required');
        hoursQuantity.value = '';
        hourlyRate.value = '';
    }
});

// Hours Package Calculation
function updateAmountFromHours() {
    const hours = parseFloat(document.getElementById('hoursQuantity').value) || 0;
    const rate = parseFloat(document.getElementById('hourlyRate').value) || 0;
    const totalAmount = hours * rate;

    if (totalAmount > 0) {
        document.getElementById('amount').value = totalAmount.toFixed(2);
        updateVatDisplay();
    }
}

document.getElementById('hoursQuantity').addEventListener('input', updateAmountFromHours);
document.getElementById('hourlyRate').addEventListener('input', updateAmountFromHours);

// Collect checks details
function collectChecksDetails() {
    const count = parseInt(document.getElementById('checksCount').value) || 0;
    const checks = [];

    for (let i = 1; i <= count; i++) {
        const dateInput = document.getElementById(`check_date_${i}`);
        const amountInput = document.getElementById(`check_amount_${i}`);

        if (dateInput && amountInput) {
            checks.push({
                checkNumber: i,
                date: dateInput.value,
                amount: parseAmount(amountInput.value)
            });
        }
    }

    return JSON.stringify(checks);
}

// Checks Details - Dynamic Fields
document.getElementById('checksCount').addEventListener('input', function() {
    const count = parseInt(this.value) || 0;
    const container = document.getElementById('checksDetailsContainer');
    container.innerHTML = '';

    if (count > 0) {
        for (let i = 1; i <= count; i++) {
            const checkRow = document.createElement('div');
            checkRow.className = 'form-row';
            checkRow.style.marginBottom = '12px';
            checkRow.innerHTML = `
                <div class="form-group" style="flex: 1;">
                    <label>שיק ${i} - תאריך <span class="required">*</span></label>
                    <input type="date" id="check_date_${i}" class="check-date" required>
                </div>
                <div class="form-group" style="flex: 1;">
                    <label>שיק ${i} - סכום <span class="required">*</span></label>
                    <input type="number" id="check_amount_${i}" class="check-amount" placeholder="0" min="0" step="any" required>
                </div>
            `;
            container.appendChild(checkRow);
        }

        // Add event listeners for auto-calculation
        setTimeout(() => {
            for (let i = 1; i <= count; i++) {
                const amountInput = document.getElementById(`check_amount_${i}`);
                if (amountInput) {
                    amountInput.addEventListener('input', autoCalculateLastCheck);
                }
            }
        }, 100);
    }
});

// Auto-calculate last check amount
function autoCalculateLastCheck() {
    const checksCount = parseInt(document.getElementById('checksCount').value) || 0;
    if (checksCount <= 1) return;

    const totalAmount = parseAmount(document.getElementById('checksTotalAmount').value);
    if (totalAmount <= 0) return;

    let sum = 0;
    for (let i = 1; i < checksCount; i++) {
        const amountInput = document.getElementById(`check_amount_${i}`);
        if (amountInput) {
            sum += parseAmount(amountInput.value);
        }
    }

    const lastCheckAmount = totalAmount - sum;
    const lastCheckInput = document.getElementById(`check_amount_${checksCount}`);

    if (lastCheckInput && lastCheckAmount >= 0) {
        lastCheckInput.value = lastCheckAmount.toFixed(2);
    }
}

// Helper function to parse amount - handles commas and multiple decimal places
function parseAmount(value) {
    if (!value) return 0;
    // Remove commas and extra spaces
    const cleaned = value.toString().replace(/,/g, '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}

// VAT Calculation Display
function updateVatDisplay() {
    const amountBeforeVat = parseAmount(document.getElementById('amount').value);

    if (amountBeforeVat > 0) {
        const vatAmount = amountBeforeVat * 0.18;
        const amountWithVat = amountBeforeVat + vatAmount;

        document.getElementById('amountBeforeVat').textContent = '₪' + amountBeforeVat.toFixed(2);
        document.getElementById('vatAmount').textContent = '₪' + vatAmount.toFixed(2);
        document.getElementById('amountWithVat').textContent = '₪' + amountWithVat.toFixed(2);
        document.getElementById('vatDisplay').classList.add('show');
    } else {
        document.getElementById('vatDisplay').classList.remove('show');
    }
}

document.getElementById('amount').addEventListener('input', updateVatDisplay);

// Global variable for split payment rows
let splitPaymentRowCounter = 0;

// Payment Method Change Handler
document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const ccConfirm = document.getElementById('creditCardConfirmation');
        const checksDetail = document.getElementById('checksDetails');
        const splitPaymentDetail = document.getElementById('splitPaymentDetails');
        const checksPhoto = document.getElementById('checksPhoto');
        const checksCount = document.getElementById('checksCount');
        const checksTotalAmount = document.getElementById('checksTotalAmount');

        ccConfirm.classList.remove('show');
        checksDetail.classList.remove('show');
        splitPaymentDetail.classList.remove('show');

        // Show encouragement message based on payment method
        showEncouragementMessage(this.value);

        if (this.value === 'כרטיס אשראי') {
            ccConfirm.classList.add('show');
            updateAmountReminder('cc');
            checksPhoto.removeAttribute('required');
            checksCount.removeAttribute('required');
            checksTotalAmount.removeAttribute('required');
        } else if (this.value === 'שיקים דחויים') {
            checksDetail.classList.add('show');
            updateAmountReminder('checks');
            checksPhoto.setAttribute('required', 'required');
            checksCount.setAttribute('required', 'required');
            checksTotalAmount.setAttribute('required', 'required');
        } else if (this.value === 'פיצול תשלום') {
            splitPaymentDetail.classList.add('show');
            updateAmountReminder('split');
            checksPhoto.removeAttribute('required');
            checksCount.removeAttribute('required');
            checksTotalAmount.removeAttribute('required');

            // Initialize with one row if empty
            if (document.getElementById('splitPaymentRows').children.length === 0) {
                addSplitPaymentRow();
            }
        } else {
            checksPhoto.removeAttribute('required');
            checksCount.removeAttribute('required');
            checksTotalAmount.removeAttribute('required');
        }
    });
});

// Show Encouragement Message Function
function showEncouragementMessage(paymentMethod) {
    const messageElement = document.getElementById('encouragementMessage');
    let icon = '';
    let text = '';

    switch(paymentMethod) {
        case 'מזומן':
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';
            text = 'אללק! קאש זה קינג! בואו נמשיך...';
            break;
        case 'כרטיס אשראי':
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>';
            text = 'יפה! חכם ומודרני. בואו נמשיך...';
            break;
        case 'שיקים דחויים':
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
            text = 'קלאסי ואמין! בואו למלא את הפרטים...';
            break;
        case 'העברה בנקאית':
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';
            text = 'מקצוען! ישר וברור. בואו נמשיך...';
            break;
        case 'ביט':
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>';
            text = 'דיגיטלי עד הסוף! יאללה להמשיך...';
            break;
        case 'פיצול תשלום':
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>';
            text = 'גמישות מקסימלית! בואו נפרט את התשלומים...';
            break;
        default:
            icon = '';
            text = '';
    }

    if (text) {
        messageElement.innerHTML = icon + '<span>' + text + '</span>';
        messageElement.classList.remove('hide');

        // Hide after 4 seconds with fade out
        setTimeout(() => {
            messageElement.classList.add('hide');
        }, 4000);
    }
}

// Update Amount Reminder Function
function updateAmountReminder(type) {
    const amountBeforeVat = parseFloat(document.getElementById('amount').value) || 0;
    if (amountBeforeVat > 0) {
        const amountWithVat = amountBeforeVat * 1.18;
        const formattedAmount = '₪' + amountWithVat.toLocaleString('he-IL', {minimumFractionDigits: 2, maximumFractionDigits: 2});

        if (type === 'cc') {
            document.getElementById('ccAmountReminder').textContent = formattedAmount;
        } else if (type === 'checks') {
            document.getElementById('checksAmountReminder').textContent = formattedAmount;
        } else if (type === 'split') {
            document.getElementById('splitAmountReminder').textContent = formattedAmount;
        }
    }
}

// Add Split Payment Row
function addSplitPaymentRow() {
    splitPaymentRowCounter++;
    const rowId = 'splitRow_' + splitPaymentRowCounter;
    const container = document.getElementById('splitPaymentRows');

    const rowHTML = `
        <div class="split-payment-row" id="${rowId}" data-row-id="${rowId}">
            <div class="split-row-header">
                <div class="form-group">
                    <label>אמצעי תשלום</label>
                    <select class="split-payment-method" onchange="handleSplitMethodChange('${rowId}')">
                        <option value="">בחר אמצעי תשלום</option>
                        <option value="מזומן">מזומן</option>
                        <option value="כרטיס אשראי">כרטיס אשראי</option>
                        <option value="העברה בנקאית">העברה בנקאית</option>
                        <option value="ביט">ביט</option>
                        <option value="שיקים דחויים">שיקים דחויים</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>סכום (כולל מע"מ)</label>
                    <input type="number" class="split-payment-amount" placeholder="0" min="0" step="0.01" oninput="updateSplitPaymentSummary()">
                </div>
                <button type="button" class="split-payment-remove" onclick="removeSplitPaymentRow('${rowId}')" title="הסר">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <!-- אזור לשדות מפורטים - יוכנס דינמית -->
            <div class="split-method-details" id="details_${rowId}"></div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', rowHTML);
    updateSplitPaymentSummary();
}

// Remove Split Payment Row
function removeSplitPaymentRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
        updateSplitPaymentSummary();
    }
}

// Handle Split Method Change - Show method-specific fields
function handleSplitMethodChange(rowId) {
    const row = document.getElementById(rowId);
    const method = row.querySelector('.split-payment-method').value;
    const detailsContainer = document.getElementById('details_' + rowId);

    // Clear previous details
    detailsContainer.innerHTML = '';

    // Add method-specific fields
    if (method === 'כרטיס אשראי') {
        detailsContainer.innerHTML = getCreditCardDetailsHTML(rowId);
    } else if (method === 'שיקים דחויים') {
        detailsContainer.innerHTML = getChecksDetailsHTML(rowId);
    }

    updateSplitPaymentSummary();
}

// Get Credit Card Details HTML
function getCreditCardDetailsHTML(rowId) {
    return `
        <div class="split-cc-details">
            <div style="font-weight: 600; margin-bottom: 12px; color: var(--gray-700);">פרטי כרטיס אשראי:</div>

            <div class="radio-group">
                <div class="radio-option">
                    <input type="radio" id="cc_full_${rowId}" name="cc_status_${rowId}" value="חיוב מלא" onchange="handleCreditCardStatusChange('${rowId}')">
                    <label for="cc_full_${rowId}">בוצע חיוב מלא</label>
                </div>
                <div class="radio-option">
                    <input type="radio" id="cc_deposit_${rowId}" name="cc_status_${rowId}" value="פיקדון" onchange="handleCreditCardStatusChange('${rowId}')">
                    <label for="cc_deposit_${rowId}">פיקדון</label>
                </div>
                <div class="radio-option">
                    <input type="radio" id="cc_temp_${rowId}" name="cc_status_${rowId}" value="אשראי זמני" onchange="handleCreditCardStatusChange('${rowId}')">
                    <label for="cc_temp_${rowId}">אשראי זמני - יוחלף</label>
                </div>
            </div>

            <!-- חיוב מלא -->
            <div id="cc_full_details_${rowId}" class="conditional-subfield">
                <div class="form-group">
                    <label>מספר תשלומים</label>
                    <input type="number" id="cc_payments_${rowId}" min="1" max="36" placeholder="1">
                </div>
            </div>

            <!-- פיקדון -->
            <div id="cc_deposit_details_${rowId}" class="conditional-subfield">
                <div class="form-group">
                    <label>חיוב חודשי</label>
                    <input type="number" id="cc_monthly_${rowId}" step="0.01" placeholder="0">
                </div>
                <div class="form-group">
                    <label>למשך כמה חודשים</label>
                    <input type="number" id="cc_months_${rowId}" min="1" placeholder="1">
                </div>
                <div class="form-group">
                    <label>פרטי פיקדון</label>
                    <textarea id="cc_deposit_text_${rowId}" rows="2"></textarea>
                </div>
            </div>

            <!-- אשראי זמני -->
            <div id="cc_temp_details_${rowId}" class="conditional-subfield">
                <div class="form-group">
                    <label>פרטי החלפה</label>
                    <textarea id="cc_temp_text_${rowId}" rows="2"></textarea>
                </div>
            </div>
        </div>
    `;
}

// Get Checks Details HTML
function getChecksDetailsHTML(rowId) {
    return `
        <div class="split-checks-details">
            <div style="font-weight: 600; margin-bottom: 12px; color: var(--gray-700);">פרטי שיקים:</div>

            <div class="form-group">
                <label>כמה צ'קים?</label>
                <input type="number" id="checks_count_${rowId}" min="1" placeholder="1">
            </div>

            <div class="form-group">
                <label>סכום כל צ'ק</label>
                <input type="number" id="checks_amount_${rowId}" step="0.01" placeholder="0">
            </div>

            <div class="form-group">
                <label>צילום צ'ק</label>
                <input type="file" id="checks_photo_${rowId}" accept="image/*,application/pdf">
            </div>

            <div class="form-group">
                <label>פרטי צ'קים נוספים (אופציונלי)</label>
                <textarea id="checks_details_${rowId}" rows="2" placeholder="תאריכים, מספרי צ'קים וכו'"></textarea>
            </div>

            <div style="margin-top: 12px;">
                <label style="font-weight: 600; display: block; margin-bottom: 8px;">האם הצ'ק יוחלף?</label>
                <div class="radio-group">
                    <div class="radio-option">
                        <input type="radio" id="check_replace_no_${rowId}" name="check_replace_${rowId}" value="לא" checked onchange="handleCheckReplaceChange('${rowId}')">
                        <label for="check_replace_no_${rowId}">לא</label>
                    </div>
                    <div class="radio-option">
                        <input type="radio" id="check_replace_yes_${rowId}" name="check_replace_${rowId}" value="כן" onchange="handleCheckReplaceChange('${rowId}')">
                        <label for="check_replace_yes_${rowId}">כן</label>
                    </div>
                </div>
            </div>

            <div id="check_replace_details_${rowId}" class="conditional-subfield">
                <div class="form-group">
                    <label>באיזה אופן יוחלף?</label>
                    <textarea id="check_replace_text_${rowId}" rows="2"></textarea>
                </div>
            </div>
        </div>
    `;
}

// Handle Credit Card Status Change
function handleCreditCardStatusChange(rowId) {
    const fullDetails = document.getElementById('cc_full_details_' + rowId);
    const depositDetails = document.getElementById('cc_deposit_details_' + rowId);
    const tempDetails = document.getElementById('cc_temp_details_' + rowId);

    fullDetails.style.display = 'none';
    depositDetails.style.display = 'none';
    tempDetails.style.display = 'none';

    const selectedStatus = document.querySelector(`input[name="cc_status_${rowId}"]:checked`)?.value;

    if (selectedStatus === 'חיוב מלא') {
        fullDetails.style.display = 'block';
    } else if (selectedStatus === 'פיקדון') {
        depositDetails.style.display = 'block';
    } else if (selectedStatus === 'אשראי זמני') {
        tempDetails.style.display = 'block';
    }
}

// Handle Check Replace Change
function handleCheckReplaceChange(rowId) {
    const replaceDetails = document.getElementById('check_replace_details_' + rowId);
    const willReplace = document.querySelector(`input[name="check_replace_${rowId}"]:checked`)?.value;

    replaceDetails.style.display = (willReplace === 'כן') ? 'block' : 'none';
}

// Update Split Payment Summary
function updateSplitPaymentSummary() {
    const rows = document.querySelectorAll('.split-payment-row');
    let totalEntered = 0;

    rows.forEach(row => {
        const amount = parseFloat(row.querySelector('.split-payment-amount').value) || 0;
        totalEntered += amount;
    });

    const amountBeforeVat = parseFloat(document.getElementById('amount').value) || 0;
    const totalRequired = amountBeforeVat * 1.18;
    const remaining = totalRequired - totalEntered;

    document.getElementById('splitTotalEntered').textContent = '₪' + totalEntered.toLocaleString('he-IL', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    document.getElementById('splitRemaining').textContent = '₪' + remaining.toLocaleString('he-IL', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    // Change color based on remaining amount
    const remainingElement = document.getElementById('splitRemaining');
    if (remaining === 0) {
        remainingElement.style.color = 'var(--success)';
    } else if (remaining < 0) {
        remainingElement.style.color = 'var(--error)';
    } else {
        remainingElement.style.color = 'var(--error)';
    }

    // Show/hide summary
    if (rows.length > 0 && totalEntered > 0) {
        document.getElementById('splitPaymentSummary').style.display = 'block';
    } else {
        document.getElementById('splitPaymentSummary').style.display = 'none';
    }
}

// Get Split Payment Data
async function getSplitPaymentData() {
    const rows = document.querySelectorAll('.split-payment-row');
    const splitPayments = [];

    for (const row of rows) {
        const rowId = row.getAttribute('data-row-id');
        const method = row.querySelector('.split-payment-method').value;
        const amount = parseFloat(row.querySelector('.split-payment-amount').value) || 0;

        if (!method || amount <= 0) continue;

        const paymentData = {
            method: method,
            amount: amount
        };

        // Collect method-specific details
        if (method === 'כרטיס אשראי') {
            const ccStatus = document.querySelector(`input[name="cc_status_${rowId}"]:checked`)?.value || '';
            paymentData.creditCardStatus = ccStatus;

            if (ccStatus === 'חיוב מלא') {
                paymentData.paymentsCount = document.getElementById('cc_payments_' + rowId)?.value || '';
            } else if (ccStatus === 'פיקדון') {
                paymentData.monthlyCharge = document.getElementById('cc_monthly_' + rowId)?.value || '';
                paymentData.monthsCount = document.getElementById('cc_months_' + rowId)?.value || '';
                paymentData.depositDetails = document.getElementById('cc_deposit_text_' + rowId)?.value || '';
            } else if (ccStatus === 'אשראי זמני') {
                paymentData.temporaryCreditDetails = document.getElementById('cc_temp_text_' + rowId)?.value || '';
            }
        } else if (method === 'שיקים דחויים') {
            paymentData.checksCount = document.getElementById('checks_count_' + rowId)?.value || '';
            paymentData.checksAmount = document.getElementById('checks_amount_' + rowId)?.value || '';
            paymentData.checksDetails = document.getElementById('checks_details_' + rowId)?.value || '';

            const checkReplace = document.querySelector(`input[name="check_replace_${rowId}"]:checked`)?.value || 'לא';
            paymentData.checkWillChange = checkReplace;

            if (checkReplace === 'כן') {
                paymentData.checkReplacementDetails = document.getElementById('check_replace_text_' + rowId)?.value || '';
            }

            // Upload check photo
            const checksPhotoFile = document.getElementById('checks_photo_' + rowId)?.files[0];
            if (checksPhotoFile) {
                const timestamp = Date.now();
                const fileName = `checks/${timestamp}_${rowId}_${checksPhotoFile.name}`;
                paymentData.checksPhotoURL = await uploadFile(checksPhotoFile, fileName);
            }
        }

        splitPayments.push(paymentData);
    }

    return splitPayments;
}

// Credit Card Status Change Handler
document.querySelectorAll('input[name="creditCardStatus"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const fullChargeDetails = document.getElementById('fullChargeDetails');
        const monthlyChargeDetails = document.getElementById('monthlyChargeDetails');
        const depositDetails = document.getElementById('depositDetails');
        const temporaryCreditDetails = document.getElementById('temporaryCreditDetails');
        const paymentsCount = document.getElementById('paymentsCount');
        const monthlyCharge = document.getElementById('monthlyCharge');
        const temporaryCreditText = document.getElementById('temporaryCreditText');
        const recurringMonthlyAmount = document.getElementById('recurringMonthlyAmount');
        const recurringMonthsCount = document.getElementById('recurringMonthsCount');
        const recurringStartDate = document.getElementById('recurringStartDate');

        // Reset all sections
        fullChargeDetails.classList.remove('show');
        monthlyChargeDetails.classList.remove('show');
        depositDetails.classList.remove('show');
        temporaryCreditDetails.classList.remove('show');
        paymentsCount.removeAttribute('required');
        monthlyCharge.removeAttribute('required');
        temporaryCreditText.removeAttribute('required');
        recurringMonthlyAmount.removeAttribute('required');
        recurringMonthsCount.removeAttribute('required');
        recurringStartDate.removeAttribute('required');

        if (this.value === 'בוצע חיוב מלא') {
            fullChargeDetails.classList.add('show');
            paymentsCount.setAttribute('required', 'required');
        } else if (this.value === 'חיוב חודשי') {
            monthlyChargeDetails.classList.add('show');
            recurringMonthlyAmount.setAttribute('required', 'required');
            recurringMonthsCount.setAttribute('required', 'required');
            recurringStartDate.setAttribute('required', 'required');
        } else if (this.value === 'פיקדון') {
            depositDetails.classList.add('show');
            monthlyCharge.setAttribute('required', 'required');
        } else if (this.value === 'אשראי זמני - יוחלף') {
            temporaryCreditDetails.classList.add('show');
            temporaryCreditText.setAttribute('required', 'required');
        } else {
            // Reset all fields
            paymentsCount.value = '';
            monthlyCharge.value = '';
            temporaryCreditText.value = '';
            document.getElementById('monthsCount').value = '';
            document.getElementById('depositDetailsText').value = '';
            recurringMonthlyAmount.value = '';
            recurringMonthsCount.value = '';
            recurringStartDate.value = '';
        }
    });
});

// Check Will Change Handler
document.querySelectorAll('input[name="checkWillChange"]').forEach(radio => {
    radio.addEventListener('change', function() {
        const checkReplacementDetails = document.getElementById('checkReplacementDetails');
        const checkReplacementText = document.getElementById('checkReplacementText');

        if (this.value === 'כן') {
            checkReplacementDetails.classList.add('show');
            checkReplacementText.setAttribute('required', 'required');
        } else {
            checkReplacementDetails.classList.remove('show');
            checkReplacementText.removeAttribute('required');
            checkReplacementText.value = '';
        }
    });
});

