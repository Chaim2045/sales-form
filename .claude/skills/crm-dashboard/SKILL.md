# CRM Dashboard — ניהול לידים

## Overview
טאב "לידים" באפליקציית טופס מכר. מציג לידים מ-Firestore בזמן אמת עם:
- **"הלידים שלי"** — dashboard אישי לכל עובד
- **Quick filter chips** — חמים, בינוני, לא נותח, היום, השבוע, ללא פעילות
- **סינונים מתקדמים** — ניקוד AI, קטגוריה משפטית, טווח תאריכים
- **AI scoring אוטומטי** — כל ליד חדש מנותח ע"י Claude
- **Timeline ויזואלי** — ציר זמן צבעוני עם relativeTime
- **התראות** — browser notifications + badge על nav
- **פעולות מהירות** — tel:/WhatsApp + bulk assign/close
- **6 גרפים** כולל funnel המרה
- **הרשאות** — leadsManagement permission, master רואה הכל

**URL:** https://helpful-licorice-ac11ba.netlify.app
**Repo:** https://github.com/Chaim2045/sales-form (main branch)
**Hosting:** Netlify (site: helpful-licorice-ac11ba)

## Architecture

```
Firestore /leads collection
    ↓ (onSnapshot realtime listener, limit 500)
js/leads.js — filter, sort, render, auto-score
    ↓
3 Views: Table | Cards | Kanban
    ↓
Lead Detail Modal (edit status, assignee, notes, timeline)
    ↓
AI Scoring: Netlify function → Claude Haiku
    ↓
Analytics: Chart.js (loads ALL leads, not just 500)
```

## Current Status (2026-04-03)

| Metric | Value |
|--------|-------|
| Total leads | ~6,784 (after dedup) |
| Imported from old CRM | ~6,750 |
| Created by bot/email | ~34 |
| Duplicates removed | 1,274 |
| Spam removed | 32 |

## Files

| File | Lines | Purpose |
|------|-------|---------|
| index.html | 1444-1580 | leadsManagement section + modal + analytics HTML |
| js/leads.js | ~850 | All CRM logic: load, filter, render, modal, AI, charts |
| css/leads.css | ~570 | Styling: status badges, kanban, modal, analytics |
| js/navigation.js | 50-58 | navLeadsMgmt(), hideLeadsManagement(), permission check |
| netlify/functions/leads-ai.js | 160 | Claude AI scoring endpoint |
| netlify/functions/lead-from-email.js | 205 | Email → Claude → Firestore |
| scripts/gmail-leads-listener.js | 118 | Google Apps Script for Gmail monitoring |
| scripts/import-crm-leads.js | 300 | CSV import from old CRM (lawguide) |
| scripts/dedupe-leads.js | 200 | Duplicate detection + cleanup |
| firestore.rules | 69-75 | leads collection access rules |

## UI Structure

```
#leadsManagement
├── Header: "ניהול לידים" + [🤖 נתח הכל] [ייצוא CSV] [חזרה]
├── Summary Cards (5):
│   ├── ldStatTotal — סה"כ
│   ├── ldStatNew — ממתינים (blue)
│   ├── ldStatActive — בטיפול (orange)
│   ├── ldStatClosed — נסגרו (green)
│   └── ldStatConversion — אחוז המרה
├── Analytics (collapsible):
│   ├── ldChartWeekly — לידים לפי שבוע (bar, 12 weeks)
│   ├── ldChartSources — פילוח לפי מקור (doughnut)
│   ├── ldChartStatus — פילוח לפי סטטוס (doughnut)
│   ├── ldChartAssignees — ביצועי עובדים (horizontal bar)
│   └── ldChartConversion — אחוז המרה לפי מקור (bar)
├── Toolbar: [חיפוש] [סטטוס ▼] [עובד ▼] [מ-תאריך] [עד-תאריך] [📊|📇|◼]
├── Views:
│   ├── Table (default) — 10 columns, paginated (20/page)
│   ├── Cards — responsive grid
│   └── Kanban — 4 columns (new, active, followup, closed)
├── Pagination
└── Loading / Empty states
```

## Lead Detail Modal

```
#leadDetailModal
├── Header: name + AI score badge + close button
├── AI Analysis Box (blue tint):
│   └── Score, reason, category, suggested assignee, urgency, action
├── Info Rows (read-only):
│   ├── טלפון (LTR)
│   ├── מקור
│   └── תאריך כניסה
├── Editable Fields (2-column grid):
│   ├── סטטוס (dropdown)
│   ├── אחראי (dropdown)
│   ├── פולואפ (datetime)
│   └── הערות (textarea)
├── Action Buttons:
│   ├── 💾 שמור (primary)
│   ├── 🤖 נתח AI (secondary)
│   └── סגור (secondary)
├── History Timeline:
│   └── [timestamp] — [action] by [user]
└── Original Message (expandable)
```

## JS Functions (js/leads.js)

### Core
| Function | Purpose |
|----------|---------|
| showLeadsManagement() | Show section, trigger loadLeadsData() |
| hideLeadsManagement() | Hide section, cleanup listener |
| loadLeadsData() | Firestore onSnapshot (limit 500) |
| updateLeadsSummary(records) | Calculate KPIs |

### Filters
| Function | Purpose |
|----------|---------|
| populateLeadsFilters() | Build assignee dropdown dynamically |
| getFilteredLeads() | Apply search + status + assignee + date filters |
| filterLeadsView() | Re-render on filter change |

### Views
| Function | Purpose |
|----------|---------|
| setLeadsViewMode(mode) | Switch table/cards/kanban |
| renderLeadsView() | Dispatcher to specific renderer |
| renderLeadsTableView(records, startIdx) | HTML table with 10 columns |
| renderLeadsCardsView(records) | Card grid |
| renderLeadsKanbanView(records) | 4-column kanban board |
| renderLeadsPagination(total, pages) | Page buttons |
| leadsGoToPage(page) | Pagination handler |

### Modal
| Function | Purpose |
|----------|---------|
| openLeadModal(docId) | Load lead data, populate modal |
| closeLeadModal() | Hide modal, clear state |
| saveLeadUpdate() | Update Firestore with form values |

### AI
| Function | Purpose |
|----------|---------|
| scoreLead() | POST /api/leads-ai with lead data |
| scoreAllLeads() | Batch score unscored leads |

### Analytics
| Function | Purpose |
|----------|---------|
| toggleAnalytics() | Show/hide analytics panel |
| loadAllLeadsForAnalytics() | Fetch ALL leads (no limit) |
| renderLeadsCharts(records) | Render all 5 charts |
| renderWeeklyChart(records) | Bar: leads per week (12 weeks) |
| renderSourcesChart(records) | Doughnut: top 8 sources |
| renderStatusChart(records) | Doughnut: status distribution |
| renderAssigneesChart(records) | Horizontal bar: assignee + closed |
| renderConversionChart(records) | Bar: conversion % per source (min 5 leads) |

### My Leads + Toggle
| Function | Purpose |
|----------|---------|
| toggleMyLeads() | Switch between "my leads" / "all leads" |
| updateMyLeadsToggle() | Update button text + dashboard visibility |
| updateMyDashboard() | Compute hot/followup/new/conversion for current user |

### Quick Filter Chips
| Function | Purpose |
|----------|---------|
| applyQuickFilter(type) | Set chip filter: all/hot/medium/unscored/today/week/stale |

### Filter State
| Function | Purpose |
|----------|---------|
| saveFilterState() | Save all filters to localStorage |
| restoreFilterState() | Restore filters on page load |

### Timeline
| Function | Purpose |
|----------|---------|
| renderTimeline(record) | Build visual timeline from history + AI + creation events |
| relativeTime(ts) | "עכשיו", "לפני 5 דק׳", "אתמול", "לפני 3 ימים" |

### Notifications
| Function | Purpose |
|----------|---------|
| showLeadNotification(data) | Browser notification for hot leads (7+) |
| updateLeadsBadge(count) | Red badge on nav button |

### Quick Actions + Bulk
| Function | Purpose |
|----------|---------|
| openWhatsApp(phone) | Open wa.me/{phone} in new tab |
| toggleSelectAllLeads(el) | Check/uncheck all rows |
| updateBulkBar() | Show/hide bulk action bar |
| executeBulkAction() | Firestore WriteBatch for bulk status/assign |
| clearBulkSelection() | Reset all checkboxes |

### Auto AI Scoring
| Function | Purpose |
|----------|---------|
| processAutoScoreQueue() | Score leads one by one (20s interval, rate limited) |

### Utilities
| Function | Purpose |
|----------|---------|
| exportLeadsCSV() | Download filtered leads as CSV |
| formatLeadDate(ts) | DD/MM format |
| formatLeadDateTime(ts) | DD/MM/YYYY HH:mm format |
| formatPhone(phone) | 05X-XXXXXXX format |
| renderScoreBadge(score) | Color-coded ⭐ badge |
| escapeHTML(str) | XSS prevention |
| parseTimestamp(ts) | Convert Firestore timestamp to ms |

## AI Scoring (leads-ai.js)

**Model:** claude-haiku-4-5-20251001
**Auth:** Firebase JWT token (Bearer header)

**Scoring Rules:**
- 9-10: סכום גבוה (100K+), נושא ברור, לקוח מוכן, דחיפות גבוהה
- 7-8: נושא ברור, פוטנציאל בינוני-גבוה, לקוח רציני
- 5-6: נושא רלוונטי אבל סכום נמוך/לא ברור
- 3-4: סיכוי נמוך, לקוח לא בשל
- 1-2: לא רלוונטי למשרד

**Assignee Routing:**
- מקרקעין / קניין / פינוי בינוי / עמידר → מירי טל
- דיני עבודה → חיים פרץ / אופק דובין
- מסחרי / חוזים / תביעות → אופק דובין
- שותפויות / חברות / הקמת עסק → רועי הרשקוביץ / אופק דובין
- פלילי → הפנייה חיצונית
- לא ברור → חיים פרץ (מכירות כללי)

## Email Integration (lead-from-email.js)

**Flow:**
```
Gmail → Apps Script (every 5 min) → Netlify webhook → Claude parse → Firestore
```

**Supported Email Sources:**
- din.co.il — שיחות שלא נענו, פניות מהפורום
- mishpati.co.il — שיחות, פניות
- כל noreply עם מילות מפתח: פנייה, ליד, lead, טופס יצירת קשר

**Special Rules:**
- din.co.il / mishpati.co.il = תמיד isLead: true
- "שיחה שלא נענתה" = score 7+ (חם)
- טלפון בלי שם = עדיין ליד (name: null)

**Webhook URL:** `https://helpful-licorice-ac11ba.netlify.app/api/lead-from-email`

## CSS Patterns (css/leads.css)

**Prefixes:**
- `ld-` — leads-specific (status badges, kanban, modal, charts)
- `bm-` — shared with billing module (header, toolbar, table, cards, summary)

**Status Badge Colors:**
- new: blue (#3b82f6)
- assigned: purple (#8b5cf6)
- contacted: orange (#f59e0b)
- followup: cyan (#06b6d4)
- no_answer: gray (#6b7280)
- closed: green (#10b981)
- not_relevant: red (#ef4444)

**Score Badge Colors:**
- high (7+): green
- med (4-6): orange
- low (1-3): red
- none: gray

**Responsive Breakpoints:**
- 900px: kanban 4→2 columns
- 768px: summary 5→3, toolbar stacks, charts 2→1 column
- 500px: kanban 1 column, summary 2 columns

## Permissions & Access Control

**Navigation visibility:** `perms.leadsManagement || perms.salesManagement || currentUserRole === 'master'`

**User Management:** עמודת "לידים" (leadsManagement) ב-toggle בניהול משתמשים.

**DEFAULT_PERMISSIONS:**
```
master:         leadsManagement: true   (רואה הכל + toggle)
office_manager: leadsManagement: true   (רואה הכל)
salesperson:    leadsManagement: true   (רואה רק שלו)
accountant:     leadsManagement: false  (לא רואה)
```

**לוגיקת תצוגה:**
- `currentUserRole === 'master'` → רואה כל הלידים + כפתור "הלידים שלי" / "כל הלידים"
- עובד רגיל → `leadsMyMode = true` תמיד, רואה רק `assignedTo === currentUser`
- ה-match הוא `displayName` מ-Firestore users collection

**חשוב:** ה-`assignedTo` בליד חייב להתאים בדיוק ל-`displayName` של המשתמש.
הבוט שומר `STAFF_FULL_NAMES[phone]` כ-assignedTo (ולא first name).

**Firestore Rules:**
```
match /leads/{docId} {
  allow read: if isActive();
  allow create: if true;  // webhook + bot write without auth
  allow update: if isActive();
  allow delete: if isMaster();
}
```

## Netlify Environment Variables

| Key | Purpose |
|-----|---------|
| ANTHROPIC_API_KEY | Claude API for AI scoring + email parsing |
| FIREBASE_WEB_API_KEY | Firestore REST API access |
| FIREBASE_PROJECT_ID | law-office-sales-form |
| FIREBASE_API_KEY | Firebase auth |
| WEBHOOK_SECRET | Gmail webhook authentication |

## External Dependencies

- Chart.js 4.4.7 (CDN) — analytics charts
- Firebase 10.7.1 — realtime database
- Google Fonts Heebo — Hebrew typography

## Scripts

| Script | Usage | Purpose |
|--------|-------|---------|
| import-crm-leads.js | `FIREBASE_AUTH_PASSWORD=xxx node scripts/import-crm-leads.js` | Import CSV from lawguide CRM |
| dedupe-leads.js | `FIREBASE_AUTH_PASSWORD=xxx node scripts/dedupe-leads.js` | Find + delete duplicate leads |

## Known Limitations

1. **Table limited to 500 leads** — onSnapshot limit, older leads not shown (analytics loads all)
2. **Kanban not drag-and-drop** — click to edit, not drag to change status
3. **CSV export flat** — no history included
4. **Charts load all leads** — may be slow with 10K+ leads
5. **Assignee dropdown hardcoded** — not synced from Firestore users

## Completed Features (2026-04-03)

- [x] "הלידים שלי" — dashboard אישי + toggle master/user
- [x] Quick filter chips (7 types)
- [x] Advanced filters: AI score, category, stale
- [x] Auto AI scoring queue (20s rate limit)
- [x] Visual timeline with relativeTime
- [x] Browser notifications + badge
- [x] Bulk assign/close
- [x] Phone tel: + WhatsApp quick actions
- [x] Funnel chart
- [x] leadsManagement permission in User Management
- [x] Full name resolution (WhatsApp → Firestore displayName)
- [x] Filter state persistence (localStorage)
- [x] Search in originalMessage

## Upgrade Roadmap

### Next
- [ ] Drag-and-drop kanban
- [ ] Lead age indicator (color-coded)
- [ ] Response time analytics chart
- [ ] Month-over-month comparison
- [ ] Daily summary (in addition to weekly)
- [ ] Confirmation in WhatsApp when lead assigned from CRM
- [ ] Custom domain (app.ghlawoffice.co.il)
- [ ] Auto-archive leads older than 30 days
- [ ] Duplicate detection on incoming leads
- [ ] Dynamic assignee dropdown from Firestore users
