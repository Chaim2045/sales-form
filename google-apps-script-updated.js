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


function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const result = addRowToSheet(data);

    if (ENABLE_LOGGING) {
      logEntry(data, result.success);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'active',
      message: 'Webhook טופס מכר פעיל',
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type')
    .setHeader('Access-Control-Max-Age', '86400');
}


function addRowToSheet(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  // בניית מחרוזות מידע מאורגנות
  let creditCardInfo = '';
  if (data.paymentMethod === 'כרטיס אשראי') {
    if (data.creditCardStatus === 'חיוב חודשי') {
      creditCardInfo = `חיוב חודשי: ₪${data.monthlyCharge || ''} למשך ${data.monthsCount || ''} חודשים`;
    } else if (data.creditCardStatus === 'פיקדון') {
      if (data.monthlyCharge && data.monthsCount) {
        creditCardInfo = `פיקדון: ₪${data.monthlyCharge} למשך ${data.monthsCount} חודשים`;
        if (data.depositDetails) {
          creditCardInfo += ` | ${data.depositDetails}`;
        }
      } else if (data.depositDetails) {
        creditCardInfo = `פיקדון: ${data.depositDetails}`;
      }
    } else if (data.creditCardStatus === 'אשראי זמני - יוחלף' && data.temporaryCreditDetails) {
      creditCardInfo = `אשראי זמני: ${data.temporaryCreditDetails}`;
    }
  }

  let checksInfo = '';
  if (data.paymentMethod === 'שיקים דחויים') {
    checksInfo = `${data.checksCount || ''} צ'קים בסך ₪${data.checksTotalAmount || ''}`;
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

  // בניית השורה לפי סדר העמודות המעודכן
  const row = [
    data.timestamp || new Date().toISOString(),           // A: חותמת זמן
    formatDate(data.date) || formatDate(new Date()),      // B: תאריך
    data.formFillerName || '',                            // C: שם ממלא הטופס
    data.clientName || '',                                // D: שם הלקוח
    data.phone || '',                                     // E: טלפון
    data.email || '',                                     // F: מייל
    data.idNumber || '',                                  // G: ח.פ / ת.ז
    data.address || '',                                   // H: כתובת
    data.clientStatus || 'חדש',                           // I: לקוח חדש/קיים
    data.transactionType || '',                           // J: סוג העסקה
    data.transactionDescription || '',                    // K: תיאור העסקה
    data.hoursQuantity || '',                             // L: כמות שעות
    data.hourlyRate || '',                                // M: מחיר לשעה
    data.amountBeforeVat || data.amount || '',            // N: סכום לפני מע"מ
    data.vatAmount || '',                                 // O: מע"מ
    data.amountWithVat || '',                             // P: סכום כולל מע"מ
    data.paymentMethod || '',                             // Q: אמצעי תשלום
    data.isSplitPayment ? 'כן' : 'לא',                    // R: פיצול תשלום?
    splitPaymentInfo,                                     // S: פירוט פיצול תשלום
    creditCardInfo,                                       // T: פרטי כרטיס אשראי
    checksInfo,                                           // U: פרטי צ'קים
    data.checksPhotoURL || '',                            // V: קישור לתמונת צ'ק
    data.attorney || '',                                  // W: עו"ד מטפל
    data.caseNumber || '',                                // X: מספר תיק
    data.branch || 'תל אביב',                             // Y: סניף
    data.notes || '',                                     // Z: הערות
    data.invoiceNumber || '',                             // AA: מס' חשבונית
    data.receiptNumber || ''                              // AB: מס' קבלה
  ];

  sheet.appendRow(row);
  const newRowNumber = sheet.getLastRow();

  // אם יש קישור לתמונת צ'ק, הפוך אותו ל-HYPERLINK לחיץ
  if (data.checksPhotoURL) {
    const checkPhotoCell = sheet.getRange(newRowNumber, 22); // עמודה V
    checkPhotoCell.setFormula(`=HYPERLINK("${data.checksPhotoURL}", "📸 צפה בתמונה")`);
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
    creditCardStatus: 'חיוב חודשי',
    monthlyCharge: '118',
    monthsCount: '1',
    depositDetails: '',
    checksCount: '',
    checksTotalAmount: '',
    checksPhotoURL: '',
    checksDetails: '',
    checkWillChange: '',
    checkReplacementDetails: '',
    attorney: 'גיא הרשקוביץ',
    caseNumber: '',
    branch: 'תל אביב',
    notes: 'שורת בדיקה - ניתן למחוק',
    invoiceNumber: '',
    receiptNumber: ''
  };

  const result = addRowToSheet(testData);
  Logger.log(result);
}


// ========== פונקציה ליצירת כותרות מעודכנות ==========

function updateSheetHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  const headers = [
    'חותמת זמן',              // A
    'תאריך',                  // B
    'שם ממלא הטופס',          // C
    'שם הלקוח',               // D
    'טלפון',                  // E
    'מייל',                   // F
    'ח.פ / ת.ז',             // G
    'כתובת',                  // H
    'סטטוס לקוח',             // I
    'סוג העסקה',              // J
    'תיאור העסקה',            // K
    'כמות שעות',              // L
    'מחיר לשעה',              // M
    'סכום לפני מע"מ',         // N
    'מע"מ',                   // O
    'סכום כולל מע"מ',         // P
    'אמצעי תשלום',            // Q
    'פיצול תשלום?',           // R
    'פירוט פיצול תשלום',      // S
    'פרטי כרטיס אשראי',       // T
    'פרטי צ\'קים',            // U
    'תמונת צ\'ק',             // V
    'עו"ד מטפל',              // W
    'מספר תיק',               // X
    'סניף',                   // Y
    'הערות',                  // Z
    'מספר חשבונית',           // AA
    'מספר קבלה'               // AB
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  Logger.log('כותרות עודכנו בהצלחה!');
}
