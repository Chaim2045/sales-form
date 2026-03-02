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
                .limit(100)
                .get(),
            db.collection('recurring_billing')
                .orderBy('createdAt', 'desc')
                .limit(100)
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
                        address: data.address || ''
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
                        address: data.address || ''
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
    document.getElementById('clientName').value = client.clientName;
    document.getElementById('phone').value = client.phone;
    document.getElementById('email').value = client.email;
    document.getElementById('idNumber').value = client.idNumber;
    document.getElementById('address').value = client.address;

    // Hide dropdown
    document.getElementById('clientAutocomplete').classList.remove('show');
};

function displayAutocompleteResults(clients) {
    const dropdown = document.getElementById('clientAutocomplete');

    if (clients.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-no-results">לא נמצאו לקוחות</div>';
        dropdown.classList.add('show');
        return;
    }

    dropdown.innerHTML = '';
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
            const results = await searchClients(searchTerm);
            displayAutocompleteResults(results);
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
