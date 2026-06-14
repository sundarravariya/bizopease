#!/usr/bin/env pwsh
# ============================================
# Robifel Portal — Deploy Script
# Run this from robifel_portal directory
# Usage: .\deploy.ps1
# ============================================

$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
$SERVER = "root@82.180.144.9"
$REMOTE_PATH = "/var/www/dashboard-robifel/"

Write-Host "🔨 Building production bundle..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Build failed!" -ForegroundColor Red; exit 1 }

Write-Host "📦 Build complete. Uploading to $SERVER..." -ForegroundColor Cyan
scp -o StrictHostKeyChecking=no -r dist/* "${SERVER}:${REMOTE_PATH}"
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Upload failed!" -ForegroundColor Red; exit 1 }

Write-Host "🔄 Reloading nginx..." -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=no $SERVER "systemctl reload nginx"

Write-Host ""
Write-Host "✅ Deployed successfully!" -ForegroundColor Green
Write-Host "🌐 Live at: https://odoo.robifel.in/portal/" -ForegroundColor Yellow
