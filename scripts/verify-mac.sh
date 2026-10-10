#!/usr/bin/env bash
set -euo pipefail
if (( $# > 1 )) || { (( $# == 1 )) && [[ "$1" != "--faults" ]]; }; then
  echo "Expected only optional --faults." >&2; exit 1
fi
if [[ "${1:-}" != "--faults" ]]; then
  [[ "${IMNOTA_SMOKE_MODE:-}" != "faults" ]] || { echo "Use explicit --faults." >&2; exit 1; }
  unset IMNOTA_FAULT_CASE_SET
fi
expected_version="${IMNOTA_EXPECT_VERSION:-$(node -p "require('./package.json').version")}"
if ! [[ "$expected_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-nightly\.[1-9][0-9]{7}\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?)?$ ]]; then
  echo "Expected a stable or nightly package version, received $expected_version." >&2
  exit 1
fi
archive="release/Imnota-${expected_version}-universal-mac.zip"
test -f "$archive"
destination="$(mktemp -d)"
# macOS TMPDIR can use /var while the canonical directory is under /private/var.
destination="$(cd "$destination" && pwd -P)"
ditto -x -k "$archive" "$destination"
codesign --verify --deep --strict "$destination/Imnota.app"
test "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$destination/Imnota.app/Contents/Info.plist")" = "13.0.0"
lipo "$destination/Imnota.app/Contents/MacOS/Imnota" -verify_arch arm64 x86_64
capture_helper="$destination/Imnota.app/Contents/Resources/imnota-capture-helper"
test -x "$capture_helper"
lipo "$capture_helper" -verify_arch arm64 x86_64
"$capture_helper" windows 0 | node -e 'let text = ""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => { if (!Array.isArray(JSON.parse(text))) process.exit(1); });'
if [[ "${1:-}" == "--faults" ]]; then
  # Keep the supplied archive and extraction bound to the existing smoke launcher.
  IMNOTA_SMOKE_MODE=faults node scripts/smoke.mjs "$destination/Imnota.app/Contents/MacOS/Imnota" "$archive" "$destination/Imnota.app/Contents/MacOS/Imnota" "$destination/Imnota.app/Contents/Resources/app.asar"
else
  if [[ "${IMNOTA_SMOKE_MODE:-smoke}" != "clipboard" ]]; then
    node scripts/verify-mcp.mjs "$destination/Imnota.app/Contents/MacOS/Imnota" "$archive"
  fi
  node scripts/smoke.mjs "$destination/Imnota.app/Contents/MacOS/Imnota"
fi
