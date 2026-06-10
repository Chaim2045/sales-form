/*
 * ============================================================================
 * ⛔ מודול YF Dashboards — תזרים (Cashflow)  ·  אי מבודד לחלוטין
 * ============================================================================
 * נפרד לחלוטין מ-CRM "טופס מכר" וממערכת ניהול המשימות. אסור לערבב!
 *  • DB נפרד: collection `yf_cashflow`, doc יחיד `office` (גלובלי-משרדי).
 *  • אסור לקרוא/לכתוב ל-sales_records / clients / leads / recurring_billing
 *    / timesheet_entries או כל collection משותף.
 *  • גישה: owner-only (guy@ghlawoffice.co.il + haim@ghlawoffice.co.il)
 *    + grants זמניים שגיא מעניק (collection `yf_access`).
 *  • ראה .claude/SHARED-CONTEXT.md §9.
 * מקור: Yoram Fishman single-file (localStorage `yf_v4`) → Firestore (Lift & Shift).
 * ============================================================================
 */

// ===== iframe mount (הדשבורד עצמו חי ב-/yf/cashflow.html — אי מבודד) =====
var yfCfLoaded = false;

// תבנית CRM: hide mainContainer + class 'active'. ה-iframe נבנה lazily בפתיחה ראשונה.
function showYfCashflow() {
    document.getElementById('mainContainer').style.display = 'none';
    var view = document.getElementById('yfCashflowView');
    if (!yfCfLoaded) {
        var f = document.createElement('iframe');
        f.src = '/yf/cashflow.html';
        f.title = 'דשבורד תזרים';
        view.innerHTML = '';            // מסיר את ה-placeholder "טוען…"
        view.appendChild(f);
        yfCfLoaded = true;              // non-owner לעולם לא מגיע לכאן → ה-iframe לא נטען
    }
    view.classList.add('active');
}

function hideYfCashflow() {
    var el = document.getElementById('yfCashflowView');
    if (el) el.classList.remove('active');   // ה-iframe נשאר ב-DOM לפתיחה חוזרת מהירה
}
