// ========== Sync to Google Sheets ==========

async function syncToSheets(data) {
    var WEBHOOK_URL = window.ENV_CONFIG.GOOGLE_SHEETS_WEBHOOK;
    var WEBHOOK_SECRET = window.ENV_CONFIG.WEBHOOK_SECRET || '';

    try {
        var sheetsData = {
            _authToken: WEBHOOK_SECRET,
            timestamp: new Date().toISOString(),
            date: data.date || new Date().toISOString().split('T')[0]
        };

        // Copy all data properties
        for (var key in data) {
            if (data.hasOwnProperty(key)) {
                sheetsData[key] = data[key];
            }
        }

        await fetch(WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(sheetsData)
        });
    } catch (error) {
        console.error('Error syncing to sheets:', error);
    }
}
