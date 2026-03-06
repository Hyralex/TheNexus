#!/bin/bash
# Install TheNexus systemd service
# Run this script with: bash install-systemd.sh

set -e

echo "🔧 Installing TheNexus systemd service..."

# Copy service file
sudo cp thenexus.service /etc/systemd/system/
echo "✓ Service file copied"

# Reload systemd
sudo systemctl daemon-reload
echo "✓ Systemd reloaded"

# Enable service (start on boot)
sudo systemctl enable thenexus
echo "✓ Service enabled"

# Start service now
sudo systemctl start thenexus
echo "✓ Service started"

# Show status
echo ""
echo "📊 Service Status:"
sudo systemctl status thenexus --no-pager | head -12

echo ""
echo "✅ TheNexus is now running as a systemd service!"
echo "   - Auto-starts on boot"
echo "   - Auto-restarts on crash"
echo "   - Logs: journalctl -u thenexus -f"
echo "   - Stop: sudo systemctl stop thenexus"
echo "   - Restart: sudo systemctl restart thenexus"
