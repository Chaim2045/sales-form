# הכנסוביץ — מדריך בניית הבוט מ-0 לפרודקשן

## מה בנינו
בוט וואטסאפ חכם שמאזין לקבוצת דיווחי עסקאות, מזהה הודעות על עסקאות חדשות, ומנהל שיחה פרטית עם העובד כדי למלא טופס מכר אוטומטית — בלי שהעובד צריך לפתוח אף אתר.

---

## ארכיטקטורה

```
┌─────────────────────────────────────────────────────────┐
│                    WhatsApp Group                        │
│         "דיווח הכנסות מפגישות ומכירות 2026"              │
│                                                         │
│  עובד כותב: "יוסי כהן ייעוץ 5000"                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Kamatera Cloud Server                       │
│              פתח תקווה, ישראל 🇮🇱                         │
│              Ubuntu 22.04 | 1 CPU | 1GB RAM             │
│                                                         │
│  ┌───────────────────────────────────────────────┐      │
│  │           PM2 Process Manager                  │      │
│  │  • auto-restart on crash                       │      │
│  │  • cron restart כל לילה ב-4:00                 │      │
│  │  • max memory 500MB                            │      │
│  │  • startup on boot                             │      │
│  │                                                │      │
│  │  ┌──────────────────────────────────────────┐  │      │
│  │  │        index.js — הליבה                   │  │      │
│  │  │                                          │  │      │
│  │  │  WhatsApp Web.js (Puppeteer + Chrome)    │  │      │
│  │  │       │                                  │  │      │
│  │  │       ▼                                  │  │      │
│  │  │  Message Handler                         │  │      │
│  │  │  • מזהה הודעות עסקה (keywords + מספרים)  │  │      │
│  │  │  • שולח DM לעובד                         │  │      │
│  │  │  • מנהל תור שיחות                        │  │      │
│  │  │  • תזכורות (10 דק, 30 דק, 2 שעות)       │  │      │
│  │  │  • auto-reconnect + health check         │  │      │
│  │  │  • התראות למפעיל                          │  │      │
│  │  │       │                                  │  │      │
│  │  │       ▼                                  │  │      │
│  │  │  agent.js — המוח                         │  │      │
│  │  │  Claude Haiku 4.5 API                    │  │      │
│  │  │  • שיחה טבעית בעברית                     │  │      │
│  │  │  • איסוף שדות טופס                       │  │      │
│  │  │  • זיהוי מגדר לפי שם                     │  │      │
│  │  │  • JSON structured output                │  │      │
│  │  │       │                                  │  │      │
│  │  │       ▼                                  │  │      │
│  │  │  firebase.js — שמירה                     │  │      │
│  │  │  • Firestore (sales_records)             │  │      │
│  │  │  • Audit log                             │  │      │
│  │  │  • חיפוש לקוח קיים                       │  │      │
│  │  │  • Google Sheets sync                    │  │      │
│  │  └──────────────────────────────────────────┘  │      │
│  └───────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────┐  ┌───────────────────────┐
│   Firebase Firestore          │  │   Google Sheets        │
│   • sales_records             │  │   • גיבוי טבלאי       │
│   • recurring_billing         │  │   • דוחות              │
│   • audit_log                 │  │                       │
└──────────────────────────────┘  └───────────────────────┘
```

---

## זרימת עבודה (Flow)

### שלב 1 — זיהוי עסקה
```
עובד כותב בקבוצה: "מירי לוי ייעוץ 8000 באשראי"
                          │
                          ▼
              isTransactionMessage()
              • בודק אורך (5-500 תווים)
              • מחפש מספר עם 3+ ספרות (סכום)
              • מחפש מילות מפתח:
                - חזקות: שולם, ייעוץ, ריטיינר, הליך, משפטי, עסקה, חתם, נסגר
                - חלשות: אשראי, מזומן, ביט, שיקים, תשלום, סכום, ₪, לקוח
              • צריך: 1 חזקה או 2+ חלשות
                          │
                          ▼
                   ✅ מזוהה כעסקה
```

### שלב 2 — פתיחת שיחה
```
הבוט שולח DM פרטי לעובד:
"מירי, תותחית! 🔥 ראיתי דיווח על *מירי לוי*.
נמלא זריז את טופס המכר? 💪
— הכנסוביץ"

מחכה לתשובה:
  • חיובי (כן/יאללה/בוא) → ממשיך לאסוף
  • שלילי (לא/עזוב) → declined flow
```

### שלב 3 — איסוף פרטים
```
Claude שואל שאלה-שאלה:

"טלפון של הלקוח? 📱 (עוד 6 👇)"
→ "050-1234567"

"ת.ז. או ח.פ.? (עוד 5 👇)"
→ "123456789"

"מייל? (עוד 4 👇)"
→ "miri@email.com"

"סוג עסקה? ייעוץ/ריטיינר/שעות/הליך/אחר (עוד 3 👇)"
→ "ייעוץ"

"תיאור קצר? (עוד 2 👇)"
→ "ייעוץ ראשוני בנושא חוזים"

"אמצעי תשלום? אשראי/העברה/מזומן/ביט/שיקים (👇 אחרון!)"
→ "אשראי"
```

### שלב 4 — סיכום ואישור
```
"📋 *סיכום:*
*מירי לוי* | 8,000 ₪ + מע"מ (9,440 ₪) | אשראי
הכל נכון? ✅"

→ "כן"

"✅ *נשמר!* מירי לוי — 9,440 ₪ נרשם במערכת 🎉
— הכנסוביץ"
```

---

## קבצי הפרויקט

### index.js — הליבה (27 KB)
**אחראי על:**
- חיבור WhatsApp דרך `whatsapp-web.js` + Puppeteer (Chrome headless)
- קבלת הודעות (`message` + `message_create` events)
- ניתוב: קבוצה → DM, פרטי → המשך שיחה
- ניהול state: שיחות פעילות, תור, תזכורות
- Auto-reconnect עם exponential backoff (5s → 10s → 20s → ... → 5 min)
- Health check כל 5 דקות
- התראות WhatsApp למפעיל בבעיות
- Rate limiting (2 שניות בין קריאות API)
- Crash protection (uncaughtException + unhandledRejection)
- ניקוי זיכרון שעתי

**State Management:**
```javascript
conversations = {
    "972501234567@c.us": {
        history: [...],           // היסטוריית שיחה ל-Claude
        formData: { ... },        // שדות שמולאו עד כה
        senderName: "חיים",
        originalMessage: "יוסי כהן ייעוץ 5000",
        existingClientData: null, // או נתוני לקוח מ-DB
        timestamp: 1711835000000,
        reminders: 0,
        lastReminder: 0
    }
}
```

**מערכת תזכורות:**
```
10 דקות  → "לא הספקת? נמשיך עם *יוסי כהן*?"
30 דקות  → "עדיין שומר לך את *יוסי כהן*. ענה כשנוח 😊"
2 שעות   → "תזכורת אחרונה — *יוסי כהן* ממתין. ענה *המשך* או *בטל*"
24 שעות  → "העסקה של *יוסי כהן* פגה."
```

**Declined Flow:**
אם העובד אמר "לא רוצה" — הבוט בודק כל שעה אם מילא ידנית בטופס האינטרנטי.
אם כן → "ראיתי שדיווחת! כל הכבוד 💪"
אם לא → תזכורות עדינות עד 6 פעמים.

---

### agent.js — המוח (11 KB)
**אחראי על:**
- System prompt מפורט להכנסוביץ (אישיות, סגנון, שדות)
- קריאה ל-Claude Haiku 4.5 API
- פרסור JSON מתגובת Claude (4 ניסיונות parsing)
- זיהוי הודעות עסקה (`isTransactionMessage`)

**System Prompt — עיקרי:**
```
אתה *הכנסוביץ* — הבוט של משרד עו"ד גיא הרשקוביץ.
תפקידך: למלא טופס מכר דרך שיחת וואטסאפ.

אישיות: ידידותי, חם, מקצועי. לא רובוטי.
סגנון: וואטסאפ — 1-3 שורות, שאלה אחת כל פעם.
מגדר: זהה לפי שם השולח (אלוף/אלופה, שלח/שלחי).

שדות: שם, טלפון, ת.ז., מייל, כתובת, סוג עסקה,
       תיאור, סכום, אמצעי תשלום + שדות מותנים.

פורמט תשובה: JSON בלבד
{ "message": "...", "formData": {...}, "status": "collecting" }
```

**סטטוסים:**
| סטטוס | משמעות |
|--------|--------|
| greeting | שלח פתיחה, מחכה לאישור |
| collecting | אוסף פרטים |
| ready | סיכום, מחכה לאישור סופי |
| confirmed | המשתמש אישר — שמור! |
| cancelled | ביטל |
| declined | סירב — לא רוצה למלא |

**JSON Parser — 4 ניסיונות:**
1. Direct `JSON.parse()`
2. Fix newlines → `\n`
3. Fix unescaped quotes בתוך message
4. Extract fields ידנית עם regex

---

### firebase.js — שמירה (9 KB)
**אחראי על:**
- חיבור Firebase Admin SDK
- שמירת עסקה ל-`sales_records` (אותו מבנה כמו הטופס באתר)
- חישוב מע"מ (18%)
- כתיבת audit log
- סנכרון ל-Google Sheets (webhook)
- חיפוש לקוח קיים (בשני collections)
- בדיקה אם עובד מילא ידנית (declined flow)

**מבנה רשומת עסקה:**
```javascript
{
    timestamp: serverTimestamp,
    date: "2026-03-31",
    formFillerName: "חיים",
    source: "whatsapp-bot",

    clientName: "יוסי כהן",
    phone: "050-1234567",
    email: "yosi@email.com",
    idNumber: "123456789",
    address: "",
    clientStatus: "קיים",

    transactionType: "פגישת ייעוץ",
    transactionDescription: "ייעוץ ראשוני",

    amountBeforeVat: 5000,
    vatAmount: 900,
    amountWithVat: 5900,

    paymentMethod: "כרטיס אשראי",
    // + שדות מותנים לפי אמצעי תשלום

    notes: "נוצר מ-WhatsApp Bot\nשולח: חיים\n\nהודעה מקורית: יוסי כהן ייעוץ 5000"
}
```

---

### ecosystem.config.js — PM2 Config
```javascript
{
    name: 'hachnasovitz',
    script: 'index.js',
    cron_restart: '0 4 * * *',     // restart כל לילה ב-4:00
    autorestart: true,
    max_restarts: 50,
    min_uptime: 10000,              // crash תוך 10s = בעיה אמיתית
    restart_delay: 5000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: '500M',
    kill_timeout: 10000
}
```

---

## כלים וטכנולוגיות

### Runtime
| כלי | גרסה | תפקיד |
|-----|-------|--------|
| Node.js | 18 | Runtime |
| PM2 | 6.x | Process manager — auto-restart, logs, cron |
| Chromium | 146 | headless browser ל-WhatsApp Web |

### ספריות npm
| ספרייה | גרסה | תפקיד |
|--------|-------|--------|
| whatsapp-web.js | ^1.26.0 | חיבור ל-WhatsApp Web דרך Puppeteer |
| @anthropic-ai/sdk | ^0.39.0 | Claude API — המוח של הבוט |
| firebase-admin | ^12.0.0 | Firestore, Auth — שמירת נתונים |
| qrcode-terminal | ^0.12.0 | הצגת QR code בטרמינל |
| dotenv | ^16.4.5 | טעינת environment variables |

### תשתית
| שירות | ספק | עלות |
|-------|------|------|
| שרת ענן | Kamatera (פתח תקווה) | ~$4/חודש |
| דאטאבייס | Firebase Firestore | חינם (Spark plan) |
| AI | Claude Haiku 4.5 (Anthropic) | ~$5-20/חודש |
| גיבוי טבלאי | Google Sheets | חינם |
| **סה"כ** | | **~$10-25/חודש** |

---

## הגנות יציבות (v5 — Cloud-Ready)

### Auto-Reconnect
```
ניתוק WhatsApp
    ↓
Exponential backoff: 5s → 10s → 20s → 40s → ... → max 5 min
    ↓ (עד 10 ניסיונות)
    ↓ נכשל?
PM2 restart אוטומטי
    ↓ נכשל?
התראת WhatsApp למפעיל
```

### Health Check (כל 5 דקות)
- בודק `wa.getState()` === 'CONNECTED'
- אם מנותק 10 דקות → שולח התראה למפעיל
- אם מנותק 15 דקות → force restart

### Crash Protection
- `uncaughtException` — תופס, לא קורס
- `unhandledRejection` — תופס, לא קורס
- PM2 `max_memory_restart: 500M` — restart אם RAM גבוה
- PM2 `exp_backoff_restart_delay` — backoff על crashes חוזרים

### ניקוי אוטומטי
- **כל שעה:** ניקוי שיחות פגות תוקף, rate limits ישנים, תורים ריקים
- **כל לילה ב-4:00:** restart מלא (cron)
- **כל 500 הודעות:** ניקוי botMessageIds

---

## הגדרת השרת (Kamatera)

### מפרט השרת
```
IP:        212.80.206.148
Location:  פתח תקווה, ישראל
OS:        Ubuntu 22.04.5 LTS
CPU:       1 vCPU (Type A)
RAM:       1 GB + 1 GB swap
Disk:      20 GB SSD
```

### מה הותקן על השרת
1. **Node.js 18** — runtime
2. **Chromium 146** (snap) — headless browser
3. **PM2** — process manager + startup on boot
4. **Swap 1GB** — הגנה מפני חוסר זיכרון
5. **UFW Firewall** — SSH only

### נתיב הפרויקט
```
/opt/hachnasovitz/
├── index.js
├── agent.js
├── firebase.js
├── package.json
├── ecosystem.config.js
├── .env
├── firebase-service-account.json
├── node_modules/
├── logs/
│   ├── out.log
│   ├── error.log
│   └── combined.log
└── .wwebjs_auth/          ← WhatsApp session (QR פעם אחת!)
    └── session/
```

---

## Environment Variables (.env)

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...       # Claude API
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
WHATSAPP_GROUP_NAME=דיווח הכנסות מפגישות ומכירות 2026 🏆🏆🏆
GOOGLE_SHEETS_WEBHOOK=https://script.google.com/macros/s/.../exec
BOT_OPERATOR_PHONE=972549539238          # התראות
DEFAULT_ATTORNEY=עו"ד גיא הרשקוביץ
DEFAULT_BRANCH=תל אביב
```

---

## פקודות ניהול

### גישה לשרת
```bash
ssh root@212.80.206.148
# סיסמה: psRHL2DlV26t9qPO
```

### PM2
```bash
pm2 status                    # סטטוס
pm2 logs hachnasovitz         # לוגים בזמן אמת
pm2 logs hachnasovitz --lines 50  # 50 שורות אחרונות
pm2 restart hachnasovitz      # restart
pm2 stop hachnasovitz         # עצירה
pm2 monit                     # מוניטור חי (CPU, RAM)
```

### עדכון קוד
```bash
# מ-Claude Code — אוטומטי:
# עורך קבצים → מעלה SFTP → pm2 restart

# ידני:
ssh root@212.80.206.148
cd /opt/hachnasovitz
nano index.js                 # עריכה
pm2 restart hachnasovitz      # הפעלה מחדש
```

---

## תרחישי קצה שטופלו

| תרחיש | טיפול |
|--------|--------|
| עובד שולח 2 עסקאות ברצף | תור — השנייה ממתינה |
| עובד אומר "בטל" | status: cancelled, הבוט עוזב |
| עובד מסרב למלא | declined flow + בדיקה שעתית |
| עובד לא עונה | תזכורות: 10 דק → 30 דק → 2 שעות → פג |
| WhatsApp מתנתק | auto-reconnect עד 10 ניסיונות |
| Node.js קורס | PM2 restart תוך 5 שניות |
| Chrome אוכל RAM | max_memory_restart 500MB |
| שרת restart | PM2 startup אוטומטי |
| Session נפגם | ניקוי lockfiles + restart |
| לקוח קיים ב-DB | auto-fill פרטים, שואל רק מה חסר |
| שם אישה | Claude מתאים לשון נקבה |

---

## עלויות סיכום

| רכיב | עלות חודשית |
|-------|-------------|
| Kamatera שרת | $4 (~15 ₪) |
| Claude Haiku API | $5-20 (~20-75 ₪) |
| Firebase | חינם |
| Google Sheets | חינם |
| WhatsApp | חינם |
| **סה"כ** | **$9-24 (~35-90 ₪/חודש)** |

---

*נבנה ב-30-31/03/2026 | משרד עו"ד גיא הרשקוביץ ושות'*
*v5 Cloud-Ready Edition*
