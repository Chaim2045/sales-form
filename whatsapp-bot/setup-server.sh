#!/bin/bash
# ============================================================
# הכנסוביץ — Server Setup Script for Kamatera / Ubuntu 22.04
# Run as root on a fresh server
# Usage: bash setup-server.sh
# ============================================================

set -e

echo ""
echo "┌─────────────────────────────────────┐"
echo "│  הכנסוביץ — Server Setup            │"
echo "│  Kamatera / Ubuntu 22.04            │"
echo "└─────────────────────────────────────┘"
echo ""

# ==================== Step 1: System Update ====================
echo "📦 [1/7] Updating system..."
apt update && apt upgrade -y
echo "✅ System updated"

# ==================== Step 2: Install Node.js 18 ====================
echo "📦 [2/7] Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi
echo "  Node: $(node -v)"
echo "  npm:  $(npm -v)"
echo "✅ Node.js installed"

# ==================== Step 3: Install Chromium ====================
echo "📦 [3/7] Installing Chromium for Puppeteer..."
apt install -y chromium-browser || apt install -y chromium
# Set Puppeteer to use system Chromium
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=$(which chromium-browser || which chromium)
echo "  Chromium: $(chromium-browser --version 2>/dev/null || chromium --version 2>/dev/null)"
echo "✅ Chromium installed"

# ==================== Step 4: Install PM2 ====================
echo "📦 [4/7] Installing PM2..."
npm install -g pm2
echo "✅ PM2 installed"

# ==================== Step 5: Setup Bot Directory ====================
echo "📦 [5/7] Setting up bot directory..."
BOT_DIR="/opt/hachnasovitz"
mkdir -p $BOT_DIR
mkdir -p $BOT_DIR/logs

# Copy files if running locally, otherwise prompt
if [ -f "./index.js" ]; then
    cp -r ./* $BOT_DIR/
    echo "  Files copied from current directory"
else
    echo ""
    echo "  ⚠️  Bot files not found in current directory."
    echo "  Copy your bot files to: $BOT_DIR"
    echo "  Required files:"
    echo "    - index.js"
    echo "    - agent.js"
    echo "    - firebase.js"
    echo "    - package.json"
    echo "    - ecosystem.config.js"
    echo "    - .env"
    echo "    - firebase-service-account.json"
    echo ""
fi

cd $BOT_DIR

# ==================== Step 6: Install Dependencies ====================
echo "📦 [6/7] Installing npm dependencies..."
if [ -f "package.json" ]; then
    npm install --production
    echo "✅ Dependencies installed"
else
    echo "  ⚠️  package.json not found — skipping npm install"
fi

# ==================== Step 7: Configure PM2 Startup ====================
echo "📦 [7/7] Configuring PM2 auto-startup..."
pm2 startup systemd -u root --hp /root
echo "✅ PM2 startup configured"

# ==================== Setup Swap (for low-RAM servers) ====================
echo "📦 Setting up swap (1GB)..."
if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "✅ Swap configured"
else
    echo "  Swap already exists"
fi

# ==================== Firewall ====================
echo "📦 Configuring firewall..."
apt install -y ufw
ufw allow OpenSSH
ufw --force enable
echo "✅ Firewall configured (SSH only)"

# ==================== Done ====================
echo ""
echo "┌─────────────────────────────────────────────┐"
echo "│  ✅ Setup Complete!                          │"
echo "│                                             │"
echo "│  Next steps:                                │"
echo "│  1. Copy bot files to /opt/hachnasovitz     │"
echo "│  2. Edit .env with your API keys            │"
echo "│  3. First run (to scan QR):                 │"
echo "│     cd /opt/hachnasovitz                    │"
echo "│     node index.js                           │"
echo "│  4. After QR scan, Ctrl+C then:             │"
echo "│     pm2 start ecosystem.config.js           │"
echo "│     pm2 save                                │"
echo "│                                             │"
echo "│  Useful commands:                           │"
echo "│  pm2 logs hachnasovitz    — view logs       │"
echo "│  pm2 status               — check status    │"
echo "│  pm2 restart hachnasovitz — restart bot     │"
echo "│  pm2 monit                — live monitor    │"
echo "└─────────────────────────────────────────────┘"
echo ""
