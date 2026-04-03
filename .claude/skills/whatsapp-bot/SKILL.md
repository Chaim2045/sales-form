---
name: whatsapp-bot
description: "הכנסוביץ" WhatsApp bot agent — manage, debug, deploy, and update the WhatsApp sales bot running on Kamatera server. Use when user mentions the bot, WhatsApp, הכנסוביץ, or server deployment.
---

# הכנסוביץ — WhatsApp Bot Agent

## Overview
בוט וואטסאפ חכם ("הכנסוביץ") שמאזין לקבוצת דיווחי עסקאות של משרד עו"ד גיא הרשקוביץ.
הבוט מזהה הודעות על עסקאות חדשות, שולח DM פרטי לעובד, ומנהל שיחה עם Claude AI כדי למלא טופס מכר אוטומטית.
גם מאזין לטופס הווב — כשמישהו ממלא ידנית, מודיע לקבוצה.

## Architecture

```
WhatsApp Group ("דיווח הכנסות מפגישות ומכירות 2026")
        │
        ▼
Kamatera Cloud Server (212.80.206.148)
Ubuntu 22.04 | 1 CPU | 1GB RAM
PM2 → index.js → agent.js (Claude Haiku 4.5) → firebase.js → Firestore + Google Sheets
        │
        ▼ (on confirmed)
1. Save to Firestore (sales_records)
2. Sync to Google Sheets (webhook + response validation)
3. Send confirmation DM to user
4. Send confirmation to WhatsApp group (without amount)
5. If Sheets fails → alert operator privately

        ▼ (Firestore listener)
Web form submissions → automatic group notification
```

## Server Access

- **IP:** 212.80.206.148
- **User:** root
- **Password:** psRHL2DlV26t9qPO
- **Bot directory:** /opt/hachnasovitz
- **Process manager:** PM2
- **Process name:** hachnasovitz

### SSH Commands
```bash
ssh root@212.80.206.148
pm2 logs hachnasovitz --lines 50
pm2 status
pm2 restart hachnasovitz
pm2 monit
```

### Check Logs Remotely (from Windows)
```bash
cd whatsapp-bot
node -e "
var { Client } = require('ssh2');
var conn = new Client();
conn.on('ready', function() {
    conn.exec('pm2 logs hachnasovitz --lines 30 --nostream 2>&1', function(err, stream) {
        stream.on('data', function(d) { process.stdout.write(d); });
        stream.on('close', function() { conn.end(); });
    });
});
conn.connect({ host: '212.80.206.148', port: 22, username: 'root', password: 'psRHL2DlV26t9qPO' });
"
```

## File Structure (whatsapp-bot/)

| File | Purpose |
|------|---------|
| `index.js` | Core — WhatsApp client, message handler, ID alias system (4-layer lookup), reminders, queue, reconnect, health check, group notifications, web form listener, revenue summary, "דיווחתי" detection, paymentMethod validation, PDF/image OCR routing |
| `agent.js` | Claude AI conversation engine — system prompt with personality + field rules + today's date, JSON parsing with 4 fallback attempts |
| `firebase.js` | Firestore save (comma-stripping, full names), Sheets sync (full payload + response validation + operator alert), client lookup, smart verify (word matching), monthly summary (new sales only), check photo upload (Storage), OCR (Vision API), PDF processing (pdftoppm + Vision + Claude) |
| `package.json` | Dependencies: whatsapp-web.js, firebase-admin, @anthropic-ai/sdk, qrcode-terminal, dotenv, ssh2 |
| `ecosystem.config.js` | PM2 config — auto-restart, cron daily 4AM, max 500MB RAM, logs |
| `.env` | API keys and config |
| `firebase-service-account.json` | Firebase Admin SDK credentials |
| `_deploy.js` | Node.js deploy script — uploads files via SSH/SFTP and restarts PM2 |
| `_check-records.js` | Debug script — shows last 20 sales_records |
| `_check-client.js` | Debug script — searches for client by name |

## Deployment

**Windows doesn't have `sshpass`. Always use:**
```bash
cd whatsapp-bot
node _deploy.js
```
Connects via SSH (ssh2 module), uploads all bot files via SFTP, runs `pm2 restart hachnasovitz`.

If `ssh2` module missing: `npm install ssh2 --no-save`

## Full Message Flow

```
Message arrives
  │
  ├─ deduplicate (processedMessages Set)
  ├─ skip fromMe / bot's own messages
  ├─ resolve sender ID (aliasMap — 4-layer lookup)
  │
  ├─ GROUP MESSAGE:
  │   ├─ "הכנסות" / "כמה עשינו" → getMonthlySummary (new sales only, no billing)
  │   ├─ isTransactionMessage? → find client in DB → open DM conversation
  │   └─ other → ignore
  │
  ├─ PRIVATE + declined status:
  │   ├─ "כן" → restart conversation
  │   ├─ "דיווחתי" → verifyTransaction (smart word match) → show found record details → close
  │   └─ other → ignore
  │
  ├─ PRIVATE + no conversation:
  │   ├─ isTransactionMessage? → start new DM conversation
  │   └─ other → ignore
  │
  ├─ PRIVATE + active conversation:
  │   ├─ "דיווחתי" → verifyTransaction → show details → close if found
  │   ├─ image? → processCheckPhoto (upload + Vision OCR + Claude)
  │   ├─ PDF? → processCheckPDF (pdftoppm + Vision per page + Claude)
  │   ├─ text → send to Claude
  │   │
  │   └─ Claude response:
  │       ├─ confirmed/ready WITHOUT paymentMethod → BLOCK, force ask
  │       ├─ confirmed → save Firestore + Sheets + group msg + queue next
  │       ├─ declined/cancelled → reminder loop
  │       └─ collecting → send message, wait
  │
  └─ rate limit (2s per user)
```

## Key Systems

### ID Alias System (CRITICAL)
WhatsApp uses two ID formats: `972XXX@c.us` (phone) and `XXX@lid` (LID).
`findConversation(chatId, senderNumber, senderLid)` does 4-layer lookup:
1. Direct match in conversations
2. Alias map lookup
3. Phone fallback: `senderNumber + '@c.us'`
4. LID fallback: `senderLid`
Auto-registers alias on match for instant future lookups.

### Staff Name Maps
```js
STAFF_NAMES = {          // For WhatsApp greetings
    '972542400403': 'גיא',
    '972525014146': 'אורי',
    '972523449893': 'שני',
    '972506470007': 'מירי',
    '972508807935': 'רועי',
    '972549539238': 'חיים'
}
STAFF_FULL_NAMES = {     // For Sheets/Firebase
    '972542400403': 'גיא הרשקוביץ',
    '972525014146': 'אורי שטיינברג',
    '972523449893': 'שני',
    '972506470007': 'מירי טל',
    '972508807935': 'רועי הרשקוביץ',
    '972549539238': 'חיים'
}
```

### Amount Handling
Claude may return "3,317". `parseFloat("3,317")` = 3, not 3317!
Commas stripped in 3 places: saveTransaction, syncToSheets, amountDisplay.

### paymentMethod Validation
If Claude sends `confirmed` or `ready` without `paymentMethod` in formData → **BLOCKED**.
Bot injects message to Claude: "חסר אמצעי תשלום! תשאל." Claude asks user.

### Smart Verify (verifyTransaction)
When user says "דיווחתי" — searches Firestore by splitting name into words.
"אופיר ארז" → searches "אופיר" OR "ארז" → finds "דרך ארז בע״מ".
Returns full record details (name, amount) so user can confirm it's the right one.
Only searches last 2 days. Skips common words (בע"מ, ltd, etc).

### Google Sheets Sync
`syncToSheets(data, senderName)` sends complete payload matching all Sheet columns:
שם ממלא הטופס, סכום לפני מע"מ, מע"מ, סכום כולל מע"מ, תאריך, חותמת זמן, סטטוס לקוח, סוג עסקה, עו"ד מטפל, סניף, הערות, תמונת צ'ק.
Validates both HTTP status AND response body `{ success: true/false }`.
Returns true/false — on failure, operator gets private alert.

### Monthly Revenue Summary
Triggered by "הכנסות"/"כמה עשינו" in group.
Queries `sales_records` from first of current month.
**Filters out:** `transactionType` containing "גבייה" or equal to "ריטיינר".
Shows: count, total before/after VAT, breakdown by attorney.
Shows count of skipped billing records.

### Web Form Listener (Firestore onSnapshot)
Listens for new `sales_records` with `timestamp > startTime`.
Skips `source: 'whatsapp-bot'` and billing records.
Sends group notification: "✅ **לקוח** דווח ונרשם בטופס מכר על ידי X."

### Check Photo OCR (Image)
1. `msg.downloadMedia()` → base64
2. Upload to Firebase Storage (`/checks/{uuid}.jpg`) → public URL
3. Google Vision API TEXT_DETECTION → raw text
4. Claude Haiku parses dates + amounts → `[{date, amount}]`
5. Results stored in formData + shown to user for confirmation

### Check PDF OCR
1. `msg.downloadMedia()` → base64 PDF
2. Upload PDF to Firebase Storage → public URL
3. Save to temp file → `pdftoppm -jpeg -r 200 -l 10` → page images (max 10)
4. Each page → Vision OCR → text
5. All texts combined with "--- עמוד X ---" separators
6. One Claude call parses all checks
7. Cleanup temp files

Server requires: `apt-get install poppler-utils`

### Session Persistence
- Auto-save every 2 minutes to `conversations-backup.json`
- On restart: restore if backup < 24 hours old
- **Backup NOT deleted after restore** (prevents data loss on rapid restarts)
- Graceful shutdown saves before exit

### Claude Agent (agent.js)
- Model: `claude-haiku-4-5-20251001`
- System prompt: personality, field definitions, collection rules, payment method enforcement
- **Today's date injected** every call (Israel timezone) — internal use only, not shown to user
- Existing client data appended when available
- 20-second timeout with 1 auto-retry
- JSON parser with 4 fallback attempts
- History limited to 16 messages (keeps first message for context)

### Reminder System
- **Active conversation:** 10 min → 30 min → 2 hours → expires 24 hours
- **Declined flow:** Checks hourly if user filled form manually, up to 6 reminders
- **"דיווחתי" detection:** Works in both declined AND collecting states

### Crash Protection
| Mechanism | What it protects |
|-----------|-----------------|
| uncaughtException handler | Doesn't die on unexpected errors |
| PM2 auto-restart | If dies — back in 5 seconds |
| PM2 cron 4AM | Daily restart — memory cleanup |
| PM2 max 500MB | Restart if memory leaks |
| Backup every 2 min (not deleted) | Conversations survive any restart |
| Claude timeout 20s + retry | Slow API doesn't hang bot |
| History limit 16 messages | Long conversations don't cause timeout |
| Rate limit 2s | Flood doesn't overwhelm Claude API |
| processedMessages dedup | Duplicate messages ignored |
| Health check every 5 min | Detects disconnect, triggers reconnect |
| Exponential backoff reconnect | Doesn't flood WhatsApp servers |
| Operator alerts | Human knows when something is wrong |

## Environment Variables (.env)
```
ANTHROPIC_API_KEY=sk-ant-api03-...
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIREBASE_STORAGE_BUCKET=law-office-sales-form.firebasestorage.app
WHATSAPP_GROUP_NAME=דיווח הכנסות מפגישות ומכירות 2026 🏆🏆🏆
GOOGLE_SHEETS_WEBHOOK=https://script.google.com/macros/s/AKfycbw8WecTKjzf.../exec
GOOGLE_VISION_API_KEY=AIzaSyBQg7_w3mCOpe6Cgi8-TQKynuK0RZfil_s
BOT_OPERATOR_PHONE=972549539238
DEFAULT_ATTORNEY=עו"ד גיא הרשקוביץ
DEFAULT_BRANCH=תל אביב
```

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Bot sends first message then disappears | LID/phone ID mismatch | 4-layer findConversation + auto-register alias |
| User replies but nothing happens | Same LID issue | Check logs for `found:false` |
| Amount saved as 3 instead of 3,317 | parseFloat stops at comma | Commas stripped in 3 places |
| Sheets empty "שם ממלא הטופס" | First name only sent | STAFF_FULL_NAMES map |
| Sheets row missing | Webhook failed silently | Response validation + operator alert |
| NaN in confirmation | Amount commas | Stripped before display |
| Claude skips paymentMethod | AI hallucination | Validation blocks confirmed/ready without it |
| Claude says 2024 | No date in prompt | Today's date injected in system prompt |
| "דיווחתי" not recognized | User in collecting, not declined | Detection added for ALL conversation states |
| "אופיר ארז" not found as "דרך ארז" | Exact match only | Word-level matching |
| Conversations lost after restart | Backup deleted after load | Backup kept (not deleted) |
| PDF not processed | Only checked image/ mimetype | Added application/pdf handling |
| PDF shows 8 of 10 checks | Single image OCR | pdftoppm converts each page separately |
| Bot not responding | PM2 crashed | `pm2 logs` then `pm2 restart hachnasovitz` |
| Need QR re-scan | Auth expired | SSH → `node index.js` → scan → Ctrl+C → `pm2 start ecosystem.config.js` |
| Deploy fails on Windows | No sshpass | Use `node _deploy.js` |
| Web form submission not notified | No listener | Firestore onSnapshot listener active |

## Transaction Detection Keywords
Strong (1 needed): שולם, ייעוץ, ריטיינר, הליך, משפטי, פיקס, עסקה, חתם, חתמה, נסגר, סגרנו, שילם, לקוח חדש, פגישה, חתימה, הסכם
Weak (2 needed): העברה, אשראי, מזומן, ביט, שיקים, שעות, תשלום, ₪, שקל, לקוח, שכ"ט, שכר טרחה

## Revenue Summary Group Commands
Trigger words: הכנסות, כמה עשינו, כמה מכרנו, כמה נכנס, סיכום חודשי, מה המצב
Shows new sales only — excludes transactionType containing "גבייה" or "ריטיינר".

## Form Fields
**Required:** clientName, phone, idNumber, email, transactionType, transactionDescription, amount, paymentMethod
**Conditional:** creditCardStatus, paymentsCount, monthlyCharge, checksCount, checksDetails, checksPhotoURL, splitPayments
**Optional:** address, attorney, branch, caseNumber, notes
**Auto-filled:** date, timestamp, formFillerName (senderFullName), source, VAT calculations

## Group Notification Rules
- **Bot transaction saved:** "✅ **לקוח** דווח ונרשם בטופס מכר על ידי X." (NO amount)
- **Web form saved:** "✅ **לקוח** דווח ונרשם בטופס מכר על ידי X." (via Firestore listener)
- **Billing records:** NOT notified (filtered out)
