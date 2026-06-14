#!/bin/bash
# =====================================================================
# BizOpease — SaaS Control Plane Deployment Script
# Runs from local workspace to push control plane code to the VPS
# =====================================================================

set -e

SERVER="root@82.180.144.9"
TARGET_DIR="/var/www/bizopease-saas"

echo "🔨 Packing control plane modules..."

# Copy files via scp
scp -r server.js database.js provisioner.js package.json landing.html superadmin.html "$SERVER:$TARGET_DIR/"

echo "📦 Installing backend packages on remote server..."
ssh "$SERVER" "cd $TARGET_DIR && npm install"

# Start or restart process via PM2
echo "🔄 Reloading PM2 process 'bizopease-saas'..."
ssh "$SERVER" "pm2 delete bizopease-saas 2>/dev/null || true; cd $TARGET_DIR && pm2 start server.js --name 'bizopease-saas'"

echo "✅ SaaS Control Plane deployed successfully!"
echo "🌐 Available at: https://bizopease.robifel.in/"
