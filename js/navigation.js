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
    hideSalesManagement();
    hideActivityLog();
    hideUserManagement();
    document.getElementById('mainContainer').style.display = '';
    document.getElementById('mainForm').classList.remove('hidden');
    document.getElementById('successScreen').classList.remove('show');
    setActiveNav('navHomeBtn');
    logAuditEvent('nav_home');
}

function navAddBilling() {
    openBillingModal();
    setActiveNav('navAddBillingBtn');
    logAuditEvent('nav_add_billing');
}

function navBillingMgmt() {
    hideSalesManagement();
    hideActivityLog();
    hideUserManagement();
    showBillingManagement();
    setActiveNav('navBillingMgmtBtn');
    logAuditEvent('nav_billing_mgmt');
}

function navSalesMgmt() {
    hideBillingManagement();
    hideActivityLog();
    hideUserManagement();
    showSalesManagement();
    setActiveNav('navSalesMgmtBtn');
    logAuditEvent('nav_sales_mgmt');
}

function navActivityLog() {
    hideBillingManagement();
    hideSalesManagement();
    hideUserManagement();
    showActivityLog();
    setActiveNav('navActivityLogBtn');
    logAuditEvent('nav_activity_log');
}

function navUserMgmt() {
    hideBillingManagement();
    hideSalesManagement();
    hideActivityLog();
    showUserManagement();
    setActiveNav('navUserMgmtBtn');
    logAuditEvent('nav_user_mgmt');
}

function navLogout() {
    handleLogout();
}

// Safe hide for userManagement
function hideUserManagement() {
    var el = document.getElementById('userManagement');
    if (el) el.classList.remove('active');
}

// Show/hide bottom nav based on auth state
function updateBottomNav(show) {
    var nav = document.getElementById('bottomNav');
    if (nav) {
        nav.classList.toggle('bottom-nav-hidden', !show);
    }
}

// Update nav button visibility based on user permissions
function updateNavVisibility() {
    var perms = currentUserPermissions || {};

    var homeBtn = document.getElementById('navHomeBtn');
    if (homeBtn) homeBtn.style.display = perms.salesForm ? '' : 'none';

    var addBillBtn = document.getElementById('navAddBillingBtn');
    if (addBillBtn) addBillBtn.style.display = perms.billingManagement ? '' : 'none';

    var billMgmtBtn = document.getElementById('navBillingMgmtBtn');
    if (billMgmtBtn) billMgmtBtn.style.display = perms.billingManagement ? '' : 'none';

    var salesBtn = document.getElementById('navSalesMgmtBtn');
    if (salesBtn) salesBtn.style.display = perms.salesManagement ? '' : 'none';

    var logBtn = document.getElementById('navActivityLogBtn');
    if (logBtn) logBtn.style.display = perms.activityLog ? '' : 'none';

    var usersBtn = document.getElementById('navUserMgmtBtn');
    if (usersBtn) usersBtn.style.display = perms.userManagement ? '' : 'none';

    // Navigate to first available page if salesForm not available
    if (!perms.salesForm) {
        document.getElementById('mainForm').classList.add('hidden');
        if (perms.billingManagement) {
            navBillingMgmt();
        } else if (perms.salesManagement) {
            navSalesMgmt();
        }
    }
}

// Hook into auth state
var authUnsub = auth.onAuthStateChanged(function(user) {
    updateBottomNav(!!user);
});
