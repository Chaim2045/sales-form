// TOFES OFFICE — WhatsApp Smart Bot v5 (Cloud-Ready)
// Claude manages the entire conversation — no rigid if/else
// Added: auto-reconnect, health check, crash protection, operator alerts

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { conversationTurn, isTransactionMessage } = require('./agent');
const { initFirebase, saveTransaction, syncToSheets, findClient, verifyTransaction, getMonthlySummary, getWeeklySummary, findRecordForEdit, updateRecord, processCheckPhoto, processCheckPDF, saveLead, assignLead, updateLeadStatus, getLeadStats, getDueFollowups } = require('./firebase');
const { classifyLeadMessage, detectAssignment, detectStatusUpdate, extractFollowupTime, isLeadReportRequest } = require('./leads-detector');

// ==================== Configuration ====================

const GROUP_NAME = process.env.WHATSAPP_GROUP_NAME || 'דיווחי עסקאות';
const LEADS_GROUP_NAME = process.env.LEADS_GROUP_NAME || '';
const OPERATOR_PHONE = process.env.BOT_OPERATOR_PHONE || '';

// ==================== Staff Name Map ====================
// Maps phone numbers to first names for WhatsApp greeting
var STAFF_NAMES = {
    '972542400403': 'גיא',
    '972525014146': 'אורי',
    '972523449893': 'שני',
    '972506470007': 'מירי',
    '972508807935': 'רועי',
    '972549539238': 'חיים'
};

// Full names for Sheets/Firebase (must match Sheets dropdown values)
// IMPORTANT: Full names must match displayName in Firestore users collection
var STAFF_FULL_NAMES = {
    '972542400403': 'גיא הרשקוביץ',
    '972525014146': 'אורי שטיינברג',
    '972523449893': 'שני',
    '972506470007': 'מירי טל',
    '972508807935': 'רועי הרשקוביץ',
    '972549539238': 'חיים'
};

// Resolve first name → full name for CRM matching
function resolveFullName(firstName) {
    if (!firstName) return firstName;
    var name = firstName.replace(/@|\u200f/g, '').trim();
    // Check STAFF_FULL_NAMES for match
    var keys = Object.keys(STAFF_NAMES);
    for (var i = 0; i < keys.length; i++) {
        if (STAFF_NAMES[keys[i]] === name || STAFF_FULL_NAMES[keys[i]] === name) {
            return STAFF_FULL_NAMES[keys[i]] || name;
        }
    }
    return name; // Return as-is if no match
}

// Reminder intervals (ms)
const REMINDER_1 = 10 * 60 * 1000;  // 10 minutes
const REMINDER_2 = 30 * 60 * 1000;  // 30 minutes
const REMINDER_3 = 2 * 60 * 60 * 1000; // 2 hours
const EXPIRE_TIME = 24 * 60 * 60 * 1000; // 24 hours — delete

// Declined flow limits
const MAX_DECLINED_REMINDERS = 6; // Stop after 6 reminders (6 hours)
const DECLINED_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

// Rate limiting — min interval between Claude API calls per user
const MIN_MSG_INTERVAL = 2000; // 2 seconds
var lastApiCall = {}; // chatId → timestamp

// Reconnect settings
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY = 5 * 60 * 1000; // 5 minutes max
var reconnectAttempts = 0;
var isReconnecting = false;

// Health check
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_DISCONNECT_TIME = 15 * 60 * 1000; // 15 minutes before force restart
var lastConnected = Date.now();
var isConnected = false;
var alertSent = false;

// Stats
var stats = { received: 0, detected: 0, saved: 0, errors: 0, startedAt: Date.now() };

// ==================== State ====================

var conversations = {};
var botMessageIds = new Set();
var pendingQueue = {};
var recentBotTexts = [];
var MAX_RECENT = 30;

// Leads tracking
var recentLeads = [];         // { docId, msgId, lead, timestamp, assignedTo, reminded2, reminded5, reminded15 }
var MAX_RECENT_LEADS = 100;
var cachedLeadsGroupChatId = null;

// ==================== ID Alias Mapping ====================
// WhatsApp uses both phone-based IDs (972XXX@c.us) and LIDs (XXX@lid)
// for the same user. This map ensures we always find the right conversation.
// aliasMap[anyId] → canonicalId (the ID used as key in conversations{})
var aliasMap = {};

function registerAlias(id1, id2) {
    if (!id1 || !id2 || id1 === id2) return;
    // Find existing canonical ID
    var canonical = aliasMap[id1] || aliasMap[id2] || id1;
    aliasMap[id1] = canonical;
    aliasMap[id2] = canonical;
    log('client', 'Alias: ' + id1.substring(0, 15) + ' ↔ ' + id2.substring(0, 15));
}

function resolveId(chatId) {
    return aliasMap[chatId] || chatId;
}

function findConversation(chatId, senderNumber, senderLid) {
    // Direct match first
    if (conversations[chatId]) return { convo: conversations[chatId], key: chatId };
    // Try alias
    var resolved = aliasMap[chatId];
    if (resolved && conversations[resolved]) return { convo: conversations[resolved], key: resolved };
    // Reverse search — chatId might be canonical for a different key
    var keys = Object.keys(aliasMap);
    for (var i = 0; i < keys.length; i++) {
        if (aliasMap[keys[i]] === chatId && conversations[keys[i]]) {
            return { convo: conversations[keys[i]], key: keys[i] };
        }
    }
    // Try phone-based lookup — if we have senderNumber, check phone@c.us directly
    if (senderNumber) {
        var phoneId = senderNumber + '@c.us';
        if (phoneId !== chatId && conversations[phoneId]) {
            // Found! Register alias for next time
            registerAlias(phoneId, chatId);
            return { convo: conversations[phoneId], key: phoneId };
        }
    }
    // Try LID-based lookup
    if (senderLid && senderLid !== chatId && conversations[senderLid]) {
        registerAlias(senderLid, chatId);
        return { convo: conversations[senderLid], key: senderLid };
    }
    return null;
}

// ==================== Crash Protection ====================

process.on('uncaughtException', function(err) {
    log('error', 'Uncaught exception: ' + (err.message || err));
    log('error', err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : '');
    // Don't exit — PM2 will restart if truly fatal
});

process.on('unhandledRejection', function(reason) {
    log('error', 'Unhandled rejection: ' + (reason && reason.message || reason));
});

// ==================== Reminders ====================

setInterval(async function() {
    var now = Date.now();
    var chatIds = Object.keys(conversations);

    for (var i = 0; i < chatIds.length; i++) {
        var chatId = chatIds[i];
        var convo = conversations[chatId];
        if (!convo) continue;

        var elapsed = now - convo.timestamp;
        var sinceLast = now - (convo.lastReminder || convo.timestamp);
        var clientLabel = convo.formData.clientName || 'הלקוח';
        var userName = (convo.senderName || '').split(' ')[0] || 'היי';

        // === DECLINED flow — verify if user filled form manually ===
        if (convo.declined) {
            var sinceLast = now - (convo.lastReminder || convo.declinedAt);

            // Give up after MAX_DECLINED_REMINDERS
            if (convo.reminders >= MAX_DECLINED_REMINDERS) {
                log('timeout', convo.senderName + ' — declined flow expired for ' + convo.declinedClient);
                delete conversations[chatId];
                continue;
            }

            if (sinceLast > DECLINED_CHECK_INTERVAL) {
                try {
                    var filled = await verifyTransaction(convo.declinedClient, convo.declinedAmount);
                    if (filled) {
                        botSend(chatId, userName + ', ראיתי שדיווחת על *' + filled.clientName + '* (' + filled.amount.toLocaleString('he-IL') + ' ₪) 💪 כל הכבוד!\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        delete conversations[chatId];
                        continue;
                    }
                } catch (e) {
                    log('error', 'Declined verify failed: ' + e.message);
                }

                convo.reminders++;
                convo.lastReminder = now;

                if (convo.reminders <= 2) {
                    botSend(chatId, userName + ', עדיין לא מצאתי דיווח על *' + convo.declinedClient + '*.\nרוצה שנמלא? או דווח פה:\nhttps://tofes-office.netlify.app\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                } else if (convo.reminders <= 4) {
                    botSend(chatId, userName + ', תזכורת — *' + convo.declinedClient + '* ממתין לדיווח.\nענה *כן* ונמלא ביחד 😊\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                } else {
                    botSend(chatId, userName + ', *' + convo.declinedClient + '* עדיין לא דווח.\nhttps://tofes-office.netlify.app\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                }
            }
            continue;
        }

        // === Normal flow — active conversation reminders ===

        // Expire after 24 hours
        if (elapsed > EXPIRE_TIME) {
            botSend(chatId, '⏰ ' + userName + ', העסקה של *' + clientLabel + '* פגה. דווח שוב בקבוצה אם צריך.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
            delete conversations[chatId];
            await startNextFromQueue(chatId);
            continue;
        }

        // Send reminders (3 tiers)
        if (convo.reminders === 0 && elapsed > REMINDER_1 && sinceLast > REMINDER_1) {
            botSend(chatId, userName + ', לא הספקת? נמשיך עם *' + clientLabel + '*?\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
            convo.reminders = 1;
            convo.lastReminder = now;
        } else if (convo.reminders === 1 && elapsed > REMINDER_2 && sinceLast > REMINDER_1) {
            botSend(chatId, userName + ', עדיין שומר לך את *' + clientLabel + '*. ענה כשנוח 😊\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
            convo.reminders = 2;
            convo.lastReminder = now;
        } else if (convo.reminders === 2 && elapsed > REMINDER_3 && sinceLast > REMINDER_2) {
            botSend(chatId, userName + ', תזכורת אחרונה — *' + clientLabel + '* ממתין.\nענה *המשך* או *בטל*\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
            convo.reminders = 3;
            convo.lastReminder = now;
        }
    }

    // ===== Leads reminders =====
    if (isConnected && cachedLeadsGroupChatId) {
        for (var li = 0; li < recentLeads.length; li++) {
            var rl = recentLeads[li];
            if (rl.assignedTo) continue; // Already assigned

            var elapsed = now - rl.timestamp;

            // 2 minutes — bot takes over, asks "מי מתקשר?"
            if (elapsed > 2 * 60 * 1000 && !rl.reminded2) {
                rl.reminded2 = true;
                var leadLabel = rl.lead.name ? '*' + rl.lead.name + '*' : (rl.lead.phone || 'ליד חדש');
                var subjectLabel = rl.lead.subject ? ' — ' + rl.lead.subject : '';
                botSend(cachedLeadsGroupChatId, '📋 ' + leadLabel + subjectLabel + '\nמי מתקשר? 📞\nלידוביץ 📋');
                log('msg', '📋 Lead reminder 2min: ' + (rl.lead.name || rl.lead.phone));
            }

            // 5 minutes — second reminder
            if (elapsed > 5 * 60 * 1000 && !rl.reminded5) {
                rl.reminded5 = true;
                botSend(cachedLeadsGroupChatId, '⏰ ליד ממתין כבר 5 דקות: *' + (rl.lead.name || rl.lead.phone || 'ליד') + '*\nמי לוקח? 🙏\nלידוביץ 📋');
                log('msg', '📋 Lead reminder 5min: ' + (rl.lead.name || rl.lead.phone));
            }

            // 15 minutes — DM to operator/manager
            if (elapsed > 15 * 60 * 1000 && !rl.reminded15) {
                rl.reminded15 = true;
                notifyOperator('⚠️ ליד לא שובץ 15 דקות!\n' + (rl.lead.name || '') + ' ' + (rl.lead.phone || '') + '\n' + (rl.lead.subject || ''));
                log('warn', '📋 Lead escalated 15min: ' + (rl.lead.name || rl.lead.phone));
            }

            // 1 hour — remove from memory (too old)
            if (elapsed > 60 * 60 * 1000) {
                recentLeads.splice(li, 1);
                li--;
            }
        }
    }

    // Clean bot message IDs periodically
    if (botMessageIds.size > 500) botMessageIds.clear();
}, 60 * 1000); // Check every minute

// ==================== Memory Cleanup (hourly) ====================

setInterval(function() {
    var now = Date.now();
    var cleaned = 0;

    // Clean expired conversations
    Object.keys(conversations).forEach(function(id) {
        if (now - conversations[id].timestamp > EXPIRE_TIME) {
            delete conversations[id];
            cleaned++;
        }
    });

    // Clean stale rate limit entries
    Object.keys(lastApiCall).forEach(function(id) {
        if (now - lastApiCall[id] > 3600000) delete lastApiCall[id];
    });

    // Clean empty queues
    Object.keys(pendingQueue).forEach(function(id) {
        if (!pendingQueue[id] || pendingQueue[id].length === 0) delete pendingQueue[id];
    });

    if (cleaned) log('warn', 'Cleaned ' + cleaned + ' expired conversations');
}, 60 * 60 * 1000);

// ==================== Leads Follow-Up Check (every 10 min) ====================

// Track sent reminders to avoid spamming: { docId: { lastSent: timestamp, level: 'normal' } }
var sentFollowupReminders = {};

setInterval(async function() {
    if (!isConnected) return;

    try {
        var due = await getDueFollowups();
        var now = Date.now();

        for (var i = 0; i < due.length; i++) {
            var lead = due[i];
            if (!lead.assignedTo) continue;

            // Throttle by reminder level (hours between sends)
            var THROTTLE_HOURS = { normal: 1, daily: 24, weekly: 72 };
            var prev = sentFollowupReminders[lead.docId];
            if (prev) {
                var hoursSinceLast = (now - prev.lastSent) / (1000 * 60 * 60);
                var minHours = THROTTLE_HOURS[lead.reminderLevel];
                if (minHours && hoursSinceLast < minHours) continue;
                if (lead.reminderLevel === 'final' && prev.level === 'final') continue;
            }

            // Find assignee's phone to DM them
            var assigneePhone = null;
            var staffKeys = Object.keys(STAFF_NAMES);
            for (var k = 0; k < staffKeys.length; k++) {
                if (STAFF_NAMES[staffKeys[k]] === lead.assignedTo || STAFF_FULL_NAMES[staffKeys[k]] === lead.assignedTo) {
                    assigneePhone = staffKeys[k];
                    break;
                }
            }

            if (assigneePhone) {
                var dmId = assigneePhone + '@c.us';
                var ageText = lead.ageDays < 1 ? Math.round(lead.ageDays * 24) + ' שעות' : Math.round(lead.ageDays) + ' ימים';
                var urgency = lead.reminderLevel === 'final' ? '🔴 תזכורת אחרונה!' : lead.reminderLevel === 'weekly' ? '🟡 תזכורת' : '🔔 תזכורת פולואפ';
                var dmText = urgency + '\n*' + (lead.name || 'ליד') + '* ' + (lead.phone || '') + '\nסטטוס: ' + (lead.statusNote || lead.status) + '\nגיל הליד: ' + ageText + '\n\nמה הסטטוס?\nלידוביץ 📋';
                await botSend(dmId, dmText);
                log('sent', '📋 Followup [' + lead.reminderLevel + '] → ' + lead.assignedTo + ' for ' + (lead.name || lead.phone) + ' (' + ageText + ')');
            }

            // Track that we sent this reminder
            sentFollowupReminders[lead.docId] = { lastSent: now, level: lead.reminderLevel };

            // If final reminder, clear followupAt so we stop checking
            if (lead.reminderLevel === 'final') {
                await updateLeadStatus(lead.docId, lead.status, 'bot', 'תזכורת אחרונה נשלחה — ליד בן ' + Math.round(lead.ageDays) + ' ימים', null);
            }
        }

        // Clean old tracking entries (older than 15 days)
        var trackKeys = Object.keys(sentFollowupReminders);
        for (var t = 0; t < trackKeys.length; t++) {
            if (now - sentFollowupReminders[trackKeys[t]].lastSent > 15 * 24 * 60 * 60 * 1000) {
                delete sentFollowupReminders[trackKeys[t]];
            }
        }
    } catch (e) {
        log('error', 'Leads followup check failed: ' + e.message);
    }
}, 10 * 60 * 1000); // Every 10 minutes

// ==================== Clean lockfiles before start ====================

var fs = require('fs');
var sessionPath = require('path').resolve('./.wwebjs_auth/session');
['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(function(f) {
    try { fs.unlinkSync(sessionPath + '/' + f); } catch (e) {}
});

// ==================== WhatsApp Client ====================

var wa = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--single-process',
            '--no-zygote'
        ]
    },
    restartOnAuthFail: true
});

// ==================== Connection Events ====================

wa.on('qr', function(qr) {
    console.log('\n📱 סרוק את ה-QR באפליקציית WhatsApp:\n');
    qrcode.generate(qr, { small: true });
    console.log('WhatsApp > הגדרות > מכשירים מקושרים > קישור מכשיר\n');
});

wa.on('ready', function() {
    isConnected = true;
    lastConnected = Date.now();
    reconnectAttempts = 0;
    cachedGroupChatId = null; // Reset group cache on reconnect
    isReconnecting = false;
    alertSent = false;

    console.log('\n✅ הכנסוביץ מחובר ופעיל!');
    console.log('📍 קבוצה: "' + GROUP_NAME + '"');
    console.log('⏰ ' + new Date().toLocaleString('he-IL'));
    console.log('─'.repeat(40) + '\n');

    try { initFirebase(); } catch (e) { console.error('❌ Firebase init failed:', e.message); }

    // Listen for new sales from the web form → notify group
    startWebSalesListener();

    // Restore conversations from previous session
    loadConversations();

    // Notify operator that bot is back online (only after a disconnect)
    if (stats.startedAt < Date.now() - 30000) {
        notifyOperator('✅ הכנסוביץ חזר לפעולה!\n⏰ ' + new Date().toLocaleString('he-IL'));
    }
});

wa.on('authenticated', function() {
    log('sent', 'WhatsApp authenticated successfully');
});

wa.on('auth_failure', function(msg) {
    log('error', 'Auth failed: ' + msg);
    isConnected = false;

    // Clean lock files
    ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(function(f) {
        try { fs.unlinkSync(sessionPath + '/' + f); } catch (e) {}
    });

    notifyOperator('⚠️ הכנסוביץ — Auth failure!\nצריך לסרוק QR מחדש.\nהתחבר לשרת ותריץ: pm2 logs hachnasovitz');

    // Restart after 10 seconds — PM2 will handle
    setTimeout(function() { process.exit(1); }, 10000);
});

wa.on('disconnected', function(reason) {
    isConnected = false;
    log('warn', 'Disconnected: ' + reason);
    attemptReconnect();
});

// ==================== Auto-Reconnect with Exponential Backoff ====================

function attemptReconnect() {
    if (isReconnecting) return;
    isReconnecting = true;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log('error', 'Max reconnect attempts (' + MAX_RECONNECT_ATTEMPTS + ') — restarting process');
        notifyOperator('❌ הכנסוביץ לא מצליח להתחבר מחדש אחרי ' + MAX_RECONNECT_ATTEMPTS + ' ניסיונות.\nPM2 יפעיל מחדש.');
        process.exit(1); // PM2 will restart
        return;
    }

    // Exponential backoff: 5s → 10s → 20s → 40s → ... → max 5 min
    var delay = Math.min(5000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;

    log('warn', 'Reconnect attempt ' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ' in ' + Math.round(delay / 1000) + 's');

    setTimeout(function() {
        isReconnecting = false;
        try {
            wa.initialize();
        } catch (e) {
            log('error', 'Reconnect failed: ' + e.message);
            attemptReconnect();
        }
    }, delay);
}

// ==================== Health Check (every 5 minutes) ====================

setInterval(async function() {
    if (!isConnected) {
        var downtime = Date.now() - lastConnected;
        log('warn', 'Health check — disconnected for ' + Math.round(downtime / 60000) + ' min');

        // Send alert once after 10 minutes of disconnect
        if (downtime > 10 * 60 * 1000 && !alertSent) {
            alertSent = true;
            notifyOperator('⚠️ הכנסוביץ מנותק כבר ' + Math.round(downtime / 60000) + ' דקות.\nמנסה להתחבר מחדש...');
        }

        // Force restart after MAX_DISCONNECT_TIME
        if (downtime > MAX_DISCONNECT_TIME) {
            log('error', 'Disconnected too long — force restart');
            process.exit(1);
        }
        return;
    }

    // Verify actual connection
    try {
        var state = await wa.getState();
        if (state === 'CONNECTED') {
            lastConnected = Date.now();
        } else {
            log('warn', 'Health check — state: ' + state);
            isConnected = false;
        }
    } catch (e) {
        log('warn', 'Health check failed: ' + e.message);
        // Don't immediately mark as disconnected — could be a transient error
    }
}, HEALTH_CHECK_INTERVAL);

// ==================== Operator Alert ====================

async function notifyOperator(message) {
    if (!OPERATOR_PHONE) return;

    try {
        var operatorChatId = OPERATOR_PHONE.replace(/^\+/, '') + '@c.us';
        await wa.sendMessage(operatorChatId, '🤖 *הכנסוביץ — התראת מערכת*\n\n' + message);
        log('sent', 'Operator alert sent');
    } catch (e) {
        // Bot is probably disconnected — can't send WhatsApp
        log('error', 'Operator alert failed (bot disconnected): ' + e.message);
    }
}

// ==================== Weekly Summary Cron (Sunday 9:00 AM Israel) ====================

var lastWeeklySent = 0;

setInterval(async function() {
    if (!isConnected) return;

    var now = new Date(Date.now() + 3 * 3600000); // Israel time
    var day = now.getDay();   // 0 = Sunday
    var hour = now.getHours();

    // Send every Sunday at 9:00 AM Israel time (check once per hour)
    if (day === 0 && hour === 9 && Date.now() - lastWeeklySent > 12 * 60 * 60 * 1000) {
        lastWeeklySent = Date.now();
        try {
            var summary = await getWeeklySummary();
            if (!summary || summary.count === 0) {
                log('warn', 'Weekly summary — no sales this week');
                return;
            }

            var msg = '📊 *סיכום שבועי — ' + summary.fromDate + ' עד ' + summary.toDate + '*\n\n';
            msg += '💰 ' + summary.count + ' עסקאות חדשות\n';
            msg += '📝 לפני מע"מ: *' + summary.totalBeforeVat.toLocaleString('he-IL') + ' ₪*\n';
            msg += '🧾 כולל מע"מ: *' + summary.totalWithVat.toLocaleString('he-IL') + ' ₪*\n';

            var attorneys = Object.keys(summary.byAttorney);
            if (attorneys.length > 0) {
                msg += '\n👥 *פילוח לפי עו"ד:*\n';
                // Sort by total descending
                attorneys.sort(function(a, b) { return summary.byAttorney[b].total - summary.byAttorney[a].total; });
                attorneys.forEach(function(att, idx) {
                    var a = summary.byAttorney[att];
                    var medal = idx === 0 ? ' 🥇' : idx === 1 ? ' 🥈' : idx === 2 ? ' 🥉' : '';
                    msg += '• ' + att + ': ' + a.count + ' עסקאות — ' + a.total.toLocaleString('he-IL') + ' ₪' + medal + '\n';
                });
            }

            if (summary.skippedRecurring > 0) {
                msg += '\n_(' + summary.skippedRecurring + ' חיובי גבייה לא נספרו)_';
            }

            msg += '\nהכנסוביץ - מס׳ 1 בדיווחים 🏆';

            var groupChat = await findGroupChat();
            if (groupChat) {
                await botSend(groupChat, msg);
                log('sent', 'Weekly summary sent to group');
            }
        } catch (e) {
            log('error', 'Weekly summary failed: ' + e.message);
        }
    }
}, 60 * 60 * 1000); // Check every hour

// ==================== Message Handler ====================

// Listen on BOTH events to catch all messages
wa.on('message', async function(msg) { handleMessage(msg).catch(function(e) { log('error', 'msg handler: ' + String(e.message || e).substring(0, 100)); }); });
wa.on('message_create', async function(msg) { handleMessage(msg).catch(function(e) { log('error', 'msg_create handler: ' + String(e.message || e).substring(0, 100)); }); });

var processedMessages = new Set();

async function handleMessage(msg) {
    try {
        // Deduplicate — same message can arrive from both events
        var msgId = msg.id ? msg.id._serialized : '';
        if (msgId && processedMessages.has(msgId)) return;
        if (msgId) {
            processedMessages.add(msgId);
            if (processedMessages.size > 500) processedMessages.clear();
        }

        var body = (msg.body || '').trim();
        var fromMe = msg.id && msg.id.fromMe;

        // Skip messages sent BY ME (the connected WhatsApp account)
        // msg.id.fromMe is true for messages the logged-in user sends
        if (fromMe) return;

        // Skip bot's own messages (tracked by ID and text)
        if (msg.id && botMessageIds.has(msg.id._serialized)) return;

        if (!body) return;

        stats.received++;

        // Check if this message text matches something the bot recently sent
        var bodyHash = body.substring(0, 80);
        if (recentBotTexts.includes(bodyHash)) return;

        // Get chat safely
        var chat;
        try { chat = await msg.getChat(); } catch (e) { return; }
        if (!chat || !chat.id) return;

        var chatId = chat.id._serialized;
        var isGroup = chat.isGroup === true;

        // Get sender info
        var senderName = 'Unknown';
        var senderFullName = 'Unknown'; // Full name for Sheets/Firebase
        var senderNumber = null;
        var senderLid = null;
        try {
            var contact = await msg.getContact();
            senderNumber = contact.number || null;

            // Get LID (WhatsApp's new Linked ID format)
            if (contact.id) {
                var cid = contact.id._serialized || '';
                if (cid.endsWith('@c.us')) {
                    senderNumber = senderNumber || cid.replace('@c.us', '');
                } else if (cid.endsWith('@lid')) {
                    senderLid = cid;
                }
            }

            // Use staff name map first (by phone number), then WhatsApp profile name
            if (senderNumber && STAFF_NAMES[senderNumber]) {
                senderName = STAFF_NAMES[senderNumber];
                senderFullName = STAFF_FULL_NAMES[senderNumber] || senderName;
            } else {
                // Extract first name from pushname (e.g. "גיא הרשקוביץ עורכי דין" → "גיא")
                var fullName = contact.pushname || contact.name || msg.author || 'Unknown';
                senderName = fullName.split(' ')[0] || fullName;
                senderFullName = fullName;
            }
        } catch (e) {}

        // Register alias between phone-based ID and LID for the same user
        if (senderNumber && senderLid) {
            registerAlias(senderNumber + '@c.us', senderLid);
        }

        // ==================== LEADS GROUP ====================
        if (isGroup && LEADS_GROUP_NAME && chat.name === LEADS_GROUP_NAME) {
            cachedLeadsGroupChatId = chatId;

            // 1. Lead report request
            if (isLeadReportRequest(body)) {
                try {
                    var stats = await getLeadStats(7);
                    if (stats && stats.total > 0) {
                        var msg2 = '📊 *סטטוס לידים — 7 ימים אחרונים*\n\n';
                        msg2 += '🔢 סה"כ: ' + stats.total + ' לידים\n';
                        if (stats.unassigned > 0) msg2 += '⚠️ לא שוייכו: ' + stats.unassigned + '\n';
                        var statuses = Object.keys(stats.byStatus);
                        var statusLabels = { new: '🆕 חדש', assigned: '👤 שויך', contacted: '📞 נוצר קשר', followup: '🔄 פולואפ', closed: '✅ נסגר', not_relevant: '❌ לא רלוונטי', no_answer: '📵 לא ענה' };
                        statuses.forEach(function(st) {
                            msg2 += (statusLabels[st] || st) + ': ' + stats.byStatus[st] + '\n';
                        });
                        var assignees = Object.keys(stats.byAssignee);
                        if (assignees.length > 0) {
                            msg2 += '\n👥 *לפי עובד:*\n';
                            assignees.sort(function(a, b) { return stats.byAssignee[b].total - stats.byAssignee[a].total; });
                            assignees.forEach(function(a) {
                                var as = stats.byAssignee[a];
                                msg2 += '• ' + a + ': ' + as.total + ' לידים';
                                if (as.closed > 0) msg2 += ' (' + as.closed + ' נסגרו ✅)';
                                msg2 += '\n';
                            });
                        }
                        msg2 += '\nלידוביץ - מס׳ 1 במעקב 📋';
                        await botSend(chatId, msg2);
                    } else {
                        await botSend(chatId, '📊 אין לידים ב-7 ימים אחרונים.\nלידוביץ - מס׳ 1 במעקב 📋');
                    }
                } catch (e) {
                    log('error', 'Lead stats failed: ' + e.message);
                }
                return;
            }

            // 2. Detect new lead
            var lead = classifyLeadMessage(body, msg.hasMedia, msg.body);
            if (lead) {
                var docId = await saveLead(lead);
                if (docId) {
                    var msgId = msg.id ? msg.id._serialized : '';
                    recentLeads.unshift({
                        docId: docId,
                        msgId: msgId,
                        lead: lead,
                        timestamp: Date.now(),
                        assignedTo: null,
                        senderName: senderName,
                        reminded2: false,
                        reminded5: false,
                        reminded15: false
                    });
                    if (recentLeads.length > MAX_RECENT_LEADS) recentLeads.pop();
                    log('msg', '📋 Lead detected: ' + (lead.name || lead.phone || 'image') + ' [' + lead.type + ']');
                }
                return;
            }

            // 3. Detect assignment ("אני" / "מטפל" / directed)
            var assignment = detectAssignment(body);
            if (assignment) {
                // Find most recent unassigned lead (within 30 min)
                var relevantLead = null;
                for (var li = 0; li < recentLeads.length; li++) {
                    if (!recentLeads[li].assignedTo && (Date.now() - recentLeads[li].timestamp) < 30 * 60 * 1000) {
                        relevantLead = recentLeads[li];
                        break;
                    }
                }

                if (relevantLead) {
                    // Use full name for CRM matching (displayName in Firestore users)
                    var assignee = assignment.type === 'self' ? (senderFullName || senderName) : resolveFullName(assignment.assignee);
                    var ok = await assignLead(relevantLead.docId, assignee);
                    if (ok) {
                        relevantLead.assignedTo = assignee;
                        log('msg', '📋 Lead assigned: ' + (relevantLead.lead.name || '') + ' → ' + assignee);

                        // Confirm in group
                        await botSend(chatId, '✅ *' + (relevantLead.lead.name || 'ליד') + '* — ' + assignee + ' מטפל.\nלידוביץ 📋');

                        // DM call prep to assignee (if we have their phone)
                        var assigneePhone = null;
                        var staffKeys = Object.keys(STAFF_NAMES);
                        for (var ak = 0; ak < staffKeys.length; ak++) {
                            if (STAFF_NAMES[staffKeys[ak]] === senderName || STAFF_FULL_NAMES[staffKeys[ak]] === assignee) {
                                assigneePhone = staffKeys[ak];
                                break;
                            }
                        }
                        if (assigneePhone) {
                            var leadInfo = relevantLead.lead;
                            var dmText = '📋 *הכנה לשיחה — ' + (leadInfo.name || leadInfo.phone || 'ליד חדש') + '*\n\n';
                            dmText += '📱 טלפון: ' + (leadInfo.phone || 'לא ידוע') + '\n';
                            if (leadInfo.subject) dmText += '📌 נושא: ' + leadInfo.subject + '\n';
                            if (leadInfo.raw) dmText += '💬 הודעה: "' + (leadInfo.raw || '').substring(0, 200) + '"\n';
                            dmText += '\n💡 *טיפים:*\n';
                            dmText += '• תתקשר תוך שעה — תגובה מהירה = סיכוי סגירה גבוה\n';
                            dmText += '• שאל: מה קרה? מתי? יש תיעוד?\n';
                            dmText += '• פגישת ייעוץ: 780₪ + מע"מ\n';
                            dmText += '\nלידוביץ 📋';
                            try {
                                await botSend(assigneePhone + '@c.us', dmText);
                                log('sent', '📋 Call prep DM → ' + assignee);
                            } catch (dmErr) {
                                log('error', 'Call prep DM failed: ' + dmErr.message);
                            }
                        }
                    }
                }
                return;
            }

            // 4. Detect status update
            var statusUpdate = detectStatusUpdate(body);
            if (statusUpdate) {
                // Find relevant lead for this sender (match by first or full name)
                var senderLead = null;
                for (var si = 0; si < recentLeads.length; si++) {
                    var la = recentLeads[si].assignedTo || '';
                    if (la === senderName || la === senderFullName || la === (senderFullName || senderName)) {
                        senderLead = recentLeads[si];
                        break;
                    }
                }

                if (senderLead) {
                    var followup = extractFollowupTime(body);
                    await updateLeadStatus(
                        senderLead.docId,
                        statusUpdate.status,
                        senderName,
                        statusUpdate.reason,
                        followup ? followup.followupAt : null
                    );
                    log('msg', '📋 Lead status: ' + (senderLead.lead.name || '') + ' → ' + statusUpdate.status);

                    // If closed, ask about CRM
                    if (statusUpdate.status === 'closed') {
                        await botSend(chatId, '🎉 *' + (senderLead.lead.name || 'ליד') + '* — נסגר! עדכנת CRM?\nלידוביץ 📋');
                    }
                }
                return;
            }

            // Not a lead-related message — ignore
            return;
        }

        // ==================== GROUP MESSAGE (INCOME) ====================
        if (isGroup && chat.name === GROUP_NAME) {

            // ===== Revenue summary request =====
            if (/הכנסות|כמה (עשינו|מכרנו|נכנס|הכנסנו)|סיכום (חודשי|הכנסות)|מה המצב/i.test(body)) {
                try {
                    var summary = await getMonthlySummary();
                    if (summary && summary.count > 0) {
                        var msg = '📊 *מכירות חדשות — ' + summary.month + ' ' + summary.year + '*\n';
                        msg += '📅 ' + summary.fromDate + ' — ' + summary.toDate + '\n\n';
                        msg += '💰 ' + summary.count + ' עסקאות\n';
                        msg += '📝 לפני מע"מ: *' + summary.totalBeforeVat.toLocaleString('he-IL') + ' ₪*\n';
                        msg += '🧾 כולל מע"מ: *' + summary.totalWithVat.toLocaleString('he-IL') + ' ₪*\n';

                        var attorneys = Object.keys(summary.byAttorney);
                        if (attorneys.length > 1) {
                            msg += '\n👥 פילוח:\n';
                            attorneys.forEach(function(att) {
                                var a = summary.byAttorney[att];
                                msg += '• ' + att + ': ' + a.count + ' עסקאות — ' + a.total.toLocaleString('he-IL') + ' ₪\n';
                            });
                        }

                        if (summary.skippedRecurring > 0) {
                            msg += '\n_(' + summary.skippedRecurring + ' חיובי גבייה חודשית לא נספרו)_';
                        }

                        msg += '\nהכנסוביץ - מס׳ 1 בדיווחים 🏆';
                        await botSend(chatId, msg);
                    } else if (summary && summary.skippedRecurring > 0) {
                        await botSend(chatId, '📊 אין מכירות חדשות החודש.\n_(' + summary.skippedRecurring + ' חיובי גבייה חודשית לא נספרו)_\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    } else {
                        await botSend(chatId, '📊 אין עסקאות עדיין החודש.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    }
                } catch (e) {
                    log('error', 'Summary failed: ' + e.message);
                }
                return;
            }

            if (!isTransactionMessage(body)) return;

            stats.detected++;

            // Determine DM target — try to send privately
            // Priority: phone number @c.us > LID > group (last resort)
            var dmChatId;
            if (senderNumber) {
                dmChatId = senderNumber + '@c.us';
            } else if (senderLid) {
                dmChatId = senderLid;
            } else {
                // Can't DM — skip to avoid sending in group
                log('warn', 'Cannot DM ' + senderName + ' — no number or LID found');
                return;
            }
            var isDM = dmChatId !== chatId;

            log('msg', senderName + (isDM ? ' [DM]' : ' [GROUP]') + ': ' + body.substring(0, 60));

            // Look up existing client data
            var existingClientData = await extractAndFindClient(body);

            // Check if user already has an active conversation (check aliases too)
            var existing = findConversation(dmChatId, senderNumber, senderLid);
            var existingConvo = existing ? existing.convo : null;
            if (existing) dmChatId = existing.key; // use the canonical key
            if (existingConvo && !existingConvo.declined) {
                if (!pendingQueue[dmChatId]) pendingQueue[dmChatId] = [];
                pendingQueue[dmChatId].push({ body: body, senderName: senderName, senderFullName: senderFullName, existingClientData: existingClientData });
                var prevClient = existingConvo.formData.clientName || 'הלקוח';
                await botSend(dmChatId, '📋 שמרתי את הדיווח בתור.\nקודם נסיים עם *' + prevClient + '* 👇');
                log('queue', senderName + ' — queued (total: ' + pendingQueue[dmChatId].length + ')');
                return;
            }

            // Rate limit check
            if (!rateLimitOk(dmChatId)) return;

            // Start conversation with Claude
            var history = [
                {
                    role: 'user',
                    content: 'הודעת דיווח עסקה חדשה מהקבוצה:\n"' + body + '"\n\nשולח: ' + senderName + '\nתפתח עם הודעת greeting קצרה שכוללת את שם הלקוח מההודעה.'
                }
            ];

            var result = await conversationTurn(history, existingClientData);
            if (!result) {
                log('error', 'Agent failed — no response');
                return;
            }

            conversations[dmChatId] = {
                history: history.concat([{ role: 'assistant', content: JSON.stringify(result) }]),
                formData: result.formData || {},
                senderName: senderName,
                senderFullName: senderFullName,
                originalMessage: body,
                existingClientData: existingClientData,
                timestamp: Date.now(),
                reminders: 0,
                lastReminder: 0
            };

            // Ensure alias is registered so replies via LID find this conversation
            if (senderNumber && senderLid) {
                registerAlias(senderNumber + '@c.us', senderLid);
            }

            await botSend(dmChatId, result.message);
            log('sent', (isDM ? 'DM' : 'Group') + ' → ' + result.status);
            return;
        }

        // ==================== PRIVATE / REPLY MESSAGE ====================
        // Look up conversation by chatId OR by alias (LID ↔ phone)
        var convoLookup = findConversation(chatId, senderNumber, senderLid);
        var convoKey = convoLookup ? convoLookup.key : chatId;
        var convo = convoLookup ? convoLookup.convo : null;

        if (!isGroup) {
            log('msg', senderName + ' [DM] (chat:' + chatId.substring(0, 15) + ' key:' + convoKey.substring(0, 15) + ' found:' + !!convo + '): ' + body.substring(0, 50));
        }

        // If user was declined/cancelled but sends a message
        if (convo && convo.declined) {
            var isYes = /^(כן|יאללה|אוקיי|בוא|מעולה|ok|yes|המשך|בטח|סבבה|👍)$/i.test(body.trim());
            var claimsFilled = /^(מילאתי|טיפלתי|דיווחתי|עשיתי|שלחתי|כבר|בוצע|עדכנתי|סיימתי)$/i.test(body.trim());

            if (isYes) {
                // User wants to fill via bot — restart conversation
                convo.declined = false;
                convo.reminders = 0;
                convo.timestamp = Date.now();
                convo.history = [
                    { role: 'user', content: 'הודעת דיווח עסקה חדשה מהקבוצה:\n"' + convo.originalMessage + '"\n\nשולח: ' + convo.senderName + '\nהמשתמש אישר שרוצה למלא. תתחיל לאסוף פרטים ישר.' }
                ];
                var result = await conversationTurn(convo.history, convo.existingClientData);
                if (result) {
                    convo.history.push({ role: 'assistant', content: JSON.stringify(result) });
                    convo.formData = result.formData || {};
                    await botSend(chatId, result.message);
                }
                return;
            }

            if (claimsFilled) {
                // User claims they filled — verify against Firebase
                var userName = (convo.senderName || '').split(' ')[0] || 'היי';
                try {
                    var filled = await verifyTransaction(convo.declinedClient, convo.declinedAmount);
                    if (filled) {
                        await botSend(chatId, userName + ', מצאתי דיווח על *' + filled.clientName + '* (' + filled.amount.toLocaleString('he-IL') + ' ₪) במערכת.\nזה הדיווח הנכון? ✅\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        delete conversations[convoKey];
                    } else {
                        await botSend(chatId, userName + ', בדקתי עכשיו במערכת ולא מצאתי דיווח על *' + convo.declinedClient + '* 🤔\nרוצה שנמלא ביחד? ענה *כן*\nאו מלא בטופס: https://tofes-office.netlify.app\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    }
                } catch (e) {
                    log('error', 'Verify claim failed: ' + e.message);
                }
                return;
            }

            // Any other message from a declined user — ignore
            return;
        }

        if (!convo) {
            // ===== Edit/update existing record =====
            var editMatch = body.match(/(?:תעדכן|תערוך|תשנה|תתקן|תעלה שיקים|עדכון|השלם פרטים|תשלים)[\s]+(?:את\s+)?(?:של\s+)?(.+)/i);
            if (!isGroup && editMatch) {
                var editClientName = editMatch[1].trim();
                if (!rateLimitOk(chatId)) return;

                log('msg', senderName + ' requested edit for: ' + editClientName);
                var matches = await findRecordForEdit(editClientName);

                if (matches.length === 0) {
                    await botSend(chatId, '🔍 לא מצאתי רשומה של *' + editClientName + '* במערכת.\nבדוק את השם ונסה שוב.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return;
                }

                // If multiple matches, show list
                var record;
                if (matches.length > 1) {
                    var listMsg = '🔍 מצאתי ' + matches.length + ' רשומות:\n\n';
                    matches.slice(0, 5).forEach(function(m, i) {
                        listMsg += (i + 1) + '. *' + m.clientName + '* — ' + m.amount.toLocaleString('he-IL') + ' ₪ (' + m.date + ')\n';
                    });
                    listMsg += '\nשלח את המספר של הרשומה שתרצה לעדכן.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆';
                    await botSend(chatId, listMsg);

                    // Store edit session
                    conversations[chatId] = {
                        editMode: true,
                        editMatches: matches.slice(0, 5),
                        editStep: 'choose',
                        senderName: senderName,
                        senderFullName: senderFullName,
                        timestamp: Date.now(),
                        reminders: 0,
                        lastReminder: 0,
                        history: [],
                        formData: {}
                    };
                    return;
                }

                // Single match — show details and ask what to update
                record = matches[0];
                var detailMsg = '📋 *' + record.clientName + '*\n';
                detailMsg += '💰 ' + record.amount.toLocaleString('he-IL') + ' ₪\n';
                detailMsg += '💳 ' + (record.paymentMethod || 'לא צוין') + '\n';
                detailMsg += '📞 ' + (record.phone || 'חסר') + '\n';
                detailMsg += '📧 ' + (record.email || 'חסר') + '\n';
                detailMsg += '🆔 ' + (record.idNumber || 'חסר') + '\n';
                if (record.checksPhotoURL) detailMsg += '📸 שיקים: יש\n';
                else detailMsg += '📸 שיקים: חסר\n';
                detailMsg += '\nמה לעדכן? (סכום / טלפון / מייל / ת.ז / שיקים — שלח תמונה או PDF)\nהכנסוביץ - מס׳ 1 בדיווחים 🏆';
                await botSend(chatId, detailMsg);

                conversations[chatId] = {
                    editMode: true,
                    editRecord: record,
                    editStep: 'what',
                    senderName: senderName,
                    senderFullName: senderFullName,
                    timestamp: Date.now(),
                    reminders: 0,
                    lastReminder: 0,
                    history: [],
                    formData: {}
                };
                return;
            }

            // DM with a new transaction
            if (!isGroup && isTransactionMessage(body)) {
                if (!rateLimitOk(chatId)) return;
                var existingClientData = await extractAndFindClient(body);

                var history = [
                    { role: 'user', content: 'הודעת דיווח עסקה חדשה (הודעה ישירה):\n"' + body + '"\n\nשולח: ' + senderName + '\nתפתח עם greeting קצר ותתחיל לאסוף פרטים.' }
                ];

                var result = await conversationTurn(history, existingClientData);
                if (result) {
                    conversations[chatId] = {
                        history: history.concat([{ role: 'assistant', content: JSON.stringify(result) }]),
                        formData: result.formData || {},
                        senderName: senderName,
                        senderFullName: senderFullName,
                        originalMessage: body,
                        existingClientData: existingClientData,
                        timestamp: Date.now(),
                        reminders: 0,
                        lastReminder: 0
                    };
                    await botSend(chatId, result.message);
                }
            }
            return;
        }

        // Rate limit check
        if (!rateLimitOk(convoKey)) return;

        // ==================== Edit Mode Handler ====================
        if (convo.editMode) {
            convo.timestamp = Date.now();

            // Step: choose from multiple matches
            if (convo.editStep === 'choose') {
                var choice = parseInt(body.trim());
                if (choice >= 1 && choice <= (convo.editMatches || []).length) {
                    var record = convo.editMatches[choice - 1];
                    convo.editRecord = record;
                    convo.editStep = 'what';

                    var detailMsg = '📋 *' + record.clientName + '*\n';
                    detailMsg += '💰 ' + record.amount.toLocaleString('he-IL') + ' ₪\n';
                    detailMsg += '💳 ' + (record.paymentMethod || 'לא צוין') + '\n';
                    detailMsg += '📞 ' + (record.phone || 'חסר') + '\n';
                    detailMsg += '📧 ' + (record.email || 'חסר') + '\n';
                    detailMsg += '🆔 ' + (record.idNumber || 'חסר') + '\n';
                    if (record.checksPhotoURL) detailMsg += '📸 שיקים: יש\n';
                    else detailMsg += '📸 שיקים: חסר\n';
                    detailMsg += '\nמה לעדכן?\nהכנסוביץ - מס׳ 1 בדיווחים 🏆';
                    await botSend(chatId, detailMsg);
                } else {
                    await botSend(chatId, 'שלח מספר בין 1 ל-' + (convo.editMatches || []).length + '\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                }
                return;
            }

            // Step: user sends image/PDF to attach checks
            if (convo.editStep === 'what' && msg.hasMedia) {
                try {
                    var media = await msg.downloadMedia();
                    if (media && media.mimetype) {
                        var isImage = media.mimetype.startsWith('image/');
                        var isPDF = media.mimetype === 'application/pdf';
                        if (isImage || isPDF) {
                            await botSend(chatId, isPDF ? '📄 מעבד PDF...' : '📸 מעבד תמונה...');
                            var ocrResult = isPDF ? await processCheckPDF(media.data) : await processCheckPhoto(media.data, media.mimetype);

                            var updates = { checksPhotoURL: ocrResult.photoUrl };
                            if (ocrResult.checks && ocrResult.checks.length > 0) {
                                updates.checksCount = ocrResult.checks.length;
                                updates.checksDetails = JSON.stringify(ocrResult.checks);
                                if (!convo.editRecord.paymentMethod || convo.editRecord.paymentMethod === '') {
                                    updates.paymentMethod = 'שיקים דחויים';
                                }
                            }
                            updates.updatedBy = senderFullName;

                            var ok = await updateRecord(convo.editRecord.docId, updates);
                            if (ok) {
                                var checksMsg = ocrResult.checks && ocrResult.checks.length > 0
                                    ? ocrResult.checks.length + ' שיקים חולצו'
                                    : 'הקובץ הועלה';
                                await botSend(chatId, '✅ *' + convo.editRecord.clientName + '* עודכן — ' + checksMsg + '!\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                                log('saved', 'Edit: ' + convo.editRecord.clientName + ' — checks uploaded by ' + senderName);
                            } else {
                                await botSend(chatId, '❌ שגיאה בעדכון. נסה שוב.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                            }
                            delete conversations[convoKey];
                            return;
                        }
                    }
                } catch (e) {
                    log('error', 'Edit media failed: ' + e.message);
                }
            }

            // Step: user says what to update (text)
            if (convo.editStep === 'what') {
                var updates = {};
                var updateDesc = '';
                var lowerBody = body.toLowerCase();

                // Detect field to update from text
                if (/סכום|מחיר|amount/i.test(lowerBody)) {
                    var numMatch = body.match(/[\d,]+/);
                    if (numMatch) {
                        var newAmount = parseFloat(numMatch[0].replace(/,/g, ''));
                        if (newAmount > 0) {
                            updates.amountBeforeVat = newAmount;
                            updateDesc = 'סכום → ' + newAmount.toLocaleString('he-IL') + ' ₪';
                        }
                    }
                    if (!updateDesc) {
                        convo.editStep = 'value';
                        convo.editField = 'amountBeforeVat';
                        await botSend(chatId, 'מה הסכום החדש?\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        return;
                    }
                } else if (/טלפון|פלאפון|נייד|phone/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'phone';
                    await botSend(chatId, 'מה הטלפון החדש?\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return;
                } else if (/מייל|אימייל|email/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'email';
                    await botSend(chatId, 'מה המייל החדש?\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return;
                } else if (/ת\.?ז|ח\.?פ|תעודת זהות|idnumber/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'idNumber';
                    await botSend(chatId, 'מה ת.ז / ח.פ החדש?\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return;
                } else if (/שיקים|צ.קים|שיק|checks|pdf/i.test(lowerBody)) {
                    await botSend(chatId, '📸 שלח תמונה או PDF של השיקים\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return; // Stay in editStep 'what' — next message with media will be caught above
                } else if (/תשלום|אמצעי/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'paymentMethod';
                    await botSend(chatId, 'מה אמצעי התשלום? (אשראי / העברה / מזומן / ביט / שיקים)\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return;
                } else if (/סיימתי|יציאה|בטל|סגור/i.test(lowerBody)) {
                    await botSend(chatId, '👍 סגרתי עריכה.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    delete conversations[convoKey];
                    return;
                } else {
                    await botSend(chatId, 'מה לעדכן?\n• סכום\n• טלפון\n• מייל\n• ת.ז / ח.פ\n• שיקים (שלח תמונה/PDF)\n• תשלום\n• סיימתי\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    return;
                }

                // Apply update
                if (Object.keys(updates).length > 0) {
                    updates.updatedBy = senderFullName;
                    var ok = await updateRecord(convo.editRecord.docId, updates);
                    if (ok) {
                        await botSend(chatId, '✅ *' + convo.editRecord.clientName + '* עודכן — ' + updateDesc + '\nעוד משהו? או *סיימתי*\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    } else {
                        await botSend(chatId, '❌ שגיאה. נסה שוב.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    }
                }
                return;
            }

            // Step: receive the new value
            if (convo.editStep === 'value' && convo.editField) {
                var updates = {};
                var fieldName = convo.editField;
                var newValue = body.trim();

                if (fieldName === 'amountBeforeVat') {
                    newValue = parseFloat(newValue.replace(/[,\s]/g, '')) || 0;
                    if (newValue <= 0) {
                        await botSend(chatId, 'סכום לא תקין. נסה שוב.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        return;
                    }
                }

                updates[fieldName] = newValue;
                updates.updatedBy = senderFullName;
                var ok = await updateRecord(convo.editRecord.docId, updates);

                if (ok) {
                    var displayValue = fieldName === 'amountBeforeVat' ? newValue.toLocaleString('he-IL') + ' ₪' : newValue;
                    await botSend(chatId, '✅ *' + convo.editRecord.clientName + '* עודכן — ' + displayValue + '\nעוד משהו? או *סיימתי*\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    convo.editStep = 'what'; // Back to menu for more edits
                } else {
                    await botSend(chatId, '❌ שגיאה. נסה שוב.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                }
                return;
            }

            // Fallback
            delete conversations[convoKey];
            return;
        }

        // ==================== Check Photo / PDF Handling ====================
        if (msg.hasMedia) {
            try {
                var media = await msg.downloadMedia();
                if (media && media.mimetype) {
                    var isImage = media.mimetype.startsWith('image/');
                    var isPDF = media.mimetype === 'application/pdf';

                    if (isImage || isPDF) {
                        var sizeKB = Math.round(media.data.length / 1024);
                        log('msg', convo.senderName + ' sent ' + (isPDF ? 'PDF' : 'image') + ' (' + sizeKB + 'KB)');
                        await botSend(chatId, isPDF ? '📄 מעבד PDF... זה יכול לקחת כמה שניות' : '📸 מעבד את התמונה... רגע');

                        var ocrResult;
                        if (isPDF) {
                            ocrResult = await processCheckPDF(media.data);
                        } else {
                            ocrResult = await processCheckPhoto(media.data, media.mimetype);
                        }

                        if (ocrResult.checks && ocrResult.checks.length > 0) {
                            var checksText = ocrResult.checks.map(function(c) {
                                var dateStr = c.date || '?';
                                if (dateStr.length === 10 && dateStr.indexOf('-') > -1) {
                                    var parts = dateStr.split('-');
                                    dateStr = parts[2] + '/' + parts[1] + '/' + parts[0];
                                }
                                return 'שיק ' + c.index + ': ' + dateStr + ' — ' + (c.amount || '?').toLocaleString() + ' ₪';
                            }).join('\n');

                            convo.formData.checksCount = ocrResult.checks.length;
                            convo.formData.checksDetails = ocrResult.checks;
                            convo.formData.checksPhotoURL = ocrResult.photoUrl;
                            convo.formData.paymentMethod = 'שיקים דחויים';

                            convo.timestamp = Date.now();
                            convo.reminders = 0;
                            var pageInfo = ocrResult.pageCount ? ' (' + ocrResult.pageCount + ' עמודים)' : '';
                            convo.history.push({
                                role: 'user',
                                content: 'המשתמש שלח ' + (isPDF ? 'קובץ PDF' : 'תמונת') + ' שיקים' + pageInfo + '. תוצאות OCR:\n' + checksText +
                                    '\nסה"כ ' + ocrResult.checks.length + ' שיקים.' +
                                    '\nקישור לקובץ: ' + ocrResult.photoUrl +
                                    '\nאשר את הפרטים עם המשתמש והמשך לאסוף מה שחסר.'
                            });

                            var result = await conversationTurn(convo.history, convo.existingClientData);
                            if (result) {
                                convo.history.push({ role: 'assistant', content: JSON.stringify(result) });
                                convo.formData = Object.assign(convo.formData, result.formData || {});
                                convo.formData.checksPhotoURL = ocrResult.photoUrl;
                                convo.formData.checksDetails = ocrResult.checks;
                                convo.formData.checksCount = ocrResult.checks.length;
                                await botSend(chatId, result.message);
                                log('turn', convo.senderName + ' → ' + result.status + ' (OCR: ' + ocrResult.checks.length + ' checks from ' + (isPDF ? 'PDF' : 'image') + ')');
                            }
                        } else {
                            await botSend(chatId, '😅 לא הצלחתי לזהות שיקים. נסה ' + (isPDF ? 'PDF ברור יותר' : 'תמונה ברורה יותר') + ', או ספר לי את הפרטים ידנית.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        }
                        return;
                    }
                }
            } catch (mediaErr) {
                log('error', 'Media handling failed: ' + mediaErr.message);
            }
        }

        // Check if user says they already filled the form manually (during active conversation)
        if (/דיווחתי|מילאתי|טיפלתי|כבר (מילאתי|דיווחתי|רשמתי|הכנסתי)|עשיתי את זה בטופס/i.test(body.trim())) {
            var clientLabel = convo.formData.clientName || '';
            var userName = (convo.senderName || '').split(' ')[0] || 'היי';
            if (clientLabel) {
                try {
                    var filled = await verifyTransaction(clientLabel, convo.formData.amount);
                    if (filled) {
                        await botSend(chatId, userName + ', מצאתי דיווח על *' + filled.clientName + '* (' + filled.amount.toLocaleString('he-IL') + ' ₪) במערכת.\nמעולה! סוגר את הטיפול 💪\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        delete conversations[convoKey];
                        await startNextFromQueue(convoKey);
                        return;
                    }
                } catch (e) {
                    log('error', 'Verify during collecting failed: ' + e.message);
                }
            }
            // Not found — let Claude handle it (might ask "are you sure?")
        }

        // Update conversation
        convo.timestamp = Date.now();
        convo.reminders = 0;
        convo.history.push({ role: 'user', content: body });

        // Get Claude's response (with 1 auto-retry on failure)
        var result = await conversationTurn(convo.history, convo.existingClientData);
        if (!result) {
            log('warn', 'Claude failed — retrying once...');
            result = await conversationTurn(convo.history, convo.existingClientData);
        }
        if (!result) {
            await botSend(chatId, '🔄 שגיאה — נסה שוב');
            stats.errors++;
            if (stats.errors > 3 && stats.errors % 5 === 0) {
                notifyOperator('⚠️ שגיאות חוזרות (' + stats.errors + ' סה"כ).\nייתכן שה-Claude API key פג או שיש rate limit.');
            }
            return;
        }

        convo.history.push({ role: 'assistant', content: JSON.stringify(result) });
        convo.formData = result.formData || convo.formData;

        log('turn', convo.senderName + ' → ' + result.status + (result.formData.clientName ? ' (' + result.formData.clientName + ')' : ''));

        // Handle status
        if (!result || !result.status) {
            log('warn', 'No result/status from Claude — ignoring');
            return;
        }
        // VALIDATION: If Claude says confirmed but paymentMethod is missing, push back
        if ((result.status === 'confirmed' || result.status === 'ready') && result.formData && !result.formData.paymentMethod) {
            log('warn', 'Blocked ' + result.status + ' — missing paymentMethod. Pushing back to collecting.');
            convo.history.push({
                role: 'user',
                content: 'עצור — חסר אמצעי תשלום! לא ניתן לשמור בלי לדעת איך הלקוח שילם. תשאל את המשתמש: "איך שילם? (אשראי / העברה / מזומן / ביט / שיקים)"'
            });
            var fixResult = await conversationTurn(convo.history, convo.existingClientData);
            if (fixResult) {
                convo.history.push({ role: 'assistant', content: JSON.stringify(fixResult) });
                convo.formData = fixResult.formData || convo.formData;
                await botSend(chatId, fixResult.message);
                log('turn', convo.senderName + ' → ' + fixResult.status + ' (paymentMethod fix)');
            }
            return;
        }

        if (result.status === 'confirmed') {
            try {
                result.formData.originalMessage = convo.originalMessage;

                // Warn if other fields are missing (non-blocking)
                var missing = [];
                if (!result.formData.phone) missing.push('טלפון');
                if (!result.formData.email) missing.push('מייל');
                if (!result.formData.idNumber) missing.push('ת.ז/ח.פ');
                if (missing.length > 0) {
                    log('warn', 'Confirmed with missing fields: ' + missing.join(', '));
                }

                var fullName = convo.senderFullName || convo.senderName;
                var docId = await saveTransaction(result.formData, fullName);
                var sheetsOk = await syncToSheets(result.formData, fullName);
                if (!sheetsOk) {
                    notifyOperator('⚠️ Sheets sync נכשל עבור *' + (result.formData.clientName || '?') + '*\nFirestore נשמר (' + docId + ').\nבדוק את הגליון.');
                }
                var clientName = result.formData.clientName || '';
                var amount = String(result.formData.amount || '').replace(/[,\s]/g, '');
                var amountNum = parseFloat(amount) || 0;
                var amountDisplay = amountNum > 0 ? amountNum.toLocaleString('he-IL') + ' ₪' : '';
                await botSend(chatId, '✅ *נשמר!* ' + clientName + (amountDisplay ? ' — ' + amountDisplay : '') + ' נרשם במערכת 🎉\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                stats.saved++;
                log('saved', clientName + ' — ' + docId);

                // Send confirmation to the group
                try {
                    var groupChat = await findGroupChat();
                    if (groupChat) {
                        var senderFirst = (convo.senderName || '').split(' ')[0] || 'משתמש';
                        await botSend(groupChat, '✅ *' + clientName + '* דווח ונרשם בטופס מכר על ידי ' + senderFirst + '.\nתודה! מחכה לעוד 💪\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                    }
                } catch (groupErr) {
                    log('error', 'Group notify failed: ' + groupErr.message);
                }
            } catch (err) {
                stats.errors++;
                log('error', 'Save failed: ' + err.message);
                await botSend(chatId, '❌ שגיאה בשמירה — נסה שוב או דווח ידנית:\nhttps://tofes-office.netlify.app');
            }
            delete conversations[convoKey];
            await startNextFromQueue(convoKey);

        } else if (result.status === 'cancelled' || result.status === 'declined') {
            var clientLabel = convo.formData.clientName || convo.originalMessage.split(/\d/)[0].trim() || 'הלקוח';
            var amount = convo.formData.amount || '';
            var userName = (convo.senderName || '').split(' ')[0] || 'היי';

            await botSend(chatId, result.message + '\n\n📝 קישור לטופס:\nhttps://tofes-office.netlify.app\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');

            // Both cancelled and declined → monitor until filled
            convo.declined = true;
            convo.declinedAt = Date.now();
            convo.declinedClient = clientLabel;
            convo.declinedAmount = amount;
            convo.declinedSender = convo.senderName;
            log('declined', convo.senderName + ' — ' + clientLabel);

        } else if (result && result.message) {
            await botSend(chatId, result.message);
        } else {
            log('warn', 'Empty result from Claude — no message to send');
        }

    } catch (err) {
        stats.errors++;
        log('error', (err.message || err).toString().substring(0, 120));
    }
}

// ==================== Queue Handler ====================

async function startNextFromQueue(chatId) {
    if (!pendingQueue[chatId] || pendingQueue[chatId].length === 0) return;

    var next = pendingQueue[chatId].shift();
    log('queue', 'Starting next: ' + next.body.substring(0, 40));

    // Small delay so user sees the previous completion message
    await new Promise(function(r) { setTimeout(r, 2000); });

    var history = [
        {
            role: 'user',
            content: 'הודעת דיווח עסקה חדשה מהקבוצה:\n"' + next.body + '"\n\nשולח: ' + next.senderName + '\nתפתח עם greeting קצר שכולל את שם הלקוח.'
        }
    ];

    var result = await conversationTurn(history, next.existingClientData);
    if (!result) return;

    conversations[chatId] = {
        history: history.concat([{ role: 'assistant', content: JSON.stringify(result) }]),
        formData: result.formData || {},
        senderName: next.senderName,
        senderFullName: next.senderFullName || next.senderName,
        originalMessage: next.body,
        existingClientData: next.existingClientData,
        timestamp: Date.now(),
        reminders: 0,
        lastReminder: 0
    };

    var queueLeft = pendingQueue[chatId] ? pendingQueue[chatId].length : 0;
    var queueMsg = queueLeft > 0 ? '\n\n📋 עוד ' + queueLeft + ' בתור' : '';
    await botSend(chatId, result.message + queueMsg);
}

// ==================== Helpers ====================

// Cache group chat ID to avoid searching every time
var cachedGroupChatId = null;

async function findGroupChat() {
    if (cachedGroupChatId) return cachedGroupChatId;
    try {
        var chats = await wa.getChats();
        for (var i = 0; i < chats.length; i++) {
            if (chats[i].isGroup && chats[i].name === GROUP_NAME) {
                cachedGroupChatId = chats[i].id._serialized;
                return cachedGroupChatId;
            }
        }
    } catch (e) {
        log('error', 'findGroupChat: ' + e.message);
    }
    return null;
}

// ==================== Web Form Sales Listener ====================
// Listens for new sales_records created from the web form and notifies the group

var webSalesListenerActive = false;

function startWebSalesListener() {
    if (webSalesListenerActive) return;
    webSalesListenerActive = true;

    try {
        var firestore = require('firebase-admin').firestore();
        var startTime = require('firebase-admin').firestore.Timestamp.now();

        firestore.collection('sales_records')
            .where('timestamp', '>', startTime)
            .onSnapshot(function(snapshot) {
                snapshot.docChanges().forEach(function(change) {
                    if (change.type !== 'added') return;

                    var d = change.doc.data();

                    // Skip bot's own records
                    if (d.source === 'whatsapp-bot') return;

                    // Skip recurring billing
                    var type = (d.transactionType || '').trim();
                    if (type.includes('גבייה') || type === 'ריטיינר') return;

                    var clientName = d.clientName || '?';
                    var filler = d.formFillerName || '?';

                    log('sent', 'Web form sale detected: ' + clientName + ' by ' + filler);

                    // Send to group
                    findGroupChat().then(function(groupChat) {
                        if (groupChat) {
                            botSend(groupChat, '✅ *' + clientName + '* דווח ונרשם בטופס מכר על ידי ' + filler + '.\nהכנסוביץ - מס׳ 1 בדיווחים 🏆');
                        }
                    }).catch(function(e) {
                        log('error', 'Web sale notify failed: ' + e.message);
                    });
                });
            }, function(err) {
                log('error', 'Firestore listener error: ' + err.message);
                webSalesListenerActive = false;
            });

        log('sent', 'Web sales listener active — monitoring new sales from web form');
    } catch (e) {
        log('error', 'Failed to start web sales listener: ' + e.message);
        webSalesListenerActive = false;
    }
}

async function botSend(chatId, text) {
    try {
        var textHash = text.substring(0, 80);
        recentBotTexts.push(textHash);
        if (recentBotTexts.length > MAX_RECENT) recentBotTexts.shift();

        var sent = await wa.sendMessage(chatId, text);
        if (sent && sent.id) botMessageIds.add(sent.id._serialized);
    } catch (err) {
        log('error', 'Send failed: ' + err.message);
    }
}

async function extractAndFindClient(body) {
    try {
        var nameMatch = body.match(/^([^\d₪]+)/);
        if (nameMatch) {
            var possibleName = nameMatch[1].trim();
            if (possibleName.length >= 2) {
                var found = await findClient(possibleName);
                if (found) {
                    log('client', 'Found in DB: ' + found.clientName);
                    return found;
                }
            }
        }
    } catch (e) {}
    return null;
}

function rateLimitOk(chatId) {
    var now = Date.now();
    if (lastApiCall[chatId] && (now - lastApiCall[chatId]) < MIN_MSG_INTERVAL) {
        return false;
    }
    lastApiCall[chatId] = now;
    return true;
}

function log(type, msg) {
    var time = new Date().toLocaleTimeString('he-IL');
    var icons = {
        msg: '📩', sent: '📨', turn: '💬', saved: '✅', error: '❌',
        warn: '⚠️', queue: '📋', client: '✨', timeout: '⏰', declined: '📋',
        health: '🏥', reconnect: '🔄'
    };
    console.log('[' + time + '] ' + (icons[type] || '▸') + ' ' + msg);
}

// ==================== Session Persistence ====================

var SESSION_FILE = require('path').resolve(__dirname, 'conversations-backup.json');

function saveConversations() {
    try {
        var data = {
            conversations: conversations,
            pendingQueue: pendingQueue,
            savedAt: Date.now()
        };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data));
        var count = Object.keys(conversations).length;
        if (count > 0) log('warn', 'Saved ' + count + ' conversations to disk');
    } catch (e) {
        log('error', 'Save conversations failed: ' + e.message);
    }
}

function loadConversations() {
    try {
        if (!fs.existsSync(SESSION_FILE)) return;
        var raw = fs.readFileSync(SESSION_FILE, 'utf8');
        var data = JSON.parse(raw);

        // Only restore if saved less than 24 hours ago
        if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
            log('warn', 'Backup too old — skipping restore');
            fs.unlinkSync(SESSION_FILE);
            return;
        }

        var count = Object.keys(data.conversations || {}).length;
        if (count > 0) {
            conversations = data.conversations;
            pendingQueue = data.pendingQueue || {};
            log('warn', 'Restored ' + count + ' conversations from disk');
        }

        // Keep backup file (don't delete) — prevents data loss on rapid restarts
    } catch (e) {
        log('error', 'Load conversations failed: ' + e.message);
    }
}

// Auto-save every 2 minutes (in case of unexpected crash)
setInterval(function() {
    if (Object.keys(conversations).length > 0) {
        saveConversations();
    }
}, 2 * 60 * 1000);

// ==================== Graceful Shutdown ====================

function shutdown(signal) {
    log('warn', 'Shutting down (' + signal + ')...');
    saveConversations();
    try { wa.destroy(); } catch (e) {}
    process.exit(0);
}

process.on('SIGINT', function() { shutdown('SIGINT'); });
process.on('SIGTERM', function() { shutdown('SIGTERM'); });

// ==================== Start ====================

console.log('');
console.log('┌─────────────────────────────────┐');
console.log('│   הכנסוביץ — Smart Bot v5       │');
console.log('│   Cloud-Ready Edition            │');
console.log('│   משרד עו"ד גיא הרשקוביץ       │');
console.log('└─────────────────────────────────┘');
console.log('');
console.log('  📍 קבוצה: ' + GROUP_NAME);
console.log('  🔑 Claude API: ' + (process.env.ANTHROPIC_API_KEY ? '✅' : '❌ חסר!'));
console.log('  🔥 Firebase:   ' + (process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? '✅' : '❌ חסר!'));
console.log('  📊 Sheets:     ' + (process.env.GOOGLE_SHEETS_WEBHOOK ? '✅' : '⚠️ לא מוגדר'));
console.log('  📋 לידוביץ:   ' + (LEADS_GROUP_NAME ? '✅ "' + LEADS_GROUP_NAME + '"' : '⚠️ לא מוגדר'));
console.log('  📱 Operator:   ' + (OPERATOR_PHONE ? '✅ ' + OPERATOR_PHONE : '⚠️ לא מוגדר'));
console.log('  🔄 Reconnect:  ' + MAX_RECONNECT_ATTEMPTS + ' attempts, backoff 5s→5min');
console.log('  🏥 Health:     every ' + (HEALTH_CHECK_INTERVAL / 60000) + ' min');
console.log('  ⏰ תזכורות: 10 דק → 30 דק → 2 שעות → פג תוקף 24 שעות');
console.log('');

wa.initialize();
