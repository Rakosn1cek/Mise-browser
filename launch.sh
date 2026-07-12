#!/usr/bin/env bash
# Distro-agnostic background execution handler for Electron
cd "$(dirname "$0")" || exit 1
ELECTRON_DISABLE_SANDBOX=1 npx electron . --log-level=3 &
