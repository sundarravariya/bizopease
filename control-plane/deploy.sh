#!/bin/bash
# BizOpease control plane deploy script
# Copies local files → server, installs deps, restarts PM2
# Usage: bash deploy.sh

set -e

REMOTE="root@82.180.144.9"
REMOTE_DIR="/var/www/bizopease-saas"
LOCAL_DIR="$(dirname "$0")"  # control-plane/

echo "🚀 Deploying BizOpease control plane..."

FILES=(
  "server.js"
  "database.js"
  "provisioner.js"
  "package.json"
  "index.html"
  "superadmin.html"
)

for f in "${FILES[@]}"; do
  echo "  → $f"
  scp "$LOCAL_DIR/$f" "$REMOTE:$REMOTE_DIR/$f"
done

echo ""
echo "📦 Installing dependencies on server..."
ssh "$REMOTE" "cd $REMOTE_DIR && npm install --omit=dev 2>&1 | tail -5"

echo ""
echo "⚡ Restarting PM2..."
ssh "$REMOTE" "cd $REMOTE_DIR && pm2 restart bizopease-saas 2>/dev/null || pm2 start server.js --name bizopease-saas && pm2 save"

echo ""
echo "⚙️  Checking Odoo config for multi-tenant readiness..."
ssh "$REMOTE" "grep 'db_name' /etc/odoo/odoo.conf || true"

echo ""
echo "✅ Done! Control plane deployed."
echo "   Landing:    https://bizopease.robifel.in/"
echo "   SuperAdmin: https://bizopease.robifel.in/superadmin.html"
echo ""
echo "📝 IMPORTANT — Odoo config changes needed for multi-tenant:"
echo "   1. In /etc/odoo/odoo.conf:"
echo "      REMOVE: db_name = robifel"
echo "      ADD:    dbfilter = ^(%h)$"
echo "   2. When removing db_name, Odoo will serve ANY DB matching dbfilter."
echo "      robifel.in subdomain → DB name must be 'robifel'"
echo "      ws_acme.robifel.in   → DB name must be 'ws_acme'"
echo "   3. For now, tenant Odoo access is at: http://<slug>.robifel.in/web"
echo "      (HTTP only until you buy bizopease.com and add wildcard SSL)"
