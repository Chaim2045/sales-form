// ========== הצפנת כרטיס אשראי ==========

// Rate limiting for password attempts
var _decryptFailedAttempts = 0;
var _decryptLockoutUntil = 0;

function encryptCardData(cardNumber, passphrase) {
    return CryptoJS.AES.encrypt(cardNumber, passphrase).toString();
}

function decryptCardData(encryptedData, passphrase) {
    // Rate limiting check
    if (_decryptFailedAttempts >= 5 && Date.now() < _decryptLockoutUntil) {
        var secondsLeft = Math.ceil((_decryptLockoutUntil - Date.now()) / 1000);
        alert('נסיונות רבים מדי. נסה שוב בעוד ' + secondsLeft + ' שניות.');
        return null;
    }

    try {
        var bytes = CryptoJS.AES.decrypt(encryptedData, passphrase);
        var decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (!decrypted) {
            _decryptFailedAttempts++;
            if (_decryptFailedAttempts >= 5) {
                _decryptLockoutUntil = Date.now() + 60000; // 60 second lockout
            }
            return null;
        }
        _decryptFailedAttempts = 0; // Reset on success
        return decrypted;
    } catch (e) {
        _decryptFailedAttempts++;
        if (_decryptFailedAttempts >= 5) {
            _decryptLockoutUntil = Date.now() + 60000;
        }
        return null;
    }
}

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
    var expiryDate = new Date(year, month); // first day of month AFTER expiry
    return expiryDate > now;
}

// פופאפ סיסמת הצפנה מעוצב
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

        if (mode === 'decrypt') {
            title.textContent = 'צפייה בפרטי כרטיס';
            desc.innerHTML = 'הזן את סיסמת המשרד כדי לצפות במספר הכרטיס המלא.<br>פעולה זו נרשמת ביומן הביקורת.';
        } else {
            title.textContent = 'הצפנת פרטי כרטיס';
            desc.innerHTML = 'סיסמה זו משמשת להצפנת פרטי כרטיס האשראי של הלקוח.<br>רק מי שיודע את הסיסמה יוכל לצפות במספר הכרטיס המלא.';
        }

        input.value = '';
        errorEl.textContent = '';
        overlay.classList.add('show');
        setTimeout(function() { input.focus(); }, 100);

        function cleanup() {
            overlay.classList.remove('show');
            input.value = '';
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
