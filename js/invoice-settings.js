// ========== Invoice Settings (Master / invoiceSettings permission only) ==========
// שלב D — פאנל שליטה ל-CRM על מנוע הפקת החשבוניות (issue-invoice.js).
// כותב ל-invoice_config/default (merge). הפונקציה issue-invoice.js קוראת מסמך זה.
// אדיטיבי בלבד: לא משנה/מוחק שדות קיימים; מירור דפוס js/user-management.js.
//
// Q1 (נעול): GREEN_INVOICE_BASE_URL (Netlify env) הוא מקור-האמת ל-sandbox/prod.
//            הפאנל מציג סביבה ל-read-only בלבד (אינדיקטור מהעסקה האחרונה).
// Q2 (נעול): הפאנל שולט במנוע דרך invoice_config/default.
//
// מבנה invoice_config/default:
//   { docTypeMap: { "מזומן":{docType,payType}, "ביט":{...},
//                   "העברה בנקאית":{...}, "כרטיס אשראי_מלא":{...} },
//     requireApproval: bool, defaultChannels: {whatsapp:bool, email:bool},
//     updatedAt, updatedBy }

// ─── enums סגורים (חייבים לתאום ל-VALID_DOC/VALID_PAY ב-netlify/functions/issue-invoice.js:42-43) ───
var IS_DOC_TYPES = [
    { value: 320, label: 'חשבונית מס/קבלה (320)' },
    { value: 400, label: 'קבלה (400)' },
    { value: 305, label: 'חשבונית מס (305)' },
    { value: 330, label: 'חשבונית זיכוי (330)' }
];
var IS_PAY_TYPES = [
    { value: 1, label: 'מזומן (1)' },
    { value: 2, label: 'שיק (2)' },
    { value: 3, label: 'כרטיס אשראי (3)' },
    { value: 4, label: 'העברה בנקאית (4)' },
    { value: 5, label: 'אפליקציה/ביט (5)' }
];

// אמצעי-התשלום (מפתחות docTypeMap) — חייבים לתאום ל-DEFAULT_DOC_TYPE_MAP ב-issue-invoice.js:45-50
var IS_METHOD_KEYS = [
    { key: 'מזומן', label: 'מזומן' },
    { key: 'ביט', label: 'ביט' },
    { key: 'העברה בנקאית', label: 'העברה בנקאית' },
    { key: 'כרטיס אשראי_מלא', label: 'כרטיס אשראי (חיוב מלא)' }
];

// ברירת-מחדל בטוחה כשהמסמך חסר (משקפת את DEFAULT_DOC_TYPE_MAP / DEFAULT_REQUIRE_APPROVAL בשרת)
var IS_DEFAULT_CONFIG = {
    docTypeMap: {
        'מזומן': { docType: 320, payType: 1 },
        'ביט': { docType: 320, payType: 5 },
        'העברה בנקאית': { docType: 320, payType: 4 },
        'כרטיס אשראי_מלא': { docType: 320, payType: 3 }
    },
    requireApproval: true,
    defaultChannels: { whatsapp: true, email: true }
};

var _isConfig = null; // העתק מקומי של הקונפיג הנוכחי (אחרי טעינה)
var _isDirty = false; // יש שינויים שלא נשמרו (שמירה מפורשת, פחות "אופס" על מנוע-המס)

// ─── הצגת ה-view + טעינה (מירור showUserManagement) ───
function showInvoiceSettings() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('mainForm').classList.add('hidden');
    var view = document.getElementById('invoiceSettings');
    if (view) view.classList.add('active');
    loadInvoiceSettings();
}

function hideInvoiceSettings() {
    var el = document.getElementById('invoiceSettings');
    if (el) el.classList.remove('active');
}

// קריאה בטוחה: מבנה לא-תקין/חלקי → מתמזג עם ברירת-המחדל (לא נשבר אם שדה חסר)
function _isNormalizeConfig(data) {
    var d = data || {};
    var dtm = (d.docTypeMap && typeof d.docTypeMap === 'object') ? d.docTypeMap : {};
    var out = { docTypeMap: {}, requireApproval: false, defaultChannels: { whatsapp: true, email: true } };
    IS_METHOD_KEYS.forEach(function(m) {
        var e = dtm[m.key] || {};
        var def = IS_DEFAULT_CONFIG.docTypeMap[m.key];
        var dt = Number(e.docType);
        var pt = Number(e.payType);
        out.docTypeMap[m.key] = {
            docType: _isValidDoc(dt) ? dt : def.docType,
            payType: _isValidPay(pt) ? pt : def.payType
        };
    });
    out.requireApproval = (d.requireApproval === true || d.requireApproval === false) ? d.requireApproval : IS_DEFAULT_CONFIG.requireApproval;
    out.enabled = (d.enabled === true); // 🛑 fail-closed: רק true = מנוע פעיל; חסר/אחר → כבוי
    var ch = (d.defaultChannels && typeof d.defaultChannels === 'object') ? d.defaultChannels : {};
    out.defaultChannels = {
        whatsapp: ch.whatsapp !== false, // ברירת-מחדל true
        email: ch.email !== false
    };
    return out;
}

function _isValidDoc(v) { return IS_DOC_TYPES.some(function(o) { return o.value === v; }); }
function _isValidPay(v) { return IS_PAY_TYPES.some(function(o) { return o.value === v; }); }

async function loadInvoiceSettings() {
    var loading = document.getElementById('isLoading');
    var body = document.getElementById('isBody');
    if (loading) loading.style.display = '';
    if (body) body.style.display = 'none';

    try {
        var doc = await db.collection('invoice_config').doc('default').get();
        _isConfig = _isNormalizeConfig(doc.exists ? doc.data() : null);
    } catch (err) {
        console.error('Error loading invoice config:', err);
        _isConfig = _isNormalizeConfig(null); // defaults בטוחים
    }

    renderInvoiceSettings();

    // אינדיקטור-סביבה read-only — מהעסקה האחרונה (ניתן להיכשל בשקט; לא חוסם את הפאנל)
    loadInvoiceEnvIndicator();

    if (loading) loading.style.display = 'none';
    if (body) body.style.display = '';
}

// ─── רינדור עורך ה-docTypeMap + toggles ───
function renderInvoiceSettings() {
    var cfg = _isConfig || _isNormalizeConfig(null);
    var isMasterUser = (typeof currentUserRole !== 'undefined' && currentUserRole === 'master');

    // (0) 🛑 מתג-עצירה ראשי (kill switch) — בראש הפאנל. master בלבד (נאכף גם ב-rules). שמירה מפורשת.
    var killHtml =
        '<div class="is-section" style="border:1px solid ' + (cfg.enabled ? '#fca5a5' : '#cbd5e1') + ';background:' + (cfg.enabled ? '#fef2f2' : '#f8fafc') + ';border-radius:10px;padding:14px 16px;">' +
            '<h3 class="is-section-title">🛑 מנוע הפקת החשבוניות</h3>' +
            '<div class="is-toggle-row">' +
                '<label class="um-toggle">' +
                    '<input type="checkbox" id="isEnabled" ' + (cfg.enabled ? 'checked' : '') + (isMasterUser ? '' : ' disabled') + ' onchange="toggleInvoiceEnabled(this.checked)">' +
                    '<span class="um-toggle-slider"></span>' +
                '</label>' +
                '<span class="is-toggle-label">' + (cfg.enabled ? '<strong style="color:#b91c1c;">פעיל</strong> — חשבוניות מופקות לפי ההגדרות' : '<strong style="color:#475569;">כבוי</strong> — לא תופק אף חשבונית (עצירה מלאה)') + (isMasterUser ? '' : ' · <span style="color:#94a3b8;">master בלבד</span>') + '</span>' +
            '</div>' +
        '</div>';

    // (א) עורך docTypeMap — שורה לכל אמצעי, 2 dropdowns סגורים
    var rows = '';
    IS_METHOD_KEYS.forEach(function(m) {
        var entry = cfg.docTypeMap[m.key] || IS_DEFAULT_CONFIG.docTypeMap[m.key];

        var docOpts = '';
        IS_DOC_TYPES.forEach(function(o) {
            var sel = (Number(entry.docType) === o.value) ? ' selected' : '';
            docOpts += '<option value="' + o.value + '"' + sel + '>' + escapeHTML(o.label) + '</option>';
        });
        var payOpts = '';
        IS_PAY_TYPES.forEach(function(o) {
            var sel = (Number(entry.payType) === o.value) ? ' selected' : '';
            payOpts += '<option value="' + o.value + '"' + sel + '>' + escapeHTML(o.label) + '</option>';
        });

        // data-key מועבר ל-handler; ערכי ה-key מוגבלים ל-IS_METHOD_KEYS (לא user-input)
        rows += '<tr>' +
            '<td style="font-weight:600;color:#0f172a;">' + escapeHTML(m.label) + '</td>' +
            '<td><select class="um-role-select is-doc-select" data-key="' + escapeHTML(m.key) + '" onchange="changeInvoiceDocType(this.getAttribute(\'data-key\'), this.value)">' + docOpts + '</select></td>' +
            '<td><select class="um-role-select is-pay-select" data-key="' + escapeHTML(m.key) + '" onchange="changeInvoicePayType(this.getAttribute(\'data-key\'), this.value)">' + payOpts + '</select></td>' +
            '</tr>';
    });

    var docMapHtml =
        '<div class="is-section">' +
            '<h3 class="is-section-title">מיפוי סוג-מסמך לפי אמצעי תשלום</h3>' +
            '<p class="is-section-hint">איזה מסמך Green Invoice מופק עבור כל אמצעי גבייה. שינוי נכנס לתוקף <strong>לאחר שמירה</strong>, עבור הפקות עתידיות.</p>' +
            '<div class="bm-table-wrapper"><table class="bm-table is-table">' +
                '<thead><tr><th>אמצעי תשלום</th><th>סוג מסמך</th><th>סוג תשלום (GI)</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
            '</table></div>' +
        '</div>';

    // (ב) toggle requireApproval
    var approvalHtml =
        '<div class="is-section">' +
            '<h3 class="is-section-title">אישור לפני הפקה</h3>' +
            '<div class="is-toggle-row">' +
                '<label class="um-toggle">' +
                    '<input type="checkbox" id="isRequireApproval" ' + (cfg.requireApproval ? 'checked' : '') + (isMasterUser ? '' : ' disabled') + ' onchange="toggleInvoiceRequireApproval(this.checked)">' +
                    '<span class="um-toggle-slider"></span>' +
                '</label>' +
                '<span class="is-toggle-label">דרוש אישור ידני לפני הפקת חשבונית (כשכבוי — הפקה אוטומטית)</span>' +
            '</div>' +
        '</div>';

    // (ג) 2 toggles defaultChannels
    var channelsHtml =
        '<div class="is-section">' +
            '<h3 class="is-section-title">ערוצי שליחה ברירת-מחדל</h3>' +
            '<div class="is-toggle-row">' +
                '<label class="um-toggle">' +
                    '<input type="checkbox" id="isChannelWhatsapp" ' + (cfg.defaultChannels.whatsapp ? 'checked' : '') + ' onchange="toggleInvoiceChannel(\'whatsapp\', this.checked)">' +
                    '<span class="um-toggle-slider"></span>' +
                '</label>' +
                '<span class="is-toggle-label">שליחת קישור לחשבונית ב-WhatsApp</span>' +
            '</div>' +
            '<div class="is-toggle-row">' +
                '<label class="um-toggle">' +
                    '<input type="checkbox" id="isChannelEmail" ' + (cfg.defaultChannels.email ? 'checked' : '') + ' onchange="toggleInvoiceChannel(\'email\', this.checked)">' +
                    '<span class="um-toggle-slider"></span>' +
                '</label>' +
                '<span class="is-toggle-label">שליחת חשבונית במייל (Green Invoice שולח אוטומטית כשיש כתובת)</span>' +
            '</div>' +
        '</div>';

    // (ד) תצוגת-סביבה read-only (ימולא ע"י loadInvoiceEnvIndicator)
    var envHtml =
        '<div class="is-section">' +
            '<h3 class="is-section-title">סביבת עבודה</h3>' +
            '<div class="is-env-row">' +
                '<span class="is-env-badge" id="isEnvBadge">בודק…</span>' +
                '<span class="is-env-note">הסביבה נקבעת ב-Netlify env (GREEN_INVOICE_BASE_URL) — תצוגה זו לקריאה בלבד, מבוססת על העסקה האחרונה שהופקה.</span>' +
            '</div>' +
        '</div>';

    // (ה) פס שמירה מפורשת — שינויים נכנסים לתוקף רק בלחיצה (פחות "אופס" על מנוע-המס)
    var saveBarHtml =
        '<div style="position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;margin-top:16px;background:#fff;border-top:1px solid #e2e8f0;box-shadow:0 -2px 8px rgba(0,0,0,0.04);">' +
            '<span id="isDirtyStatus" style="font-size:13px;color:#64748b;">הכל שמור</span>' +
            '<div style="display:flex;gap:8px;">' +
                '<button onclick="cancelInvoiceSettings()" style="padding:8px 16px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;font-family:Heebo,sans-serif;font-size:14px;cursor:pointer;">בטל שינויים</button>' +
                '<button id="isSaveBtn" onclick="commitInvoiceSettings()" disabled style="padding:8px 20px;border:none;background:#3b82f6;color:#fff;border-radius:8px;font-family:Heebo,sans-serif;font-size:14px;font-weight:600;opacity:0.5;cursor:default;">שמירה</button>' +
            '</div>' +
        '</div>';

    var body = document.getElementById('isBody');
    if (body) body.innerHTML = killHtml + approvalHtml + docMapHtml + channelsHtml + envHtml + saveBarHtml;
    _isDirty = false;
    _isUpdateSaveBar();
}

// ─── אינדיקטור-סביבה read-only מהעסקה האחרונה ב-sales_records ───
async function loadInvoiceEnvIndicator() {
    var badge = document.getElementById('isEnvBadge');
    if (!badge) return;
    try {
        // ללא orderBy → אין צורך באינדקס מורכב; בוחרים את האחרונה לפי invoiceIssuedAt בצד-לקוח
        var snap = await db.collection('sales_records')
            .where('invoiceIssued', '==', true)
            .limit(15)
            .get();
        var best = null;
        snap.forEach(function(d) {
            var x = d.data();
            if (!x.invoiceEnv) return;
            var t = x.invoiceIssuedAt && x.invoiceIssuedAt.toMillis ? x.invoiceIssuedAt.toMillis() : 0;
            if (!best || t > best.t) best = { env: x.invoiceEnv, t: t };
        });
        _isApplyEnvBadge(best ? best.env : '');
    } catch (err) {
        console.warn('env indicator failed:', err && err.message);
        _isApplyEnvBadge('');
    }
}

function _isApplyEnvBadge(env) {
    var badge = document.getElementById('isEnvBadge');
    if (!badge) return;
    badge.classList.remove('is-env-prod', 'is-env-sandbox', 'is-env-unknown');
    if (env === 'prod') {
        badge.textContent = 'פרודקשן (prod)';
        badge.classList.add('is-env-prod');
    } else if (env === 'sandbox') {
        badge.textContent = 'בדיקות (sandbox)';
        badge.classList.add('is-env-sandbox');
    } else {
        badge.textContent = 'לא ידוע (טרם הופקה חשבונית)';
        badge.classList.add('is-env-unknown');
    }
}

// ─── handlers — מעדכנים את ההעתק המקומי ואז שומרים (merge) ───
function changeInvoiceDocType(key, value) {
    if (!_isConfig || !_isConfig.docTypeMap[key]) return;
    var v = Number(value);
    if (!_isValidDoc(v)) return; // הגנה: רק מ-enum סגור
    _isConfig.docTypeMap[key].docType = v;
    _isMarkDirty();
}

function changeInvoicePayType(key, value) {
    if (!_isConfig || !_isConfig.docTypeMap[key]) return;
    var v = Number(value);
    if (!_isValidPay(v)) return;
    _isConfig.docTypeMap[key].payType = v;
    _isMarkDirty();
}

function toggleInvoiceRequireApproval(checked) {
    if (!_isConfig) return;
    _isConfig.requireApproval = !!checked;
    _isMarkDirty();
}

function toggleInvoiceEnabled(checked) {
    if (!_isConfig) return;
    _isConfig.enabled = !!checked;
    _isMarkDirty();
}

function toggleInvoiceChannel(channel, checked) {
    if (!_isConfig || (channel !== 'whatsapp' && channel !== 'email')) return;
    _isConfig.defaultChannels[channel] = !!checked;
    _isMarkDirty();
}

// ─── ניהול "שינויים שלא נשמרו" + פס שמירה/ביטול (שמירה מפורשת) ───
function _isMarkDirty() { _isDirty = true; _isUpdateSaveBar(); }
function _isUpdateSaveBar() {
    var btn = document.getElementById('isSaveBtn');
    var status = document.getElementById('isDirtyStatus');
    if (btn) { btn.disabled = !_isDirty; btn.style.opacity = _isDirty ? '1' : '0.5'; btn.style.cursor = _isDirty ? 'pointer' : 'default'; }
    if (status) {
        status.textContent = _isDirty ? '● יש שינויים שלא נשמרו' : 'הכל שמור';
        status.style.color = _isDirty ? '#b45309' : '#64748b';
        status.style.fontWeight = _isDirty ? '600' : '400';
    }
}
async function commitInvoiceSettings() {
    if (!_isDirty) return;
    await saveInvoiceConfig('שמירה ידנית');
}
function cancelInvoiceSettings() {
    if (!_isDirty) return;
    loadInvoiceSettings(); // טעינה מחדש מהשרת → משליך שינויים מקומיים שלא נשמרו
}

// ─── שמירה: כותב ל-invoice_config/default (merge) + audit + toast ───
async function saveInvoiceConfig(changeSummary) {
    if (!_isConfig) return;
    try {
        var payload = {
            docTypeMap: _isConfig.docTypeMap,
            requireApproval: _isConfig.requireApproval,
            enabled: !!_isConfig.enabled,
            defaultChannels: _isConfig.defaultChannels,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: (authUser && authUser.email) ? authUser.email : (currentUser || 'unknown')
        };
        await db.collection('invoice_config').doc('default').set(payload, { merge: true });

        logAuditEvent('invoice_config_updated', { change: changeSummary || '' });
        _isDirty = false;
        _isUpdateSaveBar();
        showToast('הגדרות החשבוניות נשמרו');
    } catch (err) {
        console.error('Error saving invoice config:', err);
        showToast('שגיאה בשמירת ההגדרות', '#ef4444');
        // טען מחדש כדי לשקף את המצב האמיתי בשרת אחרי כשל
        loadInvoiceSettings();
    }
}

// ============================================================================
// Helper גלובלי — issueInvoiceForSale(saleId, opts)
// ----------------------------------------------------------------------------
// המקום היחיד בקליינט שקורא ל-netlify/functions/issue-invoice.js (החוזה הקבוע).
// POST /.netlify/functions/issue-invoice  · Authorization: Bearer <Firebase ID token>
//   body: { saleId, approve }
//   - בלי approve  → הפקה רגילה (requireApproval פעיל ולא מאושר → {needsApproval:true})
//   - approve:true → אישור master (השרת מאמת master ומפיק)
// תשובה: { success, issued, invoiceNumber, invoiceUrl, needsApproval?, deferred?, inProgress?, error? }
//
// עמיד-לשגיאה: לעולם לא זורק (כדי לא לשבור את הקורא — טופס/גבייה לא-חוסמים).
// כשל → מחזיר { success:false, error } במקום throw.
// ============================================================================
async function issueInvoiceForSale(saleId, opts) {
    try {
        if (!saleId) return { success: false, error: 'no saleId' };
        if (!(typeof authUser !== 'undefined' && authUser && typeof authUser.getIdToken === 'function')) {
            return { success: false, error: 'not authenticated' };
        }
        var idToken = await authUser.getIdToken();
        var res = await fetch('/.netlify/functions/issue-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({ saleId: String(saleId), approve: !!(opts && opts.approve) })
        });
        var json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        if (!json) return { success: false, error: 'bad response (' + res.status + ')' };
        return json;
    } catch (err) {
        // לוג בלבד — לא זורק (קורא לא-חוסם)
        console.error('issueInvoiceForSale failed:', err && err.message);
        return { success: false, error: (err && err.message) || 'request failed' };
    }
}
// חשיפה גלובלית מפורשת (זמין בזמן-קריאה גם אם הקובץ נטען אחרי הקוראים)
window.issueInvoiceForSale = issueInvoiceForSale;
