#!/bin/bash
# BizWiz deploy script
# Usage: ./deploy.sh "your commit message"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MSG="${1:-chore: update}"

echo "📡 Fetching latest from GitHub..."
git fetch origin

echo "📦 Staging all changes..."
git add -A

if git diff --cached --quiet; then
  echo "⚠️  Nothing to commit — working tree clean."
  exit 0
fi

echo "💾 Committing: $MSG"
git commit -m "$MSG"

echo "🚀 Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Done! Vercel will auto-deploy in ~30 seconds."
echo "🌐 https://bizwiz.space"
