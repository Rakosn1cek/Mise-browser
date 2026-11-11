#!/usr/bin/env zsh
# Pure Zsh script to prepare and verify AppImageHub submission assets
# Verifies AppStream metainfo, desktop launcher, and drafts catalogue entry

set -e

local script_dir="${0:A:h}"
local repo_dir="${script_dir:h}"
local metainfo_file="${repo_dir}/assets/io.github.rakosn1cek.mise-browser.metainfo.xml"
local desktop_file="${repo_dir}/mise-browser.desktop"
local submission_dir="${repo_dir}/build/appimagehub"

print "Verifying AppImageHub submission assets for Mise Browser..."

# 1. Validate AppStream metainfo file
if [[ ! -f "$metainfo_file" ]]; then
    print -u2 "Error: AppStream metainfo file not found at ${metainfo_file}"
    exit 1
fi

if (( $+commands[appstreamcli] )); then
    print "Validating AppStream metadata via appstreamcli..."
    appstreamcli validate --pedantic "$metainfo_file"
    print "✓ AppStream metainfo passed validation."
else
    print "ℹ appstreamcli not installed, skipping AppStream schema check."
fi

# 2. Validate desktop entry
if [[ ! -f "$desktop_file" ]]; then
    print -u2 "Error: Desktop file not found at ${desktop_file}"
    exit 1
fi

if (( $+commands[desktop-file-validate] )); then
    print "Validating desktop file via desktop-file-validate..."
    desktop-file-validate "$desktop_file"
    print "✓ Desktop entry passed validation."
else
    print "ℹ desktop-file-validate not installed, skipping desktop check."
fi

# 3. Generate AppImageHub directory entry manifest
mkdir -p "$submission_dir"
local manifest_file="${submission_dir}/Mise Browser"

cat > "$manifest_file" << 'EOF'
https://github.com/Rakosn1cek/Mise-browser
#
EOF

print "✓ Generated AppImageHub manifest: ${manifest_file}"
print ""
print "AppImageHub Submission Instructions:"
print "1. Fork repository: https://github.com/AppImage/appimage.github.io"
print "2. Add the file 'Mise Browser' into the 'data/' directory of your fork."
print "3. Open a pull request titled: 'Add Mise Browser'"
print "4. AppImageHub crawler will parse assets/io.github.rakosn1cek.mise-browser.metainfo.xml from release AppImages."
