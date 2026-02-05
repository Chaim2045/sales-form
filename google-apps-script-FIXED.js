/**
 * ===========================================
 * Google Apps Script - FIXED VERSION
 * משרד עו"ד גיא הרשקוביץ
 * ===========================================
 */

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
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'active',
      message: 'Webhook טופס מכר פעיל',
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}


function addRowToSheet(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  // Log the incoming data for debugging
  Logger.log('Received data: ' + JSON.stringify(data));
  Logger.log('checksPhotoURL: ' + data.checksPhotoURL);

  // בניית מחרוזות מידע מאורגנות
  let creditCardInfo = '';
  if (data.paymentMethod === 'כרטיס אשראי') {
    if (data.creditCardStatus === 'בוצע חיוב מלא') {
      const payments = data.paymentsCount || '';
      creditCardInfo = payments ? `בוצע חיוב מלא - ${payments} תשלומים` : 'בוצע חיוב מלא';
    } else if (data.creditCardStatus === 'חיוב חודשי') {
      creditCardInfo = `חיוב חודשי: ₪${data.monthlyCharge || ''} למשך ${data.monthsCount || ''} חודשים`;
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

  // 🔴 תיקון קריטי: בניית השורה בסדר המדויק של הכותרות!
  const row = [
    data.timestamp || new Date().toISOString(),           // A: חותמת זמן
    formatDate(data.date) || formatDate(new Date()),      // B: תאריך
    data.formFillerName || '',                            // C: שם ממלא הטופס
    data.clientName || '',                                // D: שם הלקוח
    data.phone || '',                                     // E: טלפון
    data.email || '',                                     // F: מייל
    data.idNumber || '',                                  // G: ח.פ / ת.ז
    data.address || '',                                   // H: כתובת
    data.clientStatus || 'חדש',                           // I: סטטוס לקוח
    data.transactionType || '',                           // J: סוג העסקה
    data.transactionDescription || '',                    // K: תיאור העסקה
    data.hoursQuantity || '',                             // L: כמות שעות
    data.hourlyRate || '',                                // M: מחיר לשעה
    data.amountBeforeVat || data.amount || '',            // N: סכום לפני מע"מ
    data.vatAmount || '',                                 // O: מע"מ
    data.amountWithVat || '',                             // P: סכום כולל מע"מ
    data.paymentMethod || '',                             // Q: אמצעי תשלום
    creditCardInfo,                                       // R: פרטי כרטיס אשראי
    checksInfo,                                           // S: פרטי צ'קים
    data.checksPhotoURL || '',                            // T: תמונת צ'ק
    data.attorney || '',                                  // U: עו"ד מטפל
    data.caseNumber || '',                                // V: מספר תיק
    data.branch || 'תל אביב',                             // W: סניף
    data.notes || '',                                     // X: הערות
    data.invoiceNumber || '',                             // Y: מספר חשבונית
    data.receiptNumber || ''                              // Z: מספר קבלה
  ];

  Logger.log('Row to append: ' + JSON.stringify(row));

  sheet.appendRow(row);
  const newRowNumber = sheet.getLastRow();

  Logger.log('New row number: ' + newRowNumber);
  Logger.log('Checks photo URL exists: ' + (data.checksPhotoURL ? 'YES' : 'NO'));

  // אם יש קישור לתמונת צ'ק, הפוך אותו ל-HYPERLINK לחיץ
  if (data.checksPhotoURL && data.checksPhotoURL.trim() !== '') {
    Logger.log('Creating hyperlink in column T (20)');
    const checkPhotoCell = sheet.getRange(newRowNumber, 20); // עמודה T
    checkPhotoCell.setFormula(`=HYPERLINK("${data.checksPhotoURL}", "📸 צפה בתמונה")`);
    Logger.log('Hyperlink created successfully');
  } else {
    Logger.log('No checks photo URL to create hyperlink');
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


// ========== פונקציות עזר ==========

function updateSheetStructure() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  Logger.log('מתחיל עדכון מבנה הגיליון...');

  // שלב 1: מחק את כל השורות מלבד שורת הכותרות
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
    Logger.log(`נמחקו ${lastRow - 1} שורות ישנות`);
  }

  // שלב 2: עדכן את שורת הכותרות
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
    'פרטי כרטיס אשראי',       // R
    'פרטי צ\'קים',            // S
    'תמונת צ\'ק',             // T
    'עו"ד מטפל',              // U
    'מספר תיק',               // V
    'סניף',                   // W
    'הערות',                  // X
    'מספר חשבונית',           // Y
    'מספר קבלה'               // Z
  ];

  // כתוב את הכותרות
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // עיצוב הכותרות
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4A90E2');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setHorizontalAlignment('center');

  // התאם רוחב עמודות
  sheet.autoResizeColumns(1, headers.length);

  Logger.log('===========================');
  Logger.log('✅ העדכון הושלם בהצלחה!');
  Logger.log('===========================');
  Logger.log(`עודכנו ${headers.length} עמודות`);
  Logger.log('הגיליון מוכן לקליטת נתונים חדשים');

  return {
    success: true,
    message: 'מבנה הגיליון עודכן בהצלחה',
    columnsCount: headers.length
  };
}


function diagnoseSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  Logger.log('===== אבחון מבנה הגיליון =====');
  Logger.log('');

  const lastColumn = sheet.getLastColumn();
  Logger.log(`סה"כ עמודות בגיליון: ${lastColumn}`);
  Logger.log('');

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  Logger.log('===== כותרות הגיליון =====');
  for (let i = 0; i < headers.length; i++) {
    const columnLetter = String.fromCharCode(65 + i);
    Logger.log(`עמודה ${columnLetter} (${i + 1}): "${headers[i]}"`);
  }
  Logger.log('');

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    Logger.log('===== השורה האחרונה שנוספה =====');
    const lastRowData = sheet.getRange(lastRow, 1, 1, lastColumn).getValues()[0];
    for (let i = 0; i < lastRowData.length; i++) {
      const columnLetter = String.fromCharCode(65 + i);
      const header = headers[i] || '(ללא כותרת)';
      Logger.log(`${columnLetter}. ${header}: "${lastRowData[i]}"`);
    }
  } else {
    Logger.log('אין שורות נתונים בגיליון');
  }

  Logger.log('');
  Logger.log('===== סיימתי אבחון =====');
}


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
