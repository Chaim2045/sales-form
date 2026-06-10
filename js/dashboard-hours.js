/*
 * ============================================================================
 * ⛔ מודול YF Dashboards — שעות עובד (Hours)  ·  אי מבודד לחלוטין
 * ============================================================================
 * נפרד לחלוטין מ-CRM "טופס מכר" וממערכת ניהול המשימות. אסור לערבב!
 *  • DB נפרד: collection `yf_hours`, doc per-user `{uid}` (כל עובד את שלו;
 *    master רואה את כולם).
 *  • ⚠️ "שעות עובד" כאן ≠ `timesheet_entries` של מערכת ניהול המשימות/הבוט.
 *    אסור לחבר/לערבב ביניהם.
 *  • אסור לקרוא/לכתוב ל-sales_records / clients / leads / recurring_billing
 *    או כל collection משותף.
 *  • גישה: owner-only (guy@ghlawoffice.co.il + haim@ghlawoffice.co.il)
 *    + grants זמניים שגיא מעניק (collection `yf_access`).
 *  • ראה .claude/SHARED-CONTEXT.md §9.
 * מקור: Yoram Fishman single-file (localStorage `yf_hours_v3`) → Firestore (Lift & Shift).
 * ============================================================================
 */

// ===== iframe mount (הדשבורד עצמו חי ב-/yf/hours.html — אי מבודד) =====
var yfHrLoaded = false;

// תבנית CRM: hide mainContainer + class 'active'. ה-iframe נבנה lazily בפתיחה ראשונה.
function showYfHours() {
    document.getElementById('mainContainer').style.display = 'none';
    var view = document.getElementById('yfHoursView');
    if (!yfHrLoaded) {
        var f = document.createElement('iframe');
        f.src = '/yf/hours.html';
        f.title = 'דשבורד שעות עובד';
        view.innerHTML = '';            // מסיר את ה-placeholder "טוען…"
        view.appendChild(f);
        yfHrLoaded = true;              // non-owner לעולם לא מגיע לכאן → ה-iframe לא נטען
    }
    view.classList.add('active');
}

function hideYfHours() {
    var el = document.getElementById('yfHoursView');
    if (el) el.classList.remove('active');   // ה-iframe נשאר ב-DOM לפתיחה חוזרת מהירה
}
