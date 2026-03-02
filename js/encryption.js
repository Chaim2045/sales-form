// ========== הצפנת כרטיס אשראי ==========

// Client-side rate limiting for password attempts (backup for server-side)
var _decryptFailedAttempts = 0;
var _decryptLockoutUntil = 0;

// ========== Server-side rate limiting via Firestore ==========

async function checkServerRateLimit(docId) {
    if (!authUser) return false;

    var userId = authUser.uid;
    var rateLimitRef = db.collection('decrypt_rate_limit').doc(userId);

    try {
        var doc = await rateLimitRef.get();
        if (doc.exists) {
            var data = doc.data();
            var lockedUntil = data.lockedUntil ? data.lockedUntil.toMillis() : 0;
            if (Date.now() < lockedUntil) {
                var secondsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
                alert('נסיונות רבים מדי. נסה שוב בעוד ' + secondsLeft + ' שניות.');
                return false;
            }

            // Reset if lockout has expired
            if ((data.failedAttempts || 0) >= 5 && Date.now() >= lockedUntil) {
                await rateLimitRef.set({ failedAttempts: 0, lockedUntil: null }, { merge: true });
            }
        }
        return true;
    } catch (e) {
        console.error('Rate limit check error:', e);
        return true; // Fail open — local rate limit still active
    }
}

async function recordServerDecryptFail(docId) {
    if (!authUser) return;
    var userId = authUser.uid;
    var rateLimitRef = db.collection('decrypt_rate_limit').doc(userId);

    try {
        var doc = await rateLimitRef.get();
        var failedAttempts = (doc.exists ? (doc.data().failedAttempts || 0) : 0) + 1;
        var updateData = {
            failedAttempts: failedAttempts,
            lastAttempt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (failedAttempts >= 5) {
            // Lock for 5 minutes (300,000ms) server-side
            updateData.lockedUntil = new Date(Date.now() + 300000);
        }

        await rateLimitRef.set(updateData, { merge: true });
    } catch (e) {
        console.error('Rate limit record error:', e);
    }
}

async function resetServerDecryptFail() {
    if (!authUser) return;
    var userId = authUser.uid;
    try {
        await db.collection('decrypt_rate_limit').doc(userId).set(
            { failedAttempts: 0, lockedUntil: null },
            { merge: true }
        );
    } catch (e) {
        console.error('Rate limit reset error:', e);
    }
}

// ========== PBKDF2 + AES-256-CBC Encryption ==========

function encryptCardData(cardNumber, passphrase) {
    // Generate random 128-bit salt and 128-bit IV
    var salt = CryptoJS.lib.WordArray.random(16);
    var iv = CryptoJS.lib.WordArray.random(16);

    // Derive 256-bit key using PBKDF2 with 100,000 iterations and SHA-256
    var key = CryptoJS.PBKDF2(passphrase, salt, {
        keySize: 256 / 32,
        iterations: 100000,
        hasher: CryptoJS.algo.SHA256
    });

    // Encrypt with AES-256-CBC
    var encrypted = CryptoJS.AES.encrypt(cardNumber, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });

    // Format: "v2:base64(salt):base64(iv):base64(ciphertext)"
    return 'v2:' + salt.toString(CryptoJS.enc.Base64) +
           ':' + iv.toString(CryptoJS.enc.Base64) +
           ':' + encrypted.ciphertext.toString(CryptoJS.enc.Base64);
}

function decryptCardData(encryptedData, passphrase) {
    // Client-side rate limiting check
    if (_decryptFailedAttempts >= 5 && Date.now() < _decryptLockoutUntil) {
        var secondsLeft = Math.ceil((_decryptLockoutUntil - Date.now()) / 1000);
        alert('נסיונות רבים מדי. נסה שוב בעוד ' + secondsLeft + ' שניות.');
        return null;
    }

    try {
        var decrypted;

        if (encryptedData.indexOf('v2:') === 0) {
            // New PBKDF2 format: "v2:salt:iv:ciphertext" (all base64)
            var parts = encryptedData.split(':');
            if (parts.length !== 4) {
                _handleDecryptFail();
                return null;
            }

            var salt = CryptoJS.enc.Base64.parse(parts[1]);
            var iv = CryptoJS.enc.Base64.parse(parts[2]);
            var ciphertext = CryptoJS.enc.Base64.parse(parts[3]);

            var key = CryptoJS.PBKDF2(passphrase, salt, {
                keySize: 256 / 32,
                iterations: 100000,
                hasher: CryptoJS.algo.SHA256
            });

            var decryptedWA = CryptoJS.AES.decrypt(
                { ciphertext: ciphertext },
                key,
                { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
            );

            decrypted = decryptedWA.toString(CryptoJS.enc.Utf8);
        } else {
            // Legacy format: CryptoJS.AES.encrypt(data, passphrase).toString()
            var bytes = CryptoJS.AES.decrypt(encryptedData, passphrase);
            decrypted = bytes.toString(CryptoJS.enc.Utf8);
        }

        if (!decrypted) {
            _handleDecryptFail();
            return null;
        }

        // Success: reset local counter
        _decryptFailedAttempts = 0;
        return decrypted;

    } catch (e) {
        _handleDecryptFail();
        return null;
    }
}

function _handleDecryptFail() {
    _decryptFailedAttempts++;
    if (_decryptFailedAttempts >= 5) {
        _decryptLockoutUntil = Date.now() + 300000; // 5 minute lockout (matches server)
    }
}

// Re-encrypt legacy data to v2 format
function reEncryptToV2(encryptedData, passphrase) {
    if (encryptedData.indexOf('v2:') === 0) return encryptedData;
    var decrypted = decryptCardData(encryptedData, passphrase);
    if (!decrypted) return null;
    return encryptCardData(decrypted, passphrase);
}

// ========== Validation ==========

// Luhn algorithm validation
function validateCardNumber(num) {
    var digits = num.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
        var n = parseInt(digits[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

// Expiry validation (MM/YY format, not expired)
function validateCardExpiry(expiry) {
    if (!/^\d{2}\/\d{2}$/.test(expiry)) return false;
    var parts = expiry.split('/');
    var month = parseInt(parts[0], 10);
    var year = parseInt(parts[1], 10) + 2000;
    if (month < 1 || month > 12) return false;
    var now = new Date();
    var expiryDate = new Date(year, month);
    return expiryDate > now;
}

// ========== Password Popup ==========

function requestPassword(mode) {
    // Check lockout before showing popup
    if (_decryptFailedAttempts >= 5 && Date.now() < _decryptLockoutUntil) {
        var secondsLeft = Math.ceil((_decryptLockoutUntil - Date.now()) / 1000);
        alert('נסיונות רבים מדי. נסה שוב בעוד ' + secondsLeft + ' שניות.');
        return Promise.resolve(null);
    }

    return new Promise(function(resolve) {
        var overlay = document.getElementById('pwPopupOverlay');
        var input = document.getElementById('pwPopupInput');
        var errorEl = document.getElementById('pwPopupError');
        var title = document.getElementById('pwPopupTitle');
        var desc = document.getElementById('pwPopupDesc');

        // הסרת שדות אישור קודמים אם קיימים
        var oldConfirm = document.getElementById('pwPopupConfirmInput');
        if (oldConfirm) oldConfirm.parentNode.removeChild(oldConfirm);
        var oldLabel = document.getElementById('pwPopupConfirmLabel');
        if (oldLabel) oldLabel.parentNode.removeChild(oldLabel);
        var oldCheck = document.getElementById('pwPopupSavedWrap');
        if (oldCheck) oldCheck.parentNode.removeChild(oldCheck);

        if (mode === 'decrypt') {
            title.textContent = 'צפייה בפרטי כרטיס';
            desc.innerHTML = 'הזן את סיסמת המשרד כדי לצפות במספר הכרטיס המלא.<br>פעולה זו נרשמת ביומן הביקורת.';
        } else {
            title.textContent = 'הצפנת פרטי כרטיס';
            desc.innerHTML = '<strong style="color:#ef4444;">סיסמה זו היא הדרך היחידה לגשת לנתוני הכרטיס.</strong><br>רשום אותה ושמור במקום בטוח. ללא הסיסמה לא ניתן יהיה לצפות במספר הכרטיס.';
            // הוספת שדה אישור סיסמה
            var confirmLabel = document.createElement('label');
            confirmLabel.id = 'pwPopupConfirmLabel';
            confirmLabel.textContent = 'הזן סיסמה שוב לאישור';
            confirmLabel.style.cssText = 'display:block;margin-top:10px;font-size:13px;color:#94a3b8;';
            var confirmInput = document.createElement('input');
            confirmInput.type = 'password';
            confirmInput.id = 'pwPopupConfirmInput';
            confirmInput.placeholder = 'אישור סיסמה';
            confirmInput.setAttribute('autocomplete', 'new-password');
            confirmInput.style.cssText = input.style.cssText || '';
            confirmInput.className = input.className;
            input.parentNode.insertBefore(confirmLabel, input.nextSibling);
            confirmLabel.parentNode.insertBefore(confirmInput, confirmLabel.nextSibling);
            // checkbox אישור שמירה
            var checkWrap = document.createElement('div');
            checkWrap.id = 'pwPopupSavedWrap';
            checkWrap.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:8px;direction:rtl;';
            checkWrap.innerHTML = '<input type="checkbox" id="pwPopupSavedCheck" style="width:18px;height:18px;cursor:pointer;">' +
                '<label for="pwPopupSavedCheck" style="font-size:13px;color:#cbd5e1;cursor:pointer;">אני מאשר/ת ששמרתי את הסיסמה במקום בטוח</label>';
            confirmInput.parentNode.insertBefore(checkWrap, confirmInput.nextSibling);
        }

        input.value = '';
        errorEl.textContent = '';
        overlay.classList.add('show');
        setTimeout(function() { input.focus(); }, 100);

        function cleanup() {
            overlay.classList.remove('show');
            input.value = '';
            // Clear confirm input too
            var ci = document.getElementById('pwPopupConfirmInput');
            if (ci) ci.value = '';
            document.getElementById('pwPopupConfirm').removeEventListener('click', onConfirm);
            document.getElementById('pwPopupCancel').removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeydown);
        }

        function onConfirm() {
            var val = input.value;
            if (!val) {
                errorEl.textContent = 'נא להזין סיסמה';
                return;
            }
            if (mode === 'encrypt') {
                if (val.length < 6) {
                    errorEl.textContent = 'סיסמה חייבת להכיל לפחות 6 תווים';
                    return;
                }
                var confirmInput = document.getElementById('pwPopupConfirmInput');
                var savedCheckbox = document.getElementById('pwPopupSavedCheck');
                if (confirmInput && confirmInput.value !== val) {
                    errorEl.textContent = 'הסיסמאות אינן תואמות';
                    return;
                }
                if (savedCheckbox && !savedCheckbox.checked) {
                    errorEl.textContent = 'נא לאשר ששמרת את הסיסמה';
                    return;
                }
            }
            cleanup();
            resolve(val);
        }

        function onCancel() {
            cleanup();
            resolve(null);
        }

        function onKeydown(e) {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
        }

        document.getElementById('pwPopupConfirm').addEventListener('click', onConfirm);
        document.getElementById('pwPopupCancel').addEventListener('click', onCancel);
        input.addEventListener('keydown', onKeydown);
    });
}

// פורמט מספר כרטיס - רווח כל 4 ספרות
document.addEventListener('DOMContentLoaded', function() {
    var cardInput = document.getElementById('billingCardNumber');
    if (cardInput) {
        cardInput.addEventListener('input', function(e) {
            var val = e.target.value.replace(/\D/g, '').substring(0, 16);
            var formatted = val.replace(/(\d{4})(?=\d)/g, '$1 ');
            e.target.value = formatted;
        });
    }

    var expiryInput = document.getElementById('billingCardExpiry');
    if (expiryInput) {
        expiryInput.addEventListener('input', function(e) {
            var val = e.target.value.replace(/\D/g, '').substring(0, 4);
            if (val.length >= 3) {
                val = val.substring(0, 2) + '/' + val.substring(2);
            }
            e.target.value = val;
        });
    }
});
