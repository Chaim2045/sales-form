# Leads Bot — לידוביץ

## Overview
בוט וואטסאפ לזיהוי, מעקב וניהול לידים בקבוצת "הרשקוביץ - פניית לידים".
רץ על שרת Kamatera (212.80.206.148) כחלק מ-hachnasovitz (PM2).

## Architecture

```
קבוצת וואטסאפ "הרשקוביץ - פניית לידים"
    ↓ (הודעה נכנסת)
leads-detector.js — regex pattern matching (7 פורמטים)
    ↓
index.js — LEADS GROUP handler
    ↓
firebase.js — saveLead() / assignLead() / updateLeadStatus()
    ↓
Firestore /leads/{docId}
    ↓
CRM Dashboard (realtime listener) + בוט תזכורות
```

## Full Message Flow

```
⏰ רגע 0 — הודעה נכנסת בקבוצה
│
├─ 1. "סטטוס לידים"? → שולח דוח שבועי (getLeadStats)
│
├─ 2. ליד חדש? (classifyLeadMessage) → saveLead() + טיימר תזכורות
│   ├─ 2 דק ללא שיוך → הודעה בקבוצה "⚠️ ליד חדש ממתין!"
│   ├─ 5 דק ללא שיוך → תזכורת שנייה
│   └─ 15 דק ללא שיוך → DM למנהל
│
├─ 3. שיוך? (detectAssignment)
│   ├─ "אני" / "מטפל" / "👍" → self-assign (sender name)
│   └─ "@חיים תטפל" / "תן לרועי" → directed assign
│   → assignLead() + מאפס טיימר
│
├─ 4. עדכון סטטוס? (detectStatusUpdate)
│   ├─ "לא רלוונטי" → not_relevant
│   ├─ "נסגר" / "נקבעה פגישה" → closed
│   ├─ "לא ענה" → no_answer
│   ├─ "דיברתי איתו" → contacted
│   └─ "אחזור מחר" → followup + extractFollowupTime()
│   → updateLeadStatus()
│
└─ 5. לא זוהה → מתעלם
```

## Lead Detection Patterns (leads-detector.js)

| # | סוג | Regex / Trigger | דוגמה | מה נתפס |
|---|------|-----------------|--------|---------|
| 1 | din.co.il SMS | `din\.co\.il\s*SMS` | `din.co.il SMS: דוד כהן, 054-8633933, דיני עבודה` | שם + טלפון + נושא |
| 2 | שיחה שלא נענתה | `התקבלה שיחה מאת` / `פספסת שיחה` | `פספסת שיחה מהמספר 053-3239882` | טלפון (priority: high) |
| 3 | מנהלת | `ליד\s*חדש\s*[-–:]` | `ליד חדש - מוראל - 054-8633933 - דיני עבודה` | שם + טלפון + נושא |
| 4 | מזכירות | `^([^0-9]{2,})\s*[-–]\s*([^0-9]+)\s*[-–]\s*(0\d+)` | `רותם - מסחרי - 050-9942484` | שם + נושא + טלפון |
| 5 | עובד ישיר | Phone first or name+phone | `0502369598 - נתנאל` | שם + טלפון |
| 6 | תמונה + "מי מטפל" | `hasMedia && /מי מטפל/` | תמונת סקרינשוט + "מי מטפל?" | image_lead + needsOCR |
| 7 | כללי | `מי מטפל` + phone in text | `מי מטפל? 054-1234567` | טלפון + name guess |

## Assignment Detection

**עצמי (self):**
- `אני`, `אני מטפל`, `מטפלת`, `אתקשר`, `אני על זה`, `👍`, `כן`, `יטופל`, `עליי`

**מכוון (directed):**
- `חיים תטפל`, `@מירי`, `תן לרועי`, `אופק בבקשה`, `שיטפל חיים`

## Status Update Detection

| סטטוס | ביטויים |
|--------|---------|
| not_relevant | לא רלוונטי, לא מתאים, לא בתחום, אין כדאיות |
| closed | נסגר, נקבעה פגישה, סגרנו, חתם, שולם, תואם |
| no_answer | לא ענה, לא עונה, ללא מענה, לא זמין, לא תפס |
| contacted | דיברתי איתו, שוחחתי, שלחתי הודעה, יצרתי קשר, התקשרתי |
| followup | פולואפ, אחזור מחר, מחכה לתשובה, ביקש לחשוב, אנסה שוב |

## Followup Time Extraction

| ביטוי | תוצאה |
|-------|--------|
| מחר | מחר 09:00 |
| מחר אחה"צ | מחר 14:00 |
| עוד X דקות | now + X min |
| עוד שעה | now + 1h |
| בסוף היום | היום 17:00 |
| בשעה HH:MM | היום/מחר HH:MM |
| פולואפ (ללא זמן) | now + 2h |

## Followup Reminder System

**טיימרים אוטומטיים (כל 10 דקות):**

| גיל הליד | תדירות | סוג הודעה |
|-----------|---------|-----------|
| 0-24 שעות | פעם בשעה max | 🔔 תזכורת פולואפ |
| 1-3 ימים | פעם ביום max | 🔔 תזכורת פולואפ |
| 3-7 ימים | פעם ב-3 ימים max | 🟡 תזכורת |
| 7-14 ימים | פעם אחת בלבד | 🔴 תזכורת אחרונה! |
| 14+ ימים | כלום | פג תוקף |

**כללים:**
- לידים מיובאים (importedFromCRM=true) → אין תזכורות
- רק לידים עם assignedTo → מקבלים תזכורת
- תזכורת נשלחת כ-DM לעובד (לפי STAFF_NAMES mapping)
- sentFollowupReminders{} מונע ספאם

## Staff Name Resolution (CRM ↔ WhatsApp)

**בעיה שנפתרה:** WhatsApp profile name (first) לא תואם ל-Firestore displayName (full).

**פתרון:** `resolveFullName(firstName)` — ממפה first name → full name מתוך STAFF_FULL_NAMES.

**מיפוי נוכחי:**
```
STAFF_NAMES (WhatsApp → first name):
  972542400403 → גיא
  972525014146 → אורי
  972523449893 → שני
  972506470007 → מירי
  972508807935 → רועי
  972549539238 → חיים

STAFF_FULL_NAMES (WhatsApp → full name = Firestore displayName):
  972542400403 → גיא הרשקוביץ
  972525014146 → אורי שטיינברג
  972523449893 → שני
  972506470007 → מירי טל
  972508807935 → רועי הרשקוביץ
  972549539238 → חיים
```

**חשוב:** ה-`assignedTo` ב-Firestore leads חייב להתאים בדיוק ל-`displayName` ב-Firestore users collection.
כשעובד כותב "אני" בקבוצת הלידים, הבוט שומר את `senderFullName` (לא `senderName`).
כשמנהל כותב "חיים תטפל", הבוט מריץ `resolveFullName("חיים")` → "חיים" (כי ככה ב-Firestore).

## Firestore Schema — leads/{docId}

```
name: string
phone: string (05X-XXXXXXX)
email: string
subject: string
source: string (din_sms|missed_call|manager|secretary|staff_direct|image_lead|generic|email)
status: string (new|assigned|contacted|followup|no_answer|closed|not_relevant)
statusNote: string
priority: string (normal|high)
assignedTo: string | null
assignedAt: timestamp | null
followupAt: timestamp | null
createdAt: timestamp
lastUpdated: timestamp
originalMessage: string (500 chars max)
crmUpdated: boolean
escalated: boolean
importedFromCRM: boolean
aiScore: integer (1-10)
aiReason: string
city: string
category: string
businessName: string
crmId: string (original ID from old CRM)
history: [{ action, by, at, note }]
```

## Gmail Integration

```
Gmail (din.co.il, mishpati.co.il emails)
    ↓ (every 5 min via Google Apps Script trigger)
gmail-leads-listener.js (Apps Script)
    ↓ POST with secret
lead-from-email.js (Netlify Function)
    ↓ Claude Haiku parses email
    ↓ Extracts: name, phone, subject, score
Firestore /leads/{docId} (source: "email")
```

**WEBHOOK_URL:** `https://helpful-licorice-ac11ba.netlify.app/api/lead-from-email`
**WEBHOOK_SECRET:** configured in Apps Script + Netlify env

## Server Access

```
Host: 212.80.206.148
User: root
Password: psRHL2DlV26t9qPO
Path: /opt/hachnasovitz/
PM2: hachnasovitz
```

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| index.js | /opt/hachnasovitz/ + whatsapp-bot/ | Main bot: message handler, leads group, timers |
| leads-detector.js | whatsapp-bot/ | All regex patterns for lead detection |
| firebase.js | whatsapp-bot/ | Firestore CRUD for leads |
| lead-from-email.js | netlify/functions/ | Netlify function: email → Claude → Firestore |
| gmail-leads-listener.js | scripts/ | Google Apps Script: scan Gmail → webhook |
| leads-ai.js | netlify/functions/ | AI scoring endpoint |

## Deploy

```bash
# From whatsapp-bot/ directory:
node _deploy.js
# Uploads index.js, leads-detector.js, firebase.js via SFTP
# Restarts PM2
```

## Known Limitations

1. Image leads (`needsOCR: true`) — OCR not implemented for leads group
2. 14-day expiry — old leads get no more reminders
3. No dedup on incoming leads (same phone can create new lead)
4. Apps Script has 5-min polling delay (not instant)
5. LEADS_GROUP_NAME must be set in .env on server