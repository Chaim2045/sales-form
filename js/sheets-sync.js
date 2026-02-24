// ========== Sync to Google Sheets ==========

// Sync to Google Sheets
async function syncToSheets(data) {
    const WEBHOOK_URL = window.ENV_CONFIG.GOOGLE_SHEETS_WEBHOOK;
    try {
        const sheetsData = {
            ...data,
            timestamp: new Date().toISOString(),
            date: data.date || new Date().toISOString().split('T')[0]
        };
        await fetch(WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sheetsData)
        });
    } catch (error) {
        console.error('Error syncing to sheets:', error);
    }
}
