#!/bin/bash
#
# ISAF (Integrated Standards Assurance Framework) — Double-click to launch
#
# This opens a Terminal window, starts the web server, and
# opens your browser to the upload page.
#

# Navigate to the script's directory (wherever the ISAF package lives)
DIR="$(cd "$(dirname "$0")" && pwd)"

# Remove the macOS download quarantine flag from the whole package, so the
# other launchers (Make_Customer_Edition, Make_Demo_Edition, Build,
# QUALIFY_RELEASE) open without the "Apple could not verify" warning.
if [ "$(uname)" = "Darwin" ]; then
    xattr -dr com.apple.quarantine "$DIR" 2>/dev/null || true
fi
clear
if grep -Eq '"edition"[[:space:]]*:[[:space:]]*"demo"' "$DIR/EDITION.json" 2>/dev/null; then
    printf '\033]0;Demo ISAF\007'
    echo ""
    echo "  +------------------------------------------+"
    echo "  |  Demo ISAF v5.3.44                      |"
    echo "  |  SOI 1 Demonstration App                |"
    echo "  +------------------------------------------+"
else
    echo ""
    echo "  +-------------------------------------------------------------+"
    echo "  |  ISAF (Integrated Standards Assurance Framework) v5.3.44    |"
    echo "  |  Certification Document Generation Engine                   |"
    echo "  +-------------------------------------------------------------+"
fi
echo ""
cd "$DIR/07_Web_Service"

# Check Node.js is installed
if ! command -v node &> /dev/null; then
    echo "  ✗ Node.js is not installed."
    echo "    Download it from https://nodejs.org (LTS version)"
    echo ""
    echo "  Press any key to exit..."
    read -n 1
    exit 1
fi

echo "  Node.js $(node -v)"

# Install dependencies if needed (first run only)
if [ ! -d "node_modules" ]; then
    echo ""
    echo "  First run — installing dependencies..."
    npm install --production 2>&1 | tail -3
    echo ""
fi

# Stop any ISAF server (from this or an older package) already using port 3000,
# so the browser always opens this version. Other programs on the port are left alone.
for PID in $(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null); do
    if ps -p "$PID" -o command= 2>/dev/null | grep -q "server.js"; then
        echo "  Stopping an ISAF server that was already running (process $PID)..."
        kill "$PID" 2>/dev/null
        sleep 1
    else
        echo "  ! Port 3000 is in use by another program: $(ps -p "$PID" -o comm= 2>/dev/null)"
        echo "    Close it, then run START.command again."
        read -n 1 -s -r -p "  Press any key to exit..."
        exit 1
    fi
done

echo ""
echo "  Starting server..."
echo "  Browser will open to: http://localhost:3000"
echo ""
echo "  ─────────────────────────────────────────────"
echo "  Press Ctrl+C to stop the server."
echo "  ─────────────────────────────────────────────"
echo ""

# Open browser after a short delay (gives server time to start)
(sleep 2 && open "http://localhost:3000") &

# Start the server
node server.js
