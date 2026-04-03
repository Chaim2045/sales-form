# TOFES OFFICE - Comprehensive Project Documentation

**Project Name:** טופס מכר | Sales Form System  
**Organization:** משרד עו"ד גיא הרשקוביץ (Law Office - Guy Hershkowitz)  
**Repository:** https://github.com/Chaim2045/sales-form  
**Hosting:** Netlify  
**Backend:** Firebase (Firestore, Auth, Storage)  
**Technologies:** Vanilla JavaScript, HTML5, CSS3, Firebase, Netlify Functions (Node.js)

---

## 1. PROJECT OVERVIEW

TOFES OFFICE is a comprehensive legal office management system designed for recording sales transactions, managing recurring billing, handling OCR-based check processing, and maintaining audit logs. The system is built as a responsive web application with RTL (right-to-left) support for Hebrew language.

### Key Features
- **4-step multi-stage sales form** with real-time validation
- **Recurring billing management** with automatic payment tracking
- **OCR check extraction** using Google Vision API + Claude AI
- **Client autocomplete** search from both sales and billing records
- **Role-based access control** with Firebase Security Rules
- **Audit logging** for all user actions
- **Encryption** of sensitive credit card data (PBKDF2 + AES-256-CBC)
- **Service worker** for offline support
- **Mobile-responsive design** with Material Design principles
- **Google Sheets integration** via Google Apps Script webhooks

---

## 2. FULL FILE TREE & STRUCTURE

```
/TOFES OFFICE/
├── index.html                      # Main application shell (8,000+ lines, RTL Hebrew)
├── env-config.js                   # Firebase environment configuration
├── build.sh                        # Build script for Netlify (replaces env vars)
├── firebase.json                   # Firebase hosting config
├── firestore.rules                 # Firestore security rules
├── storage.rules                   # Firebase Storage security rules (checks only)
├── netlify.toml                    # Netlify configuration with CSP headers
├── manifest.json                   # PWA manifest
├── service-worker.js               # Service Worker for offline functionality
├── README.md                       # Project documentation
│
├── css/
│   ├── variables.css               # Design system tokens (95 lines)
│   ├── layout.css                  # Header, footer, container layouts (324 lines)
│   ├── components.css              # Buttons, forms, cards, badges (687 lines)
│   ├── sales-form.css              # Multi-step form styling (346 lines)
│   ├── billing.css                 # Billing modal & management UI (1,478 lines)
│   ├── modals.css                  # Modal overlays, dialogs (539 lines)
│   └── mobile.css                  # Mobile breakpoints (1,193 lines)
│
├── js/
│   ├── firebase-init.js            # Firebase initialization, auth listener (213 lines)
│   ├── auth.js                     # Login, logout, quick login (biometric) (164 lines)
│   ├── navigation.js               # Bottom nav, tab switching, greeting (151 lines)
│   ├── sales-form.js               # 4-step form logic, validation (1,014 lines)
│   ├── sales-records.js            # Sales management view (868 lines)
│   ├── client-search.js            # Autocomplete search logic (204 lines)
│   ├── form-draft.js               # Auto-save form to localStorage (310 lines)
│   ├── payments.js                 # Payment modal & management (1,492 lines)
│   ├── billing.js                  # Recurring billing modal & management (2,013 lines)
│   ├── encryption.js               # PBKDF2+AES-256 encryption/decryption (335 lines)
│   ├── file-upload.js              # Firebase Storage upload handler (384 lines)
│   ├── ocr-check.js                # Client-side OCR trigger & PDF handling (405 lines)
│   ├── activity-log.js             # Audit log viewer (637 lines)
│   ├── user-management.js          # User creation, permissions (432 lines)
│   └── sheets-sync.js              # Google Sheets webhook (32 lines)
│
├── netlify/functions/
│   ├── ocr-check.js                # Netlify function: Vision API + Claude (242 lines)
│   └── reset-password.js           # Firebase auth reset endpoint
│
├── scripts/
│   ├── diagnose-sheet.js           # Debug script for Sheets integration
│   ├── fix-existing-links.js       # Migration helper
│   ├── google-apps-script.js       # Google Sheets bound script template
│   └── setup-users.js              # Initial Firebase user setup
│
├── assets/
│   ├── logo.png                    # Law office logo (192x192, 512x512)
│   └── hero-image.png              # Header hero image
│
├── .vscode/
│   └── settings.json               # VSCode Live Server port config
│
└── .claude/
    ├── settings.json               # Claude settings (backup)
    └── settings.local.json         # Local development settings
```

**Total Project Size:** 12 MB  
**Total Files:** 45 (excluding .git)  
**Total Lines of Code:** ~13,316 lines

---

## 3. CORE JAVASCRIPT FILES - DETAILED BREAKDOWN

### 3.1 firebase-init.js (213 lines)
**Purpose:** Central Firebase initialization and authentication state management

**Key Functions:**
- `auth.onAuthStateChanged()` - Handles login/logout, loads user permissions from Firestore
- Session timeout (30 min idle) - Auto-logout on inactivity
- Audit logging infrastructure
- Strong password validation (6+ chars, uppercase, number, special char)
- Israeli phone and ID validation helper functions

**Global Variables:**
- `authUser` - Firebase Auth user object
- `currentUser` - Display name from Firestore user doc
- `currentUserPermissions` - Role-based permissions object
- `currentUserRole` - 'master' or regular user
- `VAT_RATE` - 0.18 (18% Israeli VAT)

**Security:**
- Firebase Security Rules checked on all DB operations
- SessionStorage caching for performance
- Automatic sign-out on missing/inactive user doc

---

### 3.2 auth.js (164 lines)
**Purpose:** Authentication UI handlers and quick login (biometric)

**Key Functions:**
- `handleLogin()` - Email/password authentication
- `handleQuickLogin()` - Biometric/saved credential login via PasswordCredential API
- `handleLogout()` - Session cleanup and UI reset
- `storeCredentials()` - Stores credentials for quick login (browser support required)
- `checkQuickLoginAvailable()` - Detects if credentials are available

**Features:**
- Enter-key support on login form
- Comprehensive error messages in Hebrew
- Biometric support (Android, Windows Hello, Safari)
- Audit logging for failed attempts

---

### 3.3 navigation.js (151 lines)
**Purpose:** Tab/view navigation, user greeting, bottom navigation bar

**Key Functions:**
- `navHome()`, `navBillingMgmt()`, `navSalesMgmt()`, `navActivityLog()`, `navUserMgmt()`
- `updateNavVisibility()` - Shows/hides nav buttons based on user permissions
- `showUserGreeting()` - Displays "Good morning/afternoon, [Name]"
- `updateGreetingTime()` - Refreshes greeting time every minute

**Features:**
- Bottom navigation with active state
- Permission-based visibility (salesForm, billingManagement, salesManagement, etc.)
- Time-based greeting messages (בוקר, צהריים, ערב, לילה)
- Smooth view transitions

---

### 3.4 sales-form.js (1,014 lines) ⭐ CORE FILE
**Purpose:** 4-step sales transaction form logic and validation

**Form Steps:**
1. **Client Details** - Name, phone, ID, email, address, status (new/existing)
2. **Transaction Details** - Type (consultation, retainer, hours, legal case, etc.), description, amount, VAT calculation
3. **Payment Method** - Credit card, bank transfer, cash, Bit, checks (post-dated), split payment
4. **Summary** - Review all fields before submission

**Key Functions:**
- `nextStep()`, `prevStep()`, `showStep(step)` - Step navigation
- `validateStep(step)` - Comprehensive validation with error messages
- `updateProgress()` - Progress bar animation
- `displayAutoFillFeedback()` - Toast notification for autocomplete

**Payment Method Conditional Fields:**
- **Credit Card** - Charge status (full, monthly, deposit, temporary), payment count, monthly charge, recurring dates
- **Checks** - Number of checks, total amount, check photo upload, OCR extraction
- **Split Payment** - Multiple payment methods with custom amounts
- **Bank Transfer** - Basic amount confirmation
- **Cash/Bit** - Simple confirmation

**Validation:**
- Required field checking with Hebrew error messages
- Israeli phone number format (starting with 0, 9-10 digits)
- Israeli ID validation (Luhn algorithm)
- Amount > 0 check
- Date validation (future dates for checks)
- Split payment sum matching total amount

**Form Data Submitted:**
```javascript
{
    timestamp, date,
    formFillerName (currentUser),
    clientName, phone, email, idNumber, address,
    clientStatus (new/existing),
    transactionType, transactionDescription,
    hoursQuantity, hourlyRate (if applicable),
    amountBeforeVat, vatAmount, amountWithVat,
    paymentMethod,
    isSplitPayment, paymentBreakdown (JSON),
    creditCardStatus, paymentsCount, monthlyCharge,
    checksCount, checksPhotoURL,
    and more...
}
```

---

### 3.5 payments.js (1,492 lines)
**Purpose:** Modal for viewing/editing recurring billing payment records

**Key Functions:**
- `openPaymentModal(docId)` - Fetches and displays payment schedule
- `generatePaymentDocs(docId, client)` - Creates individual payment records from billing setup
- `markSinglePayment(docId, paymentId)` - Marks payment as completed
- `editCompletedPayment()` - Edit a completed payment's amount/date
- `deletePayment()` - Remove a payment from the series
- `renderPaymentModal(client, payments)` - Renders payment table with status indicators
- `formatDateHebrew()` - Converts ISO dates to DD/MM/YYYY

**Payment States:**
- `ממתין` (Pending) - Future or current month
- `באיחור` (Overdue) - Past due date, not yet paid
- `בוצע` (Completed) - Marked as paid
- `בוטל` (Cancelled) - Removed from series

**Firestore Structure:**
```
recurring_billing/{docId}/
  ├── clientName, phone, email, idNumber
  ├── recurringMonthlyAmount, recurringMonthsCount
  ├── recurringStartDate, recurringDayOfMonth
  ├── totalPlannedAmount, totalActualPaid
  ├── completedPaymentsCount, status
  └── payments/
      ├── {paymentId}/
      │   ├── monthNumber, plannedAmount, plannedDate
      │   ├── actualAmountPaid, actualPaymentDate
      │   ├── status, receiptNumber, notes
      │   └── completedBy
```

---

### 3.6 billing.js (2,013 lines) ⭐ CORE FILE
**Purpose:** Recurring billing management - create and manage recurring charges

**Key Functions:**
- `openBillingModal()` - Open billing creation modal
- `submitBillingForm()` - Save new recurring billing client
- `showBillingManagement()` - Display all billing clients in table/card view
- `searchClients()` - Autocomplete for existing clients
- `fillBillingClientData()` - Prefill form from autocomplete
- `validateCardNumber()`, `validateCardExpiry()` - Card validation (Luhn algorithm)

**Billing Features:**
- Create recurring monthly charges for retainer/subscription clients
- Encrypt sensitive credit card data (PBKDF2 + AES-256-CBC)
- Store only last 4 digits visible
- Support for custom amounts per month (override default)
- Mark months as already-paid (paidMonthsAlready)
- Billing ID prefix for tracking (BIL-{timestamp})
- Payment reminders via system

**Credit Card Storage:**
- `cardEncrypted` - Full card number encrypted with user passphrase
- `cvvEncrypted` - CVV encrypted separately
- `cardExpiryEncrypted` - Expiry date encrypted
- `cardHolderEncrypted` - Cardholder name encrypted
- `cardLast4` - Last 4 digits in plain text for reference
- `cardType` - Visa, Mastercard, etc. (not encrypted)

**Management Views:**
- Table view - All active clients, sortable by payment status, amount, due date
- Card view - Individual client cards with quick stats
- Filter by status (active, completed, cancelled)
- Search, edit, delete operations

---

### 3.7 encryption.js (335 lines)
**Purpose:** PBKDF2 + AES-256-CBC encryption for sensitive data

**Encryption Scheme:**
```
Format: "v2:{base64-salt}:{base64-iv}:{base64-ciphertext}"

1. Generate 128-bit random salt
2. Generate 128-bit random IV
3. Derive 256-bit key via PBKDF2-SHA256 (100,000 iterations)
4. Encrypt plaintext with AES-256-CBC
5. Encode all components to base64
```

**Key Functions:**
- `encryptCardData(cardNumber, passphrase)` - Encrypts credit card data
- `decryptCardData(encryptedData, passphrase)` - Decrypts with password prompt
- `validateCardNumber(num)` - Luhn algorithm validation
- `validateCardExpiry(expiry)` - MM/YY format, not expired
- `requestPassword(mode)` - Password popup for encrypt/decrypt
- `reEncryptToV2(encryptedData, passphrase)` - Migrates legacy data to v2

**Security Features:**
- Client-side rate limiting (5 failed attempts = 5 min lockout)
- Server-side rate limiting via Firestore `decrypt_rate_limit` collection
- Passphrase required to VIEW card data (prompted each time)
- No automatic decryption
- Legacy format support with migration

**Password Requirements (for encryption mode):**
- Minimum 6 characters
- Must be saved to secure location (checkbox confirmation required)

---

### 3.8 file-upload.js (384 lines)
**Purpose:** Firebase Storage uploads with validation and preview

**File Upload Process:**
1. Validate file type (JPEG, PNG, GIF, WebP, HEIC, PDF)
2. Validate file size (max 10 MB)
3. Generate UUID for secure filename
4. Upload to Firebase Storage `/checks/{uuid}.{ext}`
5. Get download URL

**Key Functions:**
- `uploadFile(file, path)` - Main upload handler
- `generateUUID()` - Secure UUID generation
- `compressImageBase64()` - Compress images to fit Netlify 1MB function limit
- Preview handling on file selection
- Clear file handler

**Security:**
- No user-controlled filenames (UUID only)
- File type and size validation
- Custom metadata with upload timestamp and user email
- Firestore Storage Rules restrict to authenticated users

---

### 3.9 ocr-check.js (405 lines) + netlify/functions/ocr-check.js (242 lines)
**Purpose:** OCR extraction of check details using Google Vision API + Claude AI

**Client-side Process (ocr-check.js):**
1. User selects image or PDF of checks
2. If PDF: convert pages to images using pdf.js
3. For each image:
   - Compress to <700KB to fit Netlify function limit
   - Extract text via Google Vision API
4. Send ALL extracted texts to Claude API in ONE request
5. Parse structured check data (date, amount) from Claude response
6. Populate check details form

**Server-side Process (netlify/functions/ocr-check.js):**
1. Verify Firebase auth token
2. If single image: Call Google Vision API
3. Extract text with TEXT_DETECTION feature
4. Send text to Claude API with prompt:
   - Extract date (DD/MONTH/YEAR format from OCR)
   - Extract amount (₪ currency format)
   - Handle OCR artifacts (leading 1s, spaces, dots instead of commas)
   - Return JSON array of extracted checks

**Claude Prompt Optimization:**
- Account for OCR smashing digits ("304 26" → 30/4/26)
- Handle Hebrew date formatting
- Ignore check numbers, account numbers, phone numbers
- Parse Shekel amounts with thousands separators

**Check Details Extracted:**
```javascript
[
  { date: "YYYY-MM-DD", amount: 8850 },
  { date: "YYYY-MM-DD", amount: 8850 }
]
```

**Limitations:**
- Max 10 PDF pages to avoid excessive API calls
- Requires GOOGLE_VISION_API_KEY and ANTHROPIC_API_KEY env vars
- Base64 compression to stay under 1MB Netlify function limit

---

### 3.10 activity-log.js (637 lines)
**Purpose:** Audit log viewer for compliance and investigation

**Audit Events Logged:**
- `login_success`, `login_failed`, `logout`
- `form_step_change` - User navigates through sales form steps
- `card_view` - User views a sales record
- `sales_record_created`, `sales_record_updated`, `sales_record_deleted`
- `billing_created`, `billing_updated`, `billing_deleted`
- `payment_marked_done`, `payment_deleted`
- `client_autocomplete_used`
- `session_timeout`
- `user_created`, `user_permissions_updated`
- `nav_*` - Navigation events

**Firestore Structure:**
```
audit_log/{docId}/
  ├── action - Event type (string)
  ├── details - Event-specific data (object)
  ├── performedBy - Display name
  ├── authEmail - Firebase auth email
  ├── timestamp - Server timestamp
  ├── clientTimestamp - Browser time
  └── userAgent - Browser details
```

**Deduplication:**
- Prevents duplicate events within 5 seconds (AUDIT_DEDUP_MS)
- Checks `_lastAuditAction` and `_lastAuditTime`

**Viewer Features:**
- Filter by action type
- Filter by user
- Date range picker
- Search by client name
- Export to CSV
- Real-time updates

---

### 3.11 user-management.js (432 lines)
**Purpose:** Create users, assign permissions, manage roles

**User Roles:**
- `master` - Full admin access, can manage other users
- Regular user - Limited by permissions object

**User Permissions Object:**
```javascript
{
  "salesForm": true,           // Can submit sales transactions
  "billingManagement": true,   // Can create/edit recurring billing
  "salesManagement": true,     // Can view/edit all sales records
  "activityLog": true,         // Can view audit logs
  "userManagement": true       // Can create/manage users (requires master role)
}
```

**Firestore User Document:**
```
users/{uid}/
  ├── displayName - Attorney name
  ├── email - Firebase auth email
  ├── role - 'master' or 'user'
  ├── isActive - true/false (can be deactivated)
  ├── permissions - Object with permission flags
  ├── createdBy - Who created this user
  ├── createdAt - Timestamp
  └── lastLogin - Server timestamp
```

**Key Functions:**
- `createNewUser(email, password)` - Firebase auth + Firestore doc
- `updateUserPermissions(uid, permissions)` - Modify permission flags
- `toggleUserActive(uid, isActive)` - Deactivate/reactivate user
- `deleteUser(uid)` - Only master users

**Password Security:**
- Strong password validation required on create
- Password reset via email (Firebase default)
- No plaintext passwords in Firestore

---

### 3.12 client-search.js (204 lines)
**Purpose:** Autocomplete search across sales_records and recurring_billing

**Search Features:**
- Search by client name (case-insensitive substring match)
- Query both collections in parallel for speed
- Deduplicate clients that appear in both collections
- Return with contact info for reference

**Firestore Queries:**
```javascript
// sales_records (last 500 docs, ordered by timestamp)
db.collection('sales_records')
  .orderBy('timestamp', 'desc')
  .limit(500)
  .get()

// recurring_billing (last 500 docs, ordered by createdAt)
db.collection('recurring_billing')
  .orderBy('createdAt', 'desc')
  .limit(500)
  .get()
```

**Auto-fill on Selection:**
- Step 1 fields: clientName, phone, email, idNumber, address
- Marks as "existing client"
- Step 4 fields: attorney, branch, caseNumber (if available)

---

### 3.13 form-draft.js (310 lines)
**Purpose:** Auto-save form progress to localStorage to prevent data loss

**Features:**
- Auto-save after every field change (debounced)
- Load saved draft on page reload
- Clear draft option
- Show "draft available" indicator
- Restore from draft button

**Saved Data:**
```javascript
localStorage['tofes_formDraft_' + currentUser] = {
  currentStep,
  clientName, phone, email, idNumber, address,
  clientStatus, transactionType, transactionDescription,
  amount, hoursQuantity, hourlyRate,
  paymentMethod, creditCardStatus, paymentsCount,
  checksCount, checkDetails array,
  attorney, branch, caseNumber,
  and all other form fields...
}
```

**Debouncing:**
- Saves on input/change events with 500ms delay
- Prevents excessive localStorage writes

---

### 3.14 sales-records.js (868 lines)
**Purpose:** View, search, filter, and export sales transactions

**Management Features:**
- Table/card view toggle
- Filter by date range, transaction type, payment method, status
- Search by client name, phone, email
- Sort by amount, date, attorney
- Quick stats (total sales, average deal size, payment methods breakdown)
- Export to CSV
- PDF generation from transaction records
- PDF download with official letterhead

**Firestore Queries:**
```javascript
// Get all sales (paginated, 50 per page)
db.collection('sales_records')
  .orderBy('timestamp', 'desc')
  .limit(50)
  .get()
```

**PDF Export:**
- Uses jspdf + html2canvas
- Includes law office logo, transaction details, calculation breakdown
- Professional formatting with payment method details
- Hebrew language support

---

### 3.15 sheets-sync.js (32 lines)
**Purpose:** Minimal - triggers Google Sheets webhook on form submit

**Function:**
- Calls Google Apps Script webhook on sales record submission
- Appends row to Google Sheets automatically
- Webhook URL from env-config.js

---

## 4. CSS FILES - DESIGN SYSTEM

### 4.1 variables.css (95 lines)
**Design System Tokens:**

```css
/* Accent Colors */
--accent: #3b82f6
--accent-hover: #2563eb
--accent-subtle: rgba(59,130,246,0.06)
--accent-ring: rgba(59,130,246,0.15)

/* Text Colors (opacity-based) */
--text-primary: rgba(0,0,0,0.88)
--text-secondary: rgba(0,0,0,0.55)
--text-tertiary: rgba(0,0,0,0.4)
--text-quaternary: rgba(0,0,0,0.25)

/* Backgrounds */
--bg-primary: #ffffff
--bg-hover: rgba(0,0,0,0.02)
--bg-active: rgba(0,0,0,0.04)
--bg-elevated: rgba(0,0,0,0.05)

/* Borders */
--border-default: rgba(0,0,0,0.06)
--border-strong: rgba(0,0,0,0.08)
--border-input: rgba(0,0,0,0.1)

/* Semantic Colors (muted) */
--success: rgba(16,185,129,0.8)
--error: rgba(239,68,68,0.75)
--warning: rgba(245,158,11,0.75)

/* Shadows */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04)
--shadow-md: 0 0 0 1px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)
--shadow-lg: 0 0 0 1px rgba(0,0,0,0.08), 0 8px 40px rgba(0,0,0,0.08)

/* Radius */
--radius-sm: 4px
--radius-md: 6px
--radius-lg: 8px
```

**Global Scrollbar:**
- Thin, subtle scrollbar across all elements
- Matches design system
- Firefox and Chrome support

---

### 4.2 layout.css (324 lines)
- Header with logo and law office name
- Main container with padding/margins
- Footer with copyright
- Bottom navigation bar (fixed)
- Grid/flex utilities

### 4.3 components.css (687 lines)
- Buttons (primary, secondary, danger)
- Form inputs with focus states
- Badges and status indicators
- Cards and containers
- Progress bars
- Step indicators
- Autocomplete dropdowns

### 4.4 sales-form.css (346 lines)
- Multi-step form layout
- Form groups and row layouts
- Radio buttons and checkboxes
- Quick-select chips for transaction types
- VAT display calculation
- Progress line animation

### 4.5 billing.css (1,478 lines)
- Billing modal structure
- Payment table with inline editing
- Monthly amount customization
- Status badge colors
- Card encryption UI
- Split payment row builder
- Summaries and totals display

### 4.6 modals.css (539 lines)
- Modal overlay with backdrop
- Input modal (simple text/number/date inputs)
- Password popup for encryption
- Notification panels
- Slide-in animations
- Escape-key closing

### 4.7 mobile.css (1,193 lines)
**Breakpoints:**
- Tablet: 500px - 768px
- Mobile: < 500px
- Desktop: > 768px

**Mobile Features:**
- Stack form groups vertically
- Single-column layouts
- Larger touch targets (44px min)
- Simplified navigation
- Bottom sheet modals
- Optimized font sizes
- Reduced padding/margins

---

## 5. HTML STRUCTURE - index.html

### 5.1 Main Sections

**Login Screen**
- Email and password inputs
- Quick Login button (if credentials saved)
- Error message display
- Logo and branding

**Main Container (Hidden by Default)**

**Header**
- Logo image
- "טופס מכר" title
- Law office name

**User Greeting Bar**
- Time-based greeting message
- Current time display (updates every minute)

**Main Form (4 Steps)**

**Step 1: Client Details**
```html
<div class="form-step active" data-step="1">
  - Client name (with autocomplete)
  - Phone (Israeli format: 0XX-XXXXXXX)
  - ID/Business number
  - Email
  - Address (optional)
  - Client status radio (new/existing)
</div>
```

**Step 2: Transaction Details**
```html
<div class="form-step" data-step="2">
  - Transaction type chips (retainer, consultation, hours, legal case, other)
  - Hours package (conditional: hours qty + hourly rate)
  - Transaction description
  - Amount (before VAT)
  - VAT calculation display (18%)
  - Amount with VAT display
</div>
```

**Step 3: Payment Method**
```html
<div class="form-step" data-step="3">
  - Payment method radios:
    * Credit Card
    * Bank Transfer
    * Cash
    * Bit
    * Post-dated Checks
    * Split Payment
  
  - Credit Card Section (conditional):
    * Charge status (full, monthly, deposit, temporary)
    * Payment count (if full charge)
    * Monthly details (if recurring)
    * Deposit details (if deposit)
  
  - Checks Section (conditional):
    * Number of checks
    * Total amount
    * Check photo upload with OCR button
    * Dynamic check details table (date + amount per check)
  
  - Split Payment Section (conditional):
    * Add payment method rows
    * Method selector + amount inputs
    * Payment summary with remaining balance
</div>
```

**Step 4: Summary**
```html
<div class="form-step" data-step="4">
  - Attorney selection
  - Branch selection
  - Case number (optional)
  - Notes (optional)
  - Complete Form submission
</div>
```

**Success Screen** (Hidden)
- Confirmation message
- Transaction details summary
- "Back to Form" button
- Share/Email option

**Bottom Navigation**
- Home button
- Add Billing button
- Billing Management button
- Sales Management button
- Activity Log button
- User Management button
- Logout button

**Modals** (Hidden by Default)
- Input Modal (generic text/number/date)
- Password Popup (for encryption)
- Billing Modal (create recurring charge)
- Payment Modal (manage monthly payments)
- Notification Panel

---

## 6. FIRESTORE DATABASE SCHEMA

### 6.1 Collections

**users/{uid}**
- Authentication and user profile
- Role-based permissions
- Activity tracking

**sales_records/{docId}**
- All completed sales transactions
- Contains full form submission data
- Indexed by timestamp

**recurring_billing/{docId}**
- Recurring billing clients
- Payment schedule metadata
- Encrypted credit card data

**recurring_billing/{docId}/payments/{paymentId}**
- Individual payment records
- Status tracking (pending, completed, overdue, cancelled)
- Actual payment amount and date

**audit_log/{docId}**
- All system actions for compliance
- Not editable after creation
- Contains user, timestamp, action, details

**decrypt_rate_limit/{uid}**
- Server-side rate limiting for password attempts
- Lockout tracking for security

---

### 6.2 Security Rules (firestore.rules)

**Access Levels:**
- `isAuth()` - User is authenticated
- `isActive()` - User doc exists and isActive=true
- `hasPermission(perm)` - Check specific permission flag
- `isMaster()` - User role is 'master'

**Rules:**
- users: Self-read, master-managed
- sales_records: Active users can read/create/update if have salesForm permission
- recurring_billing: Active users can read/create/update if have billingManagement
- audit_log: Create with any auth, read if have activityLog permission
- decrypt_rate_limit: Self-manage for rate limiting

---

### 6.3 Storage Rules (storage.rules)

**Allowed:**
- `/checks/{fileName}` - Authenticated users can upload/read checks
  - Max 10 MB
  - Image or PDF only
  - User and timestamp in metadata

**Denied:**
- All other paths

---

## 7. FIREBASE CONFIGURATION

**Project:** law-office-sales-form  
**Region:** Default (US central)  
**Auth:** Email/Password
**Database:** Cloud Firestore
**Storage:** Cloud Storage for Firebase

**Environment Variables** (env-config.js):
```javascript
window.ENV_CONFIG = {
  FIREBASE_API_KEY: 'AIzaSyAkRGg1HUaJhimwIhRir7wQ0vrZRUuqIy8',
  FIREBASE_AUTH_DOMAIN: 'law-office-sales-form.firebaseapp.com',
  FIREBASE_DATABASE_URL: '...',
  FIREBASE_PROJECT_ID: 'law-office-sales-form',
  FIREBASE_STORAGE_BUCKET: 'law-office-sales-form.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '120096251777',
  FIREBASE_APP_ID: '1:120096251777:web:...',
  GOOGLE_SHEETS_WEBHOOK: 'https://script.google.com/macros/s/...'
}
```

---

## 8. DEPLOYMENT

### 8.1 Netlify Configuration (netlify.toml)

**Build:**
- Node 18 runtime
- Build command: `echo 'No build required - static site'`
- Publish directory: `.`

**Functions:**
- Directory: `netlify/functions`
- Node.js runtime for OCR and password reset

**Redirects:**
- `/api/*` → `/.netlify/functions/:splat` (route API to functions)
- `/*` → `/index.html` (SPA routing)

**Security Headers:**
- CSP with specific Google, Firebase, CDN domains
- X-Frame-Options: DENY
- HSTS with preload
- Permissions-Policy: camera, microphone, geolocation, payment disabled
- Referrer-Policy: strict-origin-when-cross-origin

**Environment Variables (Required in Netlify Dashboard):**
```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
GOOGLE_SHEETS_WEBHOOK
GOOGLE_VISION_API_KEY (for OCR)
ANTHROPIC_API_KEY (for OCR parsing)
FIREBASE_WEB_API_KEY (for auth verification in functions)
```

### 8.2 Build Script (build.sh)

Replaces environment variable placeholders in `env-config.js`:
```bash
sed -i "s|NETLIFY_FIREBASE_API_KEY_PLACEHOLDER|${FIREBASE_API_KEY}|g" env-config.js
# ... (similar for each variable)
```

---

## 9. NETLIFY FUNCTIONS

### 9.1 ocr-check.js (242 lines)
**Endpoint:** `POST /.netlify/functions/ocr-check`

**Request:**
```javascript
{
  "idToken": "Firebase JWT token",
  "imageBase64": "data:image/...;base64,...", // OR
  "ocrTexts": ["Raw OCR text from Vision API", ...],
  "visionOnly": true // Optional: return raw text without Claude parsing
}
```

**Response:**
```javascript
{
  "success": true,
  "checks": [
    { "date": "2026-03-30", "amount": 8850, "index": 1 },
    { "date": "2026-04-15", "amount": 10000, "index": 2 }
  ],
  "rawText": "Full OCR text from Vision API"
}
```

**Process:**
1. Verify Firebase auth token (rate limited)
2. If image: Call Google Vision API with TEXT_DETECTION
3. If preextracted texts: Skip Vision
4. Send OCR text to Claude API with parsing prompt
5. Return structured check data

**Error Handling:**
- 401: Missing/invalid auth token
- 400: Missing image or text data
- 500: API errors (Vision, Claude, or auth)
- CORS: Automatic based on request origin

### 9.2 reset-password.js
**Endpoint:** `POST /.netlify/functions/reset-password`

Handles Firebase password reset via email. Not used in current UI (Firebase default email link).

---

## 10. GOOGLE INTEGRATION

### 10.1 Google Sheets Webhook

**Webhook URL:** (from env-config.js)
```
https://script.google.com/macros/s/AKfycbw8WecTKjzf.../exec
```

**Trigger:** On successful sales_record submission

**Bound Script Template:** In `scripts/google-apps-script.js`

**Function:**
```javascript
function doPost(e) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName('Sales Records');
  
  var data = JSON.parse(e.postData.contents);
  
  sheet.appendRow([
    data.date,
    data.clientName,
    data.phone,
    data.amount,
    data.paymentMethod,
    data.formFillerName
  ]);
  
  return ContentService.createTextOutput(JSON.stringify({success: true}))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 11. SERVICE WORKER (service-worker.js)

**Features:**
- Install event: Cache assets
- Fetch event: Serve from cache, fall back to network
- Offline support for previously viewed pages
- Version-based cache busting

**Cached Assets:**
- index.html
- CSS files
- JS files (vendor + custom)
- Assets (logo, images)

**Not Cached:**
- Firebase API calls
- Netlify functions
- Real-time database operations

---

## 12. SECURITY FEATURES

### 12.1 Authentication
- Firebase email/password with strong validation
- Quick Login via PasswordCredential API (biometric support)
- Session timeout (30 min idle)
- Auto-logout on user doc deactivation

### 12.2 Data Protection
- PBKDF2 (100,000 iterations) + AES-256-CBC encryption for credit cards
- User passphrase required to view card data
- Rate limiting (5 failed decrypt attempts = 5 min lockout)
- Server-side rate limit tracking in Firestore

### 12.3 Authorization
- Role-based access control (master vs regular user)
- Permission-based feature visibility
- Firestore Security Rules enforce all access
- No client-side auth bypass possible

### 12.4 Data Validation
- Israeli phone number validation (starts with 0, 9-10 digits)
- Israeli ID validation (Luhn algorithm)
- Credit card validation (Luhn algorithm)
- Card expiry validation (MM/YY, not expired)
- Amount > 0 checks
- File type and size validation
- XSS prevention via HTML escaping

### 12.5 Audit & Compliance
- All actions logged with timestamp, user, action type, details
- Audit logs immutable (no delete/update)
- Activity log viewer for investigations
- User agent tracking
- Timestamp from server (not client)

### 12.6 Network Security
- HTTPS enforced (Netlify automatic)
- CSP headers with whitelist for Google/Firebase/CDNs
- CORS enabled for specific origins only
- Subresource Integrity (SRI) on external scripts
- No mixed content

---

## 13. EXTERNAL DEPENDENCIES

### 13.1 Firebase (v10.7.1)
```html
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js" integrity="sha384-..."></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js" integrity="sha384-..."></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js" integrity="sha384-..."></script>
<script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js" integrity="sha384-..."></script>
```

### 13.2 Cryptography (CryptoJS 4.2.0)
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js"></script>
```

### 13.3 PDF Generation (jsPDF 2.5.2, html2canvas 1.4.1)
```html
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
```

### 13.4 PDF Parsing (PDF.js 3.11.174)
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
```

### 13.5 Fonts (Google Fonts)
- Heebo: Hebrew-optimized sans-serif
- Weights: 300, 400, 500, 600, 700

---

## 14. DEVELOPMENT & TESTING

### 14.1 Local Development

**Start local server:**
```bash
# Python
python -m http.server 8000

# Node.js
npx serve .

# VSCode Live Server
# Uses port 5503 (configured in .vscode/settings.json)
```

**Access:** `http://localhost:8000` (or 5503)

### 14.2 Environment
- `.env` (git-ignored)
- `env-config.js` (public Firebase keys - safe to expose)
- `.claude/settings.local.json` (local Claude Code settings)

### 14.3 Testing Checklist
- Form validation on all steps
- Israeli phone/ID format validation
- Credit card encryption/decryption
- OCR check extraction
- Payment tracking (pending → overdue → completed)
- Permission-based UI visibility
- Mobile responsiveness (test at 375px, 768px, 1200px)
- Offline mode (Service Worker)
- Session timeout (30 min idle)

---

## 15. GIT HISTORY SUMMARY

**Recent Commits (Last 20):**
- Update Google Apps Script webhook URL for new deployment
- Edit payment dates in sales record + sync to sheets
- 6 critical validation and UX fixes
- Code cleanup - removed debug alerts
- OCR batch mode - Vision for each page, Claude once
- OCR accuracy improvements - handle leading digit errors
- Improved Claude prompt with real OCR examples
- OCR results logging
- Check parser with Claude API instead of regex
- Improved OCR parsing from raw text
- Display raw OCR text always
- OCR optimization for Israeli checks
- Fixed check parser for date/amount extraction
- OCR with Google Vision API + Firebase Admin SDK
- Payment date editing in sales record
- OCR image compression to fit Netlify 1MB limit
- PDF multi-page support
- Check number detection
- System refined to extract date/amount only
- Intelligent check parsing
- Image compression
- PDF support

**Repository:** https://github.com/Chaim2045/sales-form (main branch)

---

## 16. KEY BUSINESS LOGIC

### 16.1 Transaction Types

**Transaction Type Options:**
1. **פגישת ייעוץ** (Consultation) - One-time consultation fee
2. **ריטיינר** (Retainer) - Monthly retainer fee
3. **תוכנית שעות** (Hours Package) - Billable hours at rate
4. **הליך משפטי - תקרת שעות** (Legal Case - Hour Cap) - Case with max hours limit
5. **הליך משפטי - פיקס** (Legal Case - Fixed Fee) - Flat fee for case
6. **אחר** (Other) - Custom description required

### 16.2 Payment Methods

**Basic Methods:**
- Credit Card - Immediate or recurring charge
- Bank Transfer - Manual transfer details
- Cash - In-person payment
- Bit (ביט) - Israeli mobile payment app
- Post-dated Checks (שיקים דחויים) - Multiple checks with dates

**Advanced:**
- Split Payment - Combination of multiple payment methods

### 16.3 Credit Card Charge Types

**Charge Status Options:**
1. **בוצע חיוב מלא** (Full Charge) - All at once, possibly in installments
2. **חיוב חודשי** (Monthly Billing) - Recurring charge
3. **פיקדון** (Deposit) - Advance payment against future services
4. **אשראי זמני - יוחלף** (Temporary Credit) - Will be replaced by another payment method

### 16.4 VAT Calculation

**Standard Rate:** 18%

**Calculation:**
```
Amount Before VAT: ₪1,000
VAT (18%): ₪180
Amount With VAT: ₪1,180
```

**Display:**
- All three amounts shown to user
- VAT displayed in transaction details
- Recurring billing stored with amounts including VAT

---

## 17. COMMON PATTERNS & CONVENTIONS

### 17.1 Naming Conventions
- HTML IDs: camelCase, descriptive (e.g., `clientName`, `checksPhotoUploadContainer`)
- CSS classes: kebab-case for BEM methodology (e.g., `.form-group`, `.pm-payment-row`)
- JavaScript functions: camelCase (e.g., `validateStep()`, `showBillingManagement()`)
- Firestore collections: snake_case (e.g., `sales_records`, `recurring_billing`)
- Boolean variables: prefix with `is` or `has` (e.g., `isValid`, `hasPermission`)

### 17.2 Error Handling
- User-facing errors in Hebrew
- Toast notifications for non-critical errors
- Alert dialogs for critical issues requiring immediate attention
- Console logging for debugging
- Graceful fallbacks (e.g., fail open on auth errors in functions)

### 17.3 Data Formatting
- Dates: ISO 8601 format in database (YYYY-MM-DD)
- Dates: Hebrew format in UI (DD/MM/YYYY)
- Currency: Shekel symbol (₪) with thousands separator
- Phone: Direction: ltr; text-align: right (for proper number display)

### 17.4 Validation Patterns
```javascript
// Israeli Phone
/^0[2-9]\d{7,8}$/ (after removing non-digits)

// Israeli ID (Luhn algorithm)
digits.padStart(9, '0'), then check sum % 10 === 0

// Credit Card (Luhn algorithm)
sum % 10 === 0 for all digits

// Card Expiry
MM/YY format, month 01-12, year not expired
```

---

## 18. PERFORMANCE OPTIMIZATIONS

### 18.1 Frontend
- Debounced search (300ms) to reduce API calls
- Debounced form autosave (500ms)
- Lazy load modals (only create DOM when needed)
- Cache client list in memory with deduplication Map
- Compress images before upload (700KB max)
- PDF pages limited to 10 max
- PDF.js worker loaded from CDN

### 18.2 Database
- Firestore indexes on timestamp and createdAt
- Limit queries to 500 results for autocomplete
- Pagination for large result sets
- Batch operations for payment generation
- Merge updates to avoid overwrites

### 18.3 Network
- Subresource Integrity (SRI) on external scripts
- gzip compression (automatic on Netlify)
- CDN delivery (Netlify edges)
- CORS preflight caching (OPTIONS method)

---

## 19. TROUBLESHOOTING GUIDE

| Issue | Cause | Solution |
|-------|-------|----------|
| Form won't submit | Missing required fields | Check validation error toast at top |
| Checks OCR not working | Missing API key | Set GOOGLE_VISION_API_KEY and ANTHROPIC_API_KEY in Netlify |
| Credit card won't decrypt | Wrong passphrase | Password is case-sensitive, try again |
| Locked out of decryption | Too many wrong attempts | Wait 5 minutes, then retry |
| Payment date showing as overdue | Date is before today | Mark as completed with actual payment date |
| Auto-save not working | localStorage disabled | Enable in browser settings |
| Login doesn't work | User deactivated | Admin needs to reactivate in User Management |
| Slow autocomplete | Too many queries | Reduce search term to <2 chars for faster results |
| PDF generation fails | File too large | Limit PDF content, use table view for export |

---

## 20. FUTURE IMPROVEMENTS & ROADMAP

### Potential Enhancements
1. **Export Features**
   - Export sales to Excel
   - Generate financial reports by month/quarter
   - Export audit logs for compliance

2. **Integrations**
   - Slack notifications for overdue payments
   - SMS reminders for payment dates
   - WhatsApp integration for client communication

3. **Advanced Reporting**
   - Revenue dashboard
   - Attorney performance metrics
   - Client lifetime value tracking
   - Payment method analysis

4. **Data Management**
   - Bulk import from CSV
   - Data migration tools
   - Archive old records

5. **Mobile App**
   - React Native app for field sales
   - Offline transaction capture
   - Mobile photo upload optimization

6. **AI Enhancements**
   - Auto-categorize transactions
   - Predict client payment behavior
   - Anomaly detection for fraud

---

## 21. CONTACT & SUPPORT

**Organization:** משרד עו"ד גיא הרשקוביץ  
**Website:** (if available)  
**Email:** (contact info)  
**Phone:** (contact info)

For technical issues, contact the development team.

---

---

## 22. SECURITY AUDIT FINDINGS

### CRITICAL (Action Required Immediately)

1. **Exposed Google Sheets Webhook URLs** — `env-config.js:18` + `README.md` contain different webhook URLs. Anyone can invoke them to inject data into the Sheet.
   - **Fix:** Rotate both URLs, implement HMAC-SHA256 signature verification.

2. **Webhook Secret Not Implemented** — `env-config.js:19` has `WEBHOOK_SECRET: 'NETLIFY_WEBHOOK_SECRET_PLACEHOLDER'`. The webhook is unauthenticated.
   - **Fix:** Generate real secret, validate in Google Apps Script.

3. **Firebase JWT Token in .claude/settings.json** — Line 17 contains a full JWT (user: haim@ghlawoffice.co.il). Even if expired, the pattern is dangerous.
   - **Fix:** Remove token, add `.claude/` to `.gitignore`.

4. **Password Exposed in .claude/settings.json** — Line 9: `firebase auth:update ... --password "Office9668!"` reveals password pattern.
   - **Fix:** Remove from settings, rotate password.

5. **Firebase Credentials in README.md** — Lines 63-70 contain API keys and Spreadsheet ID.
   - **Fix:** Remove from README, reference env vars only.

### WARNING (Should Fix Soon)

6. **CSP allows `unsafe-inline`** — `netlify.toml:31`. Defeats XSS protection.
   - **Fix:** Move inline scripts to external files, remove `unsafe-inline`.

7. **Firebase Rules Too Permissive** — `firestore.rules:40`: All active users can read ALL sales records regardless of role.
   - **Fix:** Add permission-based read rules.

8. **XSS Risk in innerHTML** — `billing.js:90`: JSON.stringify in onclick handlers.
   - **Fix:** Use DOM createElement + event listeners.

9. **Quick Login Stores Passwords** — `auth.js:90-102`: PasswordCredential API stores email+password.
   - **Fix:** Migrate to FIDO2/WebAuthn.

10. **Client-Side Rate Limiting Bypassable** — `encryption.js:4-5`: Can reset via browser console.
    - **Mitigation:** Server-side rate limit exists (good), document this reliance.

### .gitignore Improvements Needed
```
# Add these lines:
.claude/
.claude/settings*.json
*.local.json
```

---

## 23. CODE QUALITY FINDINGS

### Code Quality Score: 7.0/10

### Duplicated Code (HIGH)
- `roundMoney()` defined in both `billing.js:8` and `payments.js:3`
- `escapeHTML()` defined in multiple files
- **Fix:** Create `js/utils.js` with shared utility functions

### Performance Issues (HIGH)
- `client-search.js:14-23`: Queries 500 docs per autocomplete search
- `billing.js:1829-1862`: Loads ALL records into memory for reports
- **Fix:** Implement pagination, cursor-based queries, client-side caching

### Accessibility (CRITICAL)
- **Zero ARIA labels** in entire `index.html`
- No focus trapping in modals
- No screen reader announcements for form validation errors
- Color contrast may fail WCAG AA (`--text-secondary: rgba(0,0,0,0.55)`)
- **Fix:** Add ARIA attributes, implement focus management, test with screen reader

### Error Handling Gaps
- Empty catch blocks in `form-draft.js:218`: `catch (e) { /* ignore */ }`
- `alert()` used for errors (blocks UI) instead of toast notifications
- Auth failure silently signs out without user feedback
- **Fix:** Replace alerts with toasts, add user-facing error messages

### Global Variable Overuse
- 11+ globals in `firebase-init.js:19-59`
- State scattered across files without centralized management
- **Fix:** Implement state management module or use consistent pattern

### Dependencies Status
| Library | Version | Status |
|---------|---------|--------|
| Firebase SDK | 10.7.1 | ⚠️ ~1 year old (v11+ available) |
| CryptoJS | 4.2.0 | ⚠️ Not actively maintained |
| jsPDF | 2.5.2 | ✅ Current |
| html2canvas | 1.4.1 | ✅ Current |
| PDF.js | 3.11.174 | ⚠️ v4.x available, **missing SRI hash** |

### Dead Code
- `sales-form.js:2-24`: Legacy `selectUser()` function (replaced by auth system)
- **Fix:** Remove after confirming no references

---

## 24. IMPROVEMENT ROADMAP

### Phase 1: Security Hardening (Immediate)
- [ ] Rotate webhook URLs + implement HMAC verification
- [ ] Remove secrets from `.claude/settings.json` and README
- [ ] Add `.claude/` to `.gitignore`
- [ ] Remove `unsafe-inline` from CSP
- [ ] Tighten Firebase Security Rules per-permission

### Phase 2: Accessibility & UX (1-2 weeks)
- [ ] Add ARIA labels to all interactive elements
- [ ] Implement focus trapping in modals
- [ ] Replace all `alert()` with toast notifications
- [ ] Add keyboard navigation for autocomplete dropdowns
- [ ] Fix color contrast for WCAG AA compliance

### Phase 3: Performance (2-4 weeks)
- [ ] Implement cursor-based Firestore pagination
- [ ] Reduce client-search query from 500 to 50 docs with caching
- [ ] Add composite Firestore indexes
- [ ] Batch DOM updates in rendering loops

### Phase 4: Code Quality (Ongoing)
- [ ] Create `js/utils.js` — extract shared functions
- [ ] Upgrade Firebase SDK to v11+ (modular imports)
- [ ] Replace CryptoJS with native Web Crypto API
- [ ] Add SRI hash to PDF.js
- [ ] Remove dead code (legacy `selectUser()`)
- [ ] Implement centralized state management

---

**Document Generated:** 2026-03-29
**Project Status:** Production
**Version:** 2.0 (includes Security Audit + Code Review)
