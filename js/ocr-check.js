// ========== OCR Check Reading ==========
// Extracts check details (date, amount, check number) from uploaded check photos

var _ocrProcessing = false;

async function ocrExtractCheckData(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = async function() {
            try {
                var base64 = reader.result; // data:image/jpeg;base64,...
                var idToken = await authUser.getIdToken();

                var response = await fetch('/api/ocr-check', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + idToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        imageBase64: base64,
                        mimeType: file.type
                    })
                });

                var data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'OCR request failed');
                }
                resolve(data);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = function() { reject(new Error('Failed to read file')); };
        reader.readAsDataURL(file);
    });
}

function triggerOcrExtraction(file) {
    if (_ocrProcessing) return;

    // If no file passed, get from input
    if (!file) {
        var fileInput = document.getElementById('checksPhoto');
        file = fileInput && fileInput.files[0];
    }
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        showOcrStatus('OCR זמין רק עבור תמונות ו-PDF', 'warning');
        return;
    }

    _ocrProcessing = true;
    var ocrBtn = document.getElementById('ocrExtractBtn');
    var ocrStatus = document.getElementById('ocrStatus');

    if (ocrBtn) {
        ocrBtn.disabled = true;
        ocrBtn.querySelector('.ocr-btn-text').textContent = 'סורק...';
        ocrBtn.querySelector('.ocr-btn-spinner').style.display = 'inline-block';
    }
    showOcrStatus('סורק את השיק...', 'loading');

    ocrExtractCheckData(file)
        .then(function(result) {
            if (result.checks && result.checks.length > 0) {
                showOcrConfirmationModal(result.checks);
                showOcrStatus('נמצאו ' + result.checks.length + ' שיקים', 'success');
            } else {
                showOcrStatus('לא הצלחנו לזהות פרטי שיק. מלא/י ידנית.', 'warning');
            }
        })
        .catch(function(err) {
            console.error('OCR error:', err);
            showOcrStatus('שגיאה: ' + (err.message || 'שגיאה בסריקה') + '. מלא/י ידנית.', 'error');
        })
        .finally(function() {
            _ocrProcessing = false;
            if (ocrBtn) {
                ocrBtn.disabled = false;
                ocrBtn.querySelector('.ocr-btn-text').textContent = 'קרא פרטים מהשיק';
                ocrBtn.querySelector('.ocr-btn-spinner').style.display = 'none';
            }
        });
}

function showOcrStatus(message, type) {
    var statusEl = document.getElementById('ocrStatus');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = 'ocr-status';
    if (type) statusEl.classList.add('ocr-status-' + type);
    statusEl.style.display = 'block';

    if (type !== 'loading') {
        setTimeout(function() {
            statusEl.style.display = 'none';
        }, 5000);
    }
}

function showOcrConfirmationModal(checks) {
    // Remove existing modal if any
    var existing = document.getElementById('ocrConfirmOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'ocrConfirmOverlay';
    overlay.className = 'ocr-confirm-overlay';

    var modal = document.createElement('div');
    modal.className = 'ocr-confirm-modal';

    // Title
    var title = document.createElement('div');
    title.className = 'ocr-confirm-title';
    title.textContent = 'פרטי שיקים שזוהו';
    modal.appendChild(title);

    var subtitle = document.createElement('div');
    subtitle.className = 'ocr-confirm-subtitle';
    subtitle.textContent = 'בדוק/י את הפרטים ותקן/י במידת הצורך:';
    modal.appendChild(subtitle);

    // Check fields
    var fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'ocr-confirm-fields';

    for (var i = 0; i < checks.length; i++) {
        var checkDiv = document.createElement('div');
        checkDiv.className = 'ocr-check-row';

        var checkTitle = document.createElement('div');
        checkTitle.className = 'ocr-check-title';
        checkTitle.textContent = 'שיק ' + (i + 1);
        checkDiv.appendChild(checkTitle);

        var row = document.createElement('div');
        row.className = 'ocr-check-fields-row';

        // Date field
        var dateGroup = document.createElement('div');
        dateGroup.className = 'ocr-field-group';
        dateGroup.innerHTML = '<label>תאריך</label><input type="date" class="ocr-check-date" value="' + (checks[i].date || '') + '">';
        row.appendChild(dateGroup);

        // Amount field
        var amountGroup = document.createElement('div');
        amountGroup.className = 'ocr-field-group';
        amountGroup.innerHTML = '<label>סכום</label><input type="number" class="ocr-check-amount" value="' + (checks[i].amount || '') + '" step="any" min="0">';
        row.appendChild(amountGroup);

        // Check number field
        var numGroup = document.createElement('div');
        numGroup.className = 'ocr-field-group';
        numGroup.innerHTML = '<label>מס\' שיק</label><input type="text" class="ocr-check-number" value="' + (checks[i].checkNumber || '') + '">';
        row.appendChild(numGroup);

        checkDiv.appendChild(row);
        fieldsContainer.appendChild(checkDiv);
    }
    modal.appendChild(fieldsContainer);

    // Buttons
    var buttons = document.createElement('div');
    buttons.className = 'ocr-confirm-buttons';

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'ocr-btn-apply';
    applyBtn.textContent = 'מלא בטופס';
    applyBtn.onclick = function() {
        var checkData = collectOcrModalData();
        applyOcrDataToForm(checkData);
        overlay.remove();
    };

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ocr-btn-cancel';
    cancelBtn.textContent = 'ביטול';
    cancelBtn.onclick = function() { overlay.remove(); };

    buttons.appendChild(applyBtn);
    buttons.appendChild(cancelBtn);
    modal.appendChild(buttons);

    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

function collectOcrModalData() {
    var dates = document.querySelectorAll('.ocr-check-date');
    var amounts = document.querySelectorAll('.ocr-check-amount');
    var numbers = document.querySelectorAll('.ocr-check-number');
    var checks = [];

    for (var i = 0; i < dates.length; i++) {
        checks.push({
            date: dates[i].value || '',
            amount: parseFloat(amounts[i].value) || 0,
            checkNumber: numbers[i] ? numbers[i].value : ''
        });
    }
    return checks;
}

function applyOcrDataToForm(checks) {
    if (!checks || checks.length === 0) return;

    // Set checksCount and trigger dynamic field generation
    var checksCountInput = document.getElementById('checksCount');
    if (checksCountInput) {
        checksCountInput.value = checks.length;
        // Trigger input event to generate dynamic fields
        checksCountInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Small delay to let DOM update after event dispatch
    setTimeout(function() {
        var totalAmount = 0;

        for (var i = 0; i < checks.length; i++) {
            var dateInput = document.getElementById('check_date_' + (i + 1));
            var amountInput = document.getElementById('check_amount_' + (i + 1));

            if (dateInput && checks[i].date) {
                dateInput.value = checks[i].date;
                dateInput.classList.add('ocr-filled');
                setTimeout(function(el) { el.classList.remove('ocr-filled'); }, 2000, dateInput);
            }
            if (amountInput && checks[i].amount > 0) {
                amountInput.value = checks[i].amount;
                amountInput.classList.add('ocr-filled');
                totalAmount += checks[i].amount;
                setTimeout(function(el) { el.classList.remove('ocr-filled'); }, 2000, amountInput);
            }
        }

        // Set total amount
        var totalInput = document.getElementById('checksTotalAmount');
        if (totalInput && totalAmount > 0) {
            totalInput.value = totalAmount.toFixed(2);
            totalInput.classList.add('ocr-filled');
            setTimeout(function() { totalInput.classList.remove('ocr-filled'); }, 2000);
        }

        showOcrStatus('הפרטים מולאו בטופס', 'success');
    }, 100);
}
