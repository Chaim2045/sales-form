// ========== הצפנת כרטיס אשראי ==========

function encryptCardData(cardNumber, passphrase) {
    return CryptoJS.AES.encrypt(cardNumber, passphrase).toString();
}

function decryptCardData(encryptedData, passphrase) {
    try {
        var bytes = CryptoJS.AES.decrypt(encryptedData, passphrase);
        var decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (!decrypted) return null;
        return decrypted;
    } catch (e) {
        return null;
    }
}

// פופאפ סיסמת הצפנה מעוצב
function requestPassword(mode) {
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
