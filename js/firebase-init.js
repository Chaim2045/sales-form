// Firebase Configuration - Using environment variables
const firebaseConfig = {
    apiKey: window.ENV_CONFIG.FIREBASE_API_KEY,
    authDomain: window.ENV_CONFIG.FIREBASE_AUTH_DOMAIN,
    databaseURL: window.ENV_CONFIG.FIREBASE_DATABASE_URL,
    projectId: window.ENV_CONFIG.FIREBASE_PROJECT_ID,
    storageBucket: window.ENV_CONFIG.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: window.ENV_CONFIG.FIREBASE_MESSAGING_SENDER_ID,
    appId: window.ENV_CONFIG.FIREBASE_APP_ID,
    measurementId: window.ENV_CONFIG.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ========== Firebase Authentication ==========

let authUser = null;

auth.onAuthStateChanged(function(user) {
    if (user) {
        authUser = user;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainContainer').style.display = '';
    } else {
        authUser = null;
        document.getElementById('loginScreen').style.display = '';
        document.getElementById('mainContainer').style.display = 'none';
        document.getElementById('billingManagement').classList.remove('active');
    }
});

// ========== Audit Log ==========

function logCardView(docId, clientName) {
    try {
        db.collection('audit_log').add({
            action: 'card_view',
            billingDocId: docId,
            clientName: clientName || '',
            viewedBy: authUser ? authUser.email : (currentUser || 'unknown'),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error('Audit log error:', e);
    }
}

// Global Variables
let currentStep = 1;
let currentUser = '';
const totalSteps = 4;
let searchTimeout = null;
