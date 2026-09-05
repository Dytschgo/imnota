#!/usr/bin/env bash
set -euo pipefail
expected_version="${IMNOTA_EXPECT_VERSION:-$(node -p "require('./package.json').version")}"
if ! [[ "$expected_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-nightly\.[1-9][0-9]{7}\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?)?$ ]]; then
  echo "Expected a stable or nightly package version, received $expected_version." >&2
  exit 1
fi
archive="release/Imnota-${expected_version}-universal-mac.zip"
test -f "$archive"
destination="$(mktemp -d)"
ditto -x -k "$archive" "$destination"
codesign --verify --deep --strict "$destination/Imnota.app"
lipo "$destination/Imnota.app/Contents/MacOS/Imnota" -verify_arch arm64 x86_64
node scripts/smoke.mjs "$destination/Imnota.app/Contents/MacOS/Imnota"
