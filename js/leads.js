// ==================== Leads CRM Management ====================
// Loads leads from Firestore, renders table/cards/kanban, AI scoring

var leadsRecords = [];
var leadsViewMode = 'table';
var leadsCurrentPage = 1;
var LEADS_PAGE_SIZE = 20;
var LEADS_BATCH_SIZE = 50;
var leadsDataLoaded = false;
var leadsRealtimeUnsubscribe = null;
var leadsNewListener = null; // realtime listener for new leads only
var leadsLastDoc = null;     // cursor for pagination
var leadsHasMore = true;     // are there more batches to load
var leadsLoadingMore = false; // prevent double-load
var currentLeadDocId = null;
var leadsMyMode = false;
var leadsQuickFilter = 'all';
var leadsLastSeenIds = {};
var autoScoreQueue = [];
var autoScoreRunning = false;
var leadsDuplicateMap = {}; // docId → { isDuplicate, duplicateOf, primaryName }

// ==================== SVG Icons ====================

var LDI = {
    new:         '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    assigned:    '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    contacted:   '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    followup:    '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    no_answer:   '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    closed:      '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    not_relevant:'<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    ai:          '<svg class="ld-icon ld-icon-ai" viewBox="0 0 24 24" fill="none" stroke="url(#aiGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>',
    save:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    trash:       '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    calendar:    '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    whatsapp:    '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    mail:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    money:       '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    lightbulb:   '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>',
    scale:       '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M5 12H2l5-9 5 9H5z"/><path d="M19 12h-3l5-9 5 9h-7z" transform="translate(-5,0)"/></svg>',
    clipboard:   '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
    star:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    flame:       '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    zap:         '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    help:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    clock:       '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    building:    '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="6" x2="9.01" y2="6"/><line x1="15" y1="6" x2="15.01" y2="6"/><line x1="9" y1="10" x2="9.01" y2="10"/><line x1="15" y1="10" x2="15.01" y2="10"/><line x1="9" y1="14" x2="9.01" y2="14"/><line x1="15" y1="14" x2="15.01" y2="14"/><line x1="9" y1="18" x2="15" y2="18"/></svg>',
    monitor:     '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    link:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    chart:       '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    message:     '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    edit:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    imported:    '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>',
    week:        '<svg class="ld-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/></svg>'
};

// ==================== Status Labels ====================

var LEAD_STATUS_LABELS = {
    'new': LDI.new + ' חדש',
    'assigned': LDI.assigned + ' שויך',
    'contacted': LDI.contacted + ' נוצר קשר',
    'meeting_set': LDI.calendar + ' נקבעה פגישה',
    'followup': LDI.followup + ' פולואפ',
    'no_answer': LDI.no_answer + ' לא ענה',
    'closed': LDI.closed + ' נסגר',
    'not_relevant': LDI.not_relevant + ' לא רלוונטי'
};

var LEAD_SOURCE_LABELS = {
    'din_sms': 'din.co.il',
    'secretary': 'מזכירות',
    'manager': 'מנהלת',
    'missed_call': 'שיחה',
    'staff_direct': 'עובד',
    'image_lead': 'תמונה',
    'generic': 'אחר',
    'unknown': 'לא ידוע'
};

// Plain text labels for Chart.js (canvas can't render SVG)
var LEAD_STATUS_TEXT = {
    'new': 'חדש',
    'assigned': 'שויך',
    'contacted': 'נוצר קשר',
    'meeting_set': 'נקבעה פגישה',
    'followup': 'פולואפ',
    'no_answer': 'לא ענה',
    'closed': 'נסגר',
    'not_relevant': 'לא רלוונטי'
};

// ==================== Show / Hide ====================

function showLeadsManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('leadsManagement').classList.add('active');

    // Init My Leads mode
    // Master sees all + toggle. Regular user sees only their leads, no toggle.
    var isMaster = currentUserRole === 'master';
    var toggleBtn = document.getElementById('ldToggleMy');
    if (isMaster) {
        if (toggleBtn) toggleBtn.style.display = '';
        // Master starts with "all leads" by default
    } else if (currentUser) {
        leadsMyMode = true;
        if (toggleBtn) toggleBtn.style.display = 'none';
    }
    updateMyLeadsToggle();

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Restore saved filters
    restoreFilterState();

    if (!leadsDataLoaded) {
        loadLeadsData();
    }
    // Update last seen timestamp (clears badge)
    try { localStorage.setItem('ld_lastSeen', Date.now().toString()); } catch(e) {}
    updateLeadsBadge(0);
}

function hideLeadsManagement() {
    var el = document.getElementById('leadsManagement');
    if (el) el.classList.remove('active');
    if (leadsRealtimeUnsubscribe) {
        leadsRealtimeUnsubscribe();
        leadsRealtimeUnsubscribe = null;
    }
    if (leadsNewListener) {
        leadsNewListener();
        leadsNewListener = null;
    }
}
// Expose for navigation.js which redefines hideLeadsManagement
window.hideLeadsManagement_internal = hideLeadsManagement;

// Reset all leads state on logout — prevents data leak between users
function resetLeadsState() {
    hideLeadsManagement();
    leadsRecords = [];
    leadsDataLoaded = false;
    leadsMyMode = false;
    leadsQuickFilter = 'all';
    leadsLastSeenIds = {};
    autoScoreQueue = [];
    autoScoreRunning = false;
    leadsChartsInitialized = false;
    leadsAllRecords = null;
    currentLeadDocId = null;
    leadsCurrentPage = 1;
    leadsViewMode = 'table';
    leadsDuplicateMap = {};
    leadsLastDoc = null;
    leadsHasMore = true;
    leadsLoadingMore = false;
    if (leadsNewListener) { leadsNewListener(); leadsNewListener = null; }
    // Destroy Chart.js instances to prevent memory leak
    Object.keys(leadsChartInstances).forEach(function(k) {
        try { leadsChartInstances[k].destroy(); } catch(e) {}
    });
    leadsChartInstances = {};
    // Clear localStorage to prevent state leak between users
    try { localStorage.removeItem('ld_filters'); } catch(e) {}
    try { localStorage.removeItem('ld_lastSeen'); } catch(e) {}
}

// ==================== Duplicate Detection ====================

function getLast7(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-7);
}

function scanForDuplicates(records) {
    var phoneMap = {};
    var dupMap = {};

    records.forEach(function(r) {
        var last7 = getLast7(r.phone);
        if (last7.length < 7) return;
        if (!phoneMap[last7]) phoneMap[last7] = [];
        phoneMap[last7].push(r);
    });

    Object.keys(phoneMap).forEach(function(last7) {
        var group = phoneMap[last7];
        if (group.length < 2) return;
        // Sort: newest first = primary (keep), rest = duplicates
        group.sort(function(a, b) {
            var ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
            var tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
            return tb - ta;
        });
        for (var i = 1; i < group.length; i++) {
            dupMap[group[i].id] = {
                isDuplicate: true,
                duplicateOf: group[0].id,
                primaryName: group[0].name || group[0].phone || 'ליד'
            };
        }
    });

    return dupMap;
}

// ==================== Lead Enrichment ====================

function enrichLeadOnOpen(record) {
    var enrichEl = document.getElementById('ldModalEnrichment');
    var enrichContent = document.getElementById('ldModalEnrichContent');
    if (!enrichEl || !enrichContent) return;
    enrichEl.style.display = 'none';
    enrichContent.innerHTML = '';

    var last7 = getLast7(record.phone);
    if (last7.length < 7) return;

    var salesMatches = [];
    var billingMatch = null;

    // Search sales_records
    db.collection('sales_records')
        .orderBy('timestamp', 'desc')
        .limit(200)
        .get()
        .then(function(snap) {
            snap.forEach(function(doc) {
                var d = doc.data();
                if (getLast7(d.phone) === last7) {
                    salesMatches.push({
                        name: d.clientName,
                        amount: d.amountWithVat || d.amountBeforeVat || 0,
                        type: d.transactionType || '',
                        date: d.date || '',
                        attorney: d.formFillerName || ''
                    });
                }
            });

            // Auto-enrich missing fields
            if (salesMatches.length > 0) {
                var enrichUpdates = {};
                var first = salesMatches[0];
                if (!record.name && first.name) enrichUpdates.name = first.name;
                if (Object.keys(enrichUpdates).length > 0) {
                    db.collection('leads').doc(record.id).update(enrichUpdates);
                }
            }

            // Search recurring_billing
            return db.collection('recurring_billing').limit(100).get();
        })
        .then(function(billingSnap) {
            if (billingSnap) {
                billingSnap.forEach(function(doc) {
                    var d = doc.data();
                    if (getLast7(d.phone) === last7) {
                        billingMatch = {
                            name: d.clientName,
                            amount: d.recurringMonthlyAmount || 0,
                            status: d.status || 'active'
                        };
                    }
                });
            }

            // Render
            if (salesMatches.length === 0 && !billingMatch) return;
            enrichEl.style.display = '';

            var html = '';
            salesMatches.forEach(function(s) {
                var dateStr = s.date ? (typeof s.date === 'string' ? s.date : '') : '';
                html += '<div class="ld-enrich-row">' +
                    '<span class="ld-enrich-label">עסקה</span> ' +
                    escapeHTML(s.name || '') + ' — ' +
                    '<strong>' + (s.amount ? Number(s.amount).toLocaleString('he-IL') + '₪' : '') + '</strong>' +
                    (s.type ? ' (' + escapeHTML(s.type) + ')' : '') +
                    (dateStr ? ' — ' + escapeHTML(dateStr) : '') +
                    '</div>';
            });
            if (billingMatch) {
                html += '<div class="ld-enrich-row">' +
                    '<span class="ld-enrich-label">ריטיינר</span> ' +
                    (billingMatch.amount ? Number(billingMatch.amount).toLocaleString('he-IL') + '₪/חודש' : '') +
                    ' — ' + escapeHTML(billingMatch.status) +
                    '</div>';
            }
            enrichContent.innerHTML = html;
        })
        .catch(function(err) {
            console.error('Enrichment error:', err);
        });
}

// ==================== Duplicate Alert in Modal ====================

function showDuplicateAlert(record) {
    var dupEl = document.getElementById('ldModalDuplicate');
    if (!dupEl) return;

    var dupInfo = leadsDuplicateMap[record.id];
    if (!dupInfo) {
        dupEl.style.display = 'none';
        return;
    }

    var dupLink = document.getElementById('ldModalDupLink');
    if (dupLink) {
        dupLink.textContent = dupInfo.primaryName;
        dupLink.onclick = function(e) { e.preventDefault(); openLeadModal(dupInfo.duplicateOf); };
    }
    dupEl.style.display = '';
}

// ==================== Merge Duplicates ====================

function mergeDuplicateLeads() {
    if (!currentLeadDocId) return;
    var dupInfo = leadsDuplicateMap[currentLeadDocId];
    if (!dupInfo) return;

    var keepId = dupInfo.duplicateOf; // primary (newest)
    var removeId = currentLeadDocId;  // this one (older duplicate)

    if (!confirm('למזג ליד זה עם ' + dupInfo.primaryName + '?\nהליד הנוכחי יימחק, הנתונים יועברו.')) return;

    var keepRecord = leadsRecords.find(function(r) { return r.id === keepId; });
    var removeRecord = leadsRecords.find(function(r) { return r.id === removeId; });
    if (!keepRecord || !removeRecord) return;

    // Build updates: fill missing fields on primary from duplicate
    var updates = { lastUpdated: firebase.firestore.FieldValue.serverTimestamp() };
    if (!keepRecord.name && removeRecord.name) updates.name = removeRecord.name;
    if (!keepRecord.email && removeRecord.email) updates.email = removeRecord.email;
    if (!keepRecord.subject && removeRecord.subject) updates.subject = removeRecord.subject;
    if (!keepRecord.assignedTo && removeRecord.assignedTo) updates.assignedTo = removeRecord.assignedTo;
    if (!keepRecord.aiScore && removeRecord.aiScore) {
        updates.aiScore = removeRecord.aiScore;
        updates.aiReason = removeRecord.aiReason || '';
        updates.aiCategory = removeRecord.aiCategory || '';
    }

    // Merge history
    var removeHistory = removeRecord.history || [];
    if (removeHistory.length > 0) {
        removeHistory.forEach(function(h) {
            updates.history = firebase.firestore.FieldValue.arrayUnion(h);
        });
    }
    updates.history = firebase.firestore.FieldValue.arrayUnion({
        action: 'merged',
        by: currentUser || 'web',
        at: new Date().toISOString(),
        note: 'מוזג מליד כפול'
    });

    // Update primary, delete duplicate
    db.collection('leads').doc(keepId).update(updates)
        .then(function() {
            return db.collection('leads').doc(removeId).delete();
        })
        .then(function() {
            logAuditEvent('leads_merged', { keepId: keepId, removedId: removeId });
            closeLeadModal();
            openLeadModal(keepId);
        })
        .catch(function(err) {
            alert('שגיאה במיזוג: ' + err.message);
        });
}

// ==================== Load Data ====================

async function loadLeadsData() {
    var loading = document.getElementById('ldLoading');
    if (loading) loading.style.display = '';

    try {
        // 1. Load first batch (cursor-based)
        var snapshot = await db.collection('leads')
            .orderBy('createdAt', 'desc')
            .limit(LEADS_BATCH_SIZE)
            .get();

        leadsRecords = [];
        snapshot.forEach(function(doc) {
            leadsRecords.push(Object.assign({ id: doc.id }, doc.data()));
        });

        // Save cursor for "load more"
        leadsLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
        leadsHasMore = snapshot.docs.length === LEADS_BATCH_SIZE;
        leadsDataLoaded = true;
        if (loading) loading.style.display = 'none';

        if (leadsRecords.length === 0) {
            document.getElementById('ldEmpty').style.display = '';
        } else {
            document.getElementById('ldEmpty').style.display = 'none';
        }

        leadsDuplicateMap = scanForDuplicates(leadsRecords);
        populateLeadsFilters();
        updateLeadsSummary(getFilteredLeads());
        updateMyDashboard();
        renderLeadsView();

        // Mark all loaded as seen
        leadsRecords.forEach(function(r) { leadsLastSeenIds[r.id] = true; });

        // Auto-score new unscored leads
        var unscored = leadsRecords.filter(function(r) {
            return !r.aiScore && !r.aiScoredAt && r.status !== 'not_relevant' && autoScoreQueue.indexOf(r.id) === -1;
        });
        if (unscored.length > 0) {
            unscored.slice(0, 10).forEach(function(r) { autoScoreQueue.push(r.id); });
            processAutoScoreQueue();
        }

        // 2. Realtime listener — only for NEW leads arriving after initial load
        var realtimeCutoff = new Date(Date.now() - 60000); // 1 minute ago
        leadsNewListener = db.collection('leads')
            .where('createdAt', '>', realtimeCutoff)
            .onSnapshot(function(snap) {
                snap.docChanges().forEach(function(change) {
                    if (change.type === 'added' && !leadsLastSeenIds[change.doc.id]) {
                        var newLead = Object.assign({ id: change.doc.id }, change.doc.data());
                        leadsLastSeenIds[change.doc.id] = true;
                        // Add to top of list
                        leadsRecords.unshift(newLead);
                        leadsDuplicateMap = scanForDuplicates(leadsRecords);
                        populateLeadsFilters();
                        updateLeadsSummary(getFilteredLeads());
                        renderLeadsView();

                        if (newLead.aiScore >= 7) showLeadNotification(newLead);
                    } else if (change.type === 'modified') {
                        // Update existing record in-place
                        var updatedData = Object.assign({ id: change.doc.id }, change.doc.data());
                        var idx = leadsRecords.findIndex(function(r) { return r.id === change.doc.id; });
                        if (idx !== -1) {
                            leadsRecords[idx] = updatedData;
                            renderLeadsView();
                        }
                    }
                });

                // Badge count
                var lastSeen = parseInt(localStorage.getItem('ld_lastSeen') || '0');
                var newSinceSeen = leadsRecords.filter(function(r) {
                    if (r.status !== 'new') return false;
                    var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
                    return ts > lastSeen;
                }).length;
                var leadsEl = document.getElementById('leadsManagement');
                if (!leadsEl || !leadsEl.classList.contains('active')) {
                    updateLeadsBadge(newSinceSeen);
                }
            });

    } catch (err) {
        console.error('Load leads error:', err);
        if (loading) loading.innerHTML = '<p style="color:var(--error);">שגיאה בטעינת לידים</p>';
    }
}

// Load more leads (cursor-based pagination)
async function loadMoreLeads() {
    if (!leadsHasMore || leadsLoadingMore || !leadsLastDoc) return;
    leadsLoadingMore = true;


    // Show loading indicator
    var loadMoreBtn = document.getElementById('ldLoadMore');
    if (loadMoreBtn) {
        loadMoreBtn.textContent = 'טוען...';
        loadMoreBtn.disabled = true;
    }

    try {
        var snapshot = await db.collection('leads')
            .orderBy('createdAt', 'desc')
            .startAfter(leadsLastDoc)
            .limit(LEADS_BATCH_SIZE)
            .get();

        snapshot.forEach(function(doc) {
            if (!leadsLastSeenIds[doc.id]) {
                leadsRecords.push(Object.assign({ id: doc.id }, doc.data()));
                leadsLastSeenIds[doc.id] = true;
            }
        });

        leadsLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
        leadsHasMore = snapshot.docs.length === LEADS_BATCH_SIZE;

        leadsDuplicateMap = scanForDuplicates(leadsRecords);
        populateLeadsFilters();
        updateLeadsSummary(getFilteredLeads());

        // Update button instead of full re-render to avoid observer loop
        if (loadMoreBtn) {
            if (leadsHasMore) {
                loadMoreBtn.textContent = 'טען עוד לידים (' + leadsRecords.length + ' טעונים)';
                loadMoreBtn.disabled = false;
            } else {
                loadMoreBtn.parentElement.remove();
            }
        }

        // Re-render content only (not pagination)
        renderLeadsView();

    } catch (err) {
        console.error('Load more leads error:', err);
        if (loadMoreBtn) {
            loadMoreBtn.textContent = 'שגיאה — נסה שוב';
            loadMoreBtn.disabled = false;
        }
    } finally {
        leadsLoadingMore = false;
    }
}

// ==================== Summary ====================

function updateLeadsSummary(records) {
    var total = records.length;
    var newCount = 0;
    var activeCount = 0;
    var closedCount = 0;

    records.forEach(function(r) {
        var st = r.status || 'new';
        if (st === 'new') newCount++;
        else if (st === 'assigned' || st === 'contacted' || st === 'meeting_set' || st === 'followup' || st === 'no_answer') activeCount++;
        else if (st === 'closed') closedCount++;
    });

    var conversion = total > 0 ? Math.round((closedCount / total) * 100) : 0;

    document.getElementById('ldStatTotal').textContent = total;
    document.getElementById('ldStatNew').textContent = newCount;
    document.getElementById('ldStatActive').textContent = activeCount;
    document.getElementById('ldStatClosed').textContent = closedCount;
    document.getElementById('ldStatConversion').textContent = conversion + '%';
}

// ==================== Filters ====================

function populateLeadsFilters() {
    var assigneeSelect = document.getElementById('ldFilterAssignee');
    if (!assigneeSelect) return;

    var assignees = {};
    leadsRecords.forEach(function(r) {
        if (r.assignedTo) assignees[r.assignedTo] = true;
    });

    var current = assigneeSelect.value;
    assigneeSelect.innerHTML = '<option value="">כל העובדים</option>';
    Object.keys(assignees).sort().forEach(function(a) {
        assigneeSelect.innerHTML += '<option value="' + escapeHTML(a) + '">' + escapeHTML(a) + '</option>';
    });
    assigneeSelect.value = current;
}

function getFilteredLeads() {
    var filtered = leadsRecords.slice();
    var now = Date.now();

    // My Leads mode
    if (leadsMyMode && currentUser) {
        filtered = filtered.filter(function(r) { return r.assignedTo === currentUser; });
    }

    // Quick filter chips
    if (leadsQuickFilter && leadsQuickFilter !== 'all') {
        filtered = filtered.filter(function(r) {
            var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
            switch (leadsQuickFilter) {
                case 'hot': return (r.aiScore || 0) >= 8;
                case 'medium': return (r.aiScore || 0) >= 5 && (r.aiScore || 0) <= 7;
                case 'unscored': return !r.aiScore;
                case 'today':
                    var todayStart = new Date(); todayStart.setHours(0,0,0,0);
                    return ts >= todayStart.getTime();
                case 'week': return ts >= now - 7 * 24 * 60 * 60 * 1000;
                case 'stale':
                    var lu = r.lastUpdated ? (r.lastUpdated.toDate ? r.lastUpdated.toDate().getTime() : new Date(r.lastUpdated).getTime()) : ts;
                    return (now - lu) > 3 * 24 * 60 * 60 * 1000 && r.status !== 'closed' && r.status !== 'not_relevant';
                default: return true;
            }
        });
    }

    // Text search (including original message)
    var search = (document.getElementById('ldSearch').value || '').trim().toLowerCase();
    if (search) {
        filtered = filtered.filter(function(r) {
            return (r.name || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.phone || '').indexOf(search) !== -1 ||
                   (r.subject || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.assignedTo || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.originalMessage || '').toLowerCase().indexOf(search) !== -1;
        });
    }

    var statusFilter = document.getElementById('ldFilterStatus').value;
    if (statusFilter) {
        filtered = filtered.filter(function(r) { return r.status === statusFilter; });
    }

    var assigneeFilter = document.getElementById('ldFilterAssignee').value;
    if (assigneeFilter) {
        filtered = filtered.filter(function(r) { return r.assignedTo === assigneeFilter; });
    }

    var scoreFilter = document.getElementById('ldFilterScore');
    if (scoreFilter && scoreFilter.value) {
        var sf = scoreFilter.value;
        filtered = filtered.filter(function(r) {
            var s = r.aiScore || 0;
            if (sf === '8+') return s >= 8;
            if (sf === '5-7') return s >= 5 && s <= 7;
            if (sf === '1-4') return s >= 1 && s <= 4;
            if (sf === 'none') return !r.aiScore;
            return true;
        });
    }

    var catFilter = document.getElementById('ldFilterCategory');
    if (catFilter && catFilter.value) {
        filtered = filtered.filter(function(r) { return r.aiCategory === catFilter.value; });
    }

    var dateFrom = document.getElementById('ldFilterDateFrom').value;
    if (dateFrom) {
        var fromTs = new Date(dateFrom).getTime();
        filtered = filtered.filter(function(r) {
            var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
            return ts >= fromTs;
        });
    }

    var dateTo = document.getElementById('ldFilterDateTo').value;
    if (dateTo) {
        var toTs = new Date(dateTo + 'T23:59:59').getTime();
        filtered = filtered.filter(function(r) {
            var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
            return ts <= toTs;
        });
    }

    // Sort: My Leads mode → score desc, then date desc
    if (leadsMyMode) {
        filtered.sort(function(a, b) {
            var sa = a.aiScore || 0, sb = b.aiScore || 0;
            if (sb !== sa) return sb - sa;
            var ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
            var tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
            return tb - ta;
        });
    }

    return filtered;
}

function filterLeadsView() {
    leadsCurrentPage = 1;
    var filtered = getFilteredLeads();
    updateLeadsSummary(filtered);
    renderLeadsView(filtered);
    saveFilterState();
    return filtered;
}

// ==================== View Mode ====================

function setLeadsViewMode(mode) {
    leadsViewMode = mode;
    leadsCurrentPage = 1;
    document.getElementById('ldViewTable').classList.toggle('active', mode === 'table');
    document.getElementById('ldViewCards').classList.toggle('active', mode === 'cards');
    document.getElementById('ldViewKanban').classList.toggle('active', mode === 'kanban');
    renderLeadsView();
}

// ==================== Render Router ====================

function renderLeadsView(filtered) {
    if (!filtered) filtered = getFilteredLeads();
    var tableView = document.getElementById('ldTableView');
    var cardsView = document.getElementById('ldCardsView');
    var kanbanView = document.getElementById('ldKanbanView');
    var empty = document.getElementById('ldEmpty');
    var pagination = document.getElementById('ldPagination');

    tableView.style.display = 'none';
    cardsView.style.display = 'none';
    kanbanView.style.display = 'none';

    if (filtered.length === 0) {
        if (empty) empty.style.display = '';
        if (pagination) pagination.innerHTML = '';
        return;
    }
    if (empty) empty.style.display = 'none';

    if (leadsViewMode === 'kanban') {
        kanbanView.style.display = '';
        renderLeadsKanbanView(filtered);
        if (pagination) pagination.innerHTML = '';
        return;
    }

    var totalPages = Math.ceil(filtered.length / LEADS_PAGE_SIZE);
    if (leadsCurrentPage > totalPages) leadsCurrentPage = totalPages;
    if (leadsCurrentPage < 1) leadsCurrentPage = 1;
    var start = (leadsCurrentPage - 1) * LEADS_PAGE_SIZE;
    var pageRecords = filtered.slice(start, start + LEADS_PAGE_SIZE);

    if (leadsViewMode === 'table') {
        tableView.style.display = '';
        renderLeadsTableView(pageRecords, start);
    } else {
        cardsView.style.display = '';
        renderLeadsCardsView(pageRecords);
    }

    renderLeadsPagination(filtered.length, totalPages);
}

// ==================== Table View ====================

function renderLeadsTableView(records, startIdx) {
    var tbody = document.getElementById('ldTableBody');
    var now = Date.now();
    tbody.innerHTML = records.map(function(r, idx) {
        var rowNum = (startIdx || 0) + idx + 1;
        var dateStr = formatLeadDate(r.createdAt);
        var statusHtml = '<span class="ld-status ld-status-' + (r.status || 'new') + '">' + (LEAD_STATUS_LABELS[r.status] || r.status || 'חדש') + '</span>';
        var scoreHtml = renderScoreBadge(r.aiScore);
        var dupBadge = leadsDuplicateMap[r.id] ? '<span class="ld-dup-badge">כפול</span>' : '';
        var sourceLabel = LEAD_SOURCE_LABELS[r.source] || r.source || '';
        var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
        var isNew = (now - ts) < 300000;
        var pulseClass = isNew ? ' class="ld-new-pulse"' : '';

        // Phone with actions
        var phoneFormatted = formatPhone(r.phone);
        var phoneDigits = (r.phone || '').replace(/\D/g, '');
        var phoneHtml = phoneFormatted !== '—' ?
            '<a href="tel:' + phoneDigits + '" class="ld-phone-link" onclick="event.stopPropagation();">' + escapeHTML(phoneFormatted) + '</a>' +
            '<button class="ld-wa-btn" onclick="event.stopPropagation();openWhatsApp(\'' + phoneDigits + '\')" title="WhatsApp">' + LDI.whatsapp + '</button>' :
            '<span style="color:var(--text-quaternary);">—</span>';

        return '<tr' + pulseClass + ' onclick="openLeadModal(\'' + r.id + '\')" style="cursor:pointer;">' +
            '<td style="width:30px;"><input type="checkbox" class="ld-row-check" value="' + r.id + '" onclick="event.stopPropagation();updateBulkBar()"></td>' +
            '<td style="font-size:12px;color:var(--text-quaternary);text-align:center;">' + rowNum + '</td>' +
            '<td style="font-size:12px;color:var(--text-tertiary);">' + dateStr + '</td>' +
            '<td class="ld-name-cell">' + escapeHTML(r.name || r.phone || '—') + '</td>' +
            '<td class="ld-phone-cell">' + phoneHtml + '</td>' +
            '<td style="font-size:12px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(r.subject || '—') + '</td>' +
            '<td class="ld-source">' + escapeHTML(sourceLabel) + '</td>' +
            '<td>' + scoreHtml + dupBadge + '</td>' +
            '<td style="font-size:12px;color:var(--accent);font-weight:500;">' + escapeHTML(r.assignedTo || '—') + '</td>' +
            '<td>' + statusHtml + '</td>' +
            '<td><button class="bm-action-secondary" onclick="event.stopPropagation();openLeadModal(\'' + r.id + '\')" style="padding:3px 10px;font-size:11px;">פרטים</button></td>' +
        '</tr>';
    }).join('');
}

// ==================== Cards View ====================

function renderLeadsCardsView(records) {
    var container = document.getElementById('ldCardsContainer');
    container.innerHTML = records.map(function(r) {
        var statusHtml = '<span class="ld-status ld-status-' + (r.status || 'new') + '">' + (LEAD_STATUS_LABELS[r.status] || 'חדש') + '</span>';
        var scoreHtml = renderScoreBadge(r.aiScore);
        var dupBadge = leadsDuplicateMap[r.id] ? '<span class="ld-dup-badge">כפול</span>' : '';

        return '<div class="bm-card" onclick="openLeadModal(\'' + r.id + '\')" style="cursor:pointer;">' +
            '<div class="bm-card-top">' +
                '<div>' +
                    '<div class="bm-card-name">' + escapeHTML(r.name || r.phone || 'ליד') + '</div>' +
                    '<div class="bm-card-case">' + escapeHTML(r.subject || '—') + ' | ' + formatLeadDate(r.createdAt) + '</div>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;">' + dupBadge + scoreHtml + statusHtml + '</div>' +
            '</div>' +
            '<div class="bm-card-body">' +
                '<div class="bm-card-field"><div class="bm-card-field-label">טלפון</div><div class="bm-card-field-value" style="direction:ltr;text-align:right;">' + escapeHTML(formatPhone(r.phone)) + '</div></div>' +
                '<div class="bm-card-field"><div class="bm-card-field-label">אחראי</div><div class="bm-card-field-value" style="color:var(--accent);">' + escapeHTML(r.assignedTo || 'לא שויך') + '</div></div>' +
                '<div class="bm-card-field"><div class="bm-card-field-label">מקור</div><div class="bm-card-field-value">' + escapeHTML(LEAD_SOURCE_LABELS[r.source] || r.source || '') + '</div></div>' +
            '</div>' +
        '</div>';
    }).join('');
}

// ==================== Kanban View ====================

function renderLeadsKanbanView(records) {
    var container = document.getElementById('ldKanbanContainer');
    var columns = [
        { key: 'new', label: LDI.new + ' חדש', items: [] },
        { key: 'active', label: LDI.contacted + ' בטיפול', items: [] },
        { key: 'followup', label: LDI.followup + ' פולואפ', items: [] },
        { key: 'closed', label: LDI.closed + ' נסגר', items: [] }
    ];

    records.forEach(function(r) {
        var st = r.status || 'new';
        if (st === 'new') columns[0].items.push(r);
        else if (st === 'assigned' || st === 'contacted' || st === 'no_answer') columns[1].items.push(r);
        else if (st === 'meeting_set' || st === 'followup') columns[2].items.push(r);
        else if (st === 'closed' || st === 'not_relevant') columns[3].items.push(r);
        else columns[0].items.push(r);
    });

    container.innerHTML = columns.map(function(col) {
        var cardsHtml = col.items.map(function(r) {
            return '<div class="ld-kanban-card" onclick="openLeadModal(\'' + r.id + '\')">' +
                '<div class="ld-kanban-card-name">' + escapeHTML(r.name || r.phone || 'ליד') + '</div>' +
                '<div class="ld-kanban-card-subject">' + escapeHTML(r.subject || '—') + '</div>' +
                '<div class="ld-kanban-card-footer">' +
                    '<span class="ld-kanban-card-assignee">' + escapeHTML(r.assignedTo || '') + '</span>' +
                    renderScoreBadge(r.aiScore) +
                '</div>' +
            '</div>';
        }).join('');

        return '<div class="ld-kanban-col">' +
            '<div class="ld-kanban-header">' + col.label + '<span class="ld-kanban-count">' + col.items.length + '</span></div>' +
            cardsHtml +
        '</div>';
    }).join('');
}

// ==================== Pagination ====================

function renderLeadsPagination(totalRecords, totalPages) {
    var container = document.getElementById('ldPagination');
    if (!container) return;

    // Don't touch the load-more button if it already exists (prevents observer loop)
    var existingLoadMore = document.getElementById('ldLoadMore');

    // Build page buttons
    var pagesHtml = '';
    if (totalPages > 1) {
        pagesHtml += '<div style="display:flex;justify-content:center;gap:4px;padding:12px;">';
        for (var p = 1; p <= totalPages; p++) {
            var active = p === leadsCurrentPage ? 'background:var(--accent);color:#fff;' : '';
            pagesHtml += '<button onclick="leadsGoToPage(' + p + ')" style="padding:4px 10px;border:1px solid var(--border-input);border-radius:var(--radius-sm);font-size:12px;cursor:pointer;' + active + '">' + p + '</button>';
        }
        pagesHtml += '</div>';
    }

    if (existingLoadMore) {
        // Only update page buttons, leave load-more button alone
        var pagesContainer = document.getElementById('ldPageButtons');
        if (pagesContainer) {
            pagesContainer.innerHTML = pagesHtml;
        }
        return;
    }

    // Full render (first time or after load-more removed itself)
    var html = '<div id="ldPageButtons">' + pagesHtml + '</div>';

    if (leadsHasMore) {
        html += '<div style="text-align:center;padding:8px 0 16px;">' +
            '<button id="ldLoadMore" onclick="loadMoreLeads()" style="padding:8px 24px;border:1px solid var(--border-input);border-radius:var(--radius-md);font-size:13px;font-family:Heebo,sans-serif;cursor:pointer;color:var(--accent);background:var(--bg-primary);">' +
            'טען עוד לידים (' + leadsRecords.length + ' טעונים)' +
            '</button></div>';
    }

    container.innerHTML = html;

}

function leadsGoToPage(page) {
    leadsCurrentPage = page;
    renderLeadsView();
}

// ==================== Lead Detail Modal ====================

function openLeadModal(docId) {
    currentLeadDocId = docId;
    var record = leadsRecords.find(function(r) { return r.id === docId; });
    if (!record) return;

    document.getElementById('ldModalTitle').textContent = record.name || record.phone || 'ליד';
    document.getElementById('ldModalPhone').textContent = formatPhone(record.phone);
    document.getElementById('ldModalSubject').textContent = record.subject || '—';
    document.getElementById('ldModalSource').textContent = LEAD_SOURCE_LABELS[record.source] || record.source || '—';
    document.getElementById('ldModalDate').textContent = formatLeadDateTime(record.createdAt);

    var emailVal = record.email || '';

    // Estimated value (display row)
    var valRow = document.getElementById('ldModalValueRow');
    var estVal = record.aiEstimatedValue || record.estimatedValue || '';
    if (estVal) {
        document.getElementById('ldModalValueDisplay').textContent = estVal;
        valRow.style.display = '';
    } else {
        valRow.style.display = 'none';
    }

    // Quick action buttons
    var phoneDigits = (record.phone || '').replace(/\D/g, '');
    var waDigits = phoneDigits.startsWith('0') ? '972' + phoneDigits.substring(1) : phoneDigits;
    document.getElementById('ldQuickCall').href = phoneDigits ? 'tel:' + phoneDigits : '#';
    document.getElementById('ldQuickWA').href = phoneDigits ? 'https://wa.me/' + waDigits : '#';
    var quickEmail = document.getElementById('ldQuickEmail');
    if (emailVal) {
        quickEmail.href = 'mailto:' + emailVal;
        quickEmail.style.display = '';
    } else {
        quickEmail.style.display = 'none';
    }

    // Editable fields
    document.getElementById('ldModalStatus').value = record.status || 'new';
    document.getElementById('ldModalAssignee').value = record.assignedTo || '';
    document.getElementById('ldModalNotes').value = record.statusNote || '';
    document.getElementById('ldModalCategory').value = record.aiCategory || record.category || '';
    document.getElementById('ldModalEmailInput').value = record.email || '';
    document.getElementById('ldModalCityInput').value = record.city || '';

    if (record.followupAt) {
        var d = record.followupAt.toDate ? record.followupAt.toDate() : new Date(record.followupAt);
        var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('ldModalFollowup').value = local;
    } else {
        document.getElementById('ldModalFollowup').value = '';
    }

    // Meta bar — age, contact attempts, followup reminder
    populateMetaBar(record);

    // Meeting info
    var meetSection = document.getElementById('ldModalMeetingSection');
    if (record.meetingDate) {
        var md = record.meetingDate.toDate ? record.meetingDate.toDate() : new Date(record.meetingDate);
        document.getElementById('ldModalMeetingDate').innerHTML = LDI.calendar + ' ' + md.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }) + ' ' + md.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        var mtEl = document.getElementById('ldModalMeetingType');
        mtEl.innerHTML = record.meetingType === 'online' ? LDI.monitor + ' פגישה מקוונת' : LDI.building + ' פגישה פיזית';
        var meetLink = document.getElementById('ldModalMeetLink');
        if (record.meetLink) {
            meetLink.href = record.meetLink;
            meetLink.style.display = '';
        } else {
            meetLink.style.display = 'none';
        }
        meetSection.style.display = '';
    } else {
        meetSection.style.display = 'none';
    }

    // AI Score
    var scoreEl = document.getElementById('ldModalScore');
    if (record.aiScore) {
        scoreEl.innerHTML = LDI.ai + ' ' + record.aiScore + '/10';
        scoreEl.className = 'ld-score-badge ld-score-' + (record.aiScore >= 7 ? 'high' : record.aiScore >= 4 ? 'med' : 'low');
        scoreEl.style.display = '';
    } else {
        scoreEl.style.display = 'none';
    }

    // AI Summary one-liner (visible in action zone)
    var aiSummary = document.getElementById('ldModalAISummary');
    var aiSummaryText = document.getElementById('ldModalAISummaryText');
    if (record.aiAction || record.aiReason) {
        aiSummaryText.innerHTML = LDI.ai + ' ' + escapeHTML(record.aiAction || record.aiReason || '');
        aiSummary.style.display = '';
    } else {
        aiSummary.style.display = 'none';
    }

    // AI Full Analysis (collapsible details)
    var aiDetails = document.getElementById('ldModalAIDetails');
    if (record.aiReason) {
        var aiHtml = '<p>' + escapeHTML(record.aiReason) + '</p>';
        if (record.aiAction) aiHtml += '<p style="margin-top:6px;font-weight:500;">' + LDI.lightbulb + ' ' + escapeHTML(record.aiAction) + '</p>';
        if (record.aiEstimatedValue) aiHtml += '<p style="margin-top:6px;">' + LDI.money + ' הערכת שווי: <strong>' + escapeHTML(record.aiEstimatedValue) + '</strong></p>';
        if (record.aiCallPrep) aiHtml += '<div style="margin-top:8px;padding:8px;background:rgba(59,130,246,0.04);border-radius:6px;"><div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:4px;">' + LDI.clipboard + ' הכנה לשיחה:</div><p style="margin:0;">' + escapeHTML(record.aiCallPrep) + '</p></div>';
        if (record.aiLegalContext) aiHtml += '<div style="margin-top:6px;font-size:12px;color:var(--text-tertiary);">' + LDI.scale + ' ' + escapeHTML(record.aiLegalContext) + '</div>';
        document.getElementById('ldModalAIContent').innerHTML = aiHtml;
        aiDetails.style.display = '';
    } else {
        aiDetails.style.display = 'none';
    }

    // Timeline (Phase 4)
    var historyEl = document.getElementById('ldModalHistory');
    historyEl.innerHTML = renderTimeline(record);

    // Original message
    var origEl = document.getElementById('ldModalOriginal');
    var origText = document.getElementById('ldModalOriginalText');
    if (record.originalMessage) {
        origText.textContent = record.originalMessage;
        origEl.style.display = '';
    } else {
        origEl.style.display = 'none';
    }

    // Enrichment: cross-collection data
    enrichLeadOnOpen(record);

    // Duplicate alert
    showDuplicateAlert(record);

    document.getElementById('leadDetailModal').style.display = 'flex';
}

function closeLeadModal() {
    document.getElementById('leadDetailModal').style.display = 'none';
    currentLeadDocId = null;
}

// ==================== Save Lead Update ====================

function saveLeadUpdate() {
    if (!currentLeadDocId) return;

    var newStatus = document.getElementById('ldModalStatus').value;
    var newAssignee = document.getElementById('ldModalAssignee').value;
    var newNotes = document.getElementById('ldModalNotes').value.trim();
    var newFollowup = document.getElementById('ldModalFollowup').value;
    var newCategory = document.getElementById('ldModalCategory').value;
    var newEmail = document.getElementById('ldModalEmailInput').value.trim();
    var newCity = document.getElementById('ldModalCityInput').value.trim();

    var updates = {
        status: newStatus,
        assignedTo: newAssignee || null,
        statusNote: '',
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        history: firebase.firestore.FieldValue.arrayUnion({
            action: newStatus,
            by: currentUser || 'web',
            at: new Date().toISOString(),
            note: newNotes || ('סטטוס: ' + (LEAD_STATUS_TEXT[newStatus] || newStatus))
        })
    };

    if (newAssignee) {
        updates.assignedAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    if (newFollowup) {
        updates.followupAt = new Date(newFollowup);
    } else {
        updates.followupAt = null;
    }

    // Save extra editable fields — aiCategory is the single source of truth for category
    if (newCategory) updates.aiCategory = newCategory;
    if (newEmail) updates.email = newEmail;
    if (newCity) updates.city = newCity;

    db.collection('leads').doc(currentLeadDocId).update(updates)
        .then(function() {
            closeLeadModal();
            logAuditEvent('lead_updated', { leadId: currentLeadDocId, status: newStatus, assignee: newAssignee });
        })
        .catch(function(err) {
            alert('שגיאה בשמירה: ' + err.message);
        });
}

// ==================== AI Scoring ====================

function scoreLead() {
    var docId = currentLeadDocId; // Capture before async chain
    if (!docId) return;
    var record = leadsRecords.find(function(r) { return r.id === docId; });
    if (!record) return;

    var btn = document.querySelector('.ld-modal-actions .ld-btn-secondary');
    if (btn) { btn.innerHTML = LDI.ai + ' מנתח...'; btn.disabled = true; }

    var authUser = firebase.auth().currentUser;
    if (!authUser) { alert('לא מחובר'); return; }

    authUser.getIdToken().then(function(idToken) {
        return fetch('/api/leads-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({
                action: 'score',
                lead: {
                    name: record.name || '',
                    subject: record.subject || '',
                    originalMessage: record.originalMessage || '',
                    source: record.source || '',
                    phone: record.phone || ''
                }
            })
        });
    }).then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.score) {
            db.collection('leads').doc(docId).update({
                aiScore: data.score,
                aiReason: data.reason || '',
                aiCategory: data.category || '',
                aiSuggestedAssignee: data.suggestedAssignee || '',
                aiUrgency: data.urgency || '',
                aiAction: data.action || '',
                aiCallPrep: data.callPrep || '',
                aiEstimatedValue: data.estimatedValue || '',
                aiLegalContext: data.legalContext || '',
                aiScoredAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function() {
                openLeadModal(docId);
            });
        }
    }).catch(function(err) {
        console.error('AI scoring error:', err);
        alert('שגיאה בניתוח AI: ' + err.message);
    }).finally(function() {
        if (btn) { btn.innerHTML = LDI.ai + ' נתח AI'; btn.disabled = false; }
    });
}

function scoreAllLeads() {
    var unscored = leadsRecords.filter(function(r) { return !r.aiScore && r.status !== 'not_relevant'; });
    if (unscored.length === 0) {
        alert('כל הלידים כבר נותחו');
        return;
    }
    if (!confirm('לנתח ' + unscored.length + ' לידים? (עלות API)')) return;

    var idx = 0;
    function next() {
        if (idx >= unscored.length) {
            alert('הניתוח הושלם!');
            return;
        }
        var leadToScore = unscored[idx];
        idx++;
        // Simple sequential scoring — does NOT mutate currentLeadDocId
        var authUser = firebase.auth().currentUser;
        if (!authUser) return;
        authUser.getIdToken().then(function(idToken) {
            return fetch('/api/leads-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                body: JSON.stringify({
                    action: 'score',
                    lead: {
                        name: leadToScore.name || '',
                        subject: leadToScore.subject || '',
                        originalMessage: leadToScore.originalMessage || '',
                        source: leadToScore.source || '',
                        phone: leadToScore.phone || ''
                    }
                })
            });
        }).then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.score) {
                return db.collection('leads').doc(leadToScore.id).update({
                    aiScore: data.score,
                    aiReason: data.reason || '',
                    aiCategory: data.category || '',
                    aiSuggestedAssignee: data.suggestedAssignee || '',
                    aiUrgency: data.urgency || '',
                    aiAction: data.action || '',
                    aiCallPrep: data.callPrep || '',
                    aiEstimatedValue: data.estimatedValue || '',
                    aiLegalContext: data.legalContext || '',
                    aiScoredAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }).then(function() {
            setTimeout(next, 500); // Rate limit
        }).catch(function() { setTimeout(next, 500); });
    }
    next();
}

// ==================== Export CSV ====================

function exportLeadsCSV() {
    var filtered = getFilteredLeads();
    if (filtered.length === 0) { alert('אין נתונים לייצוא'); return; }

    var headers = ['תאריך', 'שם', 'טלפון', 'נושא', 'מקור', 'AI Score', 'אחראי', 'סטטוס', 'הערות'];
    var rows = filtered.map(function(r) {
        return [
            formatLeadDate(r.createdAt),
            r.name || '',
            r.phone || '',
            r.subject || '',
            LEAD_SOURCE_LABELS[r.source] || r.source || '',
            r.aiScore || '',
            r.assignedTo || '',
            LEAD_STATUS_TEXT[r.status] || r.status || '',
            r.statusNote || ''
        ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });

    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'leads_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== Helpers ====================

function formatLeadDate(ts) {
    if (!ts) return '—';
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function formatLeadDateTime(ts) {
    if (!ts) return '—';
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function formatPhone(phone) {
    if (!phone) return '—';
    var digits = phone.replace(/\D/g, '');
    if (digits.startsWith('972') && digits.length >= 12) {
        digits = '0' + digits.substring(3);
    }
    if (digits.length === 10) {
        return digits.substring(0, 3) + '-' + digits.substring(3);
    }
    return phone;
}

function renderScoreBadge(score) {
    if (!score) return '<span class="ld-score ld-score-none">—</span>';
    var cls = score >= 7 ? 'high' : score >= 4 ? 'med' : 'low';
    return '<span class="ld-score ld-score-' + cls + '">' + LDI.ai + score + '</span>';
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== Delete Lead ====================

function deleteCurrentLead() {
    if (!currentLeadDocId) return;
    if (currentUserRole !== 'master') {
        alert('רק מנהל ראשי יכול למחוק לידים');
        return;
    }
    if (!confirm('למחוק את הליד הזה לצמיתות?')) return;

    var docIdToDelete = currentLeadDocId;
    db.collection('leads').doc(docIdToDelete).delete()
        .then(function() {
            logAuditEvent('lead_deleted', { leadId: docIdToDelete });
            closeLeadModal();
        })
        .catch(function(err) {
            alert('שגיאה במחיקה: ' + err.message);
        });
}

// ==================== My Leads Toggle ====================

function toggleMyLeads() {
    leadsMyMode = !leadsMyMode;
    updateMyLeadsToggle();
    filterLeadsView();
    updateMyDashboard();
}

function updateMyLeadsToggle() {
    var btn = document.getElementById('ldToggleMy');
    var text = document.getElementById('ldToggleMyText');
    var dashboard = document.getElementById('ldMyDashboard');
    if (btn) btn.classList.toggle('active', leadsMyMode);
    if (text) text.textContent = leadsMyMode ? 'כל הלידים' : 'הלידים שלי';
    if (dashboard) dashboard.style.display = leadsMyMode ? '' : 'none';
}

function updateMyDashboard() {
    if (!leadsMyMode || !currentUser) return;
    var now = new Date();
    var todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    var weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    var myLeads = leadsRecords.filter(function(r) { return r.assignedTo === currentUser; });

    var hot = myLeads.filter(function(r) {
        return (r.aiScore || 0) >= 7 && r.status !== 'closed' && r.status !== 'not_relevant';
    }).length;

    var followupsDue = myLeads.filter(function(r) {
        if (!r.followupAt) return false;
        var ft = r.followupAt.toDate ? r.followupAt.toDate() : new Date(r.followupAt);
        return ft <= now && r.status !== 'closed' && r.status !== 'not_relevant';
    }).length;

    var newToday = myLeads.filter(function(r) {
        var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
        return ts >= todayStart.getTime();
    }).length;

    var weekLeads = myLeads.filter(function(r) {
        var ts = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime()) : 0;
        return ts >= weekStart.getTime();
    });
    var weekClosed = weekLeads.filter(function(r) { return r.status === 'closed'; }).length;
    var weekConversion = weekLeads.length > 0 ? Math.round((weekClosed / weekLeads.length) * 100) : 0;

    var el = function(id) { return document.getElementById(id); };
    if (el('ldMyHot')) el('ldMyHot').textContent = hot;
    if (el('ldMyFollowup')) el('ldMyFollowup').textContent = followupsDue;
    if (el('ldMyNew')) el('ldMyNew').textContent = newToday;
    if (el('ldMyConversion')) el('ldMyConversion').textContent = weekClosed + ' (' + weekConversion + '%)';
}

// ==================== Quick Filter Chips ====================

function applyQuickFilter(type) {
    leadsQuickFilter = type;
    var chips = document.querySelectorAll('.ld-chip');
    chips.forEach(function(c) { c.classList.toggle('active', c.getAttribute('data-filter') === type); });
    filterLeadsView();
}

// ==================== Filter State Persistence ====================

function saveFilterState() {
    try {
        localStorage.setItem('ld_filters', JSON.stringify({
            search: document.getElementById('ldSearch').value || '',
            status: document.getElementById('ldFilterStatus').value || '',
            assignee: document.getElementById('ldFilterAssignee').value || '',
            score: (document.getElementById('ldFilterScore') || {}).value || '',
            category: (document.getElementById('ldFilterCategory') || {}).value || '',
            period: (document.getElementById('ldFilterPeriod') || {}).value || '',
            myMode: leadsMyMode,
            viewMode: leadsViewMode,
            quickFilter: leadsQuickFilter
        }));
    } catch(e) {}
}

function restoreFilterState() {
    try {
        var saved = JSON.parse(localStorage.getItem('ld_filters') || '{}');
        if (saved.search) document.getElementById('ldSearch').value = saved.search;
        if (saved.status) document.getElementById('ldFilterStatus').value = saved.status;
        if (saved.viewMode) setLeadsViewMode(saved.viewMode);
        if (saved.myMode !== undefined && currentUserRole === 'master') leadsMyMode = saved.myMode;
        if (saved.quickFilter) { leadsQuickFilter = saved.quickFilter; applyQuickFilter(saved.quickFilter); }
        var scoreEl = document.getElementById('ldFilterScore');
        if (scoreEl && saved.score) scoreEl.value = saved.score;
        var catEl = document.getElementById('ldFilterCategory');
        if (catEl && saved.category) catEl.value = saved.category;
        var periodEl = document.getElementById('ldFilterPeriod');
        if (periodEl && saved.period) {
            periodEl.value = saved.period;
            applyPeriodFilter();
        }
    } catch(e) {}
}

// ==================== Meta Bar ====================

function populateMetaBar(record) {
    // 1. Lead age — reuse relativeTime() for text
    var ageEl = document.getElementById('ldMetaAge');
    if (record.createdAt) {
        var created = record.createdAt.toDate ? record.createdAt.toDate() : new Date(record.createdAt);
        var diffMins = Math.floor((Date.now() - created.getTime()) / 60000);
        ageEl.innerHTML = LDI.clock + ' ' + relativeTime(record.createdAt);
        // Color: green if fresh (<1hr), amber if today, gray if older
        if (diffMins < 60) ageEl.className = 'ld-meta-item ld-meta-fresh';
        else if (diffMins < 1440) ageEl.className = 'ld-meta-item ld-meta-today';
        else ageEl.className = 'ld-meta-item';
    }

    // 2. Contact attempts — count from history
    var attemptsEl = document.getElementById('ldMetaAttempts');
    var attempts = 0;
    (record.history || []).forEach(function(h) {
        var a = h.action || '';
        if (a === 'contacted' || a === 'no_answer') attempts++;
    });
    if (attempts > 0) {
        attemptsEl.innerHTML = LDI.contacted + ' ' + attempts + ' ניסיונות קשר';
        if (attempts >= 3) attemptsEl.className = 'ld-meta-item ld-meta-warn';
        else attemptsEl.className = 'ld-meta-item';
        attemptsEl.style.display = '';
    } else {
        attemptsEl.style.display = 'none';
    }

    // 3. Followup reminder
    var fuEl = document.getElementById('ldMetaFollowup');
    if (record.followupAt) {
        var fuDate = record.followupAt.toDate ? record.followupAt.toDate() : new Date(record.followupAt);
        var fuDiff = fuDate.getTime() - Date.now();
        var fuText = '';
        if (fuDiff < 0) {
            fuText = LDI.followup + ' <strong style="color:var(--error);">פולואפ באיחור!</strong>';
        } else if (fuDiff < 3600000) {
            fuText = LDI.followup + ' <strong>פולואפ בעוד ' + Math.max(1, Math.round(fuDiff / 60000)) + ' דק׳</strong>';
        } else if (fuDiff < 86400000) {
            fuText = LDI.followup + ' פולואפ היום ב-' + fuDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        } else {
            fuText = LDI.followup + ' פולואפ ' + fuDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) + ' ' + fuDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        }
        fuEl.innerHTML = fuText;
        fuEl.className = fuDiff < 0 ? 'ld-meta-item ld-meta-overdue' : 'ld-meta-item ld-meta-followup';
        fuEl.style.display = '';
    } else {
        fuEl.style.display = 'none';
    }
}

// ==================== Period Filter ====================

function applyPeriodFilter() {
    var val = document.getElementById('ldFilterPeriod').value;
    var fromInput = document.getElementById('ldFilterDateFrom');
    var toInput = document.getElementById('ldFilterDateTo');

    if (val === 'custom') {
        fromInput.style.display = '';
        toInput.style.display = '';
        // Don't filter yet — wait for user to pick dates
        return;
    }

    // Hide custom date inputs for preset periods
    fromInput.style.display = 'none';
    toInput.style.display = 'none';

    if (!val) {
        fromInput.value = '';
        toInput.value = '';
        document.getElementById('ldPeriodStats').style.display = 'none';
        filterLeadsView();
        return;
    }

    var now = new Date();
    var fromDate, toDate;

    switch (val) {
        case 'this_month':
            fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
            toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'last_month':
            fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            toDate = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
        case 'this_quarter':
            var qStart = Math.floor(now.getMonth() / 3) * 3;
            fromDate = new Date(now.getFullYear(), qStart, 1);
            toDate = new Date(now.getFullYear(), qStart + 3, 0);
            break;
        case 'last_quarter':
            var qStart2 = Math.floor(now.getMonth() / 3) * 3 - 3;
            var qYear = now.getFullYear();
            if (qStart2 < 0) { qStart2 += 12; qYear--; }
            fromDate = new Date(qYear, qStart2, 1);
            toDate = new Date(qYear, qStart2 + 3, 0);
            break;
        case 'this_year':
            fromDate = new Date(now.getFullYear(), 0, 1);
            toDate = new Date(now.getFullYear(), 11, 31);
            break;
        case 'last_year':
            fromDate = new Date(now.getFullYear() - 1, 0, 1);
            toDate = new Date(now.getFullYear() - 1, 11, 31);
            break;
    }

    if (fromDate && toDate) {
        fromInput.value = fromDate.toISOString().substring(0, 10);
        toInput.value = toDate.toISOString().substring(0, 10);
    }

    var filtered = filterLeadsView();
    updatePeriodStats(filtered);
}

function onCustomDateChange() {
    var filtered = filterLeadsView();
    updatePeriodStats(filtered);
}

function updatePeriodStats(filtered) {
    var periodVal = document.getElementById('ldFilterPeriod').value;
    var statsEl = document.getElementById('ldPeriodStats');
    if (!periodVal) { statsEl.style.display = 'none'; return; }

    if (!filtered) filtered = getFilteredLeads();
    var total = filtered.length;
    var closed = 0;
    var notRelevant = 0;

    filtered.forEach(function(r) {
        if (r.status === 'closed') closed++;
        if (r.status === 'not_relevant') notRelevant++;
    });

    var conversion = total > 0 ? Math.round((closed / total) * 100) : 0;

    // Period label
    var periodLabels = {
        'this_month': 'החודש הזה',
        'last_month': 'חודש שעבר',
        'this_quarter': 'הרבעון הזה',
        'last_quarter': 'רבעון שעבר',
        'this_year': 'השנה',
        'last_year': 'שנה שעברה',
        'custom': 'טווח מותאם'
    };
    document.getElementById('ldPeriodLabel').textContent = periodLabels[periodVal] || '';
    document.getElementById('ldPeriodTotal').textContent = total;
    document.getElementById('ldPeriodClosed').textContent = closed;
    document.getElementById('ldPeriodNotRelevant').textContent = notRelevant;
    document.getElementById('ldPeriodConversion').textContent = conversion + '%';
    statsEl.style.display = '';
}

// ==================== Timeline (Phase 4) ====================

function renderTimeline(record) {
    var events = [];

    if (record.createdAt) {
        events.push({ icon: LDI.new, color: '#3b82f6', text: 'ליד נוצר', detail: 'מקור: ' + (LEAD_SOURCE_LABELS[record.source] || record.source || 'לא ידוע'), at: record.createdAt });
    }
    if (record.aiScoredAt) {
        events.push({ icon: LDI.ai, color: '#8b5cf6', text: 'ניתוח AI: ' + (record.aiScore || '?') + '/10', detail: record.aiReason || '', at: record.aiScoredAt });
    }

    (record.history || []).forEach(function(h) {
        var icon = LDI.edit, color = '#6b7280';
        var action = h.action || '';
        if (action === 'assigned' || action === 'created' || (h.note && h.note.indexOf('שויך') !== -1)) { icon = LDI.assigned; color = '#8b5cf6'; }
        else if (action === 'contacted') { icon = LDI.contacted; color = '#f59e0b'; }
        else if (action === 'meeting_set') { icon = LDI.calendar; color = '#8b5cf6'; }
        else if (action === 'closed') { icon = LDI.closed; color = '#10b981'; }
        else if (action === 'followup') { icon = LDI.followup; color = '#06b6d4'; }
        else if (action === 'not_relevant') { icon = LDI.not_relevant; color = '#ef4444'; }
        else if (action === 'no_answer') { icon = LDI.no_answer; color = '#6b7280'; }
        else if (action === 'imported') { icon = LDI.imported; color = '#94a3b8'; }

        events.push({ icon: icon, color: color, text: h.note || (LEAD_STATUS_LABELS[action] || action), detail: h.by ? 'ע"י ' + h.by : '', at: h.at });
    });

    events.sort(function(a, b) { return parseTimestamp(b.at) - parseTimestamp(a.at); });

    if (events.length === 0) return '<div style="font-size:12px;color:var(--text-quaternary);">אין היסטוריה</div>';

    return events.map(function(ev) {
        return '<div class="ld-timeline-item">' +
            '<div class="ld-timeline-dot" style="background:' + ev.color + ';">' + ev.icon + '</div>' +
            '<div class="ld-timeline-content">' +
                '<div class="ld-timeline-text">' + escapeHTML(ev.text) + '</div>' +
                (ev.detail ? '<div class="ld-timeline-detail">' + escapeHTML(ev.detail) + '</div>' : '') +
                '<div class="ld-timeline-time">' + relativeTime(ev.at) + '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

function relativeTime(ts) {
    if (!ts) return '';
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    var diff = Date.now() - d.getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'עכשיו';
    if (mins < 60) return 'לפני ' + mins + ' דק׳';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return 'לפני ' + hours + ' שעות';
    var days = Math.floor(hours / 24);
    if (days === 1) return 'אתמול';
    if (days < 7) return 'לפני ' + days + ' ימים';
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseTimestamp(ts) {
    if (!ts) return 0;
    if (ts.toDate) return ts.toDate().getTime();
    return new Date(ts).getTime();
}

// ==================== Notifications (Phase 5) ====================

function showLeadNotification(data) {
    if ('Notification' in window && Notification.permission === 'granted') {
        var n = new Notification('🔥 ליד חם חדש!', {
            body: (data.name || 'ליד') + ' — ' + (data.subject || '') + ' (⭐' + data.aiScore + ')',
            icon: '/assets/logo.png',
            tag: 'lead-' + Date.now()
        });
        setTimeout(function() { n.close(); }, 8000);
    }
}

function updateLeadsBadge(count) {
    var btn = document.getElementById('navLeadsMgmtBtn');
    if (!btn) return;
    var badge = btn.querySelector('.ld-nav-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'ld-nav-badge';
            btn.style.position = 'relative';
            btn.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = '';
    } else if (badge) {
        badge.style.display = 'none';
    }
}

// ==================== Quick Actions (Phase 6) ====================

function openWhatsApp(phone) {
    var digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '972' + digits.substring(1);
    window.open('https://wa.me/' + digits, '_blank');
}

function toggleSelectAllLeads(el) {
    var checks = document.querySelectorAll('.ld-row-check');
    checks.forEach(function(cb) { cb.checked = el.checked; });
    updateBulkBar();
}

function updateBulkBar() {
    var checked = document.querySelectorAll('.ld-row-check:checked');
    var bar = document.getElementById('ldBulkBar');
    if (!bar) return;
    if (checked.length > 0) {
        bar.style.display = '';
        document.getElementById('ldBulkCount').textContent = checked.length;
    } else {
        bar.style.display = 'none';
    }
}

function clearBulkSelection() {
    var checks = document.querySelectorAll('.ld-row-check');
    checks.forEach(function(cb) { cb.checked = false; });
    var selectAll = document.getElementById('ldSelectAll');
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
}

function executeBulkAction() {
    var checked = document.querySelectorAll('.ld-row-check:checked');
    if (checked.length === 0) return;
    var newStatus = document.getElementById('ldBulkStatus').value;
    var newAssignee = document.getElementById('ldBulkAssignee').value;
    if (!newStatus && !newAssignee) { alert('בחר סטטוס או אחראי'); return; }
    if (!confirm('לעדכן ' + checked.length + ' לידים?')) return;

    var batch = db.batch();
    checked.forEach(function(cb) {
        var ref = db.collection('leads').doc(cb.value);
        var updates = { lastUpdated: firebase.firestore.FieldValue.serverTimestamp() };
        if (newStatus) updates.status = newStatus;
        if (newAssignee) { updates.assignedTo = newAssignee; updates.assignedAt = firebase.firestore.FieldValue.serverTimestamp(); }
        updates.history = firebase.firestore.FieldValue.arrayUnion({
            action: newStatus || 'bulk_assign',
            by: currentUser || 'web',
            at: new Date().toISOString(),
            note: 'עדכון מרובה' + (newStatus ? ' — ' + (LEAD_STATUS_TEXT[newStatus] || newStatus) : '') + (newAssignee ? ' ← ' + newAssignee : '')
        });
        batch.update(ref, updates);
    });

    batch.commit().then(function() {
        clearBulkSelection();
        logAuditEvent('leads_bulk_update', { count: checked.length, status: newStatus, assignee: newAssignee });
    }).catch(function(err) {
        alert('שגיאה: ' + err.message);
    });
}

// ==================== Auto AI Scoring (Phase 3) ====================

function processAutoScoreQueue() {
    if (autoScoreRunning || autoScoreQueue.length === 0) return;
    autoScoreRunning = true;

    var docId = autoScoreQueue.shift();
    var record = leadsRecords.find(function(r) { return r.id === docId; });
    if (!record || record.aiScore) {
        autoScoreRunning = false;
        if (autoScoreQueue.length > 0) setTimeout(processAutoScoreQueue, 2000);
        return;
    }

    var authUser = firebase.auth().currentUser;
    if (!authUser) { autoScoreRunning = false; return; }

    authUser.getIdToken().then(function(idToken) {
        return fetch('/api/leads-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({
                action: 'score',
                lead: { name: record.name || '', subject: record.subject || '', originalMessage: record.originalMessage || '', source: record.source || '', phone: record.phone || '' }
            })
        });
    }).then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.score) {
            return db.collection('leads').doc(docId).update({
                aiScore: data.score, aiReason: data.reason || '', aiCategory: data.category || '',
                aiSuggestedAssignee: data.suggestedAssignee || '', aiUrgency: data.urgency || '',
                aiAction: data.action || '', aiCallPrep: data.callPrep || '',
                aiEstimatedValue: data.estimatedValue || '', aiLegalContext: data.legalContext || '',
                aiScoredAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    }).catch(function(err) {
        console.error('Auto-score error:', err);
    }).finally(function() {
        autoScoreRunning = false;
        if (autoScoreQueue.length > 0) setTimeout(processAutoScoreQueue, 20000);
    });
}

// ==================== Analytics Dashboard ====================

var leadsChartsInitialized = false;
var leadsChartInstances = {};
var leadsAllRecords = null; // Full dataset for analytics (loaded once)

function toggleAnalytics() {
    var body = document.getElementById('ldAnalyticsBody');
    var icon = document.getElementById('ldAnalyticsToggleIcon');
    if (!body) return;

    if (body.style.display === 'none') {
        body.style.display = '';
        icon.textContent = '▲';
        loadAllLeadsForAnalytics();
    } else {
        body.style.display = 'none';
        icon.textContent = '▼';
    }
}

function loadAllLeadsForAnalytics() {
    // If already loaded, just render
    if (leadsAllRecords) {
        renderLeadsCharts(leadsAllRecords);
        return;
    }

    // Rolling window: last 90 days only (fast — ~500 docs max instead of 6,800+)
    var ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    db.collection('leads')
        .where('createdAt', '>', ninetyDaysAgo)
        .orderBy('createdAt', 'desc')
        .limit(1000)
        .get().then(function(snapshot) {
        leadsAllRecords = [];
        snapshot.forEach(function(doc) {
            leadsAllRecords.push(Object.assign({ id: doc.id }, doc.data()));
        });
        console.log('[Analytics] Loaded ' + leadsAllRecords.length + ' leads (90 days) for charts');
        renderLeadsCharts(leadsAllRecords);
    }).catch(function(err) {
        console.error('[Analytics] Load error:', err);
        // Fallback to current dataset
        renderLeadsCharts(leadsRecords);
    });
}

function renderLeadsCharts(records) {
    if (typeof Chart === 'undefined') return;
    if (!records || records.length === 0) return;

    // Set global Chart.js defaults for RTL
    Chart.defaults.font.family = "'Heebo', sans-serif";
    Chart.defaults.font.size = 12;

    renderWeeklyChart(records);
    renderSourcesChart(records);
    renderStatusChart(records);
    renderAssigneesChart(records);
    renderConversionChart(records);
    renderFunnelChart(records);
    leadsChartsInitialized = true;
}

// Destroy existing chart before creating new one
function getChartCtx(canvasId) {
    if (leadsChartInstances[canvasId]) {
        leadsChartInstances[canvasId].destroy();
    }
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    return canvas.getContext('2d');
}

// ---- Chart 1: Leads per week (bar) ----
function renderWeeklyChart(records) {
    var ctx = getChartCtx('ldChartWeekly');
    if (!ctx) return;

    // Group by week
    var weekMap = {};
    var now = new Date();
    records.forEach(function(r) {
        var d = r.createdAt;
        if (!d) return;
        if (d.toDate) d = d.toDate();
        else if (typeof d === 'string') d = new Date(d);
        if (isNaN(d.getTime())) return;

        // Week start (Sunday)
        var weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        var key = weekStart.toISOString().substring(0, 10);
        weekMap[key] = (weekMap[key] || 0) + 1;
    });

    // Sort by date, take last 12 weeks
    var sorted = Object.keys(weekMap).sort();
    var last12 = sorted.slice(-12);

    var labels = last12.map(function(k) {
        var d = new Date(k);
        return d.getDate() + '/' + (d.getMonth() + 1);
    });
    var data = last12.map(function(k) { return weekMap[k]; });

    leadsChartInstances['ldChartWeekly'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'לידים',
                data: data,
                backgroundColor: 'rgba(59,130,246,0.6)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ---- Chart 2: Sources (doughnut) ----
function renderSourcesChart(records) {
    var ctx = getChartCtx('ldChartSources');
    if (!ctx) return;

    var sourceMap = {};
    records.forEach(function(r) {
        var src = r.source || 'לא ידוע';
        // Normalize common sources
        if (src === 'crm-import') src = 'CRM ישן';
        else if (src === 'email') src = 'אימייל';
        else if (src === 'whatsapp') src = 'וואטסאפ';
        sourceMap[src] = (sourceMap[src] || 0) + 1;
    });

    // Sort by count, take top 8
    var sorted = Object.entries(sourceMap).sort(function(a, b) { return b[1] - a[1]; });
    var top = sorted.slice(0, 8);
    if (sorted.length > 8) {
        var otherCount = sorted.slice(8).reduce(function(s, e) { return s + e[1]; }, 0);
        top.push(['אחר', otherCount]);
    }

    var colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#94a3b8'];

    leadsChartInstances['ldChartSources'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(function(e) { return e[0]; }),
            datasets: [{
                data: top.map(function(e) { return e[1]; }),
                backgroundColor: colors.slice(0, top.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { padding: 12, font: { size: 11 } } }
            }
        }
    });
}

// ---- Chart 3: Status distribution (doughnut) ----
function renderStatusChart(records) {
    var ctx = getChartCtx('ldChartStatus');
    if (!ctx) return;

    var statusMap = {};
    records.forEach(function(r) {
        var st = r.status || 'new';
        var label = LEAD_STATUS_TEXT[st] || st;
        statusMap[label] = (statusMap[label] || 0) + 1;
    });

    var statusColors = {
        'חדש': '#3b82f6',
        'שויך': '#8b5cf6',
        'נוצר קשר': '#f59e0b',
        'נקבעה פגישה': '#8b5cf6',
        'פולואפ': '#06b6d4',
        'לא ענה': '#6b7280',
        'נסגר': '#10b981',
        'לא רלוונטי': '#ef4444'
    };

    var labels = Object.keys(statusMap);
    var data = labels.map(function(l) { return statusMap[l]; });
    var bgColors = labels.map(function(l) { return statusColors[l] || '#94a3b8'; });

    leadsChartInstances['ldChartStatus'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { padding: 12, font: { size: 11 } } }
            }
        }
    });
}

// ---- Chart 4: Assignee performance (horizontal bar) ----
function renderAssigneesChart(records) {
    var ctx = getChartCtx('ldChartAssignees');
    if (!ctx) return;

    var assigneeMap = {};
    var closedMap = {};
    records.forEach(function(r) {
        var a = r.assignedTo || '';
        if (!a) return;
        assigneeMap[a] = (assigneeMap[a] || 0) + 1;
        if (r.status === 'closed') closedMap[a] = (closedMap[a] || 0) + 1;
    });

    // Sort by total, take top 10
    var sorted = Object.entries(assigneeMap).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);

    var labels = sorted.map(function(e) { return e[0]; });
    var totalData = sorted.map(function(e) { return e[1]; });
    var closedData = labels.map(function(l) { return closedMap[l] || 0; });

    leadsChartInstances['ldChartAssignees'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'סה"כ לידים',
                    data: totalData,
                    backgroundColor: 'rgba(59,130,246,0.6)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'נסגרו בהצלחה',
                    data: closedData,
                    backgroundColor: 'rgba(16,185,129,0.6)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 11 } } }
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: { grid: { display: false } }
            }
        }
    });
}

// ---- Chart 5: Conversion rate by source (bar) ----
function renderConversionChart(records) {
    var ctx = getChartCtx('ldChartConversion');
    if (!ctx) return;

    var sourceTotal = {};
    var sourceClosed = {};
    records.forEach(function(r) {
        var src = r.source || 'לא ידוע';
        if (src === 'crm-import') src = 'CRM ישן';
        else if (src === 'email') src = 'אימייל';
        else if (src === 'whatsapp') src = 'וואטסאפ';
        sourceTotal[src] = (sourceTotal[src] || 0) + 1;
        if (r.status === 'closed') sourceClosed[src] = (sourceClosed[src] || 0) + 1;
    });

    // Only sources with 5+ leads, sorted by conversion rate
    var entries = Object.entries(sourceTotal)
        .filter(function(e) { return e[1] >= 5; })
        .map(function(e) {
            var closed = sourceClosed[e[0]] || 0;
            return { source: e[0], total: e[1], closed: closed, rate: Math.round((closed / e[1]) * 100) };
        })
        .sort(function(a, b) { return b.rate - a.rate; })
        .slice(0, 10);

    var labels = entries.map(function(e) { return e.source + ' (' + e.total + ')'; });
    var data = entries.map(function(e) { return e.rate; });

    var barColors = data.map(function(r) {
        if (r >= 10) return 'rgba(16,185,129,0.7)';
        if (r >= 5) return 'rgba(245,158,11,0.7)';
        return 'rgba(239,68,68,0.5)';
    });

    leadsChartInstances['ldChartConversion'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'אחוז המרה %',
                data: data,
                backgroundColor: barColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { callback: function(v) { return v + '%'; } } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ---- Chart 6: Conversion Funnel ----
function renderFunnelChart(records) {
    var ctx = getChartCtx('ldChartFunnel');
    if (!ctx) return;

    var total = records.length;
    var contactedCount = records.filter(function(r) {
        return ['contacted', 'meeting_set', 'followup', 'closed', 'assigned'].indexOf(r.status) !== -1;
    }).length;
    var closedCount = records.filter(function(r) { return r.status === 'closed'; }).length;

    leadsChartInstances['ldChartFunnel'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['נכנסו (' + total + ')', 'נוצר קשר (' + contactedCount + ')', 'נסגרו (' + closedCount + ')'],
            datasets: [{
                data: [total, contactedCount, closedCount],
                backgroundColor: ['rgba(59,130,246,0.6)', 'rgba(245,158,11,0.6)', 'rgba(16,185,129,0.6)'],
                borderRadius: 4,
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            var dropoff = ctx.dataIndex > 0 ? ' (נשירה: ' + Math.round((1 - ctx.raw / total) * 100) + '%)' : '';
                            return ctx.raw + ' לידים' + dropoff;
                        }
                    }
                }
            },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }
        }
    });
}
