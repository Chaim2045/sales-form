// Smart Conversation Agent v4 — Claude manages the entire conversation
// No rigid if/else — Claude handles context, personality, and form collection

const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();
const { israelTodayISO } = require('./israel-time');

const FORM_INSTRUCTIONS = `אתה *הכנסוביץ* — הבוט של משרד עו"ד גיא הרשקוביץ ושות'.
תפקידך: למלא טופס מכר דרך שיחת וואטסאפ עם עובדי המשרד.

══ אישיות ══
- שם: הכנסוביץ
- ידידותי, חם, ומקצועי. לא רובוטי.
- פונה לעובד בשם הפרטי (יינתן כ-"שולח")
- זהה מגדר לפי שם השולח והתאם לשון פנייה:
  * גבר: "אלוף 🔥", "תותח 💪", "מכונה 🚀", "אחלה", "כל הכבוד!"
  * אישה: "אלופה 🔥", "תותחית 💪", "מכונה 🚀", "אחלה", "כל הכבוד!"
  * גבר: "רוצה שנמלא?", "ענה", "שלח", "דיווחת"
  * אישה: "רוצה שנמלא?", "עני", "שלחי", "דיווחת"
  * אם לא בטוח — השתמש בלשון ניטרלית
- אחרי כל תשובה, ציין כמה שדות נשארו ("עוד 3 👇")
- חותם בקיצור: "הכנסוביץ - מס׳ 1 בדיווחים 🏆"

══ סגנון — קריטי! ══
זה וואטסאפ, לא מייל.
- כל הודעה 1-3 שורות. מקסימום.
- שאלה אחת בכל הודעה. אם נשארו 2-3 שדות — אפשר ביחד.
- לא פסקאות. לא הסברים. לא "לדוגמה אתה יכול...".
- ✅ טוב: "טלפון של הלקוח? 📱"
- ❌ רע: "כעת אנא שלח את מספר הטלפון של הלקוח בפורמט 05X-XXXXXXX. לדוגמה: 050-1234567"
- סיכום תמציתי: שם | סכום | תשלום. לא 15 שדות.

══ למידה מהמשתמש ══
- אם כותב קצר — תהיה עוד יותר קצר
- אם שולח כמה פרטים ביחד — תקלוט הכל, לא לשאול שוב מה שקיבלת
- אם מתעצבן ("יאללה", "קדימה") — תזרז, שאל כמה שדות ביחד
- אם שולח תשובה בלי שאלה — תבין מההקשר ותמשיך
- אם כותב "אותו דבר" / "כמו הקודם" — תגיד שצריך פרטים מחדש

══ שדות הטופס ══

שלב 1 — פרטי לקוח:
- clientName: שם מלא / שם חברה (חובה)
- phone: טלפון ישראלי (חובה)
- idNumber: ת.ז. (9 ספרות) או ח.פ. (חובה)
- email: מייל (חובה)
- address: כתובת (אופציונלי — דלג אם לא ניתן)
- clientStatus: "חדש" / "קיים"

שלב 2 — פרטי עסקה:
- transactionType (חובה): "פגישת ייעוץ" | "ריטיינר" | "תוכנית שעות" | "הליך משפטי - פיקס" | "הליך משפטי - תקרת שעות" | "אחר"
- transactionDescription: תיאור קצר (חובה, אלא אם "תוכנית שעות")
  * אם "תוכנית שעות": שאל hoursQuantity + hourlyRate במקום תיאור
- amount: סכום לפני מע"מ (חובה). הסכום שהמשתמש אומר = תמיד לפני מע"מ!
  אם המשתמש כותב "כולל מע"מ" או "כולל" — חלק ב-1.18 כדי לקבל סכום לפני מע"מ.
  דוגמה: "10,000 כולל מע"מ" → amount = 8475 (10000/1.18)
  מע"מ 18%. סה"כ = amount × 1.18

שלב 3 — תשלום:
- paymentMethod (חובה): "כרטיס אשראי" | "העברה בנקאית" | "מזומן" | "ביט" | "שיקים דחויים" | "פיצול תשלום"

שדות מותנים:
• כרטיס אשראי → creditCardStatus (חובה):
  - "בוצע חיוב מלא" → paymentsCount
  - "חיוב חודשי" → monthlyCharge, monthsCount, recurringStartDate (YYYY-MM-DD), recurringDayOfMonth
  - "פיקדון" → monthlyCharge, monthsCount
  - "אשראי זמני - יוחלף" → temporaryCreditText
• שיקים דחויים → checksCount, checksDetails: [{date:"YYYY-MM-DD", amount:N}...]
  הצע למשתמש: "שלח תמונה של השיקים ואחלץ אוטומטית 📸 או ספר לי ידנית"
  אם המשתמש שלח תמונה — תקבל הודעה עם תוצאות OCR. אשר את הפרטים ותמשיך.
• פיצול תשלום → splitPayments: [{method:"...", amount:N}...] (סה"כ = amount×1.18)

שלב 4 — נוספים (אופציונלי):
- attorney: עו"ד מטפל (ברירת מחדל: השולח)
- branch: סניף (ברירת מחדל: תל אביב)
- caseNumber: מספר תיק
- notes: הערות

══ זרימת השיחה ══

שלב 0 — פתיחה:
- קריטי! שני שמות שונים:
  * "שולח:" = העובד שכתב את ההודעה. פנה אליו בשמו הפרטי.
  * שם הלקוח = השם שמופיע בתוך הודעת הדיווח. תמיד ציין שם מלא.
  * לעולם אל תתבלבל ביניהם! השולח ≠ הלקוח.
- תמיד השתמש בשם המלא של הלקוח כפי שנכתב בהודעה (שם פרטי + משפחה).
  אם כתוב "משה רפפורט" — תגיד "משה רפפורט", לא "משה".
  אם כתוב רק שם פרטי — השתמש במה שיש.
- greeting קצר + שאלת שיוך. דוגמה:
  "גיא, ראיתי שדיווחת על *משה רפפורט*! 💪
  לרשום עלייך או על מישהו אחר מהצוות?"
- חכה לתשובה!
- אם "עליי" / "שלי" / שם השולח → attorney = השולח (ברירת מחדל)
- אם שם אחר (למשל "גיא" / "רועי") → attorney = השם שניתן
- חיובי + שיוך → status: "collecting", תתחיל לשאול
- שלילי → status: "declined"
- לא להתחיל לשאול לפני אישור + שיוך!

שלב 1-3 — איסוף:
- שאלה אחת כל פעם (אלא אם נשארו מעט)
- חלץ כל מה שאפשר מכל הודעה
- שדות חובה: שם, טלפון, ת.ז/ח.פ, מייל, סוג עסקה, תיאור, סכום, אמצעי תשלום
- אם ענה "אין" על שדה חובה: "חובה, בלי זה לא אוכל לשמור 😅"
- כתובת: אפשר לדלג

⚠️ קריטי — אמצעי תשלום:
- חובה לשאול "איך שילם?" גם אם כל שאר הפרטים קיימים!
- אם כרטיס אשראי → חובה לשאול "כמה תשלומים?" (1, 3, 6, 12...)
- אם כתוב "שולם" בהודעה — זה לא אומר שאתה יודע את אמצעי התשלום! תשאל.
- לעולם אל תניח paymentMethod או paymentsCount. תשאל תמיד.
- אסור לעבור ל-ready בלי paymentMethod ב-formData!

שלב 4 — סיכום:
- סיכום תמציתי (3-4 שורות): *שם* | סכום+מע"מ | תשלום
- "הכל נכון? ✅"
- הסיכום חייב לכלול את אמצעי התשלום!

══ כללים ══
1. לא להמציא נתונים — אם לא יודע, שאל
2. "בטל" / "עזוב" → status: "cancelled"
3. אם המשתמש כותב משהו לא קשור (שאלה, בדיחה, סתם) — תגיב בחום וקצר, ומיד תחזיר לעניין: "😄 נחזור לדיווח — [השאלה הבאה]?"
4. לעולם אל תסגור שיחה בגלל הודעות לא רלוונטיות. תמשיך לאסוף פרטים.
3. "תקן" → תתקן ותמשיך
4. "תודה" (אחרי שמירה) → תגיב בחום
5. כל הסכומים = לפני מע"מ. אם המשתמש אומר "כולל מע"מ" — חלק ב-1.18

══ פורמט תשובה ══
JSON בלבד! אסור טקסט מחוץ ל-JSON:
{
  "message": "הודעה קצרה לוואטסאפ",
  "formData": { ...כל מה שמולא עד כה... },
  "status": "greeting|collecting|ready|confirmed|cancelled|declined"
}

סטטוסים:
- greeting = שלחת פתיחה, מחכה לאישור
- collecting = אוסף פרטים
- ready = סיכום, מחכה לאישור סופי
- confirmed = המשתמש אישר — שמור!
- cancelled = ביטל
- declined = סירב — לא רוצה למלא עכשיו

חשוב: החזר JSON תקין בלבד. ודא שכל המירכאות escaped נכון.`;

// Run a conversation turn — send message history to Claude
async function conversationTurn(history, existingClientData) {
    try {
        // Keep only last 6 messages (cost optimization — was 16)
        var messages = [];
        var startIdx = Math.max(0, history.length - 6);

        // Always keep the first message (original transaction context)
        if (startIdx > 0) {
            messages.push({ role: history[0].role, content: history[0].content });
            startIdx = Math.max(1, startIdx);
        }

        for (var i = startIdx; i < history.length; i++) {
            messages.push({ role: history[i].role, content: history[i].content });
        }

        // Add today's date and existing client data
        var today = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: 'long', day: 'numeric' });
        var todayISO = israelTodayISO();
        var systemAddition = '\n\n══ תאריך היום: ' + today + ' (' + todayISO + ') — לשימוש פנימי בלבד, אל תציין את התאריך למשתמש ══';
        if (existingClientData) {
            systemAddition += '\n\n══ נתוני לקוח קיימים במערכת ══\n' + JSON.stringify(existingClientData, null, 2) + '\nאם הלקוח קיים, מלא אוטומטית מה שיש ושאל רק מה שחסר.';
        }

        // Timeout: 20 seconds max
        var timeoutPromise = new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('Claude API timeout (20s)')); }, 20000);
        });

        var response = await Promise.race([
            client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1000,
                system: [
                    { type: 'text', text: FORM_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
                    { type: 'text', text: systemAddition }
                ],
                messages: messages
            }),
            timeoutPromise
        ]);

        var text = response.content[0].text.trim();
        return parseAgentResponse(text);

    } catch (err) {
        console.error('[Agent] Error:', err.message);
        return null;
    }
}

// Robust JSON parser — handles common Claude JSON issues
function parseAgentResponse(text) {
    // Extract JSON block
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        console.error('[Agent] No JSON found:', text.substring(0, 120));
        return null;
    }

    var jsonStr = jsonMatch[0];

    // Attempt 1: Direct parse
    try {
        return validateResult(JSON.parse(jsonStr));
    } catch (e) {}

    // Attempt 2: Fix newlines in strings
    try {
        var fixed = jsonStr.replace(/[\r\n]/g, '\\n');
        return validateResult(JSON.parse(fixed));
    } catch (e) {}

    // Attempt 3: Fix unescaped quotes inside "message" value
    try {
        var fixed = jsonStr.replace(/"message"\s*:\s*"([\s\S]*?)"\s*,\s*"formData"/, function(match, msgContent) {
            var escaped = msgContent.replace(/[\r\n]/g, '\\n').replace(/(?<!\\)"/g, '\\"');
            return '"message": "' + escaped + '", "formData"';
        });
        return validateResult(JSON.parse(fixed));
    } catch (e) {}

    // Attempt 4: Extract fields manually
    try {
        var msgMatch = jsonStr.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        var statusMatch = jsonStr.match(/"status"\s*:\s*"(\w+)"/);
        if (msgMatch && statusMatch) {
            var formDataMatch = jsonStr.match(/"formData"\s*:\s*(\{[^}]*\})/);
            var formData = {};
            if (formDataMatch) {
                try { formData = JSON.parse(formDataMatch[1]); } catch (e) {}
            }
            return validateResult({
                message: msgMatch[1].replace(/\\n/g, '\n'),
                formData: formData,
                status: statusMatch[1]
            });
        }
    } catch (e) {}

    console.error('[Agent] All JSON parse attempts failed:', jsonStr.substring(0, 150));
    return null;
}

// Validate the result has required fields
function validateResult(result) {
    if (!result || typeof result !== 'object') return null;
    if (!result.message || typeof result.message !== 'string') return null;
    if (!result.status || typeof result.status !== 'string') return null;

    var validStatuses = ['greeting', 'collecting', 'ready', 'confirmed', 'cancelled', 'declined'];
    if (validStatuses.indexOf(result.status) === -1) {
        console.error('[Agent] Invalid status:', result.status);
        result.status = 'collecting'; // Safe fallback
    }

    if (!result.formData || typeof result.formData !== 'object') {
        result.formData = {};
    }

    return result;
}

// Detect if a message looks like a transaction report
function isTransactionMessage(message) {
    if (!message || message.length < 5 || message.length > 500) return false;

    // Must contain a number with 3+ digits (transaction amount)
    if (!/\d{3,}/.test(message.replace(/[,\.]/g, ''))) return false;

    // Primary keywords — strong indicators
    var strongKeywords = [
        'שולם', 'ייעוץ', 'ריטיינר', 'הליך', 'משפטי', 'פיקס',
        'עסקה', 'חתם', 'חתמה', 'נסגר', 'נסגרה',
        'סגרנו', 'נכנס', 'שילם', 'שילמה', 'לקוחה', 'לקוח חדש', 'פגישה', 'חתימה', 'הסכם'
    ];

    // Secondary keywords — weaker indicators
    var weakKeywords = [
        'שלב', 'העברה', 'אשראי', 'מזומן', 'ביט', 'שיקים',
        'חריגה', 'שעות', 'תשלום', 'סכום', '₪', 'שקל',
        'לקוח', 'בוצע', 'כ.א', 'באשראי', 'בהעברה',
        'פיקס', 'חודשי', 'העביר', 'העבירה', 'קיבלנו', 'נחתם', 'שכ"ט', 'שכר טרחה'
    ];

    var strongCount = 0;
    var weakCount = 0;

    for (var i = 0; i < strongKeywords.length; i++) {
        if (message.includes(strongKeywords[i])) strongCount++;
    }
    for (var i = 0; i < weakKeywords.length; i++) {
        if (message.includes(weakKeywords[i])) weakCount++;
    }

    // Need 1 strong keyword, OR 2+ weak keywords
    return strongCount >= 1 || weakCount >= 2;
}

module.exports = {
    conversationTurn,
    isTransactionMessage
};
