// Leads Detection Module — לידוביץ
// Detects lead messages, assignments, status updates, and follow-up times
// from WhatsApp group messages in the leads group

// ==================== Phone Normalization ====================

function normalizePhone(phone) {
    if (!phone) return '';
    var digits = phone.replace(/\D/g, '');
    if (digits.startsWith('972')) return digits;
    if (digits.startsWith('0')) return '972' + digits.substring(1);
    return digits;
}

function extractPhone(text) {
    if (!text) return null;
    var match = text.match(/(0\d{1,2}[\s-]?\d{3}[\s-]?\d{4})/);
    if (match) return normalizePhone(match[1]);
    // Try mishpati format: 053-3239882
    match = text.match(/(0\d{1,2}-\d{7})/);
    if (match) return normalizePhone(match[1]);
    return null;
}

// ==================== Lead Classification ====================

// 1. din.co.il SMS format
var DIN_SMS_PATTERN = /din\.co\.il\s*SMS\s*:?\s*\n?\s*(?:פניה מהפורום\s+)?([^,\n]+),\s*(0[\d\s-]{8,12}),?\s*\n?\s*([\s\S]*)/i;

// 2. Missed call (mishpati.co.il)
var MISSED_CALL_PATTERN = /(?:התקבלה\s*שיחה\s*מאת|שיחה\s*(?:שלא\s*נענתה|חוזרת))\s*([^,\n]+),?\s*(?:בתאריך\s*(\d{1,2}\/\d{1,2}\/\d{2,4}))?\s*(?:בשעה\s*(\d{1,2}:\d{2}))?/;

// Also: "פספסת שיחה" pattern
var MISSED_CALL_ALT = /(?:פספסת|פיספסת)\s*שיחה\s*(?:של\s*)?(?:הקול|לקוח|מ)?\s*(?:מאת\s*)?(?:מהאתר|מהמספר)?\s*([\d\s-]+)/;

// mishpati.co.il notification
var MISHPATI_PATTERN = /mishpati\.co\.il/i;

// 3. Manager lead: "ליד חדש - שם - טלפון - נושא"
var MANAGER_LEAD_PATTERN = /ליד\s*חדש\s*[-–:]\s*([^-–\n]+)\s*[-–]\s*(0[\d\s-]{8,12})\s*[-–]\s*(.+)/;

// 4. Secretary: "שם - נושא - טלפון. מי מטפל?"
// More flexible: name + phone + "מי מטפל"
var SECRETARY_PATTERN = /^([^0-9\n]{2,})\s*[-–]\s*([^0-9\n]+)\s*[-–]\s*(0[\d\s-]{8,12})/;

// Alternative secretary: "שם בענין נושא - טלפון"
var SECRETARY_ALT = /^([^\d\n]{2,})\s+(?:בענין|בנושא|בקשר)\s+([^\d\n]+)\s*[-–]\s*(0[\d\s-]{8,12})/;

// 5. Staff direct: phone + name or name + phone with context
var PHONE_FIRST_PATTERN = /^(0[\d\s-]{8,12})\s*[-–\n]\s*([^\n]+)/;
var NAME_PHONE_PATTERN = /^([^\d\n]{2,30})\s+(0[\d\s-]{8,12})\s*([\s\S]*)/;

// 6. Generic "מי מטפל" with phone somewhere in message
var MI_METAPEL = /מי\s*(?:מטפל|מתקשר|לוקח|יטפל|יתקשר)\s*\??/;

// ==================== Master Classification Function ====================

function classifyLeadMessage(body, hasMedia, caption) {
    if (!body && !hasMedia) return null;
    var text = (body || '').trim();

    // Skip very short or very long messages (likely not leads)
    if (!hasMedia && (text.length < 8 || text.length > 2000)) return null;

    // 1. din.co.il SMS (highest confidence — automated)
    var dinMatch = text.match(DIN_SMS_PATTERN);
    if (dinMatch) {
        return {
            type: 'din_sms',
            name: dinMatch[1].trim(),
            phone: extractPhone(dinMatch[2]),
            subject: (dinMatch[3] || '').trim().substring(0, 200),
            priority: 'normal',
            raw: text
        };
    }

    // 2. Missed call
    var missedMatch = text.match(MISSED_CALL_PATTERN);
    if (missedMatch) {
        return {
            type: 'missed_call',
            name: null,
            phone: extractPhone(missedMatch[1]),
            subject: 'שיחה שלא נענתה',
            priority: 'high',
            raw: text,
            callDate: missedMatch[2] || null,
            callTime: missedMatch[3] || null
        };
    }

    // mishpati.co.il notification
    if (MISHPATI_PATTERN.test(text) && /שיחה|התקבלה|שלא נענתה/.test(text)) {
        var phone = extractPhone(text);
        if (phone) {
            return {
                type: 'missed_call',
                name: null,
                phone: phone,
                subject: 'שיחה מ-mishpati.co.il',
                priority: 'high',
                raw: text
            };
        }
    }

    // "פספסת שיחה" pattern from bot/system
    var missedAlt = text.match(MISSED_CALL_ALT);
    if (missedAlt) {
        return {
            type: 'missed_call',
            name: null,
            phone: extractPhone(missedAlt[1]),
            subject: 'שיחה שהוחמצה',
            priority: 'high',
            raw: text
        };
    }

    // Also: "פספסת שיחה של הקול באתר דין מהמספר XXXX בשעה XX:XX"
    var pispusMatch = text.match(/פספסת\s*שיחה\s*.*מהמספר\s*([\d\s-]+)\s*(?:בשעה\s*(\d{1,2}:\d{2}))?/);
    if (pispusMatch) {
        return {
            type: 'missed_call',
            name: null,
            phone: extractPhone(pispusMatch[1]),
            subject: 'שיחה שהוחמצה',
            priority: 'high',
            raw: text
        };
    }

    // 3. Manager lead
    var managerMatch = text.match(MANAGER_LEAD_PATTERN);
    if (managerMatch) {
        return {
            type: 'manager',
            name: managerMatch[1].trim(),
            phone: extractPhone(managerMatch[2]),
            subject: managerMatch[3].trim(),
            priority: 'normal',
            raw: text
        };
    }

    // 4. Secretary pattern: "שם - נושא - טלפון"
    var secMatch = text.match(SECRETARY_PATTERN);
    if (secMatch && extractPhone(secMatch[3])) {
        return {
            type: 'secretary',
            name: secMatch[1].trim(),
            phone: extractPhone(secMatch[3]),
            subject: secMatch[2].trim(),
            priority: 'normal',
            raw: text
        };
    }

    // Secretary alt: "שם בענין נושא - טלפון"
    var secAlt = text.match(SECRETARY_ALT);
    if (secAlt && extractPhone(secAlt[3])) {
        return {
            type: 'secretary',
            name: secAlt[1].trim(),
            phone: extractPhone(secAlt[3]),
            subject: secAlt[2].trim(),
            priority: 'normal',
            raw: text
        };
    }

    // 5a. Phone first: "0501234567 - שם"
    var phoneFirst = text.match(PHONE_FIRST_PATTERN);
    if (phoneFirst && extractPhone(phoneFirst[1])) {
        return {
            type: 'staff_direct',
            name: phoneFirst[2].trim().substring(0, 50),
            phone: extractPhone(phoneFirst[1]),
            subject: null,
            priority: 'normal',
            raw: text
        };
    }

    // 5b. Name + phone: "שם 0501234567 נושא"
    var namePhone = text.match(NAME_PHONE_PATTERN);
    if (namePhone && extractPhone(namePhone[2])) {
        var name = namePhone[1].trim();
        // Filter out non-name prefixes
        if (name.length >= 2 && name.length <= 40 && !/^(ליד|din|http|www|בוקר|ערב|שבוע)/i.test(name)) {
            return {
                type: 'staff_direct',
                name: name,
                phone: extractPhone(namePhone[2]),
                subject: (namePhone[3] || '').trim().substring(0, 200) || null,
                priority: 'normal',
                raw: text
            };
        }
    }

    // 6. Image + "מי מטפל" (in caption or body)
    if (hasMedia) {
        var combinedText = (text + ' ' + (caption || '')).trim();
        if (MI_METAPEL.test(combinedText) || /ליד|לקוח\s*חדש/.test(combinedText)) {
            // Try to extract phone from caption
            var imgPhone = extractPhone(combinedText);
            return {
                type: 'image_lead',
                name: null,
                phone: imgPhone,
                subject: null,
                priority: 'normal',
                raw: combinedText,
                needsOCR: true
            };
        }
        // Image with just "מטפל?" or no text — check if it's a screenshot
        if (combinedText.length < 30 && /מטפל|מתקשר|חדש|לקוח/.test(combinedText)) {
            return {
                type: 'image_lead',
                name: null,
                phone: null,
                subject: null,
                priority: 'normal',
                raw: combinedText,
                needsOCR: true
            };
        }
    }

    // 7. Generic "מי מטפל" with phone in message (fallback)
    if (MI_METAPEL.test(text)) {
        var genericPhone = extractPhone(text);
        if (genericPhone) {
            // Strip the "מי מטפל" part and phone to guess name
            var nameGuess = text
                .replace(MI_METAPEL, '')
                .replace(/(0[\d\s-]{8,12})/, '')
                .replace(/[-–:.\n]/g, ' ')
                .trim()
                .substring(0, 50);
            return {
                type: 'generic',
                name: nameGuess || null,
                phone: genericPhone,
                subject: null,
                priority: 'normal',
                raw: text
            };
        }
    }

    return null; // Not a lead message
}

// ==================== Assignment Detection ====================

var SELF_ASSIGN_PATTERNS = [
    /^אני$/,
    /^אני\s*(מטפל|מטפלת|אתקשר|מתקשר|מתקשרת|לוקח|לוקחת|על\s*זה|אטפל)$/,
    /^(מטפל|מטפלת|מתקשר|מתקשרת|לוקח|לוקחת|אטפל)$/,
    /^אני\s*כבר\s*(בשיחה|מטפל|מתקשר)/,
    /^(עליי|שלי)$/,
    /^אני\s*על\s*(זה|זאת)$/,
    /^(אוקיי?|ok|סבבה|יאללה|בסדר|טוב)\s*(אני|מטפל|מתקשר|אתקשר)?$/i,
    /^(כן|כן\s*אני|אני\s*כן)$/,
    /^יטופל$/,
    /^אני\s*אתקשר/,
    /^👍$/,
    /^אני$/
];

// Directed assignment: boss/manager assigns someone
var ASSIGN_OTHER_PATTERNS = [
    // "חיים תטפל" / "רועי מטפל" / "מירי תתקשרי"
    /^@?\u200f?([^\s,@]{2,15})\s+(תטפל|תטפלי|מטפל|מטפלת|תתקשר|תתקשרי|תעדכן|תעדכני|תיקח|תיקחי|יטפל|תדבר|תדברי)/,
    // "תן לחיים" / "תעבירו לרועי"
    /(?:תן\s*ל|תעביר[וי]?\s*ל|שיטפל\s*)@?\u200f?([^\s,@]{2,15})/,
    // "חיים בבקשה" / "מירי בבקשה"
    /^@?\u200f?([^\s,@]{2,15})\s+בבקשה/,
    // "@חיים"
    /^@\u200f?([^\s,@]{2,15})$/
];

function detectAssignment(body) {
    if (!body) return null;
    var trimmed = body.trim();

    // Skip long messages (status updates, not assignments)
    if (trimmed.length > 60) return null;

    // Self-assignment
    for (var i = 0; i < SELF_ASSIGN_PATTERNS.length; i++) {
        if (SELF_ASSIGN_PATTERNS[i].test(trimmed)) {
            return { type: 'self', assignee: null };
        }
    }

    // Check for "אני + verb" at start of longer message
    if (/^אני\s*(מטפל|מתקשר|אתקשר|אטפל|לוקח)/i.test(trimmed)) {
        return { type: 'self', assignee: null };
    }

    // Directed assignment
    for (var i = 0; i < ASSIGN_OTHER_PATTERNS.length; i++) {
        var match = trimmed.match(ASSIGN_OTHER_PATTERNS[i]);
        if (match) {
            var name = match[1].replace(/@|\u200f/g, '').trim();
            if (name.length >= 2) {
                return { type: 'directed', assignee: name };
            }
        }
    }

    return null;
}

// ==================== Status Update Detection ====================

var STATUS_CATEGORIES = [
    {
        status: 'not_relevant',
        patterns: [
            /לא\s*רלוונטי/,
            /לא\s*מתאים\s*(למשרד|לנו|לתחום)?/,
            /לא\s*בתחום/,
            /אין\s*כדאיות/,
            /לא\s*כלכלי/
        ]
    },
    {
        status: 'closed',
        patterns: [
            /נסגר(?:ה)?(?:\s*(?:עסקה|פגישה|תשלום))?/,
            /תואם(?:ה)?(?:\s*(?:פגישה|שיחה))?/,
            /קבענו\s*(?:פגישה|שיחה|להיפגש)/,
            /שולם/,
            /סגרנו/,
            /חתם(?:ה)?/,
            /נקבעה?\s*פגישה/,
            /סגירה/
        ]
    },
    {
        status: 'no_answer',
        patterns: [
            /לא\s*ענ(?:ה|תה)/,
            /לא\s*עונ(?:ה|ים)/,
            /ללא\s*מענה/,
            /ניסיתי\s*ללא\s*מענה/,
            /לא\s*מגיב/,
            /לא\s*זמינ?/,
            /ממתינ[הם]?/,
            /לא\s*תפס/,
            /לא\s*נת?פס/
        ]
    },
    {
        status: 'contacted',
        patterns: [
            /דיברתי\s*(?:איתו|איתה|עם|עליו|עליה)/,
            /שוחחתי/,
            /שלחתי\s*(?:הודעה|ווטסאפ|וואטסאפ|sms|מייל)/i,
            /יצרתי\s*קשר/,
            /התקשרתי/,
            /חזרתי\s*(?:אליו|אליה|ל)/,
            /דברנו/
        ]
    },
    {
        status: 'followup',
        patterns: [
            /פולואפ|follow\s*up/i,
            /(?:לחזור|אחזור|נחזור)\s*(?:אליו|אליה|ל|מחר|היום)/,
            /(?:מחכה|ממתין)\s*ל/,
            /ביקש(?:ה)?\s*(?:לחשוב|זמן|לחזור|להתייעץ)/,
            /צריך\s*לחזור/,
            /אנסה\s*(?:שוב|שנית|מחר|אותו|אותה)/,
            /ניסיון\s*נוסף/,
            /אעדכן/
        ]
    }
];

function detectStatusUpdate(body) {
    if (!body) return null;
    var trimmed = body.trim();

    // Must be at least a few words
    if (trimmed.length < 4) return null;

    // Skip if it looks like a lead (has phone number at start)
    if (/^0\d{1,2}[\s-]?\d{7}/.test(trimmed)) return null;

    for (var c = 0; c < STATUS_CATEGORIES.length; c++) {
        var cat = STATUS_CATEGORIES[c];
        for (var p = 0; p < cat.patterns.length; p++) {
            if (cat.patterns[p].test(trimmed)) {
                return {
                    status: cat.status,
                    reason: trimmed.substring(0, 200),
                    raw: trimmed
                };
            }
        }
    }

    // CRM update detection
    if (/עודכן\s*(?:ב)?crm|עדכנתי\s*crm|crm\s*עודכן/i.test(trimmed)) {
        return { status: 'crm_updated', reason: trimmed, raw: trimmed };
    }

    return null;
}

// ==================== Follow-Up Time Extraction ====================

function extractFollowupTime(body) {
    if (!body) return null;
    var text = body.trim();
    var now = new Date(Date.now() + 3 * 3600000); // Israel time (UTC+3)

    // "מחר" / "מחר בבוקר" / "מחר אחהצ"
    if (/מחר/.test(text)) {
        var target = new Date(now);
        target.setDate(target.getDate() + 1);
        if (/אחה"?צ|אחרי\s*הצהריים|צהריים/.test(text)) {
            target.setHours(14, 0, 0, 0);
        } else {
            target.setHours(9, 0, 0, 0); // default morning
        }
        return { followupAt: target.getTime() - 3 * 3600000 }; // convert back to UTC
    }

    // "עוד X דקות"
    var minMatch = text.match(/עוד\s*(\d+)\s*דק(?:ות|ה)?/);
    if (minMatch) {
        return { followupAt: Date.now() + parseInt(minMatch[1]) * 60 * 1000 };
    }

    // "עוד חצי שעה"
    if (/עוד\s*חצי\s*שעה/.test(text)) {
        return { followupAt: Date.now() + 30 * 60 * 1000 };
    }

    // "עוד שעה" / "עוד X שעות"
    var hourMatch = text.match(/עוד\s*(\d+)?\s*שע(?:ות|ה)/);
    if (hourMatch) {
        var hours = parseInt(hourMatch[1]) || 1;
        return { followupAt: Date.now() + hours * 3600 * 1000 };
    }

    // "בסוף היום" / "סוף היום"
    if (/(?:בסוף|סוף)\s*(?:ה)?יום/.test(text)) {
        var eod = new Date(now);
        eod.setHours(17, 0, 0, 0);
        if (eod <= now) eod.setDate(eod.getDate() + 1);
        return { followupAt: eod.getTime() - 3 * 3600000 };
    }

    // "בשעה HH:MM" / "ב-HH:MM"
    var timeMatch = text.match(/(?:בשעה|ב-?)\s*(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        var target = new Date(now);
        target.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return { followupAt: target.getTime() - 3 * 3600000 };
    }

    // "פולואפ" without time → default 2 hours
    if (/פולואפ|follow\s*up/i.test(text) && !minMatch && !hourMatch) {
        return { followupAt: Date.now() + 2 * 3600 * 1000 };
    }

    return null;
}

// ==================== Lead Report Request Detection ====================

function isLeadReportRequest(body) {
    if (!body) return false;
    return /סטטוס\s*לידים|כמה\s*לידים|דוח\s*לידים|סיכום\s*לידים|מצב\s*לידים/i.test(body.trim());
}

// ==================== Meeting Detection ====================

// Detect "תואמה ושילמה" / "נקבעה פגישה" / "פגישת המשך" with date
function detectMeeting(body) {
    if (!body) return null;
    var text = body.trim();

    // Must contain meeting-related keywords
    if (!/תואמ[הו]|נקבע[הו]?\s*פגישה|פגישת\s*המשך|פגישה\s*(?:ב|ל|מחר|ביום)|קבענו\s*פגישה|שילמ[הו]\s*.*פגישה/i.test(text)) {
        return null;
    }

    // Detect meeting type: online (meet/zoom) or physical
    var isOnline = /מיט|meet|זום|zoom|אונליין|online|וידאו|video/i.test(text);
    var meetLink = null;
    var linkMatch = text.match(/(https?:\/\/[^\s]+(?:meet\.google|zoom\.us)[^\s]*)/i);
    if (linkMatch) meetLink = linkMatch[1];

    // Israel timezone offset
    var ISRAEL_OFFSET = 3; // UTC+3 (IDT)
    var nowUTC = new Date();
    // For day/date calculations, we need to know what day it is in Israel
    var israelDay = new Date(nowUTC.getTime() + ISRAEL_OFFSET * 3600000).getUTCDay();
    var israelDate = new Date(nowUTC.getTime() + ISRAEL_OFFSET * 3600000).getUTCDate();
    var israelMonth = new Date(nowUTC.getTime() + ISRAEL_OFFSET * 3600000).getUTCMonth();
    var israelYear = new Date(nowUTC.getTime() + ISRAEL_OFFSET * 3600000).getUTCFullYear();

    // Try to extract date + time
    var meetingDate = null;
    var desiredHour = 10; // default
    var desiredMinute = 0;

    // Extract time first
    var timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        desiredHour = parseInt(timeMatch[1]);
        desiredMinute = parseInt(timeMatch[2]);
    }

    // Helper: build UTC timestamp for Israel time
    function makeIsraelTime(y, m, d, h, min) {
        // Create date in UTC, subtract Israel offset so it represents Israel local time
        return Date.UTC(y, m, d, h - ISRAEL_OFFSET, min, 0, 0);
    }

    // "מחר 14:00" / "מחר בארבע"
    if (/מחר/.test(text)) {
        var tomorrow = new Date(Date.UTC(israelYear, israelMonth, israelDate + 1));
        meetingDate = new Date(makeIsraelTime(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), desiredHour, desiredMinute));
    }

    // "יום ראשון" / "ביום ראשון"
    var dayNames = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5 };
    var dayMatch = text.match(/(?:ב)?יום\s*(ראשון|שני|שלישי|רביעי|חמישי|שישי)/);
    if (dayMatch && !meetingDate) {
        var targetDay = dayNames[dayMatch[1]];
        var daysUntil = (targetDay - israelDay + 7) % 7;
        if (daysUntil === 0) daysUntil = 7;
        var target = new Date(Date.UTC(israelYear, israelMonth, israelDate + daysUntil));
        meetingDate = new Date(makeIsraelTime(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), desiredHour, desiredMinute));
    }

    // "5/4" / "5.4" / "05/04"
    var dateMatch = text.match(/(\d{1,2})[\/\.](\d{1,2})(?:[\/\.](\d{2,4}))?/);
    if (dateMatch && !meetingDate) {
        var day = parseInt(dateMatch[1]);
        var month = parseInt(dateMatch[2]) - 1;
        var year = dateMatch[3] ? (parseInt(dateMatch[3]) < 100 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3])) : israelYear;
        meetingDate = new Date(makeIsraelTime(year, month, day, desiredHour, desiredMinute));
        var timeMatch3 = text.match(/(?:ב|בשעה\s*)(\d{1,2}):(\d{2})/);
        if (timeMatch3) {
            meetingDate.setHours(parseInt(timeMatch3[1]), parseInt(timeMatch3[2]), 0, 0);
        } else {
            meetingDate.setHours(10, 0, 0, 0);
        }
    }

    // "בעשר" / "בשתיים" / "בארבע"
    if (meetingDate) {
        var hebrewTimes = { 'שמונה': 8, 'תשע': 9, 'עשר': 10, 'אחת עשרה': 11, 'שתים עשרה': 12, 'אחת': 13, 'שתיים': 14, 'שלוש': 15, 'ארבע': 16, 'חמש': 17 };
        for (var heb in hebrewTimes) {
            if (text.indexOf(heb) !== -1) {
                meetingDate.setHours(hebrewTimes[heb], 0, 0, 0);
                break;
            }
        }
    }

    if (!meetingDate) return null;

    // meetingDate was built with makeIsraelTime() which already handles UTC offset.
    // getTime() returns correct UTC timestamp.
    var utcTime = meetingDate.getTime();

    return {
        meetingDate: utcTime,
        meetingType: isOnline ? 'online' : 'physical',
        meetLink: meetLink,
        raw: text
    };
}

// ==================== Exports ====================

module.exports = {
    classifyLeadMessage,
    detectAssignment,
    detectStatusUpdate,
    extractFollowupTime,
    isLeadReportRequest,
    detectMeeting,
    normalizePhone,
    extractPhone
};
