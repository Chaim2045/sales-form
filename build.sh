#!/bin/bash

# Build script for Netlify
# This script replaces placeholders in env-config.js with actual environment variables

echo "Starting build process..."

# Check if environment variables are set
if [ -z "$FIREBASE_API_KEY" ]; then
    echo "Warning: FIREBASE_API_KEY not set"
fi

# Replace placeholders in env-config.js with actual values from Netlify environment
sed -i "s|NETLIFY_FIREBASE_API_KEY_PLACEHOLDER|${FIREBASE_API_KEY}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_AUTH_DOMAIN_PLACEHOLDER|${FIREBASE_AUTH_DOMAIN}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_DATABASE_URL_PLACEHOLDER|${FIREBASE_DATABASE_URL}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_PROJECT_ID_PLACEHOLDER|${FIREBASE_PROJECT_ID}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_STORAGE_BUCKET_PLACEHOLDER|${FIREBASE_STORAGE_BUCKET}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER|${FIREBASE_MESSAGING_SENDER_ID}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_APP_ID_PLACEHOLDER|${FIREBASE_APP_ID}|g" env-config.js
sed -i "s|NETLIFY_FIREBASE_MEASUREMENT_ID_PLACEHOLDER|${FIREBASE_MEASUREMENT_ID}|g" env-config.js
sed -i "s|NETLIFY_GOOGLE_SHEETS_WEBHOOK_PLACEHOLDER|${GOOGLE_SHEETS_WEBHOOK}|g" env-config.js
sed -i "s|NETLIFY_WEBHOOK_SECRET_PLACEHOLDER|${WEBHOOK_SECRET}|g" env-config.js

echo "Build complete!"
