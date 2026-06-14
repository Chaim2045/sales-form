// ===== Idle Timeout — logout אוטומטי אחרי חוסר-פעילות (כל ה-CRM) =====
// מאבטח מפני "מחשב נטוש": אחרי 30 דק' בלי פעילות → התנתקות אוטומטית.
// הטיימר מתאפס על כל פעילות. פעילות בתוך ה-iframe של התזרים מגיעה דרך postMessage
// (same-origin) כדי שעבודה בו לא תנותק בטעות. ראה .claude/SHARED-CONTEXT.md §9.
(function () {
    var IDLE_MS = 30 * 60 * 1000;   // 30 דקות
    var WARN_MS = 60 * 1000;        // אזהרה דקה לפני
    var idleTimer = null, warnTimer = null, warnEl = null;

    function doLogout() {
        if (typeof auth !== 'undefined' && auth && auth.currentUser) {
            if (typeof logAuditEvent === 'function') { try { logAuditEvent('auto_logout_idle'); } catch (e) {} }
            if (typeof handleLogout === 'function') handleLogout();
            else auth.signOut();
        }
    }
    function showWarn() {
        if (warnEl) return;
        warnEl = document.createElement('div');
        warnEl.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#202124;color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.3);font-family:Heebo,sans-serif;direction:rtl';
        warnEl.textContent = 'תנותק בעוד דקה עקב חוסר-פעילות — הזז את העכבר כדי להישאר מחובר.';
        document.body.appendChild(warnEl);
    }
    function clearWarn() { if (warnEl) { warnEl.remove(); warnEl = null; } }

    function reset() {
        if (idleTimer) clearTimeout(idleTimer);
        if (warnTimer) clearTimeout(warnTimer);
        clearWarn();
        warnTimer = setTimeout(showWarn, IDLE_MS - WARN_MS);
        idleTimer = setTimeout(doLogout, IDLE_MS);
    }

    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
        document.addEventListener(ev, reset, { passive: true });
    });
    // פעילות בתוך ה-iframe של התזרים (same-origin בלבד)
    window.addEventListener('message', function (e) {
        if (e.origin === window.location.origin && e.data === 'yf-activity') reset();
    });
    reset();
})();
