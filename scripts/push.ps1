#!/usr/bin/env pwsh
# ============================================
# bizopease — commit & push to GitHub
# Usage: .\scripts\push.ps1 "your change notes"
# Reads GITHUB_TOKEN from .env (gitignored).
# ============================================
param([Parameter(Mandatory=$true)][string]$Message)

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

# Load GITHUB_TOKEN from .env
$token = $null
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*GITHUB_TOKEN\s*=\s*(.+)\s*$') { $token = $Matches[1].Trim() }
    }
}
if (-not $token) { Write-Host "GITHUB_TOKEN not set in .env" -ForegroundColor Red; exit 1 }

$remote = "https://$token@github.com/sundarravariya/bizopease.git"

Write-Host "Committing: $Message" -ForegroundColor Cyan
git add -A
git commit -m "$Message"
git branch -M main
git push $remote main
if ($LASTEXITCODE -eq 0) { Write-Host "Pushed to GitHub." -ForegroundColor Green }
else { Write-Host "Push failed." -ForegroundColor Red; exit 1 }
