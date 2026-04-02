// Google Apps Script — Gmail Leads Listener
// Set up: Open script.google.com → paste this → set trigger every 5 minutes
//
// Configuration: Set these in Script Properties (File > Project properties > Script properties)
// - WEBHOOK_URL: your Netlify function URL (https://tofes-office.netlify.app/api/lead-from-email)
// - WEBHOOK_SECRET: shared secret for authentication
// - PROCESSED_LABEL: Gmail label for processed emails (default: "leads-processed")

function checkForNewLeads() {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty('WEBHOOK_URL') || 'https://tofes-office.netlify.app/api/lead-from-email';
  var webhookSecret = props.getProperty('WEBHOOK_SECRET') || '';
  var labelName = props.getProperty('PROCESSED_LABEL') || 'leads-processed';

  // Get or create the "processed" label
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }

  // Search for unread lead emails (not already processed)
  var queries = [
    'from:din.co.il is:unread -label:' + labelName,
    'from:mishpati.co.il is:unread -label:' + labelName,
    'from:noreply subject:(פנייה OR ליד OR lead OR "טופס יצירת קשר" OR "פניה חדשה") is:unread -label:' + labelName
  ];

  var processed = 0;

  for (var q = 0; q < queries.length; q++) {
    var threads = GmailApp.search(queries[q], 0, 10);

    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages();
      var msg = messages[messages.length - 1]; // Latest message in thread

      var emailData = {
        secret: webhookSecret,
        from: msg.getFrom(),
        subject: msg.getSubject(),
        body: msg.getPlainBody().substring(0, 2000),
        date: msg.getDate().toISOString(),
        messageId: msg.getId()
      };

      try {
        var response = UrlFetchApp.fetch(webhookUrl, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(emailData),
          muteHttpExceptions: true
        });

        var result = JSON.parse(response.getContentText());

        if (result.isLead) {
          Logger.log('Lead found: ' + (result.name || 'unknown') + ' — ' + (result.subject || ''));
          processed++;
        } else {
          Logger.log('Not a lead: ' + msg.getSubject());
        }

        // Mark as processed regardless
        threads[t].addLabel(label);

      } catch (e) {
        Logger.log('Error processing email: ' + e.message);
      }
    }
  }

  if (processed > 0) {
    Logger.log('Total leads processed: ' + processed);
  }
}

// Run once to set up the trigger
function setupTrigger() {
  // Delete existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkForNewLeads') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create new trigger — every 5 minutes
  ScriptApp.newTrigger('checkForNewLeads')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Trigger created: checkForNewLeads every 5 minutes');
}

// Test function — run manually to verify
function testWebhook() {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty('WEBHOOK_URL') || 'https://tofes-office.netlify.app/api/lead-from-email';
  var webhookSecret = props.getProperty('WEBHOOK_SECRET') || '';

  var testData = {
    secret: webhookSecret,
    from: 'test@din.co.il',
    subject: 'בדיקה — ליד חדש',
    body: 'שלום, שמי דוד כהן, טלפון 050-1234567. מעוניין בייעוץ בנושא דיני עבודה. פוטרתי לפני שבוע ללא שימוע.',
    date: new Date().toISOString()
  };

  var response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(testData),
    muteHttpExceptions: true
  });

  Logger.log('Test response: ' + response.getContentText());
}
