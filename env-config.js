// Environment configuration
// This file handles environment variables for both local development and Netlify

(function() {
    'use strict';

    // Check if running on Netlify (environment variables will be injected during build)
    // For local development, you can create a .env file or set these directly

    window.ENV_CONFIG = {
        FIREBASE_API_KEY: 'NETLIFY_FIREBASE_API_KEY_PLACEHOLDER',
        FIREBASE_AUTH_DOMAIN: 'NETLIFY_FIREBASE_AUTH_DOMAIN_PLACEHOLDER',
        FIREBASE_DATABASE_URL: 'NETLIFY_FIREBASE_DATABASE_URL_PLACEHOLDER',
        FIREBASE_PROJECT_ID: 'NETLIFY_FIREBASE_PROJECT_ID_PLACEHOLDER',
        FIREBASE_STORAGE_BUCKET: 'NETLIFY_FIREBASE_STORAGE_BUCKET_PLACEHOLDER',
        FIREBASE_MESSAGING_SENDER_ID: 'NETLIFY_FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER',
        FIREBASE_APP_ID: 'NETLIFY_FIREBASE_APP_ID_PLACEHOLDER',
        FIREBASE_MEASUREMENT_ID: 'NETLIFY_FIREBASE_MEASUREMENT_ID_PLACEHOLDER',
        GOOGLE_SHEETS_WEBHOOK: 'NETLIFY_GOOGLE_SHEETS_WEBHOOK_PLACEHOLDER'
    };

    // For local development, you can override here
    // Never commit real values to Git!
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        window.ENV_CONFIG = {
            FIREBASE_API_KEY: 'AIzaSyC9R_eupXtdkzEMBwA1Dsc6SC_14_iUNLs',
            FIREBASE_AUTH_DOMAIN: 'law-office-guide.firebaseapp.com',
            FIREBASE_DATABASE_URL: 'https://law-office-guide-default-rtdb.europe-west1.firebasedatabase.app',
            FIREBASE_PROJECT_ID: 'law-office-guide',
            FIREBASE_STORAGE_BUCKET: 'law-office-guide.firebasestorage.app',
            FIREBASE_MESSAGING_SENDER_ID: '903121364456',
            FIREBASE_APP_ID: '1:903121364456:web:91d02f021ab618d3a6705d',
            FIREBASE_MEASUREMENT_ID: 'G-3NZXL9YB35',
            GOOGLE_SHEETS_WEBHOOK: 'https://script.google.com/macros/s/AKfycbx4en4xw-4cG7_ytYE66rLswHCoV8JDwg8g5-QL9geMFhhIdYY-2Qhw_ZgTR3R_e-7l/exec'
        };
    }
})();
