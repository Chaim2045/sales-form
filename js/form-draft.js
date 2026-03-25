// ========== שמירת טיוטת טופס מוצפנת ==========
// שומר את מצב הטופס ב-localStorage עם הצפנת AES.
// הטיוטה מוגבלת בגודל (50KB), פגה אחרי 24 שעות,
// ונמחקת בהתנתקות או בשליחת טופס מוצלחת.

var DRAFT_STORAGE_KEY = 'tofes_draft';
var DRAFT_MAX_SIZE = 50 * 1024; // 50KB
var DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 שעות
var _draftSaveTimer = null;

// שדות רגישים שלא יישמרו בטיוטה
var DRAFT_EXCLUDED_FIELDS = [
    'checksPhoto' // קבצים לא ניתן לשמור ב-localStorage
];

// שדות שלא רלוונטיים לטיוטה
var DRAFT_SKIP_FIELDS = [
    'submitBtn', 'submitText', 'submitSpinner'
];

function getDraftEncryptionKey() {
    // מפתח הצפנה = UID של המשתמש + מזהה קבוע
    // ככה כל משתמש מצפין עם מפתח שונה
    var uid = (authUser && authUser.uid) ? authUser.uid : '';
    if (!uid) return null;
    return 'tofes_draft_' + uid + '_key';
}

function encryptDraft(data) {
    var key = getDraftEncryptionKey();
    if (!key) return null;
    try {
        var json = JSON.stringify(data);
        var encrypted = CryptoJS.AES.encrypt(json, key).toString();
        return encrypted;
    } catch (e) {
        console.error('Draft encrypt error:', e);
        return null;
    }
}

function decryptDraft(encryptedStr) {
    var key = getDraftEncryptionKey();
    if (!key) return null;
    try {
        var bytes = CryptoJS.AES.decrypt(encryptedStr, key);
        var json = bytes.toString(CryptoJS.enc.Utf8);
        if (!json) return null;
        return JSON.parse(json);
    } catch (e) {
        console.error('Draft decrypt error:', e);
        return null;
    }
}

function collectFormData() {
    var form = document.getElementById('salesForm');
    if (!form) return null;

    var data = {};

    // Collect all input/select/textarea values
    var fields = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var id = field.id;
        if (!id) continue;
        if (DRAFT_EXCLUDED_FIELDS.indexOf(id) !== -1) continue;
        if (DRAFT_SKIP_FIELDS.indexOf(id) !== -1) continue;
        if (field.type === 'file') continue;

        if (field.type === 'radio') {
            if (field.checked) {
                data['radio_' + field.name] = field.value;
            }
        } else if (field.type === 'checkbox') {
            data[id] = field.checked;
        } else {
            if (field.value) {
                data[id] = field.value;
            }
        }
    }

    return data;
}

function saveDraft() {
    if (!authUser) return;

    var formData = collectFormData();
    if (!formData || Object.keys(formData).length === 0) return;

    // הוסף timestamp לבדיקת תפוגה
    formData._draftTimestamp = Date.now();
    formData._draftStep = typeof currentStep !== 'undefined' ? currentStep : 1;

    var encrypted = encryptDraft(formData);
    if (!encrypted) return;

    // בדיקת גודל
    if (encrypted.length > DRAFT_MAX_SIZE) {
        console.warn('Draft too large, skipping save');
        return;
    }

    try {
        localStorage.setItem(DRAFT_STORAGE_KEY, encrypted);
    } catch (e) {
        console.warn('Failed to save draft:', e);
    }
}

function saveDraftDebounced() {
    if (_draftSaveTimer) clearTimeout(_draftSaveTimer);
    _draftSaveTimer = setTimeout(saveDraft, 1500);
}

function loadDraft() {
    if (!authUser) return null;

    try {
        var encrypted = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!encrypted) return null;

        var data = decryptDraft(encrypted);
        if (!data) {
            clearDraft();
            return null;
        }

        // בדיקת תפוגה
        if (data._draftTimestamp && (Date.now() - data._draftTimestamp) > DRAFT_TTL_MS) {
            clearDraft();
            return null;
        }

        return data;
    } catch (e) {
        console.warn('Failed to load draft:', e);
        clearDraft();
        return null;
    }
}

function restoreDraft(data) {
    if (!data) return;

    var form = document.getElementById('salesForm');
    if (!form) return;

    // Restore regular fields
    for (var key in data) {
        if (key.startsWith('_draft')) continue; // skip metadata

        if (key.startsWith('radio_')) {
            // Restore radio buttons
            var radioName = key.replace('radio_', '');
            var radio = form.querySelector('input[name="' + radioName + '"][value="' + data[key] + '"]');
            if (radio) {
                radio.checked = true;
                // Trigger change event to show conditional fields
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else {
            var field = document.getElementById(key);
            if (!field) continue;

            if (field.type === 'checkbox') {
                field.checked = !!data[key];
            } else {
                field.value = data[key];
            }
        }
    }

    // Trigger events to update dependent UI
    var amount = document.getElementById('amount');
    if (amount && amount.value) {
        amount.dispatchEvent(new Event('input', { bubbles: true }));
    }

    var transactionType = document.getElementById('transactionType');
    if (transactionType && transactionType.value) {
        transactionType.dispatchEvent(new Event('change', { bubbles: true }));
    }

    var checksCount = document.getElementById('checksCount');
    if (checksCount && checksCount.value) {
        checksCount.dispatchEvent(new Event('input', { bubbles: true }));
        // Restore individual check values after DOM generates fields
        setTimeout(function() {
            var count = parseInt(checksCount.value) || 0;
            for (var i = 1; i <= count; i++) {
                var dateKey = 'check_date_' + i;
                var amountKey = 'check_amount_' + i;
                if (data[dateKey]) {
                    var dateEl = document.getElementById(dateKey);
                    if (dateEl) dateEl.value = data[dateKey];
                }
                if (data[amountKey]) {
                    var amountEl = document.getElementById(amountKey);
                    if (amountEl) amountEl.value = data[amountKey];
                }
            }
        }, 100);
    }

    // Navigate to saved step
    if (data._draftStep && typeof showStep === 'function') {
        showStep(data._draftStep);
    }
}

function clearDraft() {
    try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) { /* ignore */ }
}

function showDraftRestorePrompt(data) {
    // Check if draft has meaningful data (more than just metadata)
    var meaningfulKeys = Object.keys(data).filter(function(k) { return !k.startsWith('_draft'); });
    if (meaningfulKeys.length < 2) {
        clearDraft();
        return;
    }

    var clientName = data.clientName || '';
    var timestamp = data._draftTimestamp;
    var timeStr = '';
    if (timestamp) {
        var d = new Date(timestamp);
        timeStr = d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    }

    var toast = document.createElement('div');
    toast.id = 'draftRestoreToast';
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #6366f1;border-radius:14px;padding:16px 22px;z-index:9999;font-family:Heebo,sans-serif;font-size:14px;box-shadow:0 8px 30px rgba(99,102,241,0.2);max-width:90%;width:380px;direction:rtl;animation:slideDown 0.3s ease;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;margin-bottom:6px;font-size:15px;color:#1e293b;';
    title.textContent = 'נמצאה טיוטה שמורה';
    toast.appendChild(title);

    var info = document.createElement('div');
    info.style.cssText = 'font-size:13px;color:#64748b;margin-bottom:12px;';
    info.textContent = (clientName ? 'לקוח: ' + clientName + ' | ' : '') + (timeStr ? 'נשמרה: ' + timeStr : '');
    toast.appendChild(info);

    var buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;';

    var restoreBtn = document.createElement('button');
    restoreBtn.style.cssText = 'flex:1;padding:8px 14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:8px;font-family:Heebo,sans-serif;font-size:13px;font-weight:600;cursor:pointer;';
    restoreBtn.textContent = 'שחזר טיוטה';
    restoreBtn.onclick = function() {
        restoreDraft(data);
        toast.remove();
    };

    var dismissBtn = document.createElement('button');
    dismissBtn.style.cssText = 'padding:8px 14px;background:#f1f5f9;color:#64748b;border:none;border-radius:8px;font-family:Heebo,sans-serif;font-size:13px;font-weight:500;cursor:pointer;';
    dismissBtn.textContent = 'התחל מחדש';
    dismissBtn.onclick = function() {
        clearDraft();
        toast.remove();
    };

    buttons.appendChild(restoreBtn);
    buttons.appendChild(dismissBtn);
    toast.appendChild(buttons);

    document.body.appendChild(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(function() {
        if (document.getElementById('draftRestoreToast')) {
            toast.remove();
        }
    }, 15000);
}

// ========== אתחול — חיבור ל-events ==========

function initFormDraft() {
    var form = document.getElementById('salesForm');
    if (!form) return;

    // Listen to all form changes for auto-save
    form.addEventListener('input', saveDraftDebounced);
    form.addEventListener('change', saveDraftDebounced);

    // Check for existing draft
    var draft = loadDraft();
    if (draft) {
        showDraftRestorePrompt(draft);
    }
}

// Initialize when user is authenticated
// Called from selectUser() or after auth is ready
var _draftInitDone = false;
function tryInitDraft() {
    if (_draftInitDone) return;
    if (!authUser) return;
    _draftInitDone = true;
    // Small delay to ensure form is ready
    setTimeout(initFormDraft, 500);
}
