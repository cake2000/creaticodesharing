#!/bin/bash

# Path to rclone binary
RCLONE="/usr/bin/rclone"

# B2 bucket and path
REMOTE="b2:cdncreaticodecom/scratch-gui-projects"

# Fetch file list as JSON and loop through each file
$RCLONE lsjson "$REMOTE" --files-only | jq -r '.[].Path' | while read -r filepath; do
    echo "Setting Cache-Control for: $filepath"
    $RCLONE backend metadata "$REMOTE/$filepath" set Cache-Control "public,max-age=31536000,immutable"
done
