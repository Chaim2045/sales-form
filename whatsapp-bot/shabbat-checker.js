// Shabbat & Holiday Checker for Israel
// Uses Hebcal API for accurate candle lighting / havdalah times
// Fallback: Friday 18:00 → Saturday 19:30

var https = require('https');

var cachedShabbat = null; // { candles: Date, havdalah: Date, fetchedAt: number }
var cachedHolidays = []; // [{ start: Date, end: Date, name: string }]

function httpGet(url) {
    return new Promise(function(resolve, reject) {
        https.get(url, function(res) {
            var body = '';
            res.on('data', function(d) { body += d; });
            res.on('end', function() {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        }).on('error', reject);
    });
}

// Fetch this week's Shabbat times from Hebcal
async function fetchShabbatTimes() {
    // Cache for 12 hours
    if (cachedShabbat && (Date.now() - cachedShabbat.fetchedAt) < 12 * 3600 * 1000) {
        return cachedShabbat;
    }

    try {
        var data = await httpGet('https://www.hebcal.com/shabbat?cfg=json&geo=city&city=Tel+Aviv&M=on');
        if (!data || !data.items) throw new Error('No data');

        var candles = null, havdalah = null;
        data.items.forEach(function(item) {
            if (item.category === 'candles') candles = new Date(item.date);
            if (item.category === 'havdalah') havdalah = new Date(item.date);
        });

        if (candles && havdalah) {
            cachedShabbat = { candles: candles, havdalah: havdalah, fetchedAt: Date.now() };
            return cachedShabbat;
        }
    } catch (err) {
        console.error('[Shabbat] Hebcal fetch error:', err.message);
    }

    // Fallback: approximate — Friday 18:00 Israel time, Saturday 19:30
    var now = new Date();
    var israelNow = new Date(now.getTime() + 3 * 3600000);
    var day = israelNow.getDay();
    var friday = new Date(israelNow);
    friday.setDate(friday.getDate() + ((5 - day + 7) % 7));
    friday.setHours(18, 0, 0, 0);
    var saturday = new Date(friday);
    saturday.setDate(saturday.getDate() + 1);
    saturday.setHours(19, 30, 0, 0);

    // Convert to UTC
    cachedShabbat = {
        candles: new Date(friday.getTime() - 3 * 3600000),
        havdalah: new Date(saturday.getTime() - 3 * 3600000),
        fetchedAt: Date.now()
    };
    return cachedShabbat;
}

// Fetch upcoming holidays from Hebcal
async function fetchHolidays() {
    if (cachedHolidays.length > 0 && (Date.now() - (cachedHolidays._fetchedAt || 0)) < 24 * 3600 * 1000) {
        return cachedHolidays;
    }

    try {
        var year = new Date().getFullYear();
        var data = await httpGet('https://www.hebcal.com/hebcal?v=1&cfg=json&year=' + year + '&geo=city&city=Tel+Aviv&maj=on&mod=on&M=on');
        if (!data || !data.items) throw new Error('No data');

        cachedHolidays = [];
        data.items.forEach(function(item) {
            if (item.yomtov === true && item.date) {
                cachedHolidays.push({
                    name: item.title,
                    start: new Date(item.date),
                    memo: item.memo || ''
                });
            }
        });
        cachedHolidays._fetchedAt = Date.now();
    } catch (err) {
        console.error('[Shabbat] Holiday fetch error:', err.message);
    }

    return cachedHolidays;
}

// Main function: Can we send a message to a client right now?
async function canSendToClient() {
    var now = new Date();
    var israelHour = new Date(now.getTime() + 3 * 3600000).getHours();
    var israelDay = new Date(now.getTime() + 3 * 3600000).getDay(); // 0=Sun, 5=Fri, 6=Sat

    // Basic time check: 08:00-21:00 Israel time
    if (israelHour < 8 || israelHour >= 21) return { allowed: false, reason: 'שעות שקטות' };

    // Friday after 14:00
    if (israelDay === 5 && israelHour >= 14) return { allowed: false, reason: 'ערב שבת' };

    // Shabbat check
    var shabbat = await fetchShabbatTimes();
    if (shabbat) {
        if (now >= shabbat.candles && now <= shabbat.havdalah) {
            return { allowed: false, reason: 'שבת', resumeAt: shabbat.havdalah };
        }
    }

    // Holiday check
    var holidays = await fetchHolidays();
    for (var i = 0; i < holidays.length; i++) {
        var h = holidays[i];
        var hStart = new Date(h.start);
        var hEnd = new Date(hStart.getTime() + 25 * 3600 * 1000); // ~25 hours for yom tov
        if (now >= hStart && now <= hEnd) {
            return { allowed: false, reason: 'חג: ' + h.name, resumeAt: hEnd };
        }
    }

    return { allowed: true };
}

// Get the best time to send a reminder for a meeting on a given date
// Returns a Date or null if can't find a valid time
async function getBestReminderTime(meetingDate, daysBefore) {
    var reminder = new Date(meetingDate.getTime() - daysBefore * 24 * 3600 * 1000);
    var israelReminder = new Date(reminder.getTime() + 3 * 3600000);
    israelReminder.setHours(9, 0, 0, 0); // Default 09:00

    // Convert back to UTC
    var utcReminder = new Date(israelReminder.getTime() - 3 * 3600000);

    // Check if this falls on Shabbat/holiday
    var shabbat = await fetchShabbatTimes();
    if (shabbat && utcReminder >= shabbat.candles && utcReminder <= shabbat.havdalah) {
        // Shabbat! Try day before (Thursday instead of Friday)
        if (daysBefore === 1) {
            // Move to Thursday 09:00
            var thursday = new Date(israelReminder);
            thursday.setDate(thursday.getDate() - 1);
            thursday.setHours(9, 0, 0, 0);
            return new Date(thursday.getTime() - 3 * 3600000);
        }
        // Or after Shabbat (motzei)
        return new Date(shabbat.havdalah.getTime() + 30 * 60 * 1000); // 30 min after havdalah
    }

    // Friday after 14:00 → move to Thursday
    var israelDay = israelReminder.getDay();
    if (israelDay === 5) {
        israelReminder.setDate(israelReminder.getDate() - 1);
        return new Date(israelReminder.getTime() - 3 * 3600000);
    }

    // Saturday → move to motzei shabbat
    if (israelDay === 6) {
        if (shabbat) return new Date(shabbat.havdalah.getTime() + 30 * 60 * 1000);
        israelReminder.setHours(20, 0, 0, 0); // fallback 20:00 Saturday
        return new Date(israelReminder.getTime() - 3 * 3600000);
    }

    return utcReminder;
}

module.exports = {
    canSendToClient,
    fetchShabbatTimes,
    fetchHolidays,
    getBestReminderTime
};
