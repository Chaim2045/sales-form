// ========== Bottom Navigation ==========

var _overflowNavIds = ['navLeadsMgmtBtn', 'navActivityLogBtn', 'navUserMgmtBtn'];

function setActiveNav(id) {
    document.querySelectorAll('.bottom-nav-item').forEach(function(btn) {
        btn.classList.remove('active');
    });
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
    // On mobile: if navigating to an overflow item, highlight "More" button
    var moreBtn = document.getElementById('navMoreBtn');
    if (moreBtn) {
        if (_overflowNavIds.indexOf(id) !== -1) {
            moreBtn.classList.add('active');
        }
    }
}

function navHome() {
    hideBillingManagement();
    hideSalesManagement();
    hideActivityLog();
    hideUserManagement();
    hideLeadsManagement();
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
    hideLeadsManagement();
    showBillingManagement();
    setActiveNav('navBillingMgmtBtn');
    logAuditEvent('nav_billing_mgmt');
}

function navSalesMgmt() {
    hideBillingManagement();
    hideActivityLog();
    hideUserManagement();
    hideLeadsManagement();
    showSalesManagement();
    setActiveNav('navSalesMgmtBtn');
    logAuditEvent('nav_sales_mgmt');
}

function navLeadsMgmt() {
    hideBillingManagement();
    hideSalesManagement();
    hideActivityLog();
    hideUserManagement();
    showLeadsManagement();
    setActiveNav('navLeadsMgmtBtn');
    logAuditEvent('nav_leads_mgmt');
}

function navActivityLog() {
    hideBillingManagement();
    hideSalesManagement();
    hideUserManagement();
    hideLeadsManagement();
    showActivityLog();
    setActiveNav('navActivityLogBtn');
    logAuditEvent('nav_activity_log');
}

function navUserMgmt() {
    hideBillingManagement();
    hideSalesManagement();
    hideActivityLog();
    hideLeadsManagement();
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

// Safe hide for leadsManagement
function hideLeadsManagement() {
    if (typeof window.hideLeadsManagement_internal === 'function') {
        window.hideLeadsManagement_internal();
    } else {
        var el = document.getElementById('leadsManagement');
        if (el) el.classList.remove('active');
    }
}

// Show/hide nav + sidebar padding based on auth state
function updateBottomNav(show) {
    var nav = document.getElementById('bottomNav');
    if (nav) {
        nav.classList.toggle('bottom-nav-hidden', !show);
    }
    document.body.classList.toggle('sidebar-active', show);
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

    var leadsBtn = document.getElementById('navLeadsMgmtBtn');
    if (leadsBtn) leadsBtn.style.display = (perms.leadsManagement || perms.salesManagement || currentUserRole === 'master') ? '' : 'none';

    var usersBtn = document.getElementById('navUserMgmtBtn');
    if (usersBtn) usersBtn.style.display = perms.userManagement ? '' : 'none';

    // Also update overflow menu items (mobile "More" menu)
    var overflowLeads = document.getElementById('navOverflowLeads');
    if (overflowLeads) overflowLeads.style.display = (perms.leadsManagement || perms.salesManagement || currentUserRole === 'master') ? '' : 'none';

    var overflowLog = document.getElementById('navOverflowLog');
    if (overflowLog) overflowLog.style.display = perms.activityLog ? '' : 'none';

    var overflowUsers = document.getElementById('navOverflowUsers');
    if (overflowUsers) overflowUsers.style.display = perms.userManagement ? '' : 'none';

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

// ========== User Greeting ==========

var _greetingInterval = null;

function showUserGreeting(displayName) {
    var el = document.getElementById('userGreeting');
    if (!el) return;

    var hour = new Date().getHours();
    var timeOfDay = hour < 12 ? 'בוקר טוב' : (hour < 17 ? 'צהריים טובים' : (hour < 21 ? 'ערב טוב' : 'לילה טוב'));
    var greetStr = timeOfDay + ', ' + displayName;

    var greetText = document.getElementById('greetingText');
    if (greetText) greetText.textContent = greetStr;

    // Also set top-nav greeting (desktop)
    var topGreetText = document.getElementById('topNavGreetingText');
    if (topGreetText) topGreetText.textContent = greetStr;

    updateGreetingTime();
    el.style.display = '';

    // Update time every minute
    if (_greetingInterval) clearInterval(_greetingInterval);
    _greetingInterval = setInterval(updateGreetingTime, 60000);
}

function updateGreetingTime() {
    var now = new Date();
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var timeStr = hours + ':' + minutes;

    var el = document.getElementById('greetingTime');
    if (el) el.textContent = timeStr;

    // Also update top-nav time (desktop)
    var topTime = document.getElementById('topNavGreetingTime');
    if (topTime) topTime.textContent = timeStr;
}

// ========== Desktop Sidebar Toggle ==========

function toggleSidebar() {
    // Only toggle on desktop (≥1024px)
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    // Enable transition only during toggle
    document.body.classList.add('sidebar-animating');
    document.body.classList.toggle('sidebar-collapsed');
    try {
        localStorage.setItem('sidebar_collapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
    } catch (e) {}
    // Remove transition class after animation completes
    setTimeout(function() {
        document.body.classList.remove('sidebar-animating');
    }, 300);
}

// Restore sidebar state on load (desktop only)
(function() {
    try {
        if (window.matchMedia('(min-width: 1024px)').matches && localStorage.getItem('sidebar_collapsed') === '1') {
            document.body.classList.add('sidebar-collapsed');
        }
    } catch (e) {}
})();

// ========== Mobile Overflow Menu ("More" button) ==========

function toggleNavOverflow() {
    var menu = document.getElementById('navOverflowMenu');
    var backdrop = document.getElementById('navOverflowBackdrop');
    if (!menu) return;

    var isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : '';
    if (backdrop) backdrop.style.display = isOpen ? 'none' : '';
}

function closeNavOverflow() {
    var menu = document.getElementById('navOverflowMenu');
    var backdrop = document.getElementById('navOverflowBackdrop');
    if (menu) menu.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
}

// Close overflow on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        var menu = document.getElementById('navOverflowMenu');
        if (menu && menu.style.display !== 'none') {
            closeNavOverflow();
        }
    }
});
