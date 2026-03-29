// Client Autocomplete Functionality
async function searchClients(searchTerm) {
    if (!searchTerm || searchTerm.length < 2) {
        return [];
    }

    try {
        // Search by client name - case insensitive
        const searchLower = searchTerm.toLowerCase();

        const clientsMap = new Map();

        // Query both collections in parallel
        const [salesSnapshot, billingSnapshot] = await Promise.all([
            db.collection('sales_records')
                .orderBy('timestamp', 'desc')
                .limit(500)
                .get(),
            db.collection('recurring_billing')
                .orderBy('createdAt', 'desc')
                .limit(500)
                .get()
        ]);

        // Process sales_records
        salesSnapshot.forEach(doc => {
            const data = doc.data();
            const clientName = data.clientName || '';
            const clientNameLower = clientName.toLowerCase();

            if (clientNameLower.includes(searchLower)) {
                if (!clientsMap.has(clientName)) {
                    clientsMap.set(clientName, {
                        clientName: data.clientName,
                        phone: data.phone,
                        email: data.email,
                        idNumber: data.idNumber,
                        address: data.address || '',
                        attorney: data.attorney || '',
                        branch: data.branch || '',
                        caseNumber: data.caseNumber || ''
                    });
                }
            }
        });

        // Process recurring_billing
        billingSnapshot.forEach(doc => {
            const data = doc.data();
            const clientName = data.clientName || '';
            const clientNameLower = clientName.toLowerCase();

            if (clientNameLower.includes(searchLower)) {
                if (!clientsMap.has(clientName)) {
                    clientsMap.set(clientName, {
                        clientName: data.clientName,
                        phone: data.phone || '',
                        email: data.email || '',
                        idNumber: data.idNumber || '',
                        address: data.address || '',
                        attorney: data.attorney || '',
                        branch: data.branch || '',
                        caseNumber: data.caseNumber || ''
                    });
                }
            }
        });

        return Array.from(clientsMap.values());
    } catch (error) {
        console.error('Error searching clients:', error);
        return [];
    }
}

window.fillClientData = function(client) {
    // Step 1 fields
    document.getElementById('clientName').value = client.clientName;
    document.getElementById('phone').value = client.phone;
    document.getElementById('email').value = client.email;
    document.getElementById('idNumber').value = client.idNumber;
    document.getElementById('address').value = client.address;

    // Auto-set "existing client"
    var existingRadio = document.getElementById('existingClient');
    if (existingRadio) existingRadio.checked = true;

    // Step 4 fields — auto-fill if available
    if (client.attorney) {
        var attEl = document.getElementById('attorney');
        if (attEl) attEl.value = client.attorney;
    }
    if (client.branch) {
        var branchEl = document.getElementById('branch');
        if (branchEl) branchEl.value = client.branch;
    }
    if (client.caseNumber) {
        var caseEl = document.getElementById('caseNumber');
        if (caseEl) caseEl.value = client.caseNumber;
    }

    // Hide dropdown
    document.getElementById('clientAutocomplete').classList.remove('show');

    logAuditEvent('client_autocomplete_used', { clientName: client.clientName });

    // Show feedback
    showAutoFillFeedback();
};

function showAutoFillFeedback() {
    var existing = document.getElementById('autoFillToast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'autoFillToast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#059669;color:white;padding:8px 20px;border-radius:8px;font-size:13px;font-family:Heebo,sans-serif;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;';
    toast.textContent = 'הנתונים הושלמו אוטומטית';
    document.body.appendChild(toast);

    setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
    }, 2500);
}

// Search companies by name from Israeli Registrar (רשות התאגידים)
async function searchCompanies(searchTerm) {
    if (!searchTerm || searchTerm.length < 3) return [];
    try {
        var response = await fetch('/api/company-lookup?name=' + encodeURIComponent(searchTerm));
        if (!response.ok) return [];
        var data = await response.json();
        return data.results || [];
    } catch (err) {
        console.error('Company search failed:', err);
        return [];
    }
}

function displayAutocompleteResults(clients, companies) {
    const dropdown = document.getElementById('clientAutocomplete');
    companies = companies || [];

    if (clients.length === 0 && companies.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-no-results">לא נמצאו לקוחות</div>';
        dropdown.classList.add('show');
        return;
    }

    dropdown.innerHTML = '';

    // Show existing clients first
    if (clients.length > 0) {
        var clientHeader = document.createElement('div');
        clientHeader.className = 'autocomplete-section-header';
        clientHeader.textContent = 'לקוחות קיימים';
        dropdown.appendChild(clientHeader);

        clients.forEach(function(client) {
            var item = document.createElement('div');
            item.className = 'autocomplete-item';

            var nameDiv = document.createElement('div');
            nameDiv.className = 'autocomplete-item-name';
            nameDiv.textContent = client.clientName;

            var detailsDiv = document.createElement('div');
            detailsDiv.className = 'autocomplete-item-details';
            detailsDiv.textContent = (client.phone || '') + ' \u2022 ' + (client.email || '');

            item.appendChild(nameDiv);
            item.appendChild(detailsDiv);

            item.addEventListener('click', function() {
                fillClientData(client);
            });

            dropdown.appendChild(item);
        });
    }

    // Show company registry results
    if (companies.length > 0) {
        var companyHeader = document.createElement('div');
        companyHeader.className = 'autocomplete-section-header';
        companyHeader.textContent = 'רשות התאגידים';
        dropdown.appendChild(companyHeader);

        companies.forEach(function(company) {
            var item = document.createElement('div');
            item.className = 'autocomplete-item autocomplete-item-company';

            var nameDiv = document.createElement('div');
            nameDiv.className = 'autocomplete-item-name';
            nameDiv.textContent = company.companyName;

            var detailsDiv = document.createElement('div');
            detailsDiv.className = 'autocomplete-item-details';
            var details = 'ח.פ. ' + company.companyNumber;
            if (company.status) details += ' \u2022 ' + company.status;
            if (company.fullAddress) details += ' \u2022 ' + company.fullAddress;
            detailsDiv.textContent = details;

            item.appendChild(nameDiv);
            item.appendChild(detailsDiv);

            item.addEventListener('click', function() {
                // Fill from company registry data
                document.getElementById('clientName').value = company.companyName;
                document.getElementById('idNumber').value = company.companyNumber;
                if (company.fullAddress) {
                    document.getElementById('address').value = company.fullAddress;
                }

                // Hide dropdown
                dropdown.classList.remove('show');

                // Cache in company lookup cache for future reference
                if (typeof _companyLookupCache !== 'undefined') {
                    _companyLookupCache[company.companyNumber.replace(/\D/g, '')] = company;
                }

                // Show toast
                if (typeof showCompanyLookupToast === 'function') {
                    showCompanyLookupToast(company);
                }

                logAuditEvent('company_registry_autocomplete', { companyName: company.companyName, companyNumber: company.companyNumber });
            });

            dropdown.appendChild(item);
        });
    }

    dropdown.classList.add('show');
}

// Initialize autocomplete on client name input
document.addEventListener('DOMContentLoaded', function() {
    const clientNameInput = document.getElementById('clientName');
    const dropdown = document.getElementById('clientAutocomplete');

    clientNameInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value;

        // Clear previous timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        // Hide dropdown if input is too short
        if (searchTerm.length < 2) {
            dropdown.classList.remove('show');
            return;
        }

        // Show loading state
        dropdown.innerHTML = '<div class="autocomplete-loading">מחפש...</div>';
        dropdown.classList.add('show');

        // Debounce search - wait 300ms after user stops typing
        searchTimeout = setTimeout(async () => {
            // Search existing clients and company registry in parallel
            var promises = [searchClients(searchTerm)];
            if (searchTerm.length >= 3) {
                promises.push(searchCompanies(searchTerm));
            } else {
                promises.push(Promise.resolve([]));
            }
            var [clients, companies] = await Promise.all(promises);

            // Filter out companies already in client list (by name)
            var existingNames = new Set(clients.map(function(c) { return c.clientName; }));
            companies = companies.filter(function(c) { return !existingNames.has(c.companyName); });

            displayAutocompleteResults(clients, companies);
        }, 300);
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!clientNameInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    // Prevent form submission when selecting from dropdown
    clientNameInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && dropdown.classList.contains('show')) {
            e.preventDefault();
        }
    });
});
