// Company Lookup — Israeli Registrar of Companies (רשות התאגידים)
// Auto-fills company name + address when user enters a ח.פ. (company number)

var _companyLookupTimeout = null;
var _companyLookupCache = {};

// Detect if a number is likely a company number (ח.פ.) vs personal ID (ת.ז.)
// Company numbers: 51-xxxxxxx (private), 52-xxxxxxx (public), 58-xxxxxxx (amutot), etc.
// Personal IDs: pass Luhn check with 9 digits padded
function isLikelyCompanyNumber(digits) {
    if (digits.length < 8 || digits.length > 9) return false;
    // Company numbers typically start with 51, 52, 53, 54, 55, 56, 57, 58, 59
    var padded = digits.padStart(9, '0');
    var prefix = padded.substring(0, 2);
    return prefix >= '51' && prefix <= '59';
}

async function lookupCompany(companyNumber, targetFields) {
    var digits = companyNumber.replace(/\D/g, '');
    if (digits.length < 5 || digits.length > 9) return null;

    // Check cache
    if (_companyLookupCache[digits]) {
        applyCompanyData(_companyLookupCache[digits], targetFields);
        return _companyLookupCache[digits];
    }

    try {
        var response = await fetch('/api/company-lookup?q=' + encodeURIComponent(digits));
        if (!response.ok) return null;

        var data = await response.json();
        if (!data.found) return null;

        // Cache result
        _companyLookupCache[digits] = data;

        applyCompanyData(data, targetFields);
        return data;
    } catch (err) {
        console.error('Company lookup failed:', err);
        return null;
    }
}

function applyCompanyData(data, targetFields) {
    // Fill company name
    if (targetFields.clientName && data.companyName) {
        var nameEl = document.getElementById(targetFields.clientName);
        if (nameEl && !nameEl.value) {
            nameEl.value = data.companyName;
            nameEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // Fill address
    if (targetFields.address && data.fullAddress) {
        var addrEl = document.getElementById(targetFields.address);
        if (addrEl && !addrEl.value) {
            addrEl.value = data.fullAddress;
        }
    }

    // Show feedback toast
    showCompanyLookupToast(data);
}

function showCompanyLookupToast(data) {
    var existing = document.getElementById('companyLookupToast');
    if (existing) existing.remove();

    var statusText = data.status === 'פעילה' ? 'פעילה' : data.status;
    var statusColor = data.status === 'פעילה' ? '#059669' : '#dc2626';

    var toast = document.createElement('div');
    toast.id = 'companyLookupToast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:white;color:#1e293b;padding:12px 20px;border-radius:12px;font-size:13px;font-family:Heebo,sans-serif;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.15);direction:rtl;max-width:90%;border:1px solid rgba(0,0,0,0.08);transition:opacity 0.3s;';

    var icon = document.createElement('span');
    icon.textContent = '🏢 ';
    icon.style.fontSize = '16px';

    var text = document.createElement('span');
    text.innerHTML = '<strong>' + escapeHTMLSafe(data.companyName) + '</strong>';

    var statusBadge = document.createElement('span');
    statusBadge.textContent = statusText;
    statusBadge.style.cssText = 'display:inline-block;margin-right:8px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:' + statusColor + ';';

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(statusBadge);

    if (data.fullAddress) {
        var addrLine = document.createElement('div');
        addrLine.style.cssText = 'font-size:12px;color:#64748b;margin-top:4px;';
        addrLine.textContent = data.fullAddress;
        toast.appendChild(addrLine);
    }

    document.body.appendChild(toast);

    setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
    }, 4000);
}

// Safe HTML escape (avoid dependency on global escapeHTML which may not exist everywhere)
function escapeHTMLSafe(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Show loading indicator on the input field
function showLookupLoading(inputEl) {
    var wrapper = inputEl.closest('.form-group');
    if (!wrapper) return;
    var indicator = wrapper.querySelector('.company-lookup-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'company-lookup-indicator';
        indicator.style.cssText = 'position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--text-secondary, #666);';
        wrapper.style.position = 'relative';
        wrapper.appendChild(indicator);
    }
    indicator.textContent = 'מחפש ח.פ...';
    indicator.style.display = 'block';
}

function hideLookupLoading(inputEl) {
    var wrapper = inputEl.closest('.form-group');
    if (!wrapper) return;
    var indicator = wrapper.querySelector('.company-lookup-indicator');
    if (indicator) indicator.style.display = 'none';
}

function showLookupResult(inputEl, found) {
    var wrapper = inputEl.closest('.form-group');
    if (!wrapper) return;
    var indicator = wrapper.querySelector('.company-lookup-indicator');
    if (!indicator) return;

    if (found) {
        indicator.innerHTML = '<span style="color:#059669;">✓ נמצא</span>';
    } else {
        indicator.style.display = 'none';
    }

    // Auto-hide after 3 seconds
    setTimeout(function() {
        if (indicator) indicator.style.display = 'none';
    }, 3000);
}

// Attach auto-lookup to an idNumber input field
function initCompanyLookup(inputId, targetFields) {
    var input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', function() {
        var digits = input.value.replace(/\D/g, '');

        // Clear previous timeout
        if (_companyLookupTimeout) clearTimeout(_companyLookupTimeout);

        // Need at least 8 digits and must look like a company number
        if (digits.length < 8 || !isLikelyCompanyNumber(digits)) {
            hideLookupLoading(input);
            return;
        }

        // Debounce — wait 600ms after user stops typing
        _companyLookupTimeout = setTimeout(async function() {
            showLookupLoading(input);

            var result = await lookupCompany(digits, targetFields);

            if (result) {
                showLookupResult(input, true);
            } else {
                showLookupResult(input, false);
                hideLookupLoading(input);
            }
        }, 600);
    });

    // Also trigger on blur (when user leaves the field)
    input.addEventListener('blur', function() {
        var digits = input.value.replace(/\D/g, '');
        if (digits.length >= 8 && isLikelyCompanyNumber(digits) && !_companyLookupCache[digits]) {
            showLookupLoading(input);
            lookupCompany(digits, targetFields).then(function(result) {
                showLookupResult(input, !!result);
            });
        }
    });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    // Sales form — Step 1
    initCompanyLookup('idNumber', {
        clientName: 'clientName',
        address: 'address'
    });

    // Billing form
    initCompanyLookup('billingIdNumber', {
        clientName: 'billingClientName',
        address: 'billingAddress'
    });

    // Edit billing form
    initCompanyLookup('editIdNumber', {
        clientName: 'editClientName',
        address: 'editAddress'
    });
});
