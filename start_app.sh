#!/usr/bin/env bash
set -e

# Change directory to script root
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Activate virtualenv if present
if [ -d "venv" ]; then
    source venv/bin/activate
fi

echo "================================================================="
echo "  Starting TRIRIGA Multi-Server Log Analysis & Forensics SPA"
echo "================================================================="

python3 run.py
