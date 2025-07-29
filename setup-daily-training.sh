#!/bin/bash

# Setup Daily LTR Training
# Run this once to set up automatic daily training

echo "🔧 Setting up Daily LTR Training..."

# Get the current directory
PROJECT_DIR=$(pwd)

# Create cron job entry
CRON_JOB="0 2 * * * cd $PROJECT_DIR && npx tsx daily-ltr-trainer.ts >> ltr-training.log 2>&1"

# Add to crontab
echo "📅 Adding daily training to crontab (runs at 2 AM daily)..."
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo "✅ Daily training scheduled!"
echo ""
echo "📋 What was set up:"
echo "   • Daily check at 2:00 AM"
echo "   • Trains if data thresholds are met"
echo "   • Logs to: ltr-training.log"
echo ""
echo "🎯 Manual commands:"
echo "   npx tsx daily-ltr-trainer.ts              # Check and train now"
echo "   npx tsx daily-ltr-trainer.ts --force      # Force train for demo"
echo "   npx tsx daily-ltr-trainer.ts --dry-run    # Check data only"
echo ""
echo "📝 View scheduled jobs:"
echo "   crontab -l"
echo ""
echo "📊 View training logs:"
echo "   tail -f ltr-training.log"
