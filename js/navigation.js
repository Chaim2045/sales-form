// ========== Bottom Navigation ==========
function setActiveNav(id) {
    document.querySelectorAll('.bottom-nav-item').forEach(function(btn) {
        btn.classList.remove('active');
    });
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function navHome() {
    hideBillingManagement();
    document.getElementById('mainContainer').style.display = '';
    document.getElementById('userSelection').classList.remove('hidden');
    document.getElementById('mainForm').classList.add('hidden');
    document.getElementById('successScreen').classList.remove('show');
    setActiveNav('navHomeBtn');
}

function navAddBilling() {
    openBillingModal();
    setActiveNav('navAddBillingBtn');
}

function navBillingMgmt() {
    showBillingManagement();
    setActiveNav('navBillingMgmtBtn');
}

function navLogout() {
    handleLogout();
}

// Show/hide bottom nav based on auth state
function updateBottomNav(show) {
    var nav = document.getElementById('bottomNav');
    if (nav) {
        nav.classList.toggle('bottom-nav-hidden', !show);
    }
}

// Hook into auth state
var authUnsub = auth.onAuthStateChanged(function(user) {
    updateBottomNav(!!user);
});
