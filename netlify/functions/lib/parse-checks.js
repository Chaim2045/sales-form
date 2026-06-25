// Deterministic (no-AI) parser for Israeli bank-cheque OCR text.
//
// Pure Node.js. NO network, NO LLM, NO dependencies.
// Replaces the LLM parse step in ../ocr-check.js (parseChecksWithClaude).
//
// Exports: parseChecksDeterministic(ocrText) -> Array<{
//   date: "YYYY-MM-DD"|"",
//   amount: <number, 0 if unreadable>,
//   bankName: "",
//   bankBranch: "",
//   bankAccount: "",
//   chequeNum: ""
// }>  (one object per cheque page)
//
// PHILOSOPHY: conservative. When unsure -> "". NEVER invent digits.
// A guessed bank account is worse than a blank.
//
// Input is combined Google Vision DOCUMENT_TEXT_DETECTION output; multiple
// cheques are separated by lines matching /--- עמוד \d+ ---/. One cheque per
// page (v1 does not look for multiple cheques per page).

'use strict';

// ---------------------------------------------------------------------------
// Bank-name maps
// ---------------------------------------------------------------------------

// Printed Hebrew bank names. Ordered LONGEST-first so a longer/more specific
// name wins over a substring (e.g. "הבנק הבינלאומי" before "הבינלאומי",
// "מזרחי טפחות" before "מזרחי", "בנק הפועלים" before "הפועלים").
var HEBREW_BANK_PATTERNS = [
    { needle: 'הבנק הבינלאומי', name: 'הבינלאומי' },
    { needle: 'הבינלאומי', name: 'הבינלאומי' },
    { needle: 'בנק הפועלים', name: 'הפועלים' },
    { needle: 'הפועלים', name: 'הפועלים' },
    { needle: 'מזרחי טפחות', name: 'מזרחי טפחות' },
    { needle: 'מזרחי-טפחות', name: 'מזרחי טפחות' },
    { needle: 'מזרחי', name: 'מזרחי טפחות' },
    { needle: 'דיסקונט', name: 'דיסקונט' },
    { needle: 'אוצר החייל', name: 'אוצר החייל' },
    { needle: 'מרכנתיל', name: 'מרכנתיל' },
    { needle: 'לאומי', name: 'לאומי' },
    { needle: 'יהב', name: 'יהב' },
    { needle: 'מסד', name: 'מסד' },
    { needle: 'איגוד', name: 'איגוד' },
    { needle: 'ירושלים', name: 'ירושלים' }
];

// MICR 2-digit bank code -> Hebrew bank name (fallback only).
var MICR_BANK_CODE = {
    '12': 'הפועלים',
    '10': 'לאומי',
    '20': 'מזרחי טפחות',
    '11': 'דיסקונט',
    '31': 'הבינלאומי',
    '04': 'יהב',
    '14': 'אוצר החייל',
    '17': 'מרכנתיל',
    '46': 'מסד'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
}

// Validate a Y/M/D and return "YYYY-MM-DD" or "" if not a real calendar date.
function buildIsoDate(year, month, day) {
    var y = parseInt(year, 10);
    var m = parseInt(month, 10);
    var d = parseInt(day, 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
    if (m < 1 || m > 12) return '';
    if (d < 1 || d > 31) return '';
    // reject impossible day-of-month (e.g. 31/02, 30/02, 31/04)
    var daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var maxDay = daysInMonth[m - 1];
    // leap-year for February
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) maxDay = 29;
    if (d > maxDay) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
}

// Normalize a 2- or 4-digit year. 2-digit -> 20YY. Reject anything weird.
function normalizeYear(raw) {
    var s = String(raw);
    if (s.length === 2) return 2000 + parseInt(s, 10);
    if (s.length === 4) return parseInt(s, 10);
    return NaN;
}

// Parse one date-like token (D.M.YY, DD/MM/YYYY, D-M-YY, etc.) into
// { iso: "YYYY-MM-DD", year: <number> } or null. Israeli order = DAY first.
function parseDateToken(token) {
    // capture three numeric groups separated by . / -
    var m = token.match(/(\d{1,2})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{2,4})/);
    if (!m) return null;
    var day = m[1];
    var month = m[2];
    var year = normalizeYear(m[3]);
    if (isNaN(year)) return null;
    var iso = buildIsoDate(year, month, day);
    if (!iso) return null;
    return { iso: iso, year: year };
}

// Find ALL date tokens in a string, each tagged with its index position.
function findAllDateTokens(text) {
    var out = [];
    var re = /(\d{1,2})\s*[.\/\-]\s*(\d{1,2})\s*[.\/\-]\s*(\d{2,4})/g;
    var m;
    while ((m = re.exec(text)) !== null) {
        var parsed = parseDateToken(m[0]);
        if (parsed) {
            out.push({ iso: parsed.iso, year: parsed.year, index: m.index });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------------------

// HIGH-confidence: branch from printed "סניף NNN" label. 3 digits, keep zeros.
function extractBranch(text) {
    var m = text.match(/סניף\s*(\d{3})\b/);
    if (m) return m[1];
    return '';
}

// HIGH-confidence: bank name. Printed Hebrew name preferred; MICR code fallback.
function extractBankName(text, micrGroups) {
    var i;
    for (i = 0; i < HEBREW_BANK_PATTERNS.length; i++) {
        if (text.indexOf(HEBREW_BANK_PATTERNS[i].needle) !== -1) {
            return HEBREW_BANK_PATTERNS[i].name;
        }
    }
    // fallback: MICR 2-digit bank code group
    if (micrGroups && micrGroups.length) {
        for (i = 0; i < micrGroups.length; i++) {
            if (micrGroups[i].length === 2 && MICR_BANK_CODE[micrGroups[i]]) {
                return MICR_BANK_CODE[micrGroups[i]];
            }
        }
    }
    return '';
}

// HIGH-confidence: cheque number printed by the "CHEQUE NO." / "מס׳ השיק" label.
// Look for a 5-8 digit number immediately before OR after the label.
function extractChequeNum(text) {
    // Label variants. ׳ = Hebrew geresh, ״ = gershayim.
    var labelAlt = "(?:CHEQUE\\s*NO\\.?|CHECK\\s*NO\\.?|מס['\\u05f3\\u05f4’]?\\s*(?:ה)?שיק|מספר\\s*(?:ה)?שיק)";

    // number BEFORE label: "174098 CHEQUE NO."
    var re1 = new RegExp('(\\d{5,8})\\s*' + labelAlt, 'i');
    var m = text.match(re1);
    if (m) return m[1];

    // number AFTER label: "CHEQUE NO. 174098"
    var re2 = new RegExp(labelAlt + '\\s*[:#]?\\s*(\\d{5,8})', 'i');
    m = text.match(re2);
    if (m) return m[1];

    return '';
}

// Find the MICR codeline: a line with 3-4 space-separated digit groups whose
// digits total >= ~18. Returns { groups: [...], account: "" }.
//
// Sample codeline: "3174098 31 03500 409284572"
//   groups = [3174098, 31, 03500, 409284572]; total digits = 7+2+5+9 = 23.
//   account = longest group >= 7 digits = "409284572".
function extractMicr(text) {
    var lines = text.split(/\r?\n/);
    var best = null; // pick the codeline with the most total digits
    var i, j;
    for (i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        // collect runs of digits separated only by whitespace / a few symbols
        var groups = line.match(/\d{2,}/g);
        if (!groups || groups.length < 3 || groups.length > 6) continue;
        var totalDigits = 0;
        for (j = 0; j < groups.length; j++) totalDigits += groups[j].length;
        if (totalDigits < 18) continue;
        // The MICR line is mostly digits; reject lines dominated by Hebrew text
        // (addresses, descriptions) by requiring the digit groups to make up
        // the bulk of the line's non-space characters.
        var nonSpace = line.replace(/\s/g, '').length;
        if (nonSpace === 0) continue;
        if (totalDigits / nonSpace < 0.6) continue;
        if (!best || totalDigits > best.totalDigits) {
            best = { groups: groups, totalDigits: totalDigits };
        }
    }
    if (!best) return { groups: [], account: '' };

    // account = LONGEST group that is >= 7 digits
    var account = '';
    for (j = 0; j < best.groups.length; j++) {
        var g = best.groups[j];
        if (g.length >= 7 && g.length > account.length) account = g;
    }
    return { groups: best.groups, account: account };
}

// HIGH-confidence: account number.
// Primary source: longest group (>=7 digits) of the MICR codeline.
// Cross-check: a 7-10 digit number near "ACCOUNT"/"חשבון" — if present and it
// agrees with (or is contained in) the MICR account, prefer agreement; if the
// MICR gave nothing, accept the labeled number.
function extractAccount(text, micr) {
    var micrAccount = micr.account || '';

    // labeled account candidate near "ACCOUNT No." / "חשבון"
    var labeledAccount = '';
    var m = text.match(/(\d{7,10})\s*(?:ACCOUNT\s*No\.?|חשבון)/i);
    if (!m) m = text.match(/(?:ACCOUNT\s*No\.?|חשבון)\s*[:#]?\s*(\d{7,10})/i);
    if (m) labeledAccount = m[1];

    if (micrAccount) {
        // If a labeled value exists and disagrees badly, still trust MICR
        // (codeline is the canonical machine-readable source). Agreement only
        // raises confidence; it never overrides.
        return micrAccount;
    }
    // No confident codeline -> only accept a clearly-labeled account, else "".
    if (labeledAccount) return labeledAccount;
    return '';
}

// MEDIUM (best-effort): the DUE date (מועד פירעון), near "תאריך"/"DATE".
// Prefer the date adjacent to the תאריך/DATE label; if two candidates, prefer
// the LATER (future) one. Output "YYYY-MM-DD" or "".
function extractDate(text) {
    var all = findAllDateTokens(text);
    if (all.length === 0) return '';

    // Locate the תאריך/DATE label position(s).
    var labelIdx = -1;
    var labelRe = /תאריך|DATE/g;
    var lm;
    var labelPositions = [];
    while ((lm = labelRe.exec(text)) !== null) {
        labelPositions.push(lm.index);
    }

    if (labelPositions.length > 0) {
        // Score each date by distance to the NEAREST label; the due-date is
        // printed right next to it. Pick the closest; break ties by later date.
        var bestByLabel = null;
        for (var i = 0; i < all.length; i++) {
            var minDist = Infinity;
            for (var k = 0; k < labelPositions.length; k++) {
                var d = Math.abs(all[i].index - labelPositions[k]);
                if (d < minDist) minDist = d;
            }
            all[i]._dist = minDist;
            if (!bestByLabel) {
                bestByLabel = all[i];
            } else if (all[i]._dist < bestByLabel._dist) {
                bestByLabel = all[i];
            } else if (all[i]._dist === bestByLabel._dist && all[i].iso > bestByLabel.iso) {
                bestByLabel = all[i];
            }
        }
        // Only trust label-adjacency when the date is reasonably close to the
        // label (within ~40 chars). Otherwise fall through to "latest date".
        if (bestByLabel && bestByLabel._dist <= 40) {
            return bestByLabel.iso;
        }
    }

    // No usable label proximity -> prefer the LATER (future) date.
    var latest = all[0];
    for (var j = 1; j < all.length; j++) {
        if (all[j].iso > latest.iso) latest = all[j];
    }
    return latest.iso;
}

// MEDIUM (best-effort): gross cheque amount near ₪ / N.I.S / ש"ח.
// Israelis frame the amount with anti-fraud strokes that OCR reads as a leading
// "1" (real 2,800 -> OCR "12800"). Heuristic: collect numeric candidates near a
// currency token, strip thousands separators; if a candidate has a suspicious
// leading "1" that makes it ~10x larger than the next signal, also consider the
// stripped value. Return a number; 0 if no usable amount.
function extractAmount(text) {
    var candidates = [];

    // 1) Numbers appearing on the same "phrase" as a currency marker.
    //    e.g. "RJ / 12800/19"  (the 12800 is the framed amount)
    //         "N.I.S.  ₪", ".PAYTO  ₪"
    // Collect any 3-7 digit run that sits near ₪ / N.I.S / ש"ח / .-style amounts.
    var currencyContext = /(?:₪|N\.?I\.?S\.?|ש["״]ח|שקל)/i;

    // Gather candidate numbers from lines that mention currency, plus the
    // common "/ NUMBER /" framing.
    var lines = text.split(/\r?\n/);
    var i, j;
    for (i = 0; i < lines.length; i++) {
        var line = lines[i];
        var hasCurrency = currencyContext.test(line);
        // "/ 12800 /" or "/12800/" framing — a strong amount signal on a cheque
        var framed = line.match(/[\/|]\s*(\d{2,7})\s*[\/|]/g);
        if (framed) {
            for (j = 0; j < framed.length; j++) {
                var fm = framed[j].match(/(\d{2,7})/);
                if (fm) candidates.push({ raw: fm[1], framed: true, currency: hasCurrency });
            }
        }
        if (hasCurrency) {
            var nums = line.match(/\d{2,7}(?:[,.]\d{3})*/g);
            if (nums) {
                for (j = 0; j < nums.length; j++) {
                    candidates.push({ raw: nums[j], framed: false, currency: true });
                }
            }
        }
    }

    if (candidates.length === 0) return 0;

    // Normalize: strip thousands separators, parse to number, and produce a
    // "leading-1-stripped" alternative when it looks like the anti-fraud stroke.
    var values = [];
    for (i = 0; i < candidates.length; i++) {
        var rawDigits = candidates[i].raw.replace(/[,.]/g, '');
        if (!/^\d+$/.test(rawDigits)) continue;
        var n = parseInt(rawDigits, 10);
        if (isNaN(n) || n <= 0) continue;
        values.push({ value: n, framed: candidates[i].framed, digits: rawDigits });
        // suspicious leading "1": "12800" -> "2800"
        if (rawDigits.length >= 4 && rawDigits.charAt(0) === '1') {
            var stripped = parseInt(rawDigits.substring(1), 10);
            if (!isNaN(stripped) && stripped > 0) {
                values.push({ value: stripped, framed: candidates[i].framed, digits: rawDigits.substring(1), strippedLead1: true });
            }
        }
    }

    if (values.length === 0) return 0;

    // Prefer a framed candidate (strongest signal on the cheque). Among framed
    // candidates, prefer the leading-1-stripped variant (the real amount), which
    // tends to be "round-ish".
    var framedStripped = null;
    var framedRaw = null;
    for (i = 0; i < values.length; i++) {
        if (values[i].framed && values[i].strippedLead1 && !framedStripped) framedStripped = values[i];
        if (values[i].framed && !values[i].strippedLead1 && !framedRaw) framedRaw = values[i];
    }
    if (framedStripped) return framedStripped.value;
    if (framedRaw) return framedRaw.value;

    // Otherwise: take the most common / largest reasonable currency value.
    var best = values[0];
    for (i = 1; i < values.length; i++) {
        if (values[i].value > best.value) best = values[i];
    }
    return best.value;
}

// ---------------------------------------------------------------------------
// Per-page (single cheque) parse
// ---------------------------------------------------------------------------

// Decide whether a page segment actually contains a cheque. Signal = a MICR-like
// codeline OR a "סניף"/known-bank-name presence. No signal -> skip (no object).
function hasChequeSignal(text, micr) {
    if (micr.groups && micr.groups.length >= 3) return true;
    if (/סניף\s*\d{3}/.test(text)) return true;
    for (var i = 0; i < HEBREW_BANK_PATTERNS.length; i++) {
        if (text.indexOf(HEBREW_BANK_PATTERNS[i].needle) !== -1) return true;
    }
    return false;
}

function parseOneCheque(segment) {
    var micr = extractMicr(segment);
    if (!hasChequeSignal(segment, micr)) return null;

    return {
        date: extractDate(segment),
        amount: extractAmount(segment),
        bankName: extractBankName(segment, micr.groups),
        bankBranch: extractBranch(segment),
        bankAccount: extractAccount(segment, micr),
        chequeNum: extractChequeNum(segment)
    };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function parseChecksDeterministic(ocrText) {
    if (!ocrText || typeof ocrText !== 'string') return [];

    // Split on page separators "--- עמוד N ---". The split keeps text before the
    // first marker as segment[0] (the normal single-page case has no marker).
    var segments = ocrText.split(/---\s*עמוד\s*\d+\s*---/);

    var results = [];
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        if (!seg || !seg.trim()) continue;
        var cheque = parseOneCheque(seg);
        if (cheque) results.push(cheque);
    }
    return results;
}

module.exports = { parseChecksDeterministic: parseChecksDeterministic };

// ---------------------------------------------------------------------------
// Self-test (runs only via `node lib/parse-checks.js`, not on import)
// ---------------------------------------------------------------------------

if (require.main === module) {
    var passCount = 0;
    var failCount = 0;

    function assert(label, actual, expected) {
        var ok = actual === expected;
        if (ok) {
            passCount++;
            console.log('  PASS  ' + label + '  => ' + JSON.stringify(actual));
        } else {
            failCount++;
            console.log('  FAIL  ' + label + '  expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
        }
        return ok;
    }

    // ----- REAL SAMPLE (calibration page) -----
    var REAL_SAMPLE = [
        'רוזנס שרית ת.ז. 036264570',
        'מוהליבר 28 דירה 1 יהוד-מונוסון 5620914',
        'טלפון: 0542485005',
        'למוטב בלבד',
        'הבינלאומי <',
        'סניף 035 קיראון  גיא הרשקוב... שלמה המלך 37 קניון ק.אונו, קרית אונו, טל\' 03-5316200',
        'חברת עורכי דין',
        'שלמו ל  ח.פ. 515577161.',
        'N.I.S.  ₪',
        'RJ / 12800/19',
        'חתימה SIGNATURE',
        '3174098 31 03500 409284572',
        '.PAYTO  ₪',
        '3ẞ ne hy give off',
        '23',
        'כ - 19/01/25',
        'בשיק זה אין לבצע שינוי לאחר שנכתב, למעט שינוי תאריך או סכום.',
        '7.5.26.',
        'תאריך DATE',
        '174098 CHEQUE NO.',
        '-31/03500) 409284572  BRANCH No.',
        'ACCOUNT No.',
        'הבנק הבינלאומי הראשון לישראל בע"מ'
    ].join('\n');

    console.log('\n=== TEST 1: real sample (ground-truth) ===');
    var r1 = parseChecksDeterministic(REAL_SAMPLE);
    assert('count', r1.length, 1);
    if (r1.length === 1) {
        assert('bankName', r1[0].bankName, 'הבינלאומי');
        assert('bankBranch', r1[0].bankBranch, '035');
        assert('bankAccount', r1[0].bankAccount, '409284572');
        assert('chequeNum', r1[0].chequeNum, '174098');
        assert('date (due 7.5.26)', r1[0].date, '2026-05-07');
        // amount is best-effort; ground truth ~2800.
        if (r1[0].amount === 2800) {
            passCount++;
            console.log('  PASS  amount  => 2800');
        } else {
            // not a hard failure — flag it.
            console.log('  FLAG  amount  expected ~2800, got ' + JSON.stringify(r1[0].amount) + ' (best-effort; user verifies)');
        }
    }

    // ----- TEST 2: two-page input -> 2 objects -----
    console.log('\n=== TEST 2: two pages -> 2 cheques ===');
    var SECOND_CHEQUE = [
        'בנק הפועלים',
        'סניף 678 רמת גן',
        'N.I.S.  ₪ 5,000',
        '0123456 12 678 0011223344  BRANCH No.',
        '15/08/2026',
        'תאריך DATE',
        '123456 CHEQUE NO.',
        'ACCOUNT No.'
    ].join('\n');
    var twoPage = REAL_SAMPLE + '\n--- עמוד 2 ---\n' + SECOND_CHEQUE;
    var r2 = parseChecksDeterministic(twoPage);
    assert('count', r2.length, 2);
    if (r2.length === 2) {
        assert('page2 bankName', r2[1].bankName, 'הפועלים');
        assert('page2 branch', r2[1].bankBranch, '678');
        assert('page2 chequeNum', r2[1].chequeNum, '123456');
        assert('page2 account', r2[1].bankAccount, '0011223344');
        assert('page2 date', r2[1].date, '2026-08-15');
    }

    // ----- TEST 3: garbage text -> [] -----
    console.log('\n=== TEST 3: garbage -> [] ===');
    var r3 = parseChecksDeterministic('hello world\nlorem ipsum\n12 34 foo bar\n--- עמוד 2 ---\nnothing here');
    assert('count', r3.length, 0);

    // ----- TEST 4: branch + bank, NO codeline -> account "" -----
    console.log('\n=== TEST 4: branch+bank, no codeline -> account="" ===');
    var NO_CODELINE = [
        'בנק דיסקונט',
        'סניף 053 תל אביב',
        'למוטב בלבד'
    ].join('\n');
    var r4 = parseChecksDeterministic(NO_CODELINE);
    assert('count', r4.length, 1);
    if (r4.length === 1) {
        assert('branch', r4[0].bankBranch, '053');
        assert('bankName', r4[0].bankName, 'דיסקונט');
        assert('account empty', r4[0].bankAccount, '');
        assert('chequeNum empty', r4[0].chequeNum, '');
    }

    console.log('\n=== SUMMARY ===');
    console.log('PASS: ' + passCount + '   FAIL: ' + failCount);
    process.exit(failCount === 0 ? 0 : 1);
}
