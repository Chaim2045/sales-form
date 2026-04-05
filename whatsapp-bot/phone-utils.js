// Shared Phone Utilities — single source of truth for phone normalization
// Used by: leads-detector.js, firebase.js, index.js

// Local format (05XXXXXXXX) — used for storage and display
function normalizePhone(phone) {
    if (!phone) return '';
    var d = phone.replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.substring(3);
    if (d.length === 9 && /^[5]/.test(d)) d = '0' + d;
    return d;
}

// International format (972XXXXXXXX) — used for WhatsApp IDs
function toInternational(phone) {
    if (!phone) return '';
    var d = phone.replace(/\D/g, '');
    if (d.startsWith('0')) return '972' + d.substring(1);
    if (d.startsWith('972')) return d;
    return d;
}

// Last 7 digits — format-agnostic unique identifier for dedup
function getLast7(phone) {
    if (!phone) return '';
    var digits = phone.replace(/\D/g, '');
    return digits.slice(-7);
}

// Extract Israeli phone number from free text and normalize
function extractPhone(text) {
    if (!text) return null;
    var match = text.match(/(0\d{1,2}[\s-]?\d{3}[\s-]?\d{4})/);
    if (match) return normalizePhone(match[1]);
    // Try mishpati format: 053-3239882
    match = text.match(/(0\d{1,2}-\d{7})/);
    if (match) return normalizePhone(match[1]);
    return null;
}

module.exports = { normalizePhone, toInternational, getLast7, extractPhone };
