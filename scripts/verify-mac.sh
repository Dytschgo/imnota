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
test "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$destination/Imnota.app/Contents/Info.plist")" = "13.0.0"
# Current lipo consumes one arch after -verify_arch; check one per call.
verify_universal() {
  local arch
  for arch in arm64 x86_64; do
    lipo "$1" -verify_arch "$arch"
  done
}
verify_universal "$destination/Imnota.app/Contents/MacOS/Imnota"
capture_helper="$destination/Imnota.app/Contents/Resources/imnota-capture-helper"
test -x "$capture_helper"
verify_universal "$capture_helper"
security_observer="$destination/Imnota.app/Contents/Resources/imnota-security-observer"
test -x "$security_observer"
verify_universal "$security_observer"
codesign --verify --strict "$security_observer"
chmod -N "$destination"
test "$("$security_observer" acl "$destination")" = no-acl
"$capture_helper" windows 0 | node -e 'let text = ""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => { if (!Array.isArray(JSON.parse(text))) process.exit(1); });'
if [[ "${IMNOTA_SMOKE_MODE:-smoke}" != "clipboard" ]]; then
  node scripts/verify-mcp.mjs "$destination/Imnota.app/Contents/MacOS/Imnota" "$archive"
fi
node scripts/smoke.mjs "$destination/Imnota.app/Contents/MacOS/Imnota"
