# 📋 טופס מכר - משרד עו"ד גיא הרשקוביץ

אפליקציית ווב מתקדמת להזנת רשומות מכר לצוות המשרד עם אינטגרציה מלאה ל-Firebase ו-Google Sheets.

## ✨ תכונות

- ✅ טופס רב-שלבי עם ממשק משתמש אינטואיטיבי
- ✅ שמירה אוטומטית ל-Firebase Firestore
- ✅ סנכרון אוטומטי ל-Google Sheets
- ✅ תמיכה מלאה במובייל (Responsive Design)
- ✅ ניהול בטוח של משתני סביבה
- ✅ בחירת משתמש בתחילת הטופס
- ✅ תמיכה באמצעי תשלום מרובים

---

## 🚀 התקנה והעלאה

### שלב 1: העלאה ל-GitHub

```bash
# אתחול Git repository
git init

# הוספת כל הקבצים
git add .

# יצירת commit ראשון
git commit -m "Initial commit - Sales Form Application"

# חיבור ל-GitHub (החלף YOUR_USERNAME בשם המשתמש שלך)
git remote add origin https://github.com/YOUR_USERNAME/sales-form.git

# שינוי שם ה-branch ל-main
git branch -M main

# העלאה ל-GitHub
git push -u origin main
```

---

### שלב 2: פריסה ב-Netlify

#### 2.1 חיבור ה-Repository

1. היכנס ל-[Netlify](https://app.netlify.com)
2. לחץ על **"Add new site"** → **"Import an existing project"**
3. בחר **GitHub** והתחבר
4. בחר את ה-repository שיצרת
5. הגדרות Build:
   - **Build command**: `bash build.sh`
   - **Publish directory**: `.`

#### 2.2 הגדרת משתני סביבה (Environment Variables)

**חשוב מאוד!** לפני הפריסה, הוסף את משתני הסביבה הבאים ב-Netlify:

1. לך ל-**Site settings** → **Environment variables**
2. הוסף את המשתנים הבאים:

```
FIREBASE_API_KEY=AIzaSyC9R_eupXtdkzEMBwA1Dsc6SC_14_iUNLs
FIREBASE_AUTH_DOMAIN=law-office-guide.firebaseapp.com
FIREBASE_DATABASE_URL=https://law-office-guide-default-rtdb.europe-west1.firebasedatabase.app
FIREBASE_PROJECT_ID=law-office-guide
FIREBASE_STORAGE_BUCKET=law-office-guide.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=903121364456
FIREBASE_APP_ID=1:903121364456:web:91d02f021ab618d3a6705d
FIREBASE_MEASUREMENT_ID=G-3NZXL9YB35
GOOGLE_SHEETS_WEBHOOK=https://script.google.com/macros/s/AKfycbx4en4xw-4cG7_ytYE66rLswHCoV8JDwg8g5-QL9geMFhhIdYY-2Qhw_ZgTR3R_e-7l/exec
```

#### 2.3 פריסה

1. לחץ על **"Deploy site"**
2. המתן לסיום הבנייה (כדקה)
3. האתר שלך מוכן! 🎉

---

## 🔧 הגדרות נוספות

### הוספת לוגו

1. העלה את קובץ הלוגו לתיקיית הפרויקט (למשל `logo.png`)
2. ב-[index.html:516](index.html#L516), החלף את:
```html
<div class="logo-placeholder">לוגו המשרד</div>
```
עם:
```html
<img src="logo.png" alt="לוגו משרד עו"ד גיא הרשקוביץ" style="max-width: 120px; height: auto;">
```

### שינוי שמות המשתמשים

ערוך את [index.html:526-546](index.html#L526-L546) לשינוי רשימת המשתמשים.

---

## 🗂️ מבנה הפרויקט

```
.
├── index.html              # הקובץ הראשי של האפליקציה
├── env-config.js          # ניהול משתני סביבה
├── build.sh               # סקריפט build עבור Netlify
├── netlify.toml           # הגדרות Netlify
├── .gitignore             # קבצים שלא להעלות ל-Git
└── README.md              # תיעוד הפרויקט
```

---

## 🔥 Firebase Configuration

- **Project**: law-office-guide
- **Collection**: sales_records
- **Region**: europe-west1

### Firebase Security Rules (מומלץ להגדיר)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sales_records/{document} {
      allow read, write: if true; // שנה לפי הצרכים שלך
    }
  }
}
```

---

## 📊 Google Sheets Integration

- **Spreadsheet ID**: `1iI8M0aSG-LaQf4dx6vsj873w8q33Fi4dUNjWeAM4Fds`
- **Webhook URL**: מוגדר במשתני הסביבה

הנתונים מסונכרנים אוטומטית ל-Google Sheets עם כל הגשת טופס.

---

## 🛡️ אבטחה

- ✅ מפתחות Firebase מוסתרים בקוד הייצור
- ✅ שימוש במשתני סביבה של Netlify
- ✅ Headers אבטחה ב-netlify.toml
- ✅ .gitignore למניעת העלאת קבצים רגישים

**לפיתוח מקומי**: המפתחות זמינים רק כאשר הדף רץ ב-localhost.

---

## 📱 Responsive Design

האפליקציה מותאמת במלואה למובייל עם breakpoints:
- Desktop: > 768px
- Tablet: 500px - 768px
- Mobile: < 500px

---

## 🧪 בדיקה מקומית

לבדיקה מקומית, פתח את `index.html` בדפדפן. המפתחות יטענו אוטומטית למצב localhost.

```bash
# אם יש לך Python מותקן:
python -m http.server 8000

# או עם Node.js:
npx serve .
```

ואז פתח בדפדפן: `http://localhost:8000`

---

## 🐛 פתרון בעיות

### הטופס לא שומר נתונים
- בדוק שמשתני הסביבה מוגדרים נכון ב-Netlify
- בדוק את ה-Console בדפדפן לשגיאות
- וודא ש-Firebase Security Rules מאפשרות כתיבה

### Google Sheets לא מתעדכן
- בדוק שה-Webhook URL נכון
- וודא שסקריפט Google Apps מופעל ומאושר

### בעיות responsive
- נקה את ה-cache של הדפדפן
- בדוק ב-Developer Tools במצב Mobile

---

## 📞 תמיכה

לשאלות ובעיות, פנה למפתח הפרויקט.

---

## 📝 License

© 2024 משרד עו"ד גיא הרשקוביץ ושות'. כל הזכויות שמורות.
