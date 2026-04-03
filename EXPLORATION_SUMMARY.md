# TOFES OFFICE - Project Exploration Summary

## Exploration Completed
A comprehensive exploration of the TOFES OFFICE legal office management system has been completed.

## Key Findings

### Project Statistics
- **Total Files:** 45 (excluding .git)
- **Total Lines of Code:** ~13,316
- **Project Size:** 12 MB
- **Primary Language:** JavaScript (vanilla, no frameworks)
- **Backend:** Firebase (Firestore, Auth, Storage)
- **Hosting:** Netlify with serverless functions
- **UI Language:** Hebrew (RTL support)

### Architecture Overview

**Frontend:**
- Single-page application (SPA) with 4-step form
- Vanilla JavaScript - no heavy frameworks
- Responsive CSS with mobile-first approach
- Service Worker for offline support
- PWA-capable with manifest

**Backend:**
- Firebase Firestore for data storage
- Firebase Auth for user management
- Firebase Storage for check photo uploads
- Netlify Functions (Node.js) for:
  - OCR processing (Google Vision API + Claude AI)
  - Password reset handling

**Integrations:**
- Google Vision API for check OCR
- Claude AI (Haiku model) for check data parsing
- Google Sheets webhook for automatic syncing
- Google Fonts (Heebo) for Hebrew typography

### Core Features

1. **Sales Transaction Form**
   - 4-step wizard with progress tracking
   - Client details, transaction type, payment method, summary
   - Support for multiple payment methods
   - Real-time validation with Hebrew error messages

2. **Recurring Billing Management**
   - Create monthly recurring charges
   - Track payment status (pending, completed, overdue, cancelled)
   - Encrypted credit card storage
   - Auto-mark overdue payments

3. **OCR Check Processing**
   - Upload check photos (JPEG/PNG) or PDFs
   - Google Vision API extracts text
   - Claude AI parses dates and amounts
   - Handles multiple checks with batch processing

4. **Client Management**
   - Autocomplete search across sales and billing records
   - Client data persistence
   - Auto-fill from previous transactions

5. **Role-Based Access Control**
   - Master admin vs regular users
   - Permission flags (salesForm, billingManagement, etc.)
   - Firestore Security Rules enforcement
   - Audit logging for compliance

### Key Technologies

**Encryption:**
- PBKDF2 with 100,000 iterations + SHA-256
- AES-256-CBC for credit card data
- User passphrase required to decrypt
- Rate limiting (5 failed attempts = 5 min lockout)

**Validation:**
- Israeli phone numbers (0XX-XXXXXXX format)
- Israeli ID numbers (Luhn algorithm)
- Credit card numbers (Luhn algorithm)
- Card expiry (MM/YY format, not expired)

**Security:**
- HTTPS enforced (Netlify automatic)
- Content Security Policy with whitelist
- Subresource Integrity on external scripts
- CORS limited by origin
- Session timeout (30 min idle)
- Audit logging on all actions

### File Organization

**CSS (4,485 lines)**
- variables.css - Design system tokens
- layout.css - Grid/flex layouts
- components.css - Reusable UI components
- sales-form.css - Form-specific styling
- billing.css - Billing modal styling
- modals.css - Modal overlays
- mobile.css - Mobile breakpoints (500px, 768px)

**JavaScript (13,316 lines)**
- firebase-init.js (213) - Auth & initialization
- auth.js (164) - Login/logout handlers
- navigation.js (151) - Tab switching
- sales-form.js (1,014) ⭐ - Core form logic
- sales-records.js (868) - Transaction management
- client-search.js (204) - Autocomplete
- form-draft.js (310) - localStorage autosave
- payments.js (1,492) - Payment tracking
- billing.js (2,013) ⭐ - Recurring billing
- encryption.js (335) - Crypto operations
- file-upload.js (384) - Firebase Storage
- ocr-check.js (405) - Client-side OCR trigger
- activity-log.js (637) - Audit log viewer
- user-management.js (432) - User admin
- sheets-sync.js (32) - Google Sheets webhook

**Netlify Functions (Node.js)**
- ocr-check.js (242) - Vision API + Claude parsing
- reset-password.js - Firebase password reset

### Database Schema

**Collections:**
- `users/{uid}` - User profiles, roles, permissions
- `sales_records/{docId}` - Completed transactions
- `recurring_billing/{docId}` - Recurring charge clients
- `recurring_billing/{docId}/payments/{paymentId}` - Payment schedule
- `audit_log/{docId}` - All system actions
- `decrypt_rate_limit/{uid}` - Security rate limiting

### Deployment

**Netlify Configuration:**
- Build command: `bash build.sh` (replaces env vars)
- Publish directory: root (static site)
- Node 18 runtime for functions
- CSP headers with whitelist
- HSTS preload enabled

**Required Environment Variables:**
- FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, etc.
- GOOGLE_VISION_API_KEY (for OCR)
- ANTHROPIC_API_KEY (for Claude parsing)
- GOOGLE_SHEETS_WEBHOOK (for Sheets sync)

### Recent Development

**Latest Commits:**
- OCR improvements with Claude API integration
- Payment date editing capabilities
- 6 critical validation and UX fixes
- Code cleanup and debug removal
- Multi-page PDF check extraction
- Image compression for API limits

**Repository:** https://github.com/Chaim2045/sales-form (main branch)

---

## Generated Documentation

**File:** `/TOFES OFFICE/CLAUDE.md` (1,360 lines)

### Contents Include:
1. ✅ Full file tree with descriptions
2. ✅ Detailed breakdown of all 15 JavaScript files
3. ✅ CSS design system documentation
4. ✅ HTML structure (4 form steps)
5. ✅ Firestore schema and relationships
6. ✅ Security rules and authorization
7. ✅ Firebase configuration
8. ✅ Netlify deployment settings
9. ✅ Netlify Functions documentation
10. ✅ Google integration details
11. ✅ Service Worker features
12. ✅ Security features (auth, encryption, validation)
13. ✅ External dependencies and versions
14. ✅ Development environment setup
15. ✅ Git history summary
16. ✅ Business logic (transaction types, payment methods)
17. ✅ Code conventions and patterns
18. ✅ Performance optimizations
19. ✅ Troubleshooting guide
20. ✅ Future improvements roadmap

---

## Key Insights

### Architecture Strengths
- **Modular JavaScript** - Clear separation of concerns
- **Security First** - Encryption, validation, rate limiting
- **Scalable Design** - Can add features without major refactoring
- **Accessible** - Hebrew RTL support, WCAG considerations
- **Performant** - Lazy loading, debouncing, batch operations
- **Maintainable** - Clear naming conventions, comprehensive comments

### Business Value
- **Compliance** - Full audit logging for legal accountability
- **Efficiency** - 4-step form improves data entry speed
- **Accuracy** - OCR automation reduces manual entry errors
- **Automation** - Recurring billing and Google Sheets sync
- **Flexibility** - Multiple payment methods supported

### Technical Debt
- No build process (direct script includes)
- No TypeScript for type safety
- No testing framework (unit/integration tests)
- Single-page app without routing library (manual tab switching)
- Large index.html (could be split into templates)

---

## Next Steps for Development

1. **Testing** - Add Jest/Cypress for automated testing
2. **Build Process** - Webpack/Vite for bundling and optimization
3. **TypeScript** - Add type safety
4. **Component Library** - Create reusable component system
5. **Monitoring** - Error tracking (Sentry), analytics (GA)
6. **Mobile App** - React Native for iOS/Android
7. **API** - REST or GraphQL layer for backend
8. **Documentation** - Expand inline code comments

---

**Exploration Completed:** 2026-03-29  
**Documentation File:** CLAUDE.md (1,360 lines)  
**Report Generated By:** Claude Code Agent
