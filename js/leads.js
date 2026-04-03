// ==================== Leads CRM Management ====================
// Loads leads from Firestore, renders table/cards/kanban, AI scoring

var leadsRecords = [];
var leadsViewMode = 'table';
var leadsCurrentPage = 1;
var LEADS_PAGE_SIZE = 20;
var leadsDataLoaded = false;
var leadsRealtimeUnsubscribe = null;
var currentLeadDocId = null;

// ==================== Status Labels ====================

var LEAD_STATUS_LABELS = {
    'new': '🆕 חדש',
    'assigned': '👤 שויך',
    'contacted': '📞 נוצר קשר',
    'followup': '🔄 פולואפ',
    'no_answer': '📵 לא ענה',
    'closed': '✅ נסגר',
    'not_relevant': '❌ לא רלוונטי'
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

// ==================== Show / Hide ====================

function showLeadsManagement() {
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('leadsManagement').classList.add('active');
    if (!leadsDataLoaded) {
        loadLeadsData();
    }
}

function hideLeadsManagement() {
    var el = document.getElementById('leadsManagement');
    if (el) el.classList.remove('active');
    if (leadsRealtimeUnsubscribe) {
        leadsRealtimeUnsubscribe();
        leadsRealtimeUnsubscribe = null;
    }
}

// ==================== Load Data ====================

function loadLeadsData() {
    var loading = document.getElementById('ldLoading');
    if (loading) loading.style.display = '';

    try {
        // Use realtime listener for live updates
        leadsRealtimeUnsubscribe = db.collection('leads')
            .orderBy('createdAt', 'desc')
            .limit(500)
            .onSnapshot(function(snapshot) {
                leadsRecords = [];
                snapshot.forEach(function(doc) {
                    leadsRecords.push(Object.assign({ id: doc.id }, doc.data()));
                });

                leadsDataLoaded = true;
                if (loading) loading.style.display = 'none';

                if (leadsRecords.length === 0) {
                    document.getElementById('ldEmpty').style.display = '';
                    return;
                }
                document.getElementById('ldEmpty').style.display = 'none';

                populateLeadsFilters();
                updateLeadsSummary(leadsRecords);
                renderLeadsView();
                // Refresh charts if analytics panel is open (invalidate cache to reload)
                var analyticsBody = document.getElementById('ldAnalyticsBody');
                if (analyticsBody && analyticsBody.style.display !== 'none') {
                    leadsAllRecords = null;
                    loadAllLeadsForAnalytics();
                }
            }, function(error) {
                console.error('Leads listener error:', error);
                if (loading) loading.innerHTML = '<p style="color:var(--error);">שגיאה בטעינת לידים</p>';
            });
    } catch (err) {
        console.error('Load leads error:', err);
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
        else if (st === 'assigned' || st === 'contacted' || st === 'followup' || st === 'no_answer') activeCount++;
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
    var filtered = leadsRecords;

    var search = (document.getElementById('ldSearch').value || '').trim().toLowerCase();
    if (search) {
        filtered = filtered.filter(function(r) {
            return (r.name || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.phone || '').indexOf(search) !== -1 ||
                   (r.subject || '').toLowerCase().indexOf(search) !== -1 ||
                   (r.assignedTo || '').toLowerCase().indexOf(search) !== -1;
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

    return filtered;
}

function filterLeadsView() {
    leadsCurrentPage = 1;
    var filtered = getFilteredLeads();
    updateLeadsSummary(filtered);
    renderLeadsView();
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

function renderLeadsView() {
    var filtered = getFilteredLeads();
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
    tbody.innerHTML = records.map(function(r, idx) {
        var rowNum = (startIdx || 0) + idx + 1;
        var dateStr = formatLeadDate(r.createdAt);
        var statusHtml = '<span class="ld-status ld-status-' + (r.status || 'new') + '">' + (LEAD_STATUS_LABELS[r.status] || r.status || 'חדש') + '</span>';
        var scoreHtml = renderScoreBadge(r.aiScore);
        var sourceLabel = LEAD_SOURCE_LABELS[r.source] || r.source || '';

        return '<tr onclick="openLeadModal(\'' + r.id + '\')" style="cursor:pointer;">' +
            '<td style="font-size:12px;color:var(--text-quaternary);text-align:center;">' + rowNum + '</td>' +
            '<td style="font-size:12px;color:var(--text-tertiary);">' + dateStr + '</td>' +
            '<td class="ld-name-cell">' + escapeHTML(r.name || r.phone || '—') + '</td>' +
            '<td class="ld-phone-cell">' + escapeHTML(formatPhone(r.phone)) + '</td>' +
            '<td style="font-size:12px;color:var(--text-secondary);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(r.subject || '—') + '</td>' +
            '<td class="ld-source">' + escapeHTML(sourceLabel) + '</td>' +
            '<td>' + scoreHtml + '</td>' +
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

        return '<div class="bm-card" onclick="openLeadModal(\'' + r.id + '\')" style="cursor:pointer;">' +
            '<div class="bm-card-top">' +
                '<div>' +
                    '<div class="bm-card-name">' + escapeHTML(r.name || r.phone || 'ליד') + '</div>' +
                    '<div class="bm-card-case">' + escapeHTML(r.subject || '—') + ' | ' + formatLeadDate(r.createdAt) + '</div>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;">' + scoreHtml + statusHtml + '</div>' +
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
        { key: 'new', label: '🆕 חדש', items: [] },
        { key: 'active', label: '📞 בטיפול', items: [] },
        { key: 'followup', label: '🔄 פולואפ', items: [] },
        { key: 'closed', label: '✅ נסגר', items: [] }
    ];

    records.forEach(function(r) {
        var st = r.status || 'new';
        if (st === 'new') columns[0].items.push(r);
        else if (st === 'assigned' || st === 'contacted' || st === 'no_answer') columns[1].items.push(r);
        else if (st === 'followup') columns[2].items.push(r);
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
    if (!container || totalPages <= 1) {
        if (container) container.innerHTML = '';
        return;
    }

    var html = '<div style="display:flex;justify-content:center;gap:4px;padding:12px;">';
    for (var p = 1; p <= totalPages; p++) {
        var active = p === leadsCurrentPage ? 'background:var(--accent);color:#fff;' : '';
        html += '<button onclick="leadsGoToPage(' + p + ')" style="padding:4px 10px;border:1px solid var(--border-input);border-radius:var(--radius-sm);font-size:12px;cursor:pointer;' + active + '">' + p + '</button>';
    }
    html += '</div>';
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

    document.getElementById('ldModalStatus').value = record.status || 'new';
    document.getElementById('ldModalAssignee').value = record.assignedTo || '';
    document.getElementById('ldModalNotes').value = record.statusNote || '';

    if (record.followupAt) {
        var d = record.followupAt.toDate ? record.followupAt.toDate() : new Date(record.followupAt);
        var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('ldModalFollowup').value = local;
    } else {
        document.getElementById('ldModalFollowup').value = '';
    }

    // AI Score
    var scoreEl = document.getElementById('ldModalScore');
    if (record.aiScore) {
        scoreEl.textContent = '⭐ ' + record.aiScore + '/10';
        scoreEl.className = 'ld-score-badge ld-score-' + (record.aiScore >= 7 ? 'high' : record.aiScore >= 4 ? 'med' : 'low');
        scoreEl.style.display = '';
    } else {
        scoreEl.style.display = 'none';
    }

    // AI Analysis
    var aiBox = document.getElementById('ldModalAI');
    if (record.aiReason) {
        document.getElementById('ldModalAIContent').innerHTML = '<p>' + escapeHTML(record.aiReason) + '</p>' +
            (record.aiAction ? '<p style="margin-top:6px;font-weight:500;">💡 ' + escapeHTML(record.aiAction) + '</p>' : '');
        aiBox.style.display = '';
    } else {
        aiBox.style.display = 'none';
    }

    // History
    var historyEl = document.getElementById('ldModalHistory');
    var history = record.history || [];
    if (history.length > 0) {
        historyEl.innerHTML = history.slice().reverse().map(function(h) {
            var time = h.at ? new Date(h.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            return '<div class="ld-history-item">' +
                '<span class="ld-history-time">' + time + '</span>' +
                '<span class="ld-history-text">' + escapeHTML((h.by || '') + ': ' + (h.note || h.action || '')) + '</span>' +
            '</div>';
        }).join('');
    } else {
        historyEl.innerHTML = '<div style="font-size:12px;color:var(--text-quaternary);">אין היסטוריה</div>';
    }

    // Original message
    var origEl = document.getElementById('ldModalOriginal');
    var origText = document.getElementById('ldModalOriginalText');
    if (record.originalMessage) {
        origText.textContent = record.originalMessage;
        origEl.style.display = '';
    } else {
        origEl.style.display = 'none';
    }

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

    var updates = {
        status: newStatus,
        assignedTo: newAssignee || null,
        statusNote: newNotes,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        history: firebase.firestore.FieldValue.arrayUnion({
            action: newStatus,
            by: currentUser || 'web',
            at: new Date().toISOString(),
            note: newNotes || ('סטטוס: ' + (LEAD_STATUS_LABELS[newStatus] || newStatus))
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
    if (!currentLeadDocId) return;
    var record = leadsRecords.find(function(r) { return r.id === currentLeadDocId; });
    if (!record) return;

    var btn = document.querySelector('.ld-modal-actions .ld-btn-secondary');
    if (btn) { btn.textContent = '🤖 מנתח...'; btn.disabled = true; }

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
            db.collection('leads').doc(currentLeadDocId).update({
                aiScore: data.score,
                aiReason: data.reason || '',
                aiCategory: data.category || '',
                aiSuggestedAssignee: data.suggestedAssignee || '',
                aiUrgency: data.urgency || '',
                aiAction: data.action || '',
                aiScoredAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function() {
                openLeadModal(currentLeadDocId);
            });
        }
    }).catch(function(err) {
        console.error('AI scoring error:', err);
        alert('שגיאה בניתוח AI: ' + err.message);
    }).finally(function() {
        if (btn) { btn.textContent = '🤖 נתח AI'; btn.disabled = false; }
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
        currentLeadDocId = unscored[idx].id;
        idx++;
        // Simple sequential scoring
        var authUser = firebase.auth().currentUser;
        if (!authUser) return;
        authUser.getIdToken().then(function(idToken) {
            return fetch('/api/leads-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                body: JSON.stringify({
                    action: 'score',
                    lead: {
                        name: unscored[idx - 1].name || '',
                        subject: unscored[idx - 1].subject || '',
                        originalMessage: unscored[idx - 1].originalMessage || '',
                        source: unscored[idx - 1].source || ''
                    }
                })
            });
        }).then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.score) {
                return db.collection('leads').doc(unscored[idx - 1].id).update({
                    aiScore: data.score,
                    aiReason: data.reason || '',
                    aiCategory: data.category || '',
                    aiSuggestedAssignee: data.suggestedAssignee || '',
                    aiUrgency: data.urgency || '',
                    aiAction: data.action || ''
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
            LEAD_STATUS_LABELS[r.status] || r.status || '',
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
    return '<span class="ld-score ld-score-' + cls + '">⭐' + score + '</span>';
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    // Load ALL leads (no limit) for full analytics
    db.collection('leads').orderBy('createdAt', 'desc').get().then(function(snapshot) {
        leadsAllRecords = [];
        snapshot.forEach(function(doc) {
            leadsAllRecords.push(Object.assign({ id: doc.id }, doc.data()));
        });
        console.log('[Analytics] Loaded ' + leadsAllRecords.length + ' leads for charts');
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
        var label = LEAD_STATUS_LABELS[st] || st;
        statusMap[label] = (statusMap[label] || 0) + 1;
    });

    var statusColors = {
        '🆕 חדש': '#3b82f6',
        '👤 שויך': '#8b5cf6',
        '📞 נוצר קשר': '#f59e0b',
        '🔄 פולואפ': '#06b6d4',
        '📵 לא ענה': '#6b7280',
        '✅ נסגר': '#10b981',
        '❌ לא רלוונטי': '#ef4444'
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
