#!/usr/bin/env bash
set -euo pipefail
archive="$(find release -maxdepth 1 -name '*-mac.zip' -print -quit)"
test -n "$archive"
destination="$(mktemp -d)"
ditto -x -k "$archive" "$destination"
codesign --verify --deep --strict "$destination/Imnota.app"
lipo -verify_arch arm64 x86_64 "$destination/Imnota.app/Contents/MacOS/Imnota"
node scripts/smoke.mjs "$destination/Imnota.app/Contents/MacOS/Imnota"
