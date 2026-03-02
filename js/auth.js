async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errorEl.textContent = '';
    if (!email || !password) {
        errorEl.textContent = 'נא למלא מייל וסיסמה';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'מתחבר...';

    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        const messages = {
            'auth/user-not-found': 'מייל או סיסמה שגויים',
            'auth/wrong-password': 'מייל או סיסמה שגויים',
            'auth/invalid-email': 'כתובת מייל לא תקינה',
            'auth/too-many-requests': 'יותר מדי ניסיונות, נסה שוב מאוחר יותר',
            'auth/invalid-credential': 'מייל או סיסמה שגויים'
        };
        errorEl.textContent = messages[error.code] || 'שגיאת התחברות. נסה שנית.';
    }

    btn.disabled = false;
    btn.textContent = 'כניסה';
}

// Enter key on login
document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
});
document.getElementById('loginEmail').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('loginPassword').focus();
});

function handleLogout() {
    auth.signOut();
}
