// סקריפט אבחון לבדיקת מבנה הגיליון
// הרץ פונקציה זו כדי לראות מה יש בגיליון

const SPREADSHEET_ID = '1iI8M0aSG-LaQf4dx6vsj873w8q33Fi4dUNjWeAM4Fds';
const SHEET_NAME = 'תגובות לטופס 1';

function diagnoseSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  Logger.log('===== אבחון מבנה הגיליון =====');
  Logger.log('');

  // כמה עמודות יש בגיליון?
  const lastColumn = sheet.getLastColumn();
  Logger.log(`סה"כ עמודות בגיליון: ${lastColumn}`);
  Logger.log('');

  // קרא את שורת הכותרות
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  Logger.log('===== כותרות הגיליון =====');
  for (let i = 0; i < headers.length; i++) {
    const columnLetter = String.fromCharCode(65 + i); // A, B, C...
    Logger.log(`עמודה ${columnLetter} (${i + 1}): "${headers[i]}"`);
  }
  Logger.log('');

  // אם יש שורות נתונים, הצג את השורה האחרונה
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
