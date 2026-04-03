# WhatsApp Bot — הוראות התקנה

## דרישות מוקדמות
- Node.js 18+
- Google Chrome (מותקן על השרת)
- Firebase Service Account JSON
- Anthropic API Key

## שלבים

### 1. התקנת חבילות
```bash
cd whatsapp-bot
npm install
```

### 2. הגדרת Firebase Service Account
1. היכנס ל-Firebase Console: https://console.firebase.google.com
2. בחר את הפרויקט `law-office-sales-form`
3. Settings (גלגל שיניים) > Project Settings > Service Accounts
4. לחץ "Generate New Private Key"
5. שמור את הקובץ כ-`firebase-service-account.json` בתיקייה הזו

### 3. הגדרת Environment Variables
```bash
cp .env.example .env
```
ערוך את `.env`:
- `ANTHROPIC_API_KEY` — המפתח שלך (אותו אחד כמו ב-Netlify)
- `FIREBASE_SERVICE_ACCOUNT_PATH` — נתיב לקובץ JSON (ברירת מחדל: `./firebase-service-account.json`)
- `WHATSAPP_GROUP_NAME` — שם הקבוצה בדיוק כפי שמופיע בוואטסאפ
- `GOOGLE_SHEETS_WEBHOOK` — אופציונלי, לסנכרון לשיטס

### 4. הפעלה ראשונה
```bash
npm start
```
- יופיע QR code בטרמינל
- סרוק אותו מ-WhatsApp > הגדרות > מכשירים מקושרים > קישור מכשיר
- אחרי סריקה — הבוט מחובר ומאזין

### 5. בדיקה
שלח הודעה בקבוצת הוואטסאפ:
```
סקילס הליך משפטי שלב א' 18,000 שולם
```
הבוט יזהה את ההודעה, יפענח אותה, וישלח הודעת אישור.

## הרצה על שרת (24/7)

### אופציה א: Railway (חינמי/זול)
1. צור חשבון ב-railway.app
2. חבר את הריפו
3. הוסף את ה-environment variables
4. Deploy

### אופציה ב: VPS (DigitalOcean/Linode)
```bash
# התקנת pm2 לניהול תהליכים
npm install -g pm2

# הפעלה עם pm2
pm2 start index.js --name whatsapp-bot

# הפעלה אוטומטית אחרי restart
pm2 startup
pm2 save
```

### אופציה ג: המחשב שלך (לבדיקות)
```bash
npm start
```
הבוט ירוץ כל עוד הטרמינל פתוח.

## פתרון בעיות

| בעיה | פתרון |
|------|--------|
| QR code לא מופיע | התקן Chrome: `apt install chromium-browser` |
| Authentication failed | מחק `.wwebjs_auth/` ונסה שוב |
| Firebase error | ודא ש-`firebase-service-account.json` קיים ותקין |
| הבוט לא מגיב | ודא ששם הקבוצה ב-`.env` זהה לשם בוואטסאפ |
| Session expired | סרוק QR מחדש |
