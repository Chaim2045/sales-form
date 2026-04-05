// TOFES OFFICE — WhatsApp Smart Bot v5 (Cloud-Ready)
// Claude manages the entire conversation — no rigid if/else
// Added: auto-reconnect, health check, crash protection, operator alerts

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { conversationTurn, isTransactionMessage } = require('./agent');
const { initFirebase, saveTransaction, syncToSheets, findClient, verifyTransaction, getMonthlySummary, getWeeklySummary, findRecordForEdit, updateRecord, processCheckPhoto, processCheckPDF, saveLead, saveOrUpdateLead, assignLead, updateLeadStatus, getLeadStats, getDueFollowups, findClientAcrossCollections, setMeetingDate, getUpcomingMeetings, markMeetingReminderSent, ocrLeadImage, getMyLeads, searchLead } = require('./firebase');
const { classifyLeadMessage, detectAssignment, detectStatusUpdate, extractFollowupTime, isLeadReportRequest, detectMeeting } = require('./leads-detector');
const { canSendToClient, getBestReminderTime } = require('./shabbat-checker');
const { israelNow, toIsraelParts, formatIsraelTime } = require('./israel-time');
const { toInternational } = require('./phone-utils');

// ==================== Constants ====================

const OFFICE_ADDRESS = 'דרך מנחם בגין 144, תל אביב\nמגדל מידטאון, קומה 39';
const OFFICE_ADDRESS_SHORT = 'מגדל מידטאון, קומה 39';
const DEFAULT_ASSIGNEE = 'צוות המשרד';

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
                        botSend(chatId, '✅ ' + userName + ', דיווח על *' + filled.clientName + '* (' + filled.amount.toLocaleString('he-IL') + ' ₪) נמצא במערכת.');
                        delete conversations[chatId];
                        continue;
                    }
                } catch (e) {
                    log('error', 'Declined verify failed: ' + e.message);
                }

                convo.reminders++;
                convo.lastReminder = now;

                if (convo.reminders <= 2) {
                    botSend(chatId, '📋 ' + userName + ', לא מצאתי דיווח על *' + convo.declinedClient + '*.\nרוצה שנמלא? או דווח פה:\nhttps://tofes-office.netlify.app');
                } else if (convo.reminders <= 4) {
                    botSend(chatId, '📋 ' + userName + ', *' + convo.declinedClient + '* ממתין לדיווח.\nענה *כן* ונמלא ביחד.');
                } else {
                    botSend(chatId, '📋 ' + userName + ', *' + convo.declinedClient + '* עדיין לא דווח.\nhttps://tofes-office.netlify.app');
                }
            }
            continue;
        }

        // === Normal flow — active conversation reminders ===

        // Expire after 24 hours
        if (elapsed > EXPIRE_TIME) {
            botSend(chatId, '⏰ ' + userName + ', העסקה של *' + clientLabel + '* פגה. דווח שוב בקבוצה אם צריך.');
            delete conversations[chatId];
            await startNextFromQueue(chatId);
            continue;
        }

        // Send reminders (3 tiers)
        if (convo.reminders === 0 && elapsed > REMINDER_1 && sinceLast > REMINDER_1) {
            botSend(chatId, '⏳ ' + userName + ', נמשיך עם *' + clientLabel + '*?');
            convo.reminders = 1;
            convo.lastReminder = now;
        } else if (convo.reminders === 1 && elapsed > REMINDER_2 && sinceLast > REMINDER_1) {
            botSend(chatId, '⏳ ' + userName + ', *' + clientLabel + '* עדיין ממתין. ענה כשנוח.');
            convo.reminders = 2;
            convo.lastReminder = now;
        } else if (convo.reminders === 2 && elapsed > REMINDER_3 && sinceLast > REMINDER_2) {
            botSend(chatId, '⏰ ' + userName + ', תזכורת אחרונה — *' + clientLabel + '* ממתין.\nענה *המשך* או *בטל*');
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
                botSend(cachedLeadsGroupChatId, '📋 *ליד חדש* — ' + leadLabel + subjectLabel + '\nמי מטפל?');
                log('msg', '📋 Lead reminder 2min: ' + (rl.lead.name || rl.lead.phone));
            }

            // 5 minutes — second reminder
            if (elapsed > 5 * 60 * 1000 && !rl.reminded5) {
                rl.reminded5 = true;
                botSend(cachedLeadsGroupChatId, '⏰ *' + (rl.lead.name || rl.lead.phone || 'ליד') + '* ממתין 5 דקות — מי מטפל?');
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

        // ===== Assigned lead follow-up DMs =====
        // After assignment, ask the worker "what happened?" at intervals
        // Respect quiet hours (08:00-21:00 Israel, no Shabbat)
        var ilNowParts = toIsraelParts(new Date());
        var isQuietHours = ilNowParts.hour < 8 || ilNowParts.hour >= 21 || ilNowParts.day === 6; // Sat

        for (var ai = recentLeads.length - 1; ai >= 0; ai--) {
            var al = recentLeads[ai];
            if (!al.assignedTo) continue;

            var sinceAssign = now - (al.assignedAt || al.timestamp);

            // 48 hours — remove from memory (cleanup)
            if (sinceAssign > 48 * 60 * 60 * 1000) {
                recentLeads.splice(ai, 1);
                continue;
            }

            if (al.dmFollowupDone) continue;
            if (isQuietHours) continue; // Don't DM staff at night or Shabbat

            // Find assignee phone (helper pattern)
            var fPhone = null;
            var fKeys = Object.keys(STAFF_NAMES);
            for (var fi = 0; fi < fKeys.length; fi++) {
                if (STAFF_NAMES[fKeys[fi]] === al.assignedTo || STAFF_FULL_NAMES[fKeys[fi]] === al.assignedTo) {
                    fPhone = fKeys[fi]; break;
                }
            }
            if (!fPhone) continue;

            var fName = al.lead ? (al.lead.name || al.lead.phone || 'הליד') : 'הליד';
            var fPhoneDisplay = al.lead ? (al.lead.phone || '') : '';

            // 1 hour — first DM
            if (sinceAssign > 60 * 60 * 1000 && !al.dmFollowup1) {
                al.dmFollowup1 = true;
                al.lastAskedDocId = al.docId; // Track which lead we asked about
                await botSend(fPhone + '@c.us', 'מה קרה עם *' + fName + '*?' + (fPhoneDisplay ? ' (' + fPhoneDisplay + ')' : '') + '\nעדכן: דיברתי / לא ענה / נסגר / לא רלוונטי');
                log('msg', 'DM followup 1h: ' + fName + ' → ' + al.assignedTo);
            }

            // 4 hours — second DM
            if (sinceAssign > 4 * 60 * 60 * 1000 && !al.dmFollowup4) {
                al.dmFollowup4 = true;
                await botSend(fPhone + '@c.us', 'עדיין ממתין לעדכון — *' + fName + '*\nמה הסטטוס?');
                log('msg', 'DM followup 4h: ' + fName + ' → ' + al.assignedTo);
            }

            // 24 hours — stop asking
            if (sinceAssign > 24 * 60 * 60 * 1000) {
                al.dmFollowupDone = true;
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
                var dmText = urgency + '\n*' + (lead.name || 'ליד') + '* ' + (lead.phone || '') + '\nסטטוס: ' + (lead.statusNote || lead.status) + '\nגיל הליד: ' + ageText + '\n\nמה הסטטוס?';
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

// ==================== Meeting Reminders (every 30 min) ====================

setInterval(async function() {
    if (!isConnected) return;

    try {
        // Check if we can send (Shabbat/holiday/hours)
        var sendCheck = await canSendToClient();
        if (!sendCheck.allowed) {
            log('info', 'Meeting reminders skipped: ' + sendCheck.reason);
            return;
        }

        var meetings = await getUpcomingMeetings();
        var now = new Date();

        for (var i = 0; i < meetings.length; i++) {
            var m = meetings[i];
            if (!m.phone) continue;

            var hoursUntil = (m.meetingDate.getTime() - now.getTime()) / (1000 * 60 * 60);
            var isOnline = m.meetingType === 'online';

            // Format meeting date in Israel time (DST-aware)
            var meetFmt = formatIsraelTime(m.meetingDate.getTime());
            var dateDisplay = meetFmt.dateDisplay;
            var timeDisplay = meetFmt.timeStr;

            // Reminder 1: 12-36 hours before → ask approval in leads group
            if (!m.reminder1Sent && hoursUntil > 6 && hoursUntil <= 36) {
                if (cachedLeadsGroupChatId) {
                    var askMsg = '🔔 *תזכורת פגישה — מחר*\n';
                    askMsg += (m.name || m.phone) + '\n';
                    askMsg += dateDisplay + ' בשעה ' + timeDisplay + '\n';
                    askMsg += (isOnline ? 'גוגל מיט' : OFFICE_ADDRESS_SHORT) + '\n';
                    askMsg += 'אחראי: ' + (m.assignedTo || '—') + '\n\n';
                    askMsg += '*לשלוח תזכורת ללקוח/ה?*\nכתוב *כן* או *לא*';
                    await botSend(cachedLeadsGroupChatId, askMsg);

                    // Store as pending approval
                    recentLeads.unshift({
                        docId: m.docId,
                        lead: { name: m.name, phone: m.phone },
                        timestamp: Date.now(),
                        assignedTo: m.assignedTo,
                        pendingReminderApproval: true,
                        reminderNum: 1,
                        meetingDate: m.meetingDate.getTime(),
                        meetingType: m.meetingType,
                        meetLink: m.meetLink,
                        nudgeCount: 0,
                        nudgeTime: Date.now()
                    });

                    // Mark as "asked" so we don't ask again next cycle
                    await markMeetingReminderSent(m.docId, 1);
                    log('msg', '🔔 Reminder 1 approval requested: ' + (m.name || m.phone));
                }
            }

            // Reminder 2: morning of meeting (0-6 hours before) → ask approval
            if (!m.reminder2Sent && hoursUntil > 0.5 && hoursUntil <= 6) {
                if (cachedLeadsGroupChatId) {
                    var askMsg2 = '🔔 *תזכורת פגישה — היום!*\n';
                    askMsg2 += (m.name || m.phone) + '\n';
                    askMsg2 += timeDisplay + '\n';
                    askMsg2 += (isOnline ? 'גוגל מיט' : OFFICE_ADDRESS_SHORT) + '\n\n';
                    askMsg2 += '*לשלוח תזכורת ללקוח/ה?*\nכתוב *כן* או *לא*';
                    await botSend(cachedLeadsGroupChatId, askMsg2);

                    recentLeads.unshift({
                        docId: m.docId,
                        lead: { name: m.name, phone: m.phone },
                        timestamp: Date.now(),
                        assignedTo: m.assignedTo,
                        pendingReminderApproval: true,
                        reminderNum: 2,
                        meetingDate: m.meetingDate.getTime(),
                        meetingType: m.meetingType,
                        meetLink: m.meetLink,
                        nudgeCount: 0,
                        nudgeTime: Date.now()
                    });

                    await markMeetingReminderSent(m.docId, 2);
                    log('msg', '🔔 Reminder 2 approval requested: ' + (m.name || m.phone));
                }
            }
        }

        // Nudge: check for unanswered approval requests (30 min old)
        for (var ni = 0; ni < recentLeads.length; ni++) {
            var rl = recentLeads[ni];
            if (!rl.pendingReminderApproval) continue;
            var minutesSinceAsk = (Date.now() - rl.nudgeTime) / 60000;

            if (minutesSinceAsk >= 30 && rl.nudgeCount === 0 && cachedLeadsGroupChatId) {
                // First nudge — ask again in group
                await botSend(cachedLeadsGroupChatId, '⏳ עדיין ממתין לאישור — לשלוח תזכורת ל-*' + (rl.lead.name || 'הלקוח') + '*?\nכתוב *כן* או *לא*');
                rl.nudgeCount = 1;
                rl.nudgeTime = Date.now();
                log('msg', '🔔 Nudge 1: ' + (rl.lead.name || rl.docId));
            } else if (minutesSinceAsk >= 30 && rl.nudgeCount === 1) {
                // Second nudge — DM to assignee
                var nudgePhone = null;
                var staffKeys = Object.keys(STAFF_NAMES);
                for (var nk = 0; nk < staffKeys.length; nk++) {
                    if (STAFF_NAMES[staffKeys[nk]] === rl.assignedTo || STAFF_FULL_NAMES[staffKeys[nk]] === rl.assignedTo) {
                        nudgePhone = staffKeys[nk]; break;
                    }
                }
                if (nudgePhone) {
                    await botSend(nudgePhone + '@c.us', '⏳ ממתין לאישור — לשלוח תזכורת ל-*' + (rl.lead.name || 'הלקוח') + '*?\nענה בקבוצת הלידים: *כן* או *לא*');
                }
                rl.nudgeCount = 2;
                rl.nudgeTime = Date.now();
                log('msg', '🔔 Nudge 2 (DM): ' + (rl.lead.name || rl.docId) + ' → ' + rl.assignedTo);
            } else if (rl.nudgeCount >= 2 && minutesSinceAsk >= 30) {
                // Give up — don't send reminder
                rl.pendingReminderApproval = false;
                log('warn', '🔕 Reminder expired (no approval): ' + (rl.lead.name || rl.docId));
            }
        }
    } catch (e) {
        log('error', 'Meeting reminders failed: ' + e.message);
    }
}, 30 * 60 * 1000); // Every 30 minutes

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
    cachedLeadsGroupChatId = null; // Reset leads group cache too
    isReconnecting = false;
    alertSent = false;

    console.log('\n✅ הכנסוביץ מחובר ופעיל!');
    console.log('📍 קבוצה: "' + GROUP_NAME + '"');
    console.log('⏰ ' + new Date().toLocaleString('he-IL'));
    console.log('─'.repeat(40) + '\n');

    try { initFirebase(); } catch (e) { console.error('❌ Firebase init failed:', e.message); }

    // Listen for new sales from the web form → notify group
    startWebSalesListener();

    // Listen for new leads from email → announce in leads group
    startEmailLeadsListener();

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

    var ilNow = israelNow();
    var day = ilNow.getUTCDay();   // 0 = Sunday
    var hour = ilNow.getUTCHours();

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
            msg += summary.count + ' עסקאות חדשות\n';
            msg += 'לפני מע"מ: *' + summary.totalBeforeVat.toLocaleString('he-IL') + ' ₪*\n';
            msg += 'כולל מע"מ: *' + summary.totalWithVat.toLocaleString('he-IL') + ' ₪*\n';

            var attorneys = Object.keys(summary.byAttorney);
            if (attorneys.length > 0) {
                msg += '\n*פילוח לפי עו"ד:*\n';
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
wa.on('message', async function(msg) { handleMessage(msg).catch(function(e) { try { log('error', 'msg handler: ' + (e ? (e.stack || e.message || String(e)) : 'unknown').substring(0, 300)); } catch(x) { console.error('msg catch error', x); } }); });
wa.on('message_create', async function(msg) { handleMessage(msg).catch(function(e) { try { log('error', 'msg_create handler: ' + (e ? (e.stack || e.message || String(e)) : 'unknown').substring(0, 300)); } catch(x) { console.error('msg_create catch error', x); } }); });

var processedMessages = new Set();

async function handleMessage(msg) {
    try {
        // Deduplicate — same message can arrive from both events
        var msgId = msg.id ? msg.id._serialized : '';
        if (msgId && processedMessages.has(msgId)) return;
        if (msgId) {
            processedMessages.add(msgId);
            if (processedMessages.size > 500) {
                // Sliding window — keep last 250 instead of clearing all
                var arr = Array.from(processedMessages);
                processedMessages.clear();
                for (var pi = arr.length - 250; pi < arr.length; pi++) {
                    processedMessages.add(arr[pi]);
                }
            }
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
            log('msg', '📋 LEADS GROUP msg from ' + senderName + ': ' + body.substring(0, 60));

            try {

            // 0. Enrich command — WhatsApp name lookup for all leads without name
            if (body.trim() === '!enrich' && senderNumber && STAFF_NAMES[senderNumber]) {
                await botSend(chatId, '🔍 מתחיל enrichment — שליפת שמות מוואטסאפ...');
                try {
                    var result = await enrichLeadNamesFromWhatsApp(wa, db);
                    var enrichMsg = '✅ *Enrichment הושלם*\n\n' +
                        '• שמות עודכנו: *' + result.enriched + '*\n' +
                        '• לא נמצא שם: ' + result.notFound + '\n' +
                        '• לא בוואטסאפ: ' + result.notOnWhatsapp + '\n' +
                        '• שגיאות: ' + result.errors;
                    if (result.remaining > 0) {
                        enrichMsg += '\n\n📋 נשארו עוד *' + result.remaining + '* לידים — שלח `!enrich` שוב';
                    }
                    await botSend(chatId, enrichMsg);
                } catch (e) {
                    log('error', 'Enrich failed: ' + e.message);
                    await botSend(chatId, '❌ Enrichment נכשל: ' + e.message);
                }
                return;
            }

            // 1. Lead report request
            if (isLeadReportRequest(body)) {
                try {
                    var leadStats = await getLeadStats(7);
                    if (leadStats && leadStats.total > 0) {
                        var msg2 = '📊 *סטטוס לידים — 7 ימים אחרונים*\n\n';
                        msg2 += 'סה"כ: *' + leadStats.total + '* לידים\n';
                        if (leadStats.unassigned > 0) msg2 += 'לא שוייכו: *' + leadStats.unassigned + '*\n';
                        var statuses = Object.keys(leadStats.byStatus);
                        var statusLabels = { new: 'חדש', assigned: 'שויך', contacted: 'נוצר קשר', followup: 'פולואפ', closed: 'נסגר', not_relevant: 'לא רלוונטי', no_answer: 'לא ענה' };
                        statuses.forEach(function(st) {
                            msg2 += (statusLabels[st] || st) + ': ' + leadStats.byStatus[st] + '\n';
                        });
                        var assignees = Object.keys(leadStats.byAssignee);
                        if (assignees.length > 0) {
                            msg2 += '\n*לפי עובד:*\n';
                            assignees.sort(function(a, b) { return leadStats.byAssignee[b].total - leadStats.byAssignee[a].total; });
                            assignees.forEach(function(a) {
                                var as = leadStats.byAssignee[a];
                                msg2 += '• ' + a + ': ' + as.total + ' לידים';
                                if (as.closed > 0) msg2 += ' (' + as.closed + ' נסגרו)';
                                msg2 += '\n';
                            });
                        }
                        await botSend(chatId, msg2);
                    } else {
                        await botSend(chatId, '📊 אין לידים ב-7 ימים אחרונים.');
                    }
                } catch (e) {
                    log('error', 'Lead stats failed: ' + e.message);
                }
                return;
            }

            // 2. Detect meeting ("תואמה ושילמה", "פגישת המשך ליום ראשון")
            var meeting = detectMeeting(body);
            if (meeting && meeting.meetingDate) {
                // Try to find lead in recentLeads first
                var meetingLead = null;
                for (var mi = 0; mi < recentLeads.length; mi++) {
                    if (recentLeads[mi].assignedTo === senderName || recentLeads[mi].assignedTo === senderFullName) {
                        meetingLead = recentLeads[mi];
                        break;
                    }
                }

                // If no recent lead found, try to extract phone from message and create/update lead
                var meetingDocId = meetingLead ? meetingLead.docId : null;
                var meetingName = meetingLead ? (meetingLead.lead.name || meetingLead.lead.phone) : null;
                var meetClientInfo = null;

                if (!meetingDocId) {
                    // Try to parse as lead too (extract name + phone from same message)
                    var meetingLeadData = classifyLeadMessage(body, false, body);
                    if (meetingLeadData && meetingLeadData.phone) {
                        meetingDocId = await saveOrUpdateLead(meetingLeadData);
                        meetingName = meetingLeadData.name || meetingLeadData.phone;

                        // Cross-collection lookup
                        try { meetClientInfo = await findClientAcrossCollections(meetingLeadData.phone); } catch(e) {}

                        // Assign to sender
                        if (meetingDocId) {
                            await assignLead(meetingDocId, senderFullName || senderName);

                            // Notify if returning client
                            if (meetClientInfo && meetClientInfo.sales.length > 0) {
                                var lastSale = meetClientInfo.sales[0];
                                await botSend(chatId, '🔄 *לקוח חוזר* — ' + meetingName + '\nעסקה קודמת: ' + (lastSale.amount ? lastSale.amount.toLocaleString('he-IL') + '₪' : '') + ' (' + (lastSale.type || '') + ')');
                            }
                        }
                    }
                }

                if (meetingDocId) {
                    var meetFmt2 = formatIsraelTime(meeting.meetingDate);
                    await setMeetingDate(meetingDocId, meeting.meetingDate, 'פגישה נקבעה — ' + meetFmt2.dateStr, meeting.meetingType, meeting.meetLink);
                    var dateStr = meetFmt2.dateDisplay;
                    var timeStr = meetFmt2.timeStr;
                    var typeLabel = meeting.meetingType === 'online' ? 'אונליין' : 'פיזית';
                    var confirmMsg = '📅 *פגישה נקבעה*\n';
                    confirmMsg += (meetingName || 'ליד') + '\n';
                    confirmMsg += dateStr + ' ב-' + timeStr + '\n';
                    confirmMsg += typeLabel + '\n';
                    if (meeting.meetLink) confirmMsg += meeting.meetLink + '\n';
                    confirmMsg += 'אחראי: ' + (senderFullName || senderName) + '\n';
                    // Cross-lookup status
                    if (meetClientInfo && meetClientInfo.sales && meetClientInfo.sales.length > 0) {
                        var lastSale = meetClientInfo.sales[0];
                        var saleAmt = lastSale.amount;
                        var saleDate = lastSale.date || '';
                        if (saleDate && typeof saleDate === 'object' && saleDate.toDate) saleDate = saleDate.toDate().toLocaleDateString('he-IL');
                        confirmMsg += 'לקוח חוזר — עסקה קודמת: ' + (saleAmt ? saleAmt.toLocaleString('he-IL') + '₪' : '') + (lastSale.type ? ' (' + lastSale.type + ')' : '') + (saleDate ? ' — ' + saleDate : '') + '\n';
                    } else if (meetClientInfo && meetClientInfo.billing) {
                        confirmMsg += 'לקוח ריטיינר — ' + (meetClientInfo.billing.monthlyAmount ? meetClientInfo.billing.monthlyAmount.toLocaleString('he-IL') + '₪/חודש' : '') + '\n';
                    } else {
                        confirmMsg += 'לקוח חדש (לא נמצא בטופס מכר)\n';
                    }
                    confirmMsg += 'נשמר ב-CRM\n\n';
                    confirmMsg += '*לשלוח תזכורת ללקוח/ה?*\n';
                    confirmMsg += 'כתוב *כן* לשליחת תזכורת, או *לא* לביטול.';
                    await botSend(chatId, confirmMsg);

                    // Store pending reminder approval
                    recentLeads.unshift({
                        docId: meetingDocId,
                        lead: { name: meetingName, phone: (meetingLeadData || {}).phone },
                        timestamp: Date.now(),
                        assignedTo: senderFullName || senderName,
                        pendingReminderApproval: true,
                        meetingDate: meeting.meetingDate,
                        meetingType: meeting.meetingType,
                        meetLink: meeting.meetLink
                    });

                    log('msg', '📅 Meeting set (' + meeting.meetingType + '): ' + (meetingName || '') + ' → ' + dateStr + ' — waiting for reminder approval');
                } else {
                    log('warn', 'Meeting detected but no phone/lead found in message');
                }
                return;
            }

            // 2b. Handle reminder approval ("כן" / "לא" after meeting set)
            // Only match if: (a) there IS a pending approval, (b) sender is a known staff member
            var trimmedBody = body.trim();
            if (trimmedBody === 'כן' || trimmedBody === 'לא' || trimmedBody === 'yes' || trimmedBody === 'no') {
                // First check: is the sender a known staff member?
                var senderIsStaff = !!(senderNumber && STAFF_NAMES[senderNumber]);
                // LID fallback: check if sender's LID resolves to a known staff phone via aliasMap
                if (!senderIsStaff && senderLid) {
                    var resolvedPhone = aliasMap[senderLid];
                    if (resolvedPhone) {
                        var phoneOnly = resolvedPhone.replace('@c.us', '');
                        if (STAFF_NAMES[phoneOnly]) senderIsStaff = true;
                    }
                }
                // Find a pending approval (prioritize one assigned to this sender)
                var pendingLead = null;
                if (senderIsStaff) {
                    for (var pi = 0; pi < recentLeads.length; pi++) {
                        if (recentLeads[pi].pendingReminderApproval) {
                            pendingLead = recentLeads[pi];
                            break;
                        }
                    }
                }

                if (pendingLead) {
                    pendingLead.pendingReminderApproval = false;

                    if (trimmedBody === 'כן' || trimmedBody === 'yes') {
                        // Approved — send reminder NOW to client
                        var clientPhone = (pendingLead.lead.phone || '').replace(/[\s\-]/g, '');
                        if (clientPhone.startsWith('0')) clientPhone = '972' + clientPhone.substring(1);
                        var clientWaId = clientPhone + '@c.us';

                        // Format meeting info (DST-aware)
                        var mFmt = formatIsraelTime(pendingLead.meetingDate);
                        var mDateStr = mFmt.dateDisplay;
                        var mTimeStr = mFmt.timeStr;
                        var mIsOnline = pendingLead.meetingType === 'online';
                        var assignee = pendingLead.assignedTo || DEFAULT_ASSIGNEE;

                        var clientName = pendingLead.lead.name || '';
                        var firstName = clientName ? clientName.split(' ')[0] : '';

                        var reminderMsg = 'שלום' + (firstName ? ' ' + firstName : '') + ',\n\n';

                        if (pendingLead.reminderNum === 2) {
                            // Morning reminder
                            reminderMsg += 'פגישת הייעוץ המשפטי שלך עם עו"ד גיא הרשקוביץ מתקיימת היום בשעה ' + mTimeStr + '.\n\n';
                        } else {
                            // Day before reminder
                            reminderMsg += 'תזכורת לפגישת ייעוץ משפטי עם עו"ד גיא הרשקוביץ.\n\n';
                            reminderMsg += '📅 ' + mDateStr + ' בשעה ' + mTimeStr + '\n';
                        }

                        if (mIsOnline) {
                            reminderMsg += '💻 הפגישה תתקיים בגוגל מיט.';
                            if (pendingLead.meetLink) reminderMsg += '\n🔗 ' + pendingLead.meetLink;
                            else reminderMsg += '\nקישור יישלח סמוך למועד הפגישה.';
                        } else {
                            reminderMsg += '📍 ' + OFFICE_ADDRESS;
                        }

                        reminderMsg += '\n\nנתראה בפגישה!\n\n' + assignee + ',\nמשרד עו"ד הרשקוביץ ושות\'';

                        try {
                            await botSend(clientWaId, reminderMsg);
                            await botSend(chatId, '✅ תזכורת נשלחה ל-' + (clientName || 'הלקוח') + '.');
                            log('sent', '📅 Reminder sent to client: ' + (clientName || clientPhone));
                        } catch (sendErr) {
                            await botSend(chatId, '❌ שגיאה בשליחת תזכורת: ' + sendErr.message);
                            log('error', 'Reminder send failed: ' + sendErr.message);
                        }
                    } else {
                        // Denied
                        await botSend(chatId, '❌ תזכורת בוטלה.');
                        log('msg', '🔕 Reminder cancelled for ' + (pendingLead.lead.name || pendingLead.docId));
                    }
                    return;
                }
            }

            // 2c. Image OCR — extract lead details from screenshot
            if (msg.hasMedia) {
                try {
                    var media = await msg.downloadMedia();
                    if (media && /^image/.test(media.mimetype)) {
                        log('msg', 'Image received in leads group, running OCR...');
                        var ocrResult = await ocrLeadImage(media.data, media.mimetype);

                        if (ocrResult && ocrResult.phone) {
                            // Got phone from OCR — check if already exists
                            var ocrLead = {
                                name: ocrResult.name || null,
                                phone: ocrResult.phone.replace(/[\s\-]/g, ''),
                                subject: ocrResult.subject || null,
                                type: 'image_ocr',
                                raw: (ocrResult.rawText || '').substring(0, 500),
                                priority: 'normal'
                            };

                            // Cross-lookup before saving
                            var ocrClientInfo = null;
                            try { ocrClientInfo = await findClientAcrossCollections(ocrLead.phone); } catch(e) {}

                            // Check if already in leads (e.g., from email)
                            if (ocrClientInfo && ocrClientInfo.lead) {
                                var existingLead = ocrClientInfo.lead;
                                var eld = existingLead.data || existingLead;
                                var fromEmail = eld.source === 'email';
                                var ocrMsg = '📋 *ליד קיים* — ' + (eld.name || ocrLead.name || ocrLead.phone);
                                var createdDate = eld.createdAt && eld.createdAt.toDate ? eld.createdAt.toDate() : (eld.createdAt ? new Date(eld.createdAt) : null);
                                if (createdDate) ocrMsg += '\nפנה ב-' + createdDate.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
                                if (eld.source) ocrMsg += ' (' + (fromEmail ? 'מהמייל' : eld.source === 'din_sms' ? 'din.co.il' : eld.source === 'missed_call' ? 'שיחה שלא נענתה' : eld.source) + ')';
                                if (eld.assignedTo) ocrMsg += '\nמשויך ל-' + eld.assignedTo;
                                else ocrMsg += '\nלא שויך — מי מטפל?';
                                if (eld.status && eld.status !== 'new') ocrMsg += ' (סטטוס: ' + eld.status + ')';
                                await botSend(chatId, ocrMsg);
                                // Update existing lead with OCR data if missing
                                saveOrUpdateLead(ocrLead);
                                return;
                            }

                            // New lead from image
                            var ocrDocId = await saveOrUpdateLead(ocrLead);
                            if (ocrDocId) {
                                var ocrAnnounce = '📋 *ליד חדש* — ' + (ocrLead.name || ocrLead.phone);
                                if (ocrLead.phone) ocrAnnounce += ', ' + ocrLead.phone;
                                if (ocrLead.subject) ocrAnnounce += '\n' + ocrLead.subject;
                                if (ocrClientInfo && ocrClientInfo.sales && ocrClientInfo.sales.length > 0) {
                                    var ocrSale = ocrClientInfo.sales[0];
                                    ocrAnnounce += '\nלקוח חוזר (עסקה: ' + (ocrSale.amount ? ocrSale.amount.toLocaleString('he-IL') + '₪' : '') + ')';
                                }
                                ocrAnnounce += '\nמי מטפל?';
                                await botSend(chatId, ocrAnnounce);

                                recentLeads.unshift({
                                    docId: ocrDocId, lead: ocrLead, timestamp: Date.now(),
                                    assignedTo: null, senderName: senderName,
                                    reminded2: false, reminded5: false, reminded15: false
                                });
                                if (recentLeads.length > MAX_RECENT_LEADS) recentLeads.pop();
                                log('msg', 'OCR lead: ' + (ocrLead.name || ocrLead.phone));
                            }
                            return;
                        } else if (ocrResult && ocrResult.rawText) {
                            // OCR got text but no phone
                            await botSend(chatId, 'לא הצלחתי לזהות טלפון בתמונה. מה הפרטים?');
                            return;
                        }
                    }
                } catch (ocrErr) {
                    log('error', 'OCR lead error: ' + ocrErr.message);
                }
            }

            // 3. Detect new lead (text-based)
            var lead = classifyLeadMessage(body, msg.hasMedia, msg.body);
            if (lead) {
                // Dedup: use saveOrUpdateLead instead of saveLead
                var docId = await saveOrUpdateLead(lead);

                // Cross-collection lookup
                var clientInfo = null;
                if (lead.phone) {
                    try { clientInfo = await findClientAcrossCollections(lead.phone); } catch(e) {}
                }

                if (docId) {
                    log('msg', '📋 Lead detected: ' + (lead.name || lead.phone || 'image') + ' [' + lead.type + ']');

                    // Check if lead already exists and is assigned — skip reminders
                    var existingAssigned = clientInfo && clientInfo.lead && clientInfo.lead.data && clientInfo.lead.data.assignedTo;

                    // Only add to reminder queue if not already assigned
                    if (!existingAssigned) {
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
                    }

                    // Immediate announcement for NEW leads (no existing lead found)
                    if (!clientInfo || !clientInfo.lead) {
                        var newMsg = '📋 *ליד חדש* — ' + (lead.name || lead.phone || 'ליד');
                        if (lead.phone && lead.name) newMsg += ', ' + lead.phone;
                        if (lead.subject) newMsg += '\n' + lead.subject;
                        newMsg += '\nמי מטפל?';
                        await botSend(chatId, newMsg);
                    }

                    // Notify group about existing lead or returning client
                    if (clientInfo) {
                        if (clientInfo.lead && clientInfo.lead.data) {
                            var el = clientInfo.lead.data;
                            // Always show — even if no name/assignee, the phone was seen before
                            var existMsg = '📋 *ליד קיים* — ' + (el.name || lead.name || lead.phone);
                            var elCreated = el.createdAt && el.createdAt.toDate ? el.createdAt.toDate() : (el.createdAt ? new Date(el.createdAt) : null);
                            if (elCreated) existMsg += '\nפנה ב-' + elCreated.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
                            if (el.source) existMsg += ' (' + (el.source === 'email' ? 'מהמייל' : el.source === 'din_sms' ? 'din.co.il' : el.source === 'missed_call' ? 'שיחה שלא נענתה' : el.source) + ')';
                            if (el.assignedTo) existMsg += '\nמשויך ל-' + el.assignedTo;
                            else existMsg += '\nלא שויך — מי מטפל?';
                            if (el.status && el.status !== 'new') existMsg += ' (סטטוס: ' + el.status + ')';
                            await botSend(chatId, existMsg);
                        }
                        if (clientInfo.sales.length > 0 || clientInfo.billing) {
                            var returnMsg = '🔄 *לקוח חוזר* — ' + (lead.name || lead.phone) + '\n';
                            if (clientInfo.sales.length > 0) {
                                var lastSale = clientInfo.sales[0];
                                returnMsg += 'עסקה קודמת: ' + (lastSale.clientName || '') + ' — ' + (lastSale.amount ? lastSale.amount.toLocaleString('he-IL') + '₪' : '') + ' (' + (lastSale.type || '') + ')\n';
                            }
                            if (clientInfo.billing) {
                                returnMsg += 'ריטיינר: ' + (clientInfo.billing.monthlyAmount ? clientInfo.billing.monthlyAmount.toLocaleString('he-IL') + '₪/חודש' : '') + '\n';
                            }
                            await botSend(chatId, returnMsg);
                        }
                    }
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
                        relevantLead.assignedAt = Date.now();
                        log('msg', '📋 Lead assigned: ' + (relevantLead.lead.name || '') + ' → ' + assignee);

                        // Confirm in group
                        await botSend(chatId, '✅ *' + (relevantLead.lead.name || 'ליד') + '* — ' + assignee + ' מטפל.');

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
                            dmText += 'טלפון: ' + (leadInfo.phone || 'לא ידוע') + '\n';
                            if (leadInfo.subject) dmText += 'נושא: ' + leadInfo.subject + '\n';
                            if (leadInfo.raw) dmText += 'הודעה: "' + (leadInfo.raw || '').substring(0, 200) + '"\n';
                            dmText += '\n*טיפים:*\n';
                            dmText += '• תתקשר תוך שעה — תגובה מהירה = סיכוי סגירה גבוה\n';
                            dmText += '• שאל: מה קרה? מתי? יש תיעוד?\n';
                            dmText += '• פגישת ייעוץ: *780₪* + מע"מ';
                            try {
                                await botSend(assigneePhone + '@c.us', dmText);
                                log('sent', '📋 Call prep DM → ' + assignee);
                            } catch (dmErr) {
                                log('error', 'Call prep DM failed: ' + dmErr.message);
                            }
                        }
                    }
                    return;
                }
                // No unassigned lead found — fall through to status update detection
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
                    // Stop DM followup — status updated in group
                    senderLead.dmFollowupDone = true;

                    if (statusUpdate.status === 'closed') {
                        await botSend(chatId, '✅ *' + (senderLead.lead.name || 'ליד') + '* — נסגר');
                    }
                }
                return;
            }

            // Not a lead-related message — ignore
            return;

            } catch (leadsErr) {
                log('error', 'Leads group handler error: ' + (leadsErr.message || leadsErr).toString().substring(0, 150));
            }
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
                        msg += summary.fromDate + ' — ' + summary.toDate + '\n\n';
                        msg += summary.count + ' עסקאות\n';
                        msg += 'לפני מע"מ: *' + summary.totalBeforeVat.toLocaleString('he-IL') + ' ₪*\n';
                        msg += 'כולל מע"מ: *' + summary.totalWithVat.toLocaleString('he-IL') + ' ₪*\n';

                        var attorneys = Object.keys(summary.byAttorney);
                        if (attorneys.length > 1) {
                            msg += '\nפילוח:\n';
                            attorneys.forEach(function(att) {
                                var a = summary.byAttorney[att];
                                msg += '• ' + att + ': ' + a.count + ' עסקאות — ' + a.total.toLocaleString('he-IL') + ' ₪\n';
                            });
                        }

                        if (summary.skippedRecurring > 0) {
                            msg += '\n_(' + summary.skippedRecurring + ' חיובי גבייה חודשית לא נספרו)_';
                        }

                        await botSend(chatId, msg);
                    } else if (summary && summary.skippedRecurring > 0) {
                        await botSend(chatId, '📊 אין מכירות חדשות החודש.\n_(' + summary.skippedRecurring + ' חיובי גבייה חודשית לא נספרו)_');
                    } else {
                        await botSend(chatId, '📊 אין עסקאות עדיין החודש.');
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
                await botSend(dmChatId, '📋 שמרתי את הדיווח בתור.\nקודם נסיים עם *' + prevClient + '*.');
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
            log('msg', senderName + ' [DM] (chat:' + chatId.substring(0, 15) + ' key:' + convoKey.substring(0, 15) + ' found:' + !!convo + ' num:' + senderNumber + '): ' + body.substring(0, 50));
        }

        // Bot commands via DM (operator only — match by phone or staff name)
        var isOperator = (senderNumber === OPERATOR_PHONE) || (STAFF_NAMES[OPERATOR_PHONE] && senderName === STAFF_NAMES[OPERATOR_PHONE]);
        if (!isGroup && isOperator && body.trim() === '!enrich') {
            await botSend(chatId, '🔍 מתחיל enrichment — שליפת שמות מוואטסאפ (100 לידים)...');
            try {
                var result = await enrichLeadNamesFromWhatsApp(wa, null);
                var enrichMsg = '✅ *Enrichment הושלם*\n\n' +
                    '• שמות עודכנו: *' + result.enriched + '*\n' +
                    '• לא נמצא שם: ' + result.notFound + '\n' +
                    '• לא בוואטסאפ: ' + result.notOnWhatsapp + '\n' +
                    '• שגיאות: ' + result.errors;
                if (result.remaining > 0) {
                    enrichMsg += '\n\n📋 נשארו עוד *' + result.remaining + '* — שלח `!enrich` שוב';
                }
                await botSend(chatId, enrichMsg);
            } catch (e) {
                log('error', 'Enrich failed: ' + e.message);
                await botSend(chatId, '❌ Enrichment נכשל: ' + e.message);
            }
            return;
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
                        await botSend(chatId, '✅ ' + userName + ', מצאתי דיווח על *' + filled.clientName + '* (' + filled.amount.toLocaleString('he-IL') + ' ₪) במערכת.');
                        delete conversations[convoKey];
                    } else {
                        await botSend(chatId, '❌ ' + userName + ', לא מצאתי דיווח על *' + convo.declinedClient + '* במערכת.\nרוצה שנמלא ביחד? ענה *כן*\nאו מלא בטופס: https://tofes-office.netlify.app');
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
                    await botSend(chatId, '🔍 לא מצאתי רשומה של *' + editClientName + '* במערכת.\nבדוק את השם ונסה שוב.');
                    return;
                }

                // If multiple matches, show list
                var record;
                if (matches.length > 1) {
                    var listMsg = '🔍 מצאתי ' + matches.length + ' רשומות:\n\n';
                    matches.slice(0, 5).forEach(function(m, i) {
                        listMsg += (i + 1) + '. *' + m.clientName + '* — ' + m.amount.toLocaleString('he-IL') + ' ₪ (' + m.date + ')\n';
                    });
                    listMsg += '\nשלח את המספר של הרשומה שתרצה לעדכן.';
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
                detailMsg += record.amount.toLocaleString('he-IL') + ' ₪\n';
                detailMsg += (record.paymentMethod || 'לא צוין') + '\n';
                detailMsg += 'טלפון: ' + (record.phone || 'חסר') + '\n';
                detailMsg += 'מייל: ' + (record.email || 'חסר') + '\n';
                detailMsg += 'ת.ז: ' + (record.idNumber || 'חסר') + '\n';
                if (record.checksPhotoURL) detailMsg += 'שיקים: יש\n';
                else detailMsg += 'שיקים: חסר\n';
                detailMsg += '\nמה לעדכן? (סכום / טלפון / מייל / ת.ז / שיקים — שלח תמונה או PDF)';
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

            // ==================== DM Leads Queries ====================
            if (!isGroup && senderNumber && STAFF_NAMES[senderNumber]) {
                var staffFullName = STAFF_FULL_NAMES[senderNumber] || STAFF_NAMES[senderNumber];
                var handled = false;

                // "הלידים שלי"
                if (/הלידים שלי|לידים שלי/i.test(body)) {
                    var myLeads = await getMyLeads(staffFullName);
                    if (myLeads.length === 0) {
                        await botSend(chatId, '📋 אין לידים פעילים משויכים אליך כרגע');
                    } else {
                        var mlMsg = '📋 *הלידים שלי* (' + myLeads.length + ' פעילים)\n';
                        myLeads.forEach(function(l, i) {
                            var created = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : null;
                            var dateStr = created ? created.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) : '';
                            mlMsg += '\n' + (i + 1) + '. ' + (l.name || l.phone || 'ליד') + (l.phone && l.name ? ' — ' + l.phone : '');
                            mlMsg += '\n   ' + (l.subject || '—') + ' | ' + (dateStr ? 'פנה ב-' + dateStr : '') + ' | ' + (l.status || 'new');
                        });
                        await botSend(chatId, mlMsg);
                    }
                    handled = true;
                }

                // "מה עם [שם/טלפון]" — only if query is short (name/phone, not a sentence)
                if (!handled) {
                    var queryMatch = body.match(/^מה עם (.{2,30})$/);
                    // Skip if query is empty or looks like a transaction
                    if (queryMatch && queryMatch[1].trim().length < 2) queryMatch = null;
                    if (queryMatch) {
                        var searchResult = await searchLead(queryMatch[1].trim());
                        if (!searchResult || !searchResult.lead) {
                            await botSend(chatId, '📋 לא נמצא ליד עבור "' + queryMatch[1].trim() + '"');
                        } else {
                            var ld = searchResult.lead.data;
                            var ldMsg = '📋 *' + (ld.name || ld.phone || 'ליד') + '*' + (ld.phone && ld.name ? ' — ' + ld.phone : '') + '\n';
                            var ldCreated = ld.createdAt && ld.createdAt.toDate ? ld.createdAt.toDate() : null;
                            if (ldCreated) ldMsg += 'פנה ב-' + ldCreated.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
                            if (ld.source) ldMsg += ' (' + (ld.source === 'email' ? 'מהמייל' : ld.source === 'din_sms' ? 'din.co.il' : ld.source === 'missed_call' ? 'שיחה' : ld.source) + ')';
                            ldMsg += '\nסטטוס: ' + (ld.status || 'new');
                            if (ld.subject) ldMsg += '\nנושא: ' + ld.subject;
                            if (ld.assignedTo) ldMsg += '\nמשויך ל-' + ld.assignedTo;
                            if (ld.statusNote) ldMsg += '\nהערה: ' + ld.statusNote;
                            if (searchResult.sales && searchResult.sales.length > 0) {
                                var s = searchResult.sales[0];
                                ldMsg += '\n\nעסקה קודמת: ' + (s.amount ? Number(s.amount).toLocaleString('he-IL') + '₪' : '') + ' (' + (s.type || '') + ')';
                            }
                            if (searchResult.billing) {
                                ldMsg += '\nריטיינר: ' + (searchResult.billing.monthlyAmount ? Number(searchResult.billing.monthlyAmount).toLocaleString('he-IL') + '₪/חודש' : '');
                            }
                            if (ld.history && ld.history.length > 0) {
                                ldMsg += '\n\nהיסטוריה:';
                                ld.history.slice(-5).forEach(function(h) {
                                    var hDate = h.at ? new Date(h.at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) : '';
                                    ldMsg += '\n• ' + hDate + ' — ' + (h.note || h.action || '');
                                });
                            }
                            await botSend(chatId, ldMsg);
                        }
                        handled = true;
                    }
                }

                // "סטטוס לידים" in DM
                if (!handled && isLeadReportRequest(body)) {
                    var leadStats = await getLeadStats(7);
                    if (leadStats) {
                        var myCount = 0, myClosed = 0;
                        if (leadStats.byAssignee && leadStats.byAssignee[staffFullName]) {
                            myCount = leadStats.byAssignee[staffFullName].total || 0;
                            myClosed = leadStats.byAssignee[staffFullName].closed || 0;
                        }
                        var statsMsg = '📊 *סטטוס לידים — 7 ימים*\n';
                        statsMsg += 'סה"כ: ' + leadStats.total + ' | לא שויכו: ' + leadStats.unassigned + '\n';
                        statsMsg += 'שלך: ' + myCount + ' לידים, ' + myClosed + ' נסגרו';
                        await botSend(chatId, statsMsg);
                    }
                    handled = true;
                }

                // Quick status update — "דיברתי" / "לא ענה" / "נסגר" after call prep DM
                // GUARD: skip if message also looks like a transaction (e.g., "נסגר עסקה של 5000")
                if (!handled && !isTransactionMessage(body)) {
                    var dmStatusUpdate = detectStatusUpdate(body);
                    if (dmStatusUpdate) {
                        var myRecent = null;
                        // First: match the specific lead we last asked about (lastAskedDocId)
                        for (var ri = 0; ri < recentLeads.length; ri++) {
                            if (recentLeads[ri].lastAskedDocId &&
                                (recentLeads[ri].assignedTo === staffFullName || recentLeads[ri].assignedTo === STAFF_NAMES[senderNumber])) {
                                myRecent = recentLeads[ri];
                                break;
                            }
                        }
                        // Fallback: most recent lead assigned to this user
                        if (!myRecent) {
                            for (var ri2 = 0; ri2 < recentLeads.length; ri2++) {
                                if (recentLeads[ri2].assignedTo === staffFullName || recentLeads[ri2].assignedTo === STAFF_NAMES[senderNumber]) {
                                    myRecent = recentLeads[ri2];
                                    break;
                                }
                            }
                        }
                        if (myRecent) {
                            // FIX: correct argument order (docId, status, updatedBy, note, followupAt)
                            var dmReason = dmStatusUpdate.reason || body;
                            var followup = extractFollowupTime(body);
                            await updateLeadStatus(myRecent.docId, dmStatusUpdate.status, staffFullName, dmReason, followup ? followup.followupAt : null);
                            var leadName = myRecent.lead ? (myRecent.lead.name || myRecent.lead.phone || 'ליד') : 'ליד';
                            await botSend(chatId, '✅ *' + leadName + '* עודכן — ' + dmStatusUpdate.status);
                            myRecent.dmFollowupDone = true;
                            if (cachedLeadsGroupChatId) {
                                await botSend(cachedLeadsGroupChatId, '✅ *' + leadName + '* — ' + staffFullName + ' עדכן: ' + dmReason);
                            }
                            handled = true;
                        }
                        // If no lead found in memory, don't consume — let it fall through
                    }
                }

                if (handled) return;
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
                    detailMsg += record.amount.toLocaleString('he-IL') + ' ₪\n';
                    detailMsg += (record.paymentMethod || 'לא צוין') + '\n';
                    detailMsg += 'טלפון: ' + (record.phone || 'חסר') + '\n';
                    detailMsg += 'מייל: ' + (record.email || 'חסר') + '\n';
                    detailMsg += 'ת.ז: ' + (record.idNumber || 'חסר') + '\n';
                    if (record.checksPhotoURL) detailMsg += 'שיקים: יש\n';
                    else detailMsg += 'שיקים: חסר\n';
                    detailMsg += '\nמה לעדכן?';
                    await botSend(chatId, detailMsg);
                } else {
                    await botSend(chatId, 'שלח מספר בין 1 ל-' + (convo.editMatches || []).length);
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
                                await botSend(chatId, '✅ *' + convo.editRecord.clientName + '* עודכן — ' + checksMsg + '!');
                                log('saved', 'Edit: ' + convo.editRecord.clientName + ' — checks uploaded by ' + senderName);
                            } else {
                                await botSend(chatId, '❌ שגיאה בעדכון. נסה שוב.');
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
                        await botSend(chatId, 'מה הסכום החדש?');
                        return;
                    }
                } else if (/טלפון|פלאפון|נייד|phone/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'phone';
                    await botSend(chatId, 'מה הטלפון החדש?');
                    return;
                } else if (/מייל|אימייל|email/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'email';
                    await botSend(chatId, 'מה המייל החדש?');
                    return;
                } else if (/ת\.?ז|ח\.?פ|תעודת זהות|idnumber/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'idNumber';
                    await botSend(chatId, 'מה ת.ז / ח.פ החדש?');
                    return;
                } else if (/שיקים|צ.קים|שיק|checks|pdf/i.test(lowerBody)) {
                    await botSend(chatId, '📸 שלח תמונה או PDF של השיקים');
                    return; // Stay in editStep 'what' — next message with media will be caught above
                } else if (/תשלום|אמצעי/i.test(lowerBody)) {
                    convo.editStep = 'value';
                    convo.editField = 'paymentMethod';
                    await botSend(chatId, 'מה אמצעי התשלום? (אשראי / העברה / מזומן / ביט / שיקים)');
                    return;
                } else if (/סיימתי|יציאה|בטל|סגור/i.test(lowerBody)) {
                    await botSend(chatId, '👍 סגרתי עריכה.');
                    delete conversations[convoKey];
                    return;
                } else {
                    await botSend(chatId, 'מה לעדכן?\n• סכום\n• טלפון\n• מייל\n• ת.ז / ח.פ\n• שיקים (שלח תמונה/PDF)\n• תשלום\n• סיימתי');
                    return;
                }

                // Apply update
                if (Object.keys(updates).length > 0) {
                    updates.updatedBy = senderFullName;
                    var ok = await updateRecord(convo.editRecord.docId, updates);
                    if (ok) {
                        await botSend(chatId, '✅ *' + convo.editRecord.clientName + '* עודכן — ' + updateDesc + '\nעוד משהו? או *סיימתי*');
                    } else {
                        await botSend(chatId, '❌ שגיאה. נסה שוב.');
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
                        await botSend(chatId, 'סכום לא תקין. נסה שוב.');
                        return;
                    }
                }

                updates[fieldName] = newValue;
                updates.updatedBy = senderFullName;
                var ok = await updateRecord(convo.editRecord.docId, updates);

                if (ok) {
                    var displayValue = fieldName === 'amountBeforeVat' ? newValue.toLocaleString('he-IL') + ' ₪' : newValue;
                    await botSend(chatId, '✅ *' + convo.editRecord.clientName + '* עודכן — ' + displayValue + '\nעוד משהו? או *סיימתי*');
                    convo.editStep = 'what'; // Back to menu for more edits
                } else {
                    await botSend(chatId, '❌ שגיאה. נסה שוב.');
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
                            await botSend(chatId, '❌ לא הצלחתי לזהות שיקים. נסה ' + (isPDF ? 'PDF ברור יותר' : 'תמונה ברורה יותר') + ', או ספר לי את הפרטים ידנית.');
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
                        await botSend(chatId, '✅ ' + userName + ', מצאתי דיווח על *' + filled.clientName + '* (' + filled.amount.toLocaleString('he-IL') + ' ₪) במערכת.');
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
                await botSend(chatId, '✅ *' + clientName + '* — ' + (amountDisplay || '') + ' נרשם');
                stats.saved++;
                log('saved', clientName + ' — ' + docId);

                // Send confirmation to the group
                try {
                    var groupChat = await findGroupChat();
                    if (groupChat) {
                        var senderFirst = (convo.senderName || '').split(' ')[0] || 'משתמש';
                        await botSend(groupChat, '✅ *' + clientName + '* דווח ונרשם על ידי ' + senderFirst + '.');
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

            await botSend(chatId, result.message + '\n\n📝 קישור לטופס:\nhttps://tofes-office.netlify.app');

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
                            botSend(groupChat, '✅ *' + clientName + '* דווח ונרשם בטופס מכר על ידי ' + filler + '.');
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

// ==================== Email Leads Listener ====================
// Listens for new leads from email (din.co.il) and announces in the leads group

var emailLeadsListenerActive = false;

function startEmailLeadsListener() {
    if (emailLeadsListenerActive) return;
    emailLeadsListenerActive = true;

    try {
        var firestore = require('firebase-admin').firestore();
        var startTime = require('firebase-admin').firestore.Timestamp.now();

        firestore.collection('leads')
            .where('source', '==', 'email')
            .where('createdAt', '>', startTime)
            .onSnapshot(function(snapshot) {
                snapshot.docChanges().forEach(function(change) {
                    if (change.type !== 'added') return;

                    var d = change.doc.data();
                    var name = d.name || '';
                    var phone = d.phone || '';
                    var subject = d.subject || '';
                    var score = d.aiScore || 0;

                    if (!name && !phone) return; // Skip empty leads

                    log('msg', 'Email lead detected: ' + (name || phone));

                    // Announce in leads group
                    if (cachedLeadsGroupChatId) {
                        var emailMsg = '📧 *ליד מהמייל*\n';
                        emailMsg += (name || 'לא ידוע') + (phone ? ' — ' + phone : '') + '\n';
                        if (subject) emailMsg += subject + '\n';
                        if (score) emailMsg += 'ציון: ' + score + '/10\n';
                        emailMsg += 'מי מטפל?';
                        botSend(cachedLeadsGroupChatId, emailMsg);

                        // Add to recentLeads for reminder/assignment tracking
                        recentLeads.unshift({
                            docId: change.doc.id,
                            msgId: null,
                            lead: { name: name, phone: phone, subject: subject, type: 'email' },
                            timestamp: Date.now(),
                            assignedTo: null,
                            senderName: 'email',
                            reminded2: false,
                            reminded5: false,
                            reminded15: false
                        });
                        if (recentLeads.length > MAX_RECENT_LEADS) recentLeads.pop();
                    } else {
                        log('warn', 'Email lead received but leads group not cached yet');
                    }
                });
            }, function(err) {
                log('error', 'Email leads listener error: ' + err.message);
                emailLeadsListenerActive = false;
            });

        log('msg', 'Email leads listener active — monitoring new leads from email');
    } catch (e) {
        log('error', 'Failed to start email leads listener: ' + e.message);
        emailLeadsListenerActive = false;
    }
}

// ==================== WhatsApp Name Enrichment ====================

function isRealName(name) {
    if (!name || !name.trim()) return false;
    var clean = name.trim();
    if (clean.length < 2) return false;
    if (/^[\d\s\-+()]+$/.test(clean)) return false;
    return true;
}

function normalizeToWaId(phone) {
    var d = toInternational(phone);
    while (d.startsWith('972972')) d = d.substring(3);
    return d + '@c.us';
}

async function enrichLeadNamesFromWhatsApp(waClient, firestore) {
    if (!firestore) firestore = require('firebase-admin').firestore();
    var BATCH_LIMIT = 100;

    var leadsSnap = await firestore.collection('leads').get();
    var noName = [];

    leadsSnap.forEach(function(doc) {
        var data = doc.data();
        var name = (data.name || '').trim();
        var phone = (data.phone || '').trim();
        if (phone && (!name || /^[\d\s\-+()]+$/.test(name))) {
            noName.push({ docId: doc.id, phone: phone });
        }
    });

    var totalWithoutName = noName.length;
    var remaining = Math.max(0, totalWithoutName - BATCH_LIMIT);
    if (noName.length > BATCH_LIMIT) noName = noName.slice(0, BATCH_LIMIT);

    log('msg', 'Enrich: processing ' + noName.length + ' of ' + totalWithoutName + ' leads without name');

    var enriched = 0, notFound = 0, notOnWhatsapp = 0, errors = 0;
    var batch = firestore.batch();
    var batchCount = 0;

    for (var i = 0; i < noName.length; i++) {
        var lead = noName[i];

        try {
            var waId = normalizeToWaId(lead.phone);

            var isRegistered = await waClient.isRegisteredUser(waId);
            if (!isRegistered) { notOnWhatsapp++; continue; }

            var contact = await waClient.getContactById(waId);
            var waName = contact.name || contact.pushname || '';

            // Log first 10 for debugging
            if (i < 10) {
                log('msg', 'Enrich debug: ' + lead.phone + ' → pushname=[' + (contact.pushname || '') + '] name=[' + (contact.name || '') + '] waName=[' + waName + ']');
            }

            if (isRealName(waName)) {
                var phoneDigits = lead.phone.replace(/\D/g, '');
                if (phoneDigits.startsWith('972')) phoneDigits = '0' + phoneDigits.substring(3);

                batch.update(firestore.collection('leads').doc(lead.docId), {
                    name: waName.trim(),
                    nameSource: contact.name ? 'whatsapp_contact' : 'whatsapp_pushname',
                    phoneLast7: phoneDigits.slice(-7),
                    lastUpdated: require('firebase-admin').firestore.FieldValue.serverTimestamp(),
                    history: require('firebase-admin').firestore.FieldValue.arrayUnion({
                        action: 'name_enriched',
                        by: 'whatsapp-lookup',
                        at: new Date().toISOString(),
                        note: 'שם מוואטסאפ: ' + waName.trim()
                    })
                });
                batchCount++;
                enriched++;

                if (batchCount >= 450) {
                    await batch.commit();
                    batch = firestore.batch();
                    batchCount = 0;
                }
            } else {
                notFound++;
            }

            // Rate limit every 10 lookups
            if (i % 10 === 0 && i > 0) {
                await new Promise(function(r) { setTimeout(r, 1500); });
            }
        } catch (e) {
            errors++;
        }
    }

    if (batchCount > 0) await batch.commit();

    log('msg', 'Enrich done: ' + enriched + ' enriched, ' + notFound + ' no name, ' + notOnWhatsapp + ' not on WA, ' + errors + ' errors, ' + remaining + ' remaining');
    return { enriched: enriched, notFound: notFound, notOnWhatsapp: notOnWhatsapp, errors: errors, remaining: remaining };
}

async function botSend(chatId, text) {
    try {
        var textHash = text.substring(0, 80);
        recentBotTexts.push(textHash);
        if (recentBotTexts.length > MAX_RECENT) recentBotTexts.shift();

        var sent = await wa.sendMessage(chatId, text);
        if (sent && sent.id) botMessageIds.add(sent.id._serialized);
        return true;
    } catch (err) {
        log('error', 'Send failed: ' + err.message);
        return false;
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
            recentLeads: recentLeads,
            savedAt: Date.now()
        };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data));
        var count = Object.keys(conversations).length;
        if (count > 0 || recentLeads.length > 0) log('warn', 'Saved ' + count + ' conversations + ' + recentLeads.length + ' leads to disk');
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

        // Restore recentLeads with age cleanup
        if (data.recentLeads && data.recentLeads.length > 0) {
            var now = Date.now();
            recentLeads = data.recentLeads.filter(function(rl) {
                var age = now - rl.timestamp;
                if (!rl.assignedTo && age > 60 * 60 * 1000) return false; // 1hr unassigned
                if (rl.assignedTo && age > 48 * 60 * 60 * 1000) return false; // 48hr assigned
                return true;
            });
            if (recentLeads.length > 0) log('warn', 'Restored ' + recentLeads.length + ' recent leads from disk');
        }

        // Keep backup file (don't delete) — prevents data loss on rapid restarts
    } catch (e) {
        log('error', 'Load conversations failed: ' + e.message);
    }
}

// Auto-save every 2 minutes (in case of unexpected crash)
setInterval(function() {
    if (Object.keys(conversations).length > 0 || recentLeads.length > 0) {
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
