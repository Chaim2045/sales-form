/**
 * ===========================================
 * סקריפט ליצירת טופס מכר + גיליון + Webhook
 * משרד עו"ד גיא הרשקוביץ
 * ===========================================
 *
 * הוראות:
 * 1. לך ל-script.google.com
 * 2. צור פרויקט חדש
 * 3. הדבק את כל הקוד הזה
 * 4. הרץ את הפונקציה: createSalesForm
 * 5. אשר הרשאות
 * 6. הטופס והגיליון ייווצרו אוטומטית!
 *
 * ===========================================
 */


// ========== פונקציה ראשית - יוצרת הכל ==========

function createSalesForm() {

  // יצירת הטופס
  const form = FormApp.create('טופס מכר - משרד עו"ד גיא הרשקוביץ');
  form.setDescription('טופס להזנת עסקאות ולקוחות חדשים');

  // ---------- שדות הטופס ----------

  // 1. תאריך
  form.addDateItem()
    .setTitle('תאריך')
    .setRequired(true);

  // 2. שם ממלא הטופס
  form.addListItem()
    .setTitle('שם ממלא הטופס')
    .setChoiceValues(['חיים', 'מירי טל', 'רועי הרשקוביץ', 'אורי שטיינברג', 'גיא הרשקוביץ'])
    .setRequired(true);

  // 3. שם הלקוח
  form.addTextItem()
    .setTitle('שם הלקוח (כפי שיופיע בחשבונית)')
    .setRequired(true);

  // 4. טלפון
  form.addTextItem()
    .setTitle('טלפון')
    .setRequired(true);

  // 5. מייל
  form.addTextItem()
    .setTitle('מייל')
    .setRequired(true);

  // 6. כתובת
  form.addTextItem()
    .setTitle('כתובת')
    .setRequired(false);

  // 7. ח.פ / ע.מ / ת"ז
  form.addTextItem()
    .setTitle('ח.פ / ע.מ / ת"ז')
    .setRequired(true);

  // 8. תיאור העסקה
  form.addParagraphTextItem()
    .setTitle('תיאור העסקה (כפי שיופיע בחשבונית)')
    .setRequired(true);

  // 9. סוג העסקה
  form.addListItem()
    .setTitle('סוג העסקה')
    .setChoiceValues([
      'פגישת ייעוץ',
      'ריטיינר',
      'תוכנית שעות',
      'הליך משפטי - תקרת שעות',
      'הליך משפטי - פיקס',
      'אחר'
    ])
    .setRequired(true);

  // 10. סכום
  form.addTextItem()
    .setTitle('סכום לחיוב (לפני מע"מ)')
    .setRequired(true);

  // 11. אמצעי תשלום
  form.addListItem()
    .setTitle('אמצעי תשלום')
    .setChoiceValues([
      'כרטיס אשראי',
      'העברה בנקאית',
      'מזומן',
      'ביט',
      'שיקים דחויים'
    ])
    .setRequired(true);

  // 12. פרטי שיקים
  form.addParagraphTextItem()
    .setTitle('אם שיקים דחויים - פרטים (תאריך, מס\' שיק, סכום)')
    .setRequired(false);

  // 13. אישור אשראי
  form.addListItem()
    .setTitle('אם כרטיס אשראי - האם בוצע חיוב?')
    .setChoiceValues(['בוצע', 'לא בוצע', 'לא רלוונטי'])
    .setRequired(false);

  // 14. עו"ד מטפל
  form.addListItem()
    .setTitle('עו"ד מטפל')
    .setChoiceValues(['גיא הרשקוביץ', 'מירי טל', 'רועי הרשקוביץ', 'אורי שטיינברג', 'חיים'])
    .setRequired(true);

  // 15. מספר תיק
  form.addTextItem()
    .setTitle('מספר תיק בעודכנית')
    .setRequired(false);

  // 16. לקוח חדש/קיים
  form.addListItem()
    .setTitle('לקוח חדש / קיים')
    .setChoiceValues(['חדש', 'קיים'])
    .setRequired(true);

  // 17. סניף
  form.addListItem()
    .setTitle('סניף')
    .setChoiceValues(['תל אביב'])
    .setRequired(true);

  // 18. הערות
  form.addParagraphTextItem()
    .setTitle('הערות')
    .setRequired(false);

  // ---------- יצירת גיליון מקושר ----------

  // הגדרת יעד לתשובות - יצירת גיליון חדש
  form.setDestination(FormApp.DestinationType.SPREADSHEET, createResponseSpreadsheet_(form.getTitle()));

  // קבלת הגיליון שנוצר
  const formId = form.getId();
  const spreadsheetId = form.getDestinationId();

  // הוספת עמודות נוספות לגיליון
  addExtraColumns_(spreadsheetId);

  // ---------- סיכום ----------

  const formUrl = form.getPublishedUrl();
  const editUrl = form.getEditUrl();
  const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId;

  Logger.log('========================================');
  Logger.log('הטופס נוצר בהצלחה!');
  Logger.log('========================================');
  Logger.log('קישור לטופס (למילוי): ' + formUrl);
  Logger.log('קישור לעריכת הטופס: ' + editUrl);
  Logger.log('קישור לגיליון התשובות: ' + spreadsheetUrl);
  Logger.log('מזהה הגיליון: ' + spreadsheetId);
  Logger.log('========================================');

  // החזרת המידע
  return {
    formUrl: formUrl,
    editUrl: editUrl,
    spreadsheetUrl: spreadsheetUrl,
    spreadsheetId: spreadsheetId
  };
}


// ========== פונקציות עזר ==========

function createResponseSpreadsheet_(title) {
  const ss = SpreadsheetApp.create(title + ' (תגובות)');
  return ss.getId();
}

function addExtraColumns_(spreadsheetId) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheets()[0];

  // מציאת העמודה האחרונה
  const lastCol = sheet.getLastColumn() || 1;

  // הוספת עמודות נוספות
  sheet.getRange(1, lastCol + 1).setValue('מס\' חשבונית');
  sheet.getRange(1, lastCol + 2).setValue('מס\' קבלה');
  sheet.getRange(1, lastCol + 3).setValue('הערות פנימיות');
}


// ========================================
// WEBHOOK - להוספת רשומות מהטופס
// ========================================

// !!! חשוב: עדכן את המזהה הזה אחרי שתריץ את createSalesForm !!!
const SPREADSHEET_ID = '1iI8M0aSG-LaQf4dx6vsj873w8q33Fi4dUNjWeAM4Fds';
const SHEET_NAME = 'תגובות לטופס 1';
const LOG_SHEET_NAME = 'לוג הוספות';
const ENABLE_LOGGING = true;

// ========== מערכת גבייה חכמה ==========
const BILLING_SHEET_NAME = 'גבייה חודשית';
const DASHBOARD_SHEET_NAME = 'לוח בקרה גבייה';
const REMINDER_EMAIL_RECIPIENTS = ['haim@guylawoffice.co.il']; // עדכן לכתובות המייל הרלוונטיות
const REMINDER_DAYS_BEFORE = 1;
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwXXXXXXXXXX/exec'; // עדכן אחרי deployment


function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // הוספת לקוח קיים ישירות לגבייה חודשית (מהמודאל)
    if (data.action === 'addRecurringBilling') {
      const billingResult = createRecurringCharges(data, 'modal');

      if (ENABLE_LOGGING) {
        logEntry(data, billingResult.success);
      }

      return ContentService
        .createTextOutput(JSON.stringify(billingResult))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // זרימה רגילה - הוספת שורה לגיליון הראשי
    const result = addRowToSheet(data);

    // אם זה חיוב חודשי חוזר מהטופס הראשי - צור גם שורות גבייה
    if (data.recurringBilling === true || data.recurringBilling === 'true') {
      const billingResult = createRecurringCharges(data, result.rowNumber);
      result.billingCreated = billingResult.success;
      result.billingCount = billingResult.count;
    }

    if (ENABLE_LOGGING) {
      logEntry(data, result.success);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const errorResult = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };

    if (ENABLE_LOGGING) {
      logEntry({ error: error.message }, false);
    }

    return ContentService
      .createTextOutput(JSON.stringify(errorResult))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : null;

  if (action === 'markCharged') {
    return handleMarkCharged(e);
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'active',
      message: 'Webhook טופס מכר פעיל',
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}


function addRowToSheet(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  // Log the incoming data for debugging
  Logger.log('Received data: ' + JSON.stringify(data));

  // בניית מחרוזות מידע מאורגנות
  let creditCardInfo = '';
  if (data.paymentMethod === 'כרטיס אשראי') {
    if (data.creditCardStatus === 'בוצע חיוב מלא') {
      const payments = data.paymentsCount || '';
      creditCardInfo = payments ? `בוצע חיוב מלא - ${payments} תשלומים` : 'בוצע חיוב מלא';
    } else if (data.creditCardStatus === 'חיוב חודשי') {
      creditCardInfo = `חיוב חודשי: ₪${data.recurringMonthlyAmount || data.monthlyCharge || ''} למשך ${data.recurringMonthsCount || data.monthsCount || ''} חודשים, החל מ-${data.recurringStartDate || ''}`;
    } else if (data.creditCardStatus === 'פיקדון') {
      creditCardInfo = `פיקדון: ${data.depositDetails || ''}`;
    } else if (data.creditCardStatus === 'אשראי זמני - יוחלף') {
      creditCardInfo = `אשראי זמני - ${data.temporaryCreditDetails || ''}`;
    }
  }

  let checksInfo = '';
  if (data.paymentMethod === 'שיקים דחויים') {
    checksInfo = `${data.checksCount || ''} צ'קים בסך ₪${data.checksTotalAmount || ''}`;

    // Add detailed checks list if exists
    if (data.checksDetailedList) {
      try {
        const checksList = JSON.parse(data.checksDetailedList);
        const checksText = checksList.map(check =>
          `שיק ${check.checkNumber}: ${check.date} - ₪${check.amount}`
        ).join(' | ');
        checksInfo += ` | ${checksText}`;
      } catch (e) {
        Logger.log('Error parsing checks list: ' + e);
      }
    }

    if (data.checksDetails) {
      checksInfo += ` | ${data.checksDetails}`;
    }
    if (data.checkWillChange === 'כן' && data.checkReplacementDetails) {
      checksInfo += ` | החלפה: ${data.checkReplacementDetails}`;
    }
  }

  // טיפול בפיצול תשלום
  let splitPaymentInfo = '';
  if (data.isSplitPayment && data.paymentBreakdownText) {
    splitPaymentInfo = data.paymentBreakdownText;
  }

  // קריאת כותרות הגיליון כדי למפות נתונים לעמודות הנכונות
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // מיפוי ערכים לפי שם כותרת
  const dataMap = {
    'חותמת זמן': data.timestamp || new Date().toISOString(),
    'תאריך': formatDate(data.date) || formatDate(new Date()),
    'שם ממלא הטופס': data.formFillerName || '',
    'שם הלקוח': data.clientName || '',
    'טלפון': data.phone || '',
    'מייל': data.email || '',
    'ח.פ / ת.ז': data.idNumber || '',
    'כתובת': data.address || '',
    'סטטוס לקוח': data.clientStatus || 'חדש',
    'סוג העסקה': data.transactionType || '',
    'תיאור העסקה': data.transactionDescription || '',
    'כמות שעות': data.hoursQuantity || '',
    'מחיר לשעה': data.hourlyRate || '',
    'סכום לפני מע"מ': data.amountBeforeVat || data.amount || '',
    "מע\"מ": data.vatAmount || '',
    'סכום כולל מע"מ': data.amountWithVat || '',
    'אמצעי תשלום': data.paymentMethod || '',
    'פיצול תשלום?': data.isSplitPayment ? 'כן' : 'לא',
    'פירוט פיצול תשלום': splitPaymentInfo,
    'פרטי כרטיס אשראי': creditCardInfo,
    "פרטי צ'קים": checksInfo,
    "תמונת צ'ק": data.checksPhotoURL || '',
    'עו"ד מטפל': data.attorney || '',
    'מספר תיק': data.caseNumber || '',
    'סניף': data.branch || 'תל אביב',
    'הערות': data.notes || '',
    'מספר חשבונית': data.invoiceNumber || '',
    'מספר קבלה': data.receiptNumber || ''
  };

  // בניית שורה לפי סדר הכותרות בגיליון בפועל
  const row = headers.map(function(header) {
    var key = header.toString().trim();
    return dataMap.hasOwnProperty(key) ? dataMap[key] : '';
  });

  Logger.log('Headers found: ' + JSON.stringify(headers));
  Logger.log('Row to append: ' + JSON.stringify(row));

  sheet.appendRow(row);
  const newRowNumber = sheet.getLastRow();

  // אם יש קישור לתמונת צ'ק, הפוך אותו ל-HYPERLINK - חיפוש עמודה לפי כותרת
  if (data.checksPhotoURL && data.checksPhotoURL.trim() !== '') {
    const checkPhotoColIndex = headers.findIndex(function(h) {
      return h.toString().trim() === "תמונת צ'ק";
    });
    if (checkPhotoColIndex >= 0) {
      const checkPhotoCell = sheet.getRange(newRowNumber, checkPhotoColIndex + 1);
      checkPhotoCell.setFormula('=HYPERLINK("' + data.checksPhotoURL + '", "📸 צפה בתמונה")');
    }
  }

  return {
    success: true,
    message: 'הרשומה נוספה בהצלחה',
    rowNumber: newRowNumber,
    clientName: data.clientName,
    timestamp: new Date().toISOString()
  };
}


function formatDate(dateInput) {
  if (!dateInput) return '';

  let date;
  if (typeof dateInput === 'string') {
    date = new Date(dateInput);
  } else {
    date = dateInput;
  }

  if (isNaN(date.getTime())) return dateInput;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}


function logEntry(data, success) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let logSheet = ss.getSheetByName(LOG_SHEET_NAME);

    if (!logSheet) {
      logSheet = ss.insertSheet(LOG_SHEET_NAME);
      logSheet.getRange(1, 1, 1, 5).setValues([[
        'תאריך ושעה',
        'סטטוס',
        'שם לקוח',
        'סכום',
        'נתונים מלאים'
      ]]);
    }

    logSheet.appendRow([
      new Date().toLocaleString('he-IL'),
      success ? '✅ הצלחה' : '❌ שגיאה',
      data.clientName || data.error || 'לא ידוע',
      data.amountWithVat || data.amount || '',
      JSON.stringify(data)
    ]);

  } catch (e) {
    console.error('Log error:', e);
  }
}


// ========== פונקציית בדיקה ==========

function testAddRow() {
  const testData = {
    timestamp: new Date().toISOString(),
    date: new Date().toISOString(),
    formFillerName: 'חיים',
    clientName: '🔴 בדיקת מערכת - למחיקה',
    phone: '0500000000',
    email: 'test@test.com',
    address: 'רחוב הבדיקה 1, תל אביב',
    idNumber: '000000000',
    clientStatus: 'חדש',
    transactionType: 'פגישת ייעוץ',
    transactionDescription: 'בדיקת חיבור webhook',
    hoursQuantity: '',
    hourlyRate: '',
    amountBeforeVat: 100,
    vatAmount: 18,
    amountWithVat: 118,
    amount: 100,
    paymentMethod: 'כרטיס אשראי',
    creditCardStatus: 'בוצע חיוב מלא',
    paymentsCount: '3',
    monthlyCharge: '',
    monthsCount: '',
    depositDetails: '',
    temporaryCreditDetails: '',
    isSplitPayment: false,
    paymentBreakdownText: '',
    checksCount: '',
    checksTotalAmount: '',
    checksPhotoURL: '',
    checksDetailedList: '',
    checksDetails: '',
    checkWillChange: '',
    checkReplacementDetails: '',
    attorney: 'גיא הרשקוביץ',
    caseNumber: '1234',
    branch: 'תל אביב',
    notes: 'שורת בדיקה - ניתן למחוק',
    invoiceNumber: '',
    receiptNumber: ''
  };

  const result = addRowToSheet(testData);
  Logger.log(result);
}


// ========== פונקציית אבחון ==========

function diagnoseSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  Logger.log('===== אבחון מבנה הגיליון =====');
  Logger.log('');

  const lastColumn = sheet.getLastColumn();
  Logger.log('סה"כ עמודות בגיליון: ' + lastColumn);
  Logger.log('');

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  Logger.log('===== כותרות הגיליון =====');
  for (var i = 0; i < headers.length; i++) {
    var columnLetter = (i < 26) ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26);
    Logger.log('עמודה ' + columnLetter + ' (' + (i + 1) + '): "' + headers[i] + '"');
  }
  Logger.log('');

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    Logger.log('===== השורה האחרונה שנוספה (שורה ' + lastRow + ') =====');
    var lastRowData = sheet.getRange(lastRow, 1, 1, lastColumn).getValues()[0];
    for (var j = 0; j < lastRowData.length; j++) {
      var colLetter = (j < 26) ? String.fromCharCode(65 + j) : 'A' + String.fromCharCode(65 + j - 26);
      var header = headers[j] || '(ללא כותרת)';
      Logger.log(colLetter + '. ' + header + ': "' + lastRowData[j] + '"');
    }
  } else {
    Logger.log('אין שורות נתונים בגיליון');
  }

  Logger.log('');
  Logger.log('===== סיימתי אבחון =====');
}


// ========== פונקציה ליצירת כותרות מעודכנות ==========

function updateSheetHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  // כותרות תואמות לגיליון בפועל (27 עמודות, A-AA)
  const headers = [
    'תאריך',                  // A
    'שם ממלא הטופס',          // B
    'שם הלקוח',               // C
    'טלפון',                  // D
    'מייל',                   // E
    'ח.פ / ת.ז',             // F
    'כתובת',                  // G
    'סטטוס לקוח',             // H
    'סוג העסקה',              // I
    'תיאור העסקה',            // J
    'כמות שעות',              // K
    'מחיר לשעה',              // L
    'סכום לפני מע"מ',         // M
    'מע"מ',                   // N
    'סכום כולל מע"מ',         // O
    'אמצעי תשלום',            // P
    'פיצול תשלום?',           // Q
    'פירוט פיצול תשלום',      // R
    'פרטי כרטיס אשראי',       // S
    'פרטי צ\'קים',            // T
    'תמונת צ\'ק',             // U
    'עו"ד מטפל',              // V
    'מספר תיק',               // W
    'סניף',                   // X
    'הערות',                  // Y
    'מספר חשבונית',           // Z
    'מספר קבלה'               // AA
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  Logger.log('כותרות עודכנו בהצלחה! (' + headers.length + ' עמודות)');
}


// ========================================================
// מערכת גבייה חכמה - פונקציות
// ========================================================

// ---------- יצירת גיליון גבייה חודשית ----------

function createBillingSheet_(ss) {
  var sheet = ss.insertSheet(BILLING_SHEET_NAME);

  var headers = [
    'מזהה גבייה', 'שם הלקוח', 'טלפון', 'מייל', 'ח.פ / ת.ז',
    'עו"ד מטפל', 'מספר תיק', 'סוג העסקה', 'תיאור',
    'סכום חיוב חודשי', 'סה"כ חודשים', 'חודש נוכחי',
    'תאריך חיוב', 'סטטוס', 'תאריך ביצוע', 'בוצע ע"י',
    'מזהה עסקה מקורית', 'תאריך יצירה', 'הערות', 'סניף'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#4285f4');
  sheet.getRange(1, 1, 1, headers.length).setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(10, 120);
  sheet.setColumnWidth(13, 120);
  sheet.setColumnWidth(14, 100);

  // Data validation לסטטוס
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['ממתין', 'בוצע', 'באיחור', 'בוטל'])
    .setAllowInvalid(false)
    .build();
  sheet.getRange('N2:N1000').setDataValidation(statusRule);

  // עיצוב צבעים מותנה לסטטוס
  var greenRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('בוצע')
    .setBackground('#d4edda').setFontColor('#155724')
    .setRanges([sheet.getRange('N2:N1000')]).build();

  var redRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('באיחור')
    .setBackground('#f8d7da').setFontColor('#721c24')
    .setRanges([sheet.getRange('N2:N1000')]).build();

  var yellowRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('ממתין')
    .setBackground('#fff3cd').setFontColor('#856404')
    .setRanges([sheet.getRange('N2:N1000')]).build();

  var grayRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('בוטל')
    .setBackground('#e2e3e5').setFontColor('#383d41')
    .setRanges([sheet.getRange('N2:N1000')]).build();

  sheet.setConditionalFormatRules([greenRule, redRule, yellowRule, grayRule]);

  return sheet;
}


// ---------- יצירת שורות חיוב חוזר ----------

function createRecurringCharges(data, originalRowNumber) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

    if (!billingSheet) {
      billingSheet = createBillingSheet_(ss);
    }

    var monthlyAmount = parseFloat(data.recurringMonthlyAmount) || 0;
    var totalMonths = parseInt(data.recurringMonthsCount) || 1;
    var startDate = new Date(data.recurringStartDate);
    var dayOfMonth = parseInt(data.recurringDayOfMonth) || 1;
    var billingId = 'BIL-' + Date.now();

    var rows = [];

    for (var i = 0; i < totalMonths; i++) {
      var chargeDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, dayOfMonth);

      // טיפול בחודשים שאין בהם את היום המבוקש (למשל 30 בפברואר)
      if (chargeDate.getDate() !== dayOfMonth) {
        chargeDate.setDate(0);
      }

      var row = [
        billingId + '-' + (i + 1),
        data.clientName || '',
        data.phone || '',
        data.email || '',
        data.idNumber || '',
        data.attorney || '',
        data.caseNumber || '',
        data.transactionType || '',
        data.transactionDescription || '',
        monthlyAmount,
        totalMonths,
        i + 1,
        formatDate(chargeDate),
        'ממתין',
        '',
        '',
        originalRowNumber,
        formatDate(new Date()),
        data.recurringNotes || data.notes || '',
        data.branch || 'תל אביב'
      ];

      rows.push(row);
    }

    if (rows.length > 0) {
      var startRow = billingSheet.getLastRow() + 1;
      billingSheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    }

    return { success: true, count: rows.length, billingId: billingId };

  } catch (error) {
    Logger.log('Error creating recurring charges: ' + error.message);
    return { success: false, count: 0, error: error.message };
  }
}


// ---------- פונקציות עזר לתאריכים ----------

function parseDateString_(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;

  var str = dateStr.toString().trim();

  // פורמט DD/MM/YYYY
  var ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  }

  // פורמט YYYY-MM-DD
  var yyyymmdd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmdd) {
    return new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
  }

  var d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function isSameDay_(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}


// ---------- בדיקת תזכורות יומית (טריגר) ----------

function checkAndSendReminders() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

  if (!billingSheet) {
    Logger.log('גיליון גבייה לא נמצא');
    return;
  }

  var lastRow = billingSheet.getLastRow();
  if (lastRow <= 1) return;

  var data = billingSheet.getRange(2, 1, lastRow - 1, 20).getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + REMINDER_DAYS_BEFORE);

  var overdueCount = 0;
  var remindersSent = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var billingId = row[0];
    var clientName = row[1];
    var attorney = row[5];
    var caseNumber = row[6];
    var monthlyAmount = row[9];
    var totalMonths = row[10];
    var currentMonth = row[11];
    var chargeDateStr = row[12];
    var status = row[13];

    if (status === 'בוצע' || status === 'בוטל') continue;

    var chargeDate = parseDateString_(chargeDateStr);
    if (!chargeDate) continue;
    chargeDate.setHours(0, 0, 0, 0);

    var rowIndex = i + 2;

    // סימון חיובים באיחור
    if (chargeDate < today && status === 'ממתין') {
      billingSheet.getRange(rowIndex, 14).setValue('באיחור');
      overdueCount++;
    }

    // שליחת תזכורת ליום לפני
    if (isSameDay_(chargeDate, tomorrow)) {
      sendChargeReminder_({
        billingId: billingId,
        clientName: clientName,
        attorney: attorney,
        caseNumber: caseNumber,
        monthlyAmount: monthlyAmount,
        currentMonth: currentMonth,
        totalMonths: totalMonths,
        chargeDate: chargeDateStr,
        rowIndex: rowIndex
      });
      remindersSent++;
    }

    // תזכורות לחיובים באיחור
    if (chargeDate < today && (status === 'באיחור' || (status === 'ממתין' && chargeDate < today))) {
      var daysSinceOverdue = Math.floor((today - chargeDate) / (1000 * 60 * 60 * 24));
      // 3 ימים ראשונים - יומי, אח"כ כל 3 ימים
      if (daysSinceOverdue <= 3 || daysSinceOverdue % 3 === 0) {
        sendOverdueReminder_({
          billingId: billingId,
          clientName: clientName,
          attorney: attorney,
          caseNumber: caseNumber,
          monthlyAmount: monthlyAmount,
          chargeDate: chargeDateStr,
          daysOverdue: daysSinceOverdue,
          rowIndex: rowIndex
        });
        remindersSent++;
      }
    }
  }

  // עדכון דשבורד
  generateBillingDashboard();

  Logger.log('בדיקת תזכורות הושלמה. באיחור: ' + overdueCount + ', תזכורות נשלחו: ' + remindersSent);
}


// ---------- שליחת מייל תזכורת ----------

function sendChargeReminder_(info) {
  var markChargedUrl = WEBAPP_URL + '?action=markCharged&billingId=' +
    encodeURIComponent(info.billingId) + '&row=' + info.rowIndex;

  var subject = 'תזכורת גבייה - ' + info.clientName + ' - ₪' + info.monthlyAmount + ' - מחר';

  var htmlBody = '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">' +
    '<div style="background: #2563eb; color: white; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">' +
      '<h2 style="margin: 0;">תזכורת חיוב חודשי</h2>' +
      '<p style="margin: 8px 0 0; opacity: 0.9;">משרד עו"ד גיא הרשקוביץ</p>' +
    '</div>' +
    '<div style="background: #ffffff; border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 12px 12px;">' +
      '<div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">' +
        '<strong style="color: #92400e;">מחר (' + info.chargeDate + ') יש לבצע חיוב:</strong>' +
      '</div>' +
      '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">לקוח:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; font-size: 16px;">' + info.clientName + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">סכום לחיוב:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; font-size: 18px; color: #2563eb;">₪' + info.monthlyAmount + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">מספר תיק:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">' + (info.caseNumber || 'לא צוין') + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">עו"ד מטפל:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">' + info.attorney + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">תשלום:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">' + info.currentMonth + ' מתוך ' + info.totalMonths + '</td></tr>' +
      '</table>' +
      '<div style="text-align: center; margin: 24px 0;">' +
        '<a href="' + markChargedUrl + '" style="display: inline-block; background: #10b981; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">ביצעתי את החיוב</a>' +
      '</div>' +
      '<p style="text-align: center; color: #9ca3af; font-size: 12px;">ניתן גם לסמן ישירות בגיליון "גבייה חודשית" בגוגל שיטס</p>' +
    '</div>' +
  '</div>';

  REMINDER_EMAIL_RECIPIENTS.forEach(function(recipient) {
    GmailApp.sendEmail(recipient, subject, '', {
      htmlBody: htmlBody,
      name: 'מערכת גבייה - משרד עו"ד גיא הרשקוביץ'
    });
  });
}


// ---------- שליחת מייל חיוב באיחור ----------

function sendOverdueReminder_(info) {
  var markChargedUrl = WEBAPP_URL + '?action=markCharged&billingId=' +
    encodeURIComponent(info.billingId) + '&row=' + info.rowIndex;

  var subject = '[דחוף] חיוב באיחור - ' + info.clientName + ' - ₪' + info.monthlyAmount + ' (' + info.daysOverdue + ' ימים)';

  var htmlBody = '<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">' +
    '<div style="background: #dc2626; color: white; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">' +
      '<h2 style="margin: 0;">חיוב באיחור!</h2>' +
      '<p style="margin: 8px 0 0; opacity: 0.9;">' + info.daysOverdue + ' ימים מאז תאריך החיוב</p>' +
    '</div>' +
    '<div style="background: #ffffff; border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 12px 12px;">' +
      '<div style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin-bottom: 20px;">' +
        '<strong style="color: #991b1b;">החיוב היה אמור להתבצע ב-' + info.chargeDate + '</strong>' +
      '</div>' +
      '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">לקוח:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; font-size: 16px;">' + info.clientName + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">סכום לחיוב:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; font-size: 18px; color: #dc2626;">₪' + info.monthlyAmount + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">מספר תיק:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">' + (info.caseNumber || 'לא צוין') + '</td></tr>' +
        '<tr><td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: #6b7280;">עו"ד מטפל:</td>' +
        '<td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">' + info.attorney + '</td></tr>' +
      '</table>' +
      '<div style="text-align: center; margin: 24px 0;">' +
        '<a href="' + markChargedUrl + '" style="display: inline-block; background: #10b981; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">ביצעתי את החיוב</a>' +
      '</div>' +
    '</div>' +
  '</div>';

  REMINDER_EMAIL_RECIPIENTS.forEach(function(recipient) {
    GmailApp.sendEmail(recipient, subject, '', {
      htmlBody: htmlBody,
      name: 'מערכת גבייה - משרד עו"ד גיא הרשקוביץ'
    });
  });
}


// ---------- סימון חיוב כבוצע (מהמייל) ----------

function handleMarkCharged(e) {
  try {
    var billingId = e.parameter.billingId;
    var rowIndex = parseInt(e.parameter.row);

    if (!billingId || !rowIndex) {
      return HtmlService.createHtmlOutput(
        createResponsePage_('error', 'קישור לא תקין', 'פרמטרים חסרים')
      );
    }

    var result = markChargeCompleted(billingId, rowIndex, 'email');

    if (result.success) {
      return HtmlService.createHtmlOutput(
        createResponsePage_('success', 'החיוב סומן בהצלחה!',
          'לקוח: ' + result.clientName + '<br>סכום: ₪' + result.amount + '<br>תאריך: ' + result.chargeDate)
      );
    } else {
      return HtmlService.createHtmlOutput(
        createResponsePage_('error', 'שגיאה', result.error || 'לא ניתן לעדכן')
      );
    }

  } catch (error) {
    return HtmlService.createHtmlOutput(
      createResponsePage_('error', 'שגיאה', error.message)
    );
  }
}

function createResponsePage_(type, title, message) {
  var bgColor = type === 'success' ? '#10b981' : '#ef4444';
  var icon = type === 'success' ? '&#10004;' : '&#10006;';

  return '<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + title + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet">' +
    '</head><body style="font-family: Heebo, Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f3f4f6; margin: 0;">' +
    '<div style="background: white; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px;">' +
      '<div style="width: 60px; height: 60px; border-radius: 50%; background: ' + bgColor + '; color: white; font-size: 28px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">' + icon + '</div>' +
      '<h2 style="margin: 0 0 8px; color: #1f2937;">' + title + '</h2>' +
      '<p style="color: #6b7280; margin: 0;">' + message + '</p>' +
      '<p style="margin-top: 24px; color: #9ca3af; font-size: 13px;">ניתן לסגור חלון זה</p>' +
    '</div></body></html>';
}


// ---------- סימון חיוב כבוצע (פונקציה משותפת) ----------

function markChargeCompleted(billingId, rowIndex, source) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

    if (!billingSheet) {
      return { success: false, error: 'גיליון גבייה לא נמצא' };
    }

    // אימות שהמזהה תואם לשורה
    var currentBillingId = billingSheet.getRange(rowIndex, 1).getValue();
    if (currentBillingId !== billingId) {
      var searchData = billingSheet.getRange(2, 1, billingSheet.getLastRow() - 1, 1).getValues();
      var foundRow = -1;
      for (var i = 0; i < searchData.length; i++) {
        if (searchData[i][0] === billingId) {
          foundRow = i + 2;
          break;
        }
      }
      if (foundRow === -1) {
        return { success: false, error: 'מזהה גבייה לא נמצא' };
      }
      rowIndex = foundRow;
    }

    var currentStatus = billingSheet.getRange(rowIndex, 14).getValue();
    if (currentStatus === 'בוצע') {
      return { success: true, message: 'כבר סומן כבוצע', clientName: billingSheet.getRange(rowIndex, 2).getValue() };
    }
    if (currentStatus === 'בוטל') {
      return { success: false, error: 'החיוב בוטל ולא ניתן לסמן כבוצע' };
    }

    // עדכון סטטוס
    billingSheet.getRange(rowIndex, 14).setValue('בוצע');
    billingSheet.getRange(rowIndex, 15).setValue(formatDate(new Date()));
    billingSheet.getRange(rowIndex, 16).setValue(source || 'manual');

    var clientName = billingSheet.getRange(rowIndex, 2).getValue();
    var amount = billingSheet.getRange(rowIndex, 10).getValue();
    var chargeDate = billingSheet.getRange(rowIndex, 13).getValue();

    return {
      success: true,
      clientName: clientName,
      amount: amount,
      chargeDate: chargeDate,
      message: 'החיוב סומן כבוצע'
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}


// ---------- דשבורד גבייה ----------

function generateBillingDashboard() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

  if (!billingSheet) return;

  var dashSheet = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (!dashSheet) {
    dashSheet = ss.insertSheet(DASHBOARD_SHEET_NAME);
  }

  dashSheet.clear();

  var lastRow = billingSheet.getLastRow();
  if (lastRow <= 1) {
    dashSheet.getRange(1, 1).setValue('אין נתוני גבייה עדיין');
    return;
  }

  var data = billingSheet.getRange(2, 1, lastRow - 1, 20).getValues();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  var currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  var currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  var overdue = [];
  var upcoming = [];
  var completedThisMonth = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var clientName = row[1];
    var attorney = row[5];
    var caseNumber = row[6];
    var amount = row[9];
    var chargeDate = parseDateString_(row[12]);
    var status = row[13];
    var completedDate = parseDateString_(row[14]);

    if (!chargeDate) continue;
    chargeDate.setHours(0, 0, 0, 0);

    if (status === 'באיחור' || (status === 'ממתין' && chargeDate < today)) {
      overdue.push([clientName, '₪' + amount, row[12], attorney, caseNumber, status]);
    } else if (status === 'ממתין' && chargeDate >= today && chargeDate <= in30Days) {
      upcoming.push([clientName, '₪' + amount, row[12], attorney, caseNumber, status]);
    } else if (status === 'בוצע' && completedDate && completedDate >= currentMonthStart && completedDate <= currentMonthEnd) {
      completedThisMonth.push([clientName, '₪' + amount, row[12], attorney, caseNumber, row[14]]);
    }
  }

  overdue.sort(function(a, b) { return (parseDateString_(a[2]) || 0) - (parseDateString_(b[2]) || 0); });
  upcoming.sort(function(a, b) { return (parseDateString_(a[2]) || 0) - (parseDateString_(b[2]) || 0); });

  var currentRow = 1;
  var sectionHeaders = ['שם לקוח', 'סכום', 'תאריך חיוב', 'עו"ד מטפל', 'מספר תיק', 'סטטוס'];

  // כותרת
  dashSheet.getRange(currentRow, 1).setValue('לוח בקרה - גביית ריטיינרים ותשלומים חודשיים');
  dashSheet.getRange(currentRow, 1).setFontSize(16).setFontWeight('bold');
  dashSheet.getRange(currentRow, 1, 1, 6).merge();
  currentRow++;

  dashSheet.getRange(currentRow, 1).setValue('עודכן לאחרונה: ' + new Date().toLocaleString('he-IL'));
  dashSheet.getRange(currentRow, 1).setFontColor('#9ca3af');
  currentRow += 2;

  // סיכום
  dashSheet.getRange(currentRow, 1).setValue('סיכום:');
  dashSheet.getRange(currentRow, 1).setFontWeight('bold');
  dashSheet.getRange(currentRow, 2).setValue('באיחור: ' + overdue.length + ' | קרוב: ' + upcoming.length + ' | בוצעו החודש: ' + completedThisMonth.length);
  currentRow += 2;

  // חיובים באיחור
  dashSheet.getRange(currentRow, 1).setValue('חיובים באיחור (' + overdue.length + ')');
  dashSheet.getRange(currentRow, 1, 1, 6).merge().setBackground('#fee2e2').setFontWeight('bold').setFontColor('#991b1b');
  currentRow++;

  if (overdue.length > 0) {
    dashSheet.getRange(currentRow, 1, 1, 6).setValues([sectionHeaders]).setFontWeight('bold').setBackground('#fecaca');
    currentRow++;
    dashSheet.getRange(currentRow, 1, overdue.length, 6).setValues(overdue);
    currentRow += overdue.length;
  } else {
    dashSheet.getRange(currentRow, 1).setValue('אין חיובים באיחור');
    dashSheet.getRange(currentRow, 1).setFontColor('#6b7280');
    currentRow++;
  }
  currentRow++;

  // חיובים קרובים
  dashSheet.getRange(currentRow, 1).setValue('חיובים ב-30 הימים הקרובים (' + upcoming.length + ')');
  dashSheet.getRange(currentRow, 1, 1, 6).merge().setBackground('#fef3c7').setFontWeight('bold').setFontColor('#92400e');
  currentRow++;

  if (upcoming.length > 0) {
    dashSheet.getRange(currentRow, 1, 1, 6).setValues([sectionHeaders]).setFontWeight('bold').setBackground('#fde68a');
    currentRow++;
    dashSheet.getRange(currentRow, 1, upcoming.length, 6).setValues(upcoming);
    currentRow += upcoming.length;
  } else {
    dashSheet.getRange(currentRow, 1).setValue('אין חיובים קרובים');
    dashSheet.getRange(currentRow, 1).setFontColor('#6b7280');
    currentRow++;
  }
  currentRow++;

  // חיובים שבוצעו
  dashSheet.getRange(currentRow, 1).setValue('חיובים שבוצעו החודש (' + completedThisMonth.length + ')');
  dashSheet.getRange(currentRow, 1, 1, 6).merge().setBackground('#d1fae5').setFontWeight('bold').setFontColor('#065f46');
  currentRow++;

  if (completedThisMonth.length > 0) {
    var completedHeaders = ['שם לקוח', 'סכום', 'תאריך חיוב', 'עו"ד מטפל', 'מספר תיק', 'בוצע בתאריך'];
    dashSheet.getRange(currentRow, 1, 1, 6).setValues([completedHeaders]).setFontWeight('bold').setBackground('#a7f3d0');
    currentRow++;
    dashSheet.getRange(currentRow, 1, completedThisMonth.length, 6).setValues(completedThisMonth);
  } else {
    dashSheet.getRange(currentRow, 1).setValue('אין חיובים שבוצעו החודש');
    dashSheet.getRange(currentRow, 1).setFontColor('#6b7280');
  }

  for (var col = 1; col <= 6; col++) {
    dashSheet.autoResizeColumn(col);
  }
}


// ---------- התקנת טריגרים ----------

function setupDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'checkAndSendReminders') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('checkAndSendReminders')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(0)
    .inTimezone('Asia/Jerusalem')
    .create();

  Logger.log('טריגר יומי הוגדר בהצלחה - 8:00 בבוקר שעון ישראל');
}

function setupOnEditTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'onBillingSheetEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('onBillingSheetEdit')
    .forSpreadsheet(SPREADSHEET_ID)
    .onEdit()
    .create();

  Logger.log('טריגר onEdit הוגדר בהצלחה');
}

function onBillingSheetEdit(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== BILLING_SHEET_NAME) return;

  var range = e.range;
  var col = range.getColumn();
  var row = range.getRow();

  // רק שינויים בעמודת סטטוס (N = עמודה 14)
  if (col !== 14 || row <= 1) return;

  var newValue = e.value;
  if (newValue === 'בוצע') {
    sheet.getRange(row, 15).setValue(formatDate(new Date()));
    sheet.getRange(row, 16).setValue('sheets');
  }
}


// ---------- פונקציות ניהול ----------

function cancelBillingSeries(billingIdPrefix) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

  if (!billingSheet) return { success: false, error: 'גיליון לא נמצא' };

  var lastRow = billingSheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: 'אין נתונים' };

  var data = billingSheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var cancelledCount = 0;

  for (var i = 0; i < data.length; i++) {
    var billingId = data[i][0];
    var status = data[i][13];

    if (billingId.toString().indexOf(billingIdPrefix) === 0 && (status === 'ממתין' || status === 'באיחור')) {
      billingSheet.getRange(i + 2, 14).setValue('בוטל');
      cancelledCount++;
    }
  }

  return { success: true, cancelledCount: cancelledCount };
}

function updateFutureChargeAmounts(billingIdPrefix, newAmount) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

  if (!billingSheet) return { success: false, error: 'גיליון לא נמצא' };

  var lastRow = billingSheet.getLastRow();
  var data = billingSheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var today = new Date();
  var updatedCount = 0;

  for (var i = 0; i < data.length; i++) {
    var billingId = data[i][0];
    var chargeDate = parseDateString_(data[i][12]);
    var status = data[i][13];

    if (billingId.toString().indexOf(billingIdPrefix) === 0 && status === 'ממתין' && chargeDate > today) {
      billingSheet.getRange(i + 2, 10).setValue(newAmount);
      updatedCount++;
    }
  }

  return { success: true, updatedCount: updatedCount };
}


// ---------- אתחול מערכת הגבייה (הרצה חד-פעמית) ----------

function initBillingSystem() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var billingSheet = ss.getSheetByName(BILLING_SHEET_NAME);

  if (!billingSheet) {
    billingSheet = createBillingSheet_(ss);
    Logger.log('גיליון גבייה נוצר: ' + BILLING_SHEET_NAME);
  }

  setupDailyTrigger();
  setupOnEditTrigger();
  generateBillingDashboard();

  Logger.log('========================================');
  Logger.log('מערכת הגבייה אותחלה בהצלחה!');
  Logger.log('========================================');
  Logger.log('גיליון גבייה: ' + BILLING_SHEET_NAME);
  Logger.log('דשבורד: ' + DASHBOARD_SHEET_NAME);
  Logger.log('טריגר יומי: 8:00 בבוקר');
  Logger.log('========================================');
}


// ---------- בדיקת מערכת גבייה ----------

function testRecurringBilling() {
  var testData = {
    timestamp: new Date().toISOString(),
    date: new Date().toISOString(),
    formFillerName: 'חיים',
    clientName: '🔴 בדיקת גבייה חודשית - למחיקה',
    phone: '0500000000',
    email: 'test@test.com',
    address: 'רחוב הבדיקה 1, תל אביב',
    idNumber: '000000000',
    clientStatus: 'חדש',
    transactionType: 'ריטיינר',
    transactionDescription: 'בדיקת מערכת גבייה חודשית',
    hoursQuantity: '',
    hourlyRate: '',
    amountBeforeVat: 5000,
    vatAmount: 900,
    amountWithVat: 5900,
    amount: 5000,
    paymentMethod: 'כרטיס אשראי',
    creditCardStatus: 'חיוב חודשי',
    recurringBilling: true,
    recurringMonthlyAmount: '5900',
    recurringMonthsCount: '3',
    recurringStartDate: new Date().toISOString().split('T')[0],
    recurringDayOfMonth: '1',
    recurringNotes: 'שורת בדיקה - ניתן למחוק',
    isSplitPayment: false,
    paymentBreakdownText: '',
    checksCount: '',
    checksTotalAmount: '',
    checksPhotoURL: '',
    checksDetailedList: '',
    checksDetails: '',
    checkWillChange: '',
    checkReplacementDetails: '',
    attorney: 'גיא הרשקוביץ',
    caseNumber: '9999',
    branch: 'תל אביב',
    notes: 'בדיקת מערכת גבייה',
    invoiceNumber: '',
    receiptNumber: ''
  };

  var result = addRowToSheet(testData);
  Logger.log('תוצאת הוספת שורה: ' + JSON.stringify(result));

  var billingResult = createRecurringCharges(testData, result.rowNumber);
  Logger.log('תוצאת יצירת גבייה חוזרת: ' + JSON.stringify(billingResult));

  generateBillingDashboard();
  Logger.log('דשבורד עודכן');
}
