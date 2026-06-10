# SHARED-CONTEXT.md — צמתים משותפים בין פרויקטי המשרד

> **מעודכן ל:** 2026-06-09
> **סטטוס:** baseline לפני אינטגרציית `tofes-mecher` ↔ מערכת ניהול משימות + מודול YF Dashboards מבודד (§9)
> **קובץ זה נמצא ב-3 עותקים זהים** ב-`hachnasovitz/.claude/`, `bot-platform/.claude/`, `tofes-mecher/.claude/`. שינוי באחד → חובה לסנכרן את שני האחרים.
>
> **⛔ מודול מבודד:** `tofes-mecher` כולל את **מודול YF Dashboards** (תזרים + שעות) — **אי סגור**: DB נפרד (`yf_*`), גישת owner-only. **אסור לערבב** עם הצמתים המשותפים למטה או עם מערכת ניהול המשימות. ראה §9.

---

## 1. הפרויקטים במשרד (3 בלבד)

| פרויקט | מיקום local | deploy | תפקיד |
|---|---|---|---|
| `hachnasovitz` | `C:\Users\haim\Projects\hachnasovitz\` | Kamatera VPS `/opt/hachnasovitz/` (PM2) | בוט WhatsApp **יחיד** — מספר אחד, process אחד, כל ה-flows (income, leads, daily-reports, system-reports) |
| `bot-platform` | `C:\Users\haim\Projects\bot-platform\` | Netlify (`bot-platform.netlify.app`) | דשבורד ניהול הבוט (React 19 + Vite + shadcn) |
| `tofes-mecher` | `C:\Users\haim\Projects\tofes-mecher\` | Netlify (`tofes-office.netlify.app`) | טופס מכר + OCR + recurring billing (Vanilla JS) |

**לא שייכים למשרד** (לא להתייחס מכאן):
- `karen-Dot` — פרויקט פרטי של חיים (בוט של אמא שלו), תשתית נפרדת לחלוטין

---

## 2. Firebase projects — יש **שניים**, לא אחד

| Project | משמש את | תפקיד |
|---|---|---|
| `law-office-sales-form` (ראשי) | tofes-mecher, bot-platform, hachnasovitz | כל ה-collections של המכירות, לקוחות, לידים, audit, וקונפיג של הבוט |
| `law-office-system` (משני) | רק hachnasovitz (מודולים `daily-reports/` + `system-reports/`) | employees, timesheet_entries, budget_tasks, system_reports_outbox |

**הוכחה:** `hachnasovitz/system-reports/law-office-firebase.js:43` → `"Connected to law-office-system Firebase ✅"` (named app נפרד).

---

## 3. מפת collections — מי R/W (project: `law-office-sales-form`)

| Collection | tofes-mecher | bot-platform | hachnasovitz | הערה |
|---|---|---|---|---|
| `sales_records` | R/W (סנטרלי) | R (analytics) | **R/W** | **3 צרכנים — הצומת הכי קריטי** |
| `clients` | R/W | — | R/W | **2 כותבים — race condition zone** |
| `recurring_billing` | R/W (סנטרלי) | — | R (lookups) | |
| `leads` | R/W | R (analytics) | **R/W** (יוצר/מעדכן) | **3 צרכנים** |
| `audit_log` | W | R/W | W | משותף, `source` field מפריד |
| `users` | R/W | — | — | tofes-mecher only |
| `dashboard_users` | — | R/W | — | bot-platform only |
| `bot_config` | — | R/W (UI) | R (poll 30s) | **dashboard→bot pipeline** |
| `bot_flows` | — | R/W (UI) | R (poll 30s) | **dashboard→bot pipeline** |
| `bot_staff` | — | R/W (UI) | R | **dashboard→bot pipeline** |
| `conversations_live` | — | R/W (takeover) | R/W | **דו-כיווני** |
| `bot_status`, `bot_log` | — | — | W | בוט only |
| `decrypt_rate_limit` | R/W | — | — | tofes-mecher only |

### `law-office-system` (project שני) — רק hachnasovitz
`employees`, `timesheet_entries`, `budget_tasks`, `system_reports_outbox`

---

## 4. חמשת הצמתים הקריטיים — חובה לקרוא לפני שינוי

### 🔴 #1 — `sales_records`
- כותב #1: `tofes-mecher/js/sales-form.js` (טופס המכר המקורי)
- כותב #2: `hachnasovitz/data/repos/sales.js:154` (הבוט רושם מכירה)
- קורא: `bot-platform/src/lib/repos/analytics.ts:57` (analytics)
- קורא: `hachnasovitz/lib/duplicate-detector.js:43` (זיהוי כפילויות)
- **כלל:** שינוי שם שדה כאן שובר 3 פרויקטים. שדה חדש = backward-compatible default.

### 🔴 #2 — `clients`
- כותב #1: `tofes-mecher` (עת יצירת לקוח חדש מטופס)
- כותב #2: `hachnasovitz/data/repos/clients.js:104` (הבוט מזהה לקוח חדש בשיחה)
- קורא + מאחד: `hachnasovitz/data/repos/clients.js:29` (phone match) ו-`:54` (ID match)
- **סיכון:** race condition אמיתי — שני כותבים, אין locking. אם הבוט והטופס נפגשים על אותו לקוח באותן 2 שניות → 2 docs יוצרים. יש dedup ב-`hachnasovitz/data/repos/clients.js`, אך לא מושלם.

### 🔴 #3 — `leads`
- יוצר: `hachnasovitz/data/repos/leads.js:85` (בוט הלידים)
- מעשיר: `tofes-mecher` (כשהלקוח הופך לקוח מבוסס)
- מציג: `bot-platform/src/lib/repos/analytics.ts:70` (analytics)
- **כלל:** שדות `status`, `phoneLast7`, `clientId` הם הג'ויינים — לא לשנות names.

### 🔴 #4 — `bot_config` / `bot_flows` / `bot_staff` (dashboard→bot pipeline)
- כותב יחיד: `bot-platform` דרך Web SDK
- קורא: `hachnasovitz/data/repos/bot-config.js:55`, `bot-flows.js:23`, `bot-staff.js:22` (poll כל 30s)
- **כלל:** שינוי schema בdashboard חייב להיות backward-compatible **לפחות 60 שניות** (2 cycles), כדי שהבוט לא יקרוס בין pull לpull.
- **שדות `bot_config/default` שמנוהלים מהדשבורד:** `office`, `operator`, `whatsapp`, `reminders`, `security`, ו-`dailyReports.excludedEmployees: string[]` (החרגות דיווח יומי — blocklist partial-match; הבוט קורא דרך getter שמוזרק ל-`daily-reports/index.js`, fallback ל-`daily-reports/config.js`). כל שדה חדש = optional עם default, אחרת הבוט קורס.

### 🔴 #5 — שני Firebase service accounts ב-hachnasovitz
- ראשי: דרך `firebase-service-account.json` → `law-office-sales-form`
- משני: דרך `daily-reports/law-office-key.json` או `system-reports/law-office-key.json` → `law-office-system`
- **כלל:** אם מישהו "מאחד" את ה-keys בטעות (admin SDK עם key אחד לשני projects) → מודול ה-daily-reports נשבר. תמיד 2 named apps נפרדים.

---

## 5. כללי ברזל — אסור לעבור

| כלל | מקור |
|---|---|
| **בוט יחיד**: process אחד ב-PM2, client אחד של `whatsapp-web.js`, session אחד (`.wwebjs_auth/`), מספר אחד | `hachnasovitz/index.js:681` + `lib/wa-client.js:37` |
| **dashboard→bot lag = 30s** (acceptable, לא urgent changes כאן) | `bot-platform/CLAUDE.md §10` |
| **audit_log immutable** — כל פעולה אדמיניסטרטיבית כותבת עם `source: 'dashboard'\|'bot'\|'tofes'` | קונבנציה |
| **Firestore writes חייב try/catch** — rules יכולים לחסום, ייזרק exception → תקיעת UI | `bot-platform/CLAUDE.md §9` |
| **Hebrew RTL** בכל UI | קונבנציה |
| **Claude OAuth via Max** — אין צריכת API costs | משותף ל-3 |
| **לא לערבב בין הסוכנים** של הפרויקטים השונים | constraint מהמשתמש |

---

## 6. פרטי תשתית

| | ערך | מקור |
|---|---|---|
| Kamatera VPS IP | `63.250.61.105` ✅ אומת | bot-deploy-ops 2026-05-30 (גיבוי ישן 212.80.206.148 — לא בשימוש) |
| SSH user | `root` | hachnasovitz/DEPLOY.md |
| PM2 process name | `hachnasovitz` | אומת ב-`pm2 list` |
| WhatsApp groups (env) | `WHATSAPP_GROUP_NAME`, `LEADS_GROUP_NAME` | `hachnasovitz/.env.example:14-15` |
| Operator phone (alerts) | `972549539238` (חיים) | `hachnasovitz/.env.example:21` |

---

## 7. TBD — צפויים להשתנות אחרי אינטגרציית tofes-mecher ↔ task-management

> פרויקט גדול מתוכנן: חיבור בין `tofes-mecher` למערכת ניהול משימות. הסעיפים הבאים **צפויים להתעדכן** עם תחילת העבודה:

- ❓ **collection חדש?** אולי `tasks` / `task_assignments` / `task_links` — לא ידוע עדיין
- ❓ **schema של `sales_records`** — אולי יתווסף `linkedTaskId` או דומה
- ❓ **schema של `clients`** — אולי יתווסף `activeTasks[]`
- ❓ **flow חדש בבוט** — אולי הבוט יקבל TODO וייצור tasks → חיבור ל-`hachnasovitz`
- ❓ **dashboard view חדש** ב-bot-platform — אולי tab של "משימות"
- ❓ **Firebase project** — האם המערכת תוסיף project שלישי, או תשב על `law-office-sales-form`/`law-office-system` הקיימים

**פרוטוקול:** עם תחילת העבודה על האינטגרציה — מעדכנים את הקובץ הזה **לפני** השינוי בקוד, לא אחריו.

---

## 8. פרוטוקול עדכון הקובץ

1. שינוי בצומת קריטי / collection חדש / Firebase project חדש → **קודם** מעדכנים כאן
2. סנכרון של 3 העותקים (hachnasovitz / bot-platform / tofes-mecher) — חובה
3. עדכון `מעודכן ל:` בכותרת
4. ציטוט `file:line` חובה לכל הצהרה חדשה
5. אם משהו לא ודאי — לסמן `❓` ולא לטעון ודאות שלא קיימת

---

## 9. ⛔ מודול YF Dashboards — אי מבודד לחלוטין (אסור לערבב!)

> **לכל סוכן שעובד על מי מ-3 הפרויקטים:** המודול הזה **נפרד לחלוטין**. הוא חי בתוך `tofes-mecher` אבל **אינו** חלק מה-CRM, **אינו** חלק ממערכת ניהול המשימות (§7), ו**אינו נוגע** באף collection משותף.

**מה זה:** 2 דשבורדים (מקור: Yoram Fishman, single-file + localStorage) שהוטמעו ב-`tofes-mecher` כ-2 views — **תזרים** (גלובלי-משרדי) ו**שעות-עובד** (פר-עובד). הוטמע 2026-06-09, branch `feat/yf-dashboards`.

**DB נפרד — prefix `yf_`** (project `law-office-sales-form`, אך collections עצמאיים לחלוטין):

| Collection | scope | תוכן |
|---|---|---|
| `yf_cashflow` | doc יחיד `office` (גלובלי) | תזרים: entries, cats, budgets, invoices, banks, contacts |
| `yf_hours` | doc per-user `{uid}` | שעות: cases, logs |
| `yf_access` | doc per-user `{uid}` | הרשאות גישה זמניות (grants + תפוגה) |

**כללי ברזל למודול:**
1. **אסור** שקוד CRM/בוט/dashboard יקרא או יכתוב ל-`yf_*`. **אסור** שהמודול יקרא/יכתוב ל-`sales_records`/`clients`/`leads`/`recurring_billing`/`timesheet_entries` או כל collection משותף.
2. **אסור לערבב** עם מערכת ניהול המשימות (§7). למרות ש"שעות-עובד" נשמע דומה ל-`timesheet_entries` — הם **לא** אותו דבר ולא מתחברים.
3. **גישה owner-only:** רק `guy@ghlawoffice.co.il` (בעלים) + `haim@ghlawoffice.co.il` (תחזוקה). אחרים → רק grant זמני ב-`yf_access` שגיא מעניק. אכיפה ב-**Firestore Rules (server-side)** + UI.
4. קבצי המודול: `js/dashboard-cashflow.js`, `js/dashboard-hours.js`, `css/dashboards.css` — כולם נושאים header אזהרה.

**מקור:** localStorage (`yf_v4`, `yf_hours_v3`) → Firestore (Lift & Shift — שומר מבנה state, מחליף רק save/load).
