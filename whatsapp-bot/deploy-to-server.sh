#!/bin/bash
# ============================================================
# הכנסוביץ — Deploy bot files to Kamatera server
# Run from YOUR LOCAL machine (not the server)
#
# Usage: bash deploy-to-server.sh <server-ip>
# Example: bash deploy-to-server.sh 185.123.45.67
# ============================================================

SERVER_IP=$1

if [ -z "$SERVER_IP" ]; then
    echo "❌ Usage: bash deploy-to-server.sh <server-ip>"
    echo "   Example: bash deploy-to-server.sh 185.123.45.67"
    exit 1
fi

REMOTE_DIR="/opt/hachnasovitz"

echo ""
echo "🚀 Deploying Hachnasovitz to $SERVER_IP..."
echo ""

# Upload bot files (excluding node_modules and session data)
echo "📦 Uploading files..."
scp -r \
    index.js \
    agent.js \
    firebase.js \
    package.json \
    ecosystem.config.js \
    .env \
    .env.example \
    firebase-service-account.json \
    setup-server.sh \
    root@$SERVER_IP:$REMOTE_DIR/

echo ""
echo "✅ Files uploaded to $SERVER_IP:$REMOTE_DIR"
echo ""
echo "Next steps on the server:"
echo "  ssh root@$SERVER_IP"
echo "  cd $REMOTE_DIR"
echo "  bash setup-server.sh    # first time only"
echo "  npm install              # install dependencies"
echo "  node index.js            # scan QR"
echo "  pm2 start ecosystem.config.js"
echo "  pm2 save"
echo ""
