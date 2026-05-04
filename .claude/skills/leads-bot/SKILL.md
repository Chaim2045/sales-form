# Leads Bot — לידוביץ v5.1

## Overview
בוט וואטסאפ לזיהוי, מעקב וניהול לידים. רץ על שרת Kamatera (212.80.206.148) כחלק מ-hachnasovitz (PM2).

## Architecture

```
3 ערוצי כניסה:
  📧 מייל (din.co.il / callbiz.co.il) → Apps Script → lead-from-email.js → Firestore → 5 דק המתנה → הכרזה
  📸 תמונה בקבוצה → Vision API + Claude OCR → כל הטלפונים → אחרון = primary
  ✍️ טקסט בקבוצה → leads-detector.js → Firestore

כולם → הצלבה (phoneLast7 × 4 collections) → CRM Dashboard (realtime)
```

## Full Flow — 3 תרחישי כניסה

### תרחיש 1: שני ענתה לשיחה
```
שני כותבת בקבוצה: "מוטי - 050-XXX סכסוך שכנים"
  → CRM: ליד חדש
  → בקבוצה: "📋 ליד חדש — מוטי, 050-XXX. מי מטפל?"
  → מייל din מגיע (אותו טלפון) → שקט (pendingEmailLeads, 5 דק המתנה — רואה שהטלפון כבר בקבוצה)
  → אם אף אחד לא כותב "אני" תוך:
    • 2 דק  → (שקט, ממתין)
    • 5 דק  → (שקט, ממתין)  
    • 15 דק → DM למנהל (DEFAULT_ASSIGNEE)
```

### תרחיש 2: קולביז ענה (שני לא ענתה)
```
מייל din/callbiz מגיע (משך שיחה > 0)
  → CRM: ליד חדש
  → ממתין 5 דקות (pendingEmailLeads)
  → אותו טלפון לא הופיע בקבוצה
  → "📋 ליד חדש — 050-XXX, שיחה שנענתה (1:20 דק). מי מטפל?"
```

### תרחיש 3: אף אחד לא ענה
```
מייל din מגיע (משך שיחה = 0)
  → ממתין 5 דקות
  → "📋 ליד חדש — דחוף! 050-XXX, שיחה שלא נענתה! מי מטפל?"
```

## שיוך + מעקב

```
עובד כותב "אני" / "אני מתקשר"
  → בקבוצה: "✅ מוטי — רועי מטפל."
  → DM לרועי: הכנה לשיחה (טלפון + נושא + טיפים + מחירון)
  → CRM: assignedTo = רועי הרשקוביץ

"אני" כפול (שני אנשים בו-זמנית):
  → הראשון: שויך
  → השני: "מוטי כבר משויך ל-רועי"

מעקב DM (6 נדנודים):
  10 דק → "היי, מה קרה עם *מוטי*? (050-XXX)"
  20 דק → "עדיין ממתין לעדכון על *מוטי* 🙏"
  30 דק → "עדיין ממתין לעדכון על *מוטי* 🙏"
  40 דק → "רועי, חשוב לי לעדכן את המערכת... מה הסטטוס?"
  50 דק → (שוב)
  60 דק → "לא קיבלתי עדכון... אני פונה לקבוצה 👍"
         → בקבוצה: "רועי לא עונה לי בפרטי..."

ברגע שרועי עונה (בכל שלב) → מפסיק מיד + מעדכן CRM + מודיע בקבוצה.
שעות שקטות: 21:00-08:00 + שבת/חג → לא מנדנד.
```

## עדכון סטטוס (קבוצה + DM)

```
עובד כותב (בקבוצה או בפרטי):
  "דיברתי" / "דיברתי איתו"  → contacted
  "שוחחתי"                    → contacted
  "התקשרתי"                   → contacted
  "לא ענה" / "לא עונה"       → no_answer
  "פולואפ בעוד יומיים"        → followup + followupAt
  "פולואפ הערב"               → followup + followupAt = 19:00
  "פולואפ היום"               → followup + followupAt = 17:00
  "בסוף היום"                 → followup + followupAt = 17:00
  "נסגר" / "שולם" / "חתם"    → closed
  "לא רלוונטי"               → not_relevant

  → CRM מתעדכן + nudges נעצרים מיד

זיהוי ליד לפי שם (כמה לידים למשתמש):
  1. שם בטקסט: "מוטי לא ענה" → מוצא מוטי בלידים של רועי
  2. lastAskedLead: הליד שהבוט שאל עליו אחרון ב-DM
  3. fallback: הליד הכי חדש
  4. Firestore: חיפוש ב-leads collection
```

## דחיית הבוט (Bot Dismiss)

```
בקבוצה:
  "לא רלוונטי אליך" / "עזוב" / "תפסיק" / "תשתוק" / "הפסק"
  → הבוט שותק, לא נוגע בשום ליד

ב-DM:
  "תפסיק לשלוח" / "עזוב אותי" / "הפסק"
  → "הבנתי, מפסיק 👍 (X לידים)"
  → כל ה-nudges נעצרים מיד לאותו עובד
```

## @mention בקבוצה

```
"@רועי טופל?"       → "אני עוקב. רועי, שלחתי לך בפרטי 👍" + DM לרועי
"@all מי לוקח?"     → "אני עוקב. *מוטי* ממתין — כתבו *אני* 👍"
"@חיים בוקר טוב"    → שקט (שיחה רגילה)
"@חיים @שני"         → "אני עוקב ומטפל 👍"
```

## פגישות (AI-Powered)

```
"0544833426 נירה שיינברג נקבעה פגישה לשבוע הבא ביום שלישי 14:00"

  → regex מנסה ראשון
  → Claude AI מנתח (יודע את התאריך של היום)
     • "שבוע הבא ביום שלישי" → Claude: 14.4 (לא 7.4!)
     • confidence: high → שומר
     • confidence: medium → שומר + שואל "באיזו שעה?"
     • confidence: low → שואל לפני שמירה

  → חילוץ שם + טלפון (מ-AI או regex)
  → הצלבה מול CRM
  → שמירת ליד + שיוך לשולח
  
  → הכרזה:
    "📅 פגישה נקבעה — נירה שיינברג, 14.4 ב-14:00, פיזית
     אחראי: חיים
     לקוח חדש / לקוח חוזר (עסקה: X₪)
     נשמר ב-CRM
     לשלוח תזכורת ללקוח/ה? כן / לא"

  → "כן" (רק מהאחראי או תוך 3 דק) → WhatsApp ישירות ללקוח
  → "לא" → "תזכורת בוטלה"

תזכורות אוטומטיות:
  12-36h לפני → "לשלוח תזכורת?"
  0.5-6h לפני → שואל שוב (בוקר הפגישה)
  שבת/חג/לילה → חסום
```

## OCR תמונות (Multi-Lead)

```
תמונה בקבוצת לידים → downloadMedia (3 ניסיונות, 2 שניות ביניהם)
  → סינון: רק jpeg/jpg/png/gif/bmp/tiff (לא סטיקרים webp)
  → Vision API → Claude (פרומפט multi-lead)
  → כל הטלפונים בתמונה → מערך leads
  → הטלפון האחרון = primary (הכרזה + "מי מטפל?" + מעקב)
  → השאר = secondary (שמירה בשקט)
  → "זיהיתי X לידים בתמונה. Y נוספים נשמרו במערכת."

  אם שיחה שלא נענתה: priority = high, "דחוף!"
  אם שיחה שנענתה: + callDuration

  כשל OCR:
  → לא הצלחתי להוריד → "אפשר לשלוח שוב?"
  → לא מצאתי טלפון → "לא הצלחתי לזהות טלפון. מה הפרטים?"
  → כשל מוחלט → "שגיאה בעיבוד התמונה. אפשר לכתוב את הפרטים?"
```

## הצלבת נתונים (4 Collections)

```
כל ליד שנכנס → בדיקה ב-4 collections לפי phoneLast7:
  clients:           6,099 לקוחות — כרטיס לקוח
  leads:             ליד קיים? "📋 ליד קיים — פנה ב-3.4 (מהמייל). לא שויך — מי מטפל?"
  sales_records:     "🔄 לקוח חוזר — עסקה: 45,000₪ (הליך משפטי)"
  recurring_billing: "ריטיינר: 5,000₪/חודש"
```

## Email Leads — המתנה 5 דקות

```
מייל din/callbiz מגיע → Netlify function → Claude Haiku מסנן
  → isLead: true → Firestore + pendingEmailLeads
  → אחרי 5 דק:
    אותו טלפון הופיע בקבוצה? → שקט (שני כבר טיפלה)
    משך שיחה > 0?            → "ליד חדש — שיחה שנענתה. מי מטפל?"
    משך שיחה = 0?            → "ליד חדש — דחוף! שיחה לא נענתה!"

  Claude מזהה: שיחה שנענתה, שיחה שלא נענתה, callbiz, din, mishpati
  Claude מסנן: מיילים פנימיים, ניוזלטרים, חשבוניות → isLead: false
```

## פולואפ אוטומטי (Firestore, כל 10 דקות)

```
getDueFollowups: followupAt <= now AND followupAt > (now - 14 days)
  → רק לידים מ-14 ימים אחרונים (לא 934 לידים ישנים!)
  → סטטוסים פעילים: assigned, contacted, followup, no_answer, new
  → לא importedFromCRM

followupAt הגיע?
  → DM לעובד: "🔔 תזכורת — מוטי 050-XXX. מה הסטטוס?"
  → בקבוצה: "🔔 מוטי — תזכורת פולואפ לרועי (גיל: X שעות)"

Throttle:
  יום 0-1: כל check (כל 10 דק)
  יום 1-3: פעם ביום
  יום 3-7: פעם ב-3 ימים
  יום 7-14: תזכורת אחרונה
  יום 14+: מפסיק

extractFollowupTime מזהה:
  "מחר" → 09:00 / "מחר אחהצ" → 14:00
  "עוד שעה" → +1h / "עוד יומיים" → +2d 09:00
  "בשעה 14:00" → 14:00
  "בסוף היום" → 17:00
  "היום בערב" / "הערב" → 19:00
  "היום" (כללי) → 17:00 או +2h, המאוחר
```

## DM Leads Queries — עובד שואל בפרטי

```
"הלידים שלי"         → רשימת לידים פעילים
"מה עם מוטי?"        → כרטיס מלא + עסקאות + היסטוריה
"סטטוס לידים"        → סיכום אישי
"דיברתי" / "לא ענה"  → עדכון סטטוס מהיר + הודעה בקבוצה
"תפסיק לשלוח"        → עצירת כל nudges + "הבנתי, מפסיק 👍"
```

## כן/לא — אישור תזכורת (מאובטח)

```
"כן" / "לא" אחרי שאלת תזכורת פגישה:
  → בודק: האם השולח הוא האחראי על הפגישה?
  → כן: מאשר/מבטל
  → לא: בודק האם יש pending approval מ-3 דקות אחרונות
  → אין pending: מתעלם (לא מבטל תזכורת לא קשורה!)
```

## Logging — שכבת בטיחות

```
כל log() → console + Firestore bot_log collection
  { type, message, timestamp, botVersion: '5.0' }
  fire-and-forget (לא חוסם, לא קורס)
  נשמר גם אחרי restart/crash
```

## Session Persistence — שרידות restart

```
disk backup כל 2 דקות (conversations-backup.json):
  ✅ recentLeads (לידים + שיוך + nudges)
  ✅ conversations (DM context)
  ✅ sentFollowupReminders (throttle — מונע כפילות)
  ✅ lastAskedLead (DM context)
  ✅ pendingEmailLeads (5 דק המתנה)
  ✅ pendingQueue

followupAt → Firestore (שורד הכל, לנצח)
```

## Deaf Detection — בוט מחובר אבל לא מקבל

```
30 דק ללא הודעות → התראה לאופרטור בפרטי
60 דק → auto-restart PM2
```

## Lead Detection Patterns

| # | סוג | דוגמה |
|---|------|--------|
| 1 | din.co.il SMS | `din.co.il SMS: דוד כהן, 054-XXX, דיני עבודה` |
| 2 | שיחה שלא נענתה | `פספסת שיחה מהמספר 053-XXX` |
| 3 | מנהלת | `ליד חדש - מוראל - 054-XXX - דיני עבודה` |
| 4 | מזכירות | `רותם - מסחרי - 050-XXX` |
| 5 | עובד ישיר | `0502369598 - נתנאל` |
| 6 | תמונה | תמונה + Vision API OCR + Claude multi-lead |
| 7 | כללי | `מי מטפל? 054-1234567` |
| 8 | מייל | din.co.il / callbiz.co.il → Netlify → Claude |

## Staff Name Resolution

```
STAFF_NAMES (phone → first):    STAFF_FULL_NAMES (phone → full):
  972542400403 → גיא             972542400403 → גיא הרשקוביץ
  972525014146 → אורי             972525014146 → אורי שטיינברג
  972523449893 → שני              972523449893 → שני
  972506470007 → מירי             972506470007 → מירי טל
  972508807935 → רועי             972508807935 → רועי הרשקוביץ
  972549539238 → חיים             972549539238 → חיים
```

## Key Files

| File | Purpose |
|------|---------|
| index.js | Main bot: leads group handler, DM queries, timers, @mention, email listener, AI parser |
| leads-detector.js | Pattern matching: lead detection, assignment, status, meeting, followup time, bot dismiss |
| firebase.js | Firestore: saveOrUpdateLead, findClientAcrossCollections, getDueFollowups, ocrLeadImage, parseMessageWithAI |
| shabbat-checker.js | Shabbat/holiday/quiet hours via Hebcal API |
| israel-time.js | DST-aware timezone (getIsraelOffset, makeIsraelTime, formatIsraelTime) |
| phone-lookup.js | Truecaller + internal DB phone name resolution |
| phone-utils.js | Phone normalization + extraction |
| lead-from-email.js | Netlify function: email → Claude → Firestore (din + callbiz) |
| gmail-leads-listener.js | Apps Script: Gmail scan → webhook (din + callbiz + mishpati) |

## Deploy

```bash
cd whatsapp-bot/
DEPLOY_SSH_PASSWORD=psRHL2DlV26t9qPO node _deploy.js
# Uploads all .js files via SFTP, restarts PM2
```

## Server

```
Host: 212.80.206.148
User: root
Path: /opt/hachnasovitz/
PM2: hachnasovitz
Daily restart: 04:00 (cron)
```

## Changelog — 5.4.2026

### באגים קריטיים שתוקנו
- **`if (!body) return`** — הרג כל תמונה ללא כיתוב. תוקן: `if (!body && !msg.hasMedia) return`
- **OCR phone array crash** — Claude החזיר מערך טלפונים, `.replace()` קרס. תוקן: multi-lead format
- **OCR single phone only** — Claude prompt חילץ רק טלפון אחד. תוקן: prompt חדש שמחלץ כל הטלפונים
- **getDueFollowups שלף 934 לידים ישנים** — limit(200) בלי סינון תאריך. תוקן: `followupAt > (now - 14d)`
- **"שבוע הבא ביום שלישי"** — regex לא הבין "שבוע הבא". תוקן: regex + Claude AI fallback
- **פגישה עם טלפון לא זוהתה** — `classifyLeadMessage` לא תפס טלפון בטקסט פגישה. תוקן: AI + direct extraction
- **"לא רלוונטי אליך"** — סימן ליד כ-not_relevant בטעות. תוקן: `bot_dismiss` status
- **"לא" אחרי "מי מטפל?"** — ביטל תזכורת לא קשורה. תוקן: owner-first + 3-min window
- **"דיברתי" בלי סיומת** — לא זוהה. תוקן: optional suffix
- **"תפסיק לשלוח" ב-DM** — בוט המשיך לנדנד. תוקן: bot_dismiss + dmFollowupDone
- **"אני" כפול** — השני ללא משוב. תוקן: "כבר משויך ל-X"

### פיצ'רים חדשים
- **Claude AI message parser** — parseMessageWithAI ב-firebase.js: מנתח פגישות, סטטוסים, followup בשפה טבעית
- **Multi-lead OCR** — תמונה עם כמה טלפונים → ליד נפרד לכל אחד, אחרון = primary
- **"היום בערב"** — extractFollowupTime מזהה עכשיו: הערב (19:00), היום (17:00), בסוף היום (17:00)
- **Bot dismiss** — "עזוב"/"תפסיק"/"תשתוק" בקבוצה = שקט, ב-DM = עצירת nudges
- **Session persistence** — sentFollowupReminders + lastAskedLead + pendingEmailLeads שורדים restart
- **downloadMedia retry** — 3 ניסיונות עם 2 שניות ביניהם
- **OCR error feedback** — הודעת שגיאה לקבוצה בכל מצב כשל (לא שקט)
- **Sticker filter** — webp לא עובר OCR

### עדיין חסר (לא קריטי)
- שינוי/ביטול פגישה דרך הבוט
- undo שיוך ("טעות" / "התבלבלתי")
- זיהוי הודעות forwarded
- access control — רק staff יכולים לשייך/לעדכן
