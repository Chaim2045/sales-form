// פונקציה לתיקון כל הקישורים הקיימים ב-Google Sheets
// הרץ פונקציה זו פעם אחת אחרי עדכון הסקריפט

const SPREADSHEET_ID = '1iI8M0aSG-LaQf4dx6vsj873w8q33Fi4dUNjWeAM4Fds';
const SHEET_NAME = 'תגובות לטופס 1';

function fixExistingCheckLinks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log('אין שורות לתיקון');
    return;
  }

  // קרא את כל הנתונים בעמודה T (עמודה 20)
  const checksPhotoRange = sheet.getRange(2, 20, lastRow - 1, 1);
  const checksPhotoValues = checksPhotoRange.getValues();

  let fixedCount = 0;

  // עבור על כל שורה
  for (let i = 0; i < checksPhotoValues.length; i++) {
    const cellValue = checksPhotoValues[i][0];
    const rowNumber = i + 2; // שורה 2 היא השורה הראשונה עם נתונים

    // אם יש קישור בתא והוא לא HYPERLINK
    if (cellValue && typeof cellValue === 'string' && cellValue.startsWith('http')) {
      const cell = sheet.getRange(rowNumber, 20);

      // בדוק אם זה כבר HYPERLINK
      const formula = cell.getFormula();
      if (!formula || !formula.includes('HYPERLINK')) {
        // המר את הקישור ל-HYPERLINK
        cell.setFormula(`=HYPERLINK("${cellValue}", "📸 צפה בתמונה")`);
        fixedCount++;
        Logger.log(`תוקן קישור בשורה ${rowNumber}`);
      }
    }
  }

  Logger.log(`===========================`);
  Logger.log(`סה"כ קישורים שתוקנו: ${fixedCount}`);
  Logger.log(`===========================`);

  return {
    success: true,
    fixedCount: fixedCount,
    message: `תוקנו ${fixedCount} קישורים`
  };
}
