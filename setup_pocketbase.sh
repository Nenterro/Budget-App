#!/bin/bash

# PocketBase Setup Script
# Run this script on your Linux server with sudo privileges

echo "🚀 Starting PocketBase Installation..."

# 1. Install prerequisites (unzip)
echo "📦 Installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y unzip wget

# 2. Setup Directories
echo "📁 Creating /opt/pocketbase directory..."
sudo mkdir -p /opt/pocketbase
cd /opt/pocketbase

# 3. Download the latest PocketBase (Linux AMD64)
# Note: Using version 0.22.13 as a stable release. 
echo "⬇️ Downloading PocketBase..."
sudo wget https://github.com/pocketbase/pocketbase/releases/download/v0.22.13/pocketbase_0.22.13_linux_amd64.zip

# 4. Extract and make executable
echo "📦 Extracting..."
sudo unzip -o pocketbase_0.22.13_linux_amd64.zip
sudo chmod +x /opt/pocketbase/pocketbase
sudo rm pocketbase_0.22.13_linux_amd64.zip

# 5. Create Systemd Service for background execution
echo "⚙️ Creating Systemd Service..."
sudo tee /etc/systemd/system/pocketbase.service > /dev/null <<EOF
[Unit]
Description=pocketbase
After=network.target

[Service]
Type=simple
User=root
Group=root
LimitNOFILE=4096
Restart=always
RestartSec=5s
ExecStart=/opt/pocketbase/pocketbase serve --http=0.0.0.0:8090

[Install]
WantedBy=multi-user.target
EOF

# 6. Enable and Start the service
echo "🚀 Starting PocketBase service..."
sudo systemctl daemon-reload
sudo systemctl enable pocketbase.service
sudo systemctl start pocketbase.service

# 7. Check Status
echo "✅ Installation Complete!"
echo "PocketBase should now be running on port 8090."
echo "Visit http://100.97.146.42:8090/_/ in your browser."
