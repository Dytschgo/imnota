#!/usr/bin/env bash

set -euo pipefail

repository="Dytschgo/imnota"
stable_tag_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
checksum_line_pattern='^([0-9a-fA-F]{64})  (.+)$'
release_tag="${IMNOTA_RELEASE_TAG:-}"
if [ -n "$release_tag" ] && ! [[ "$release_tag" =~ $stable_tag_pattern ]]; then
  echo "IMNOTA_RELEASE_TAG must be an exact stable tag." >&2
  exit 1
fi
temporary_directory="$(mktemp -d)"

staging_directory=""
cleanup() {
  [ -z "$staging_directory" ] || rm -rf -- "$staging_directory"
  rm -rf -- "$temporary_directory"
}

trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

# The download and SHA256SUMS.txt must come from the same release. The
# releases/latest/download alias is resolved separately for every request, so a
# release promoted between two requests could pair one release's download with
# another release's checksums. Resolve the latest tag once and use tagged URLs.
resolve_latest_release_tag() {
  local resolved_url
  resolved_url="$(curl --fail --silent --show-error --location --retry 3 --head --output /dev/null \
    --write-out '%{url_effective}' "https://github.com/${repository}/releases/latest")" || return 1
  [ "${resolved_url%/*}" = "https://github.com/${repository}/releases/tag" ] || return 1
  release_tag="${resolved_url##*/}"
  [[ "$release_tag" =~ $stable_tag_pattern ]]
}

sha256_of() {
  local output
  if command -v sha256sum >/dev/null 2>&1; then
    output="$(sha256sum < "$1")" || return 1
  elif command -v shasum >/dev/null 2>&1; then
    output="$(shasum -a 256 < "$1")" || return 1
  else
    return 1
  fi
  printf '%s' "${output%% *}" | tr '[:upper:]' '[:lower:]'
}

# Downloads a release asset and refuses to continue unless its SHA-256 matches
# the single entry for that asset in the same release's SHA256SUMS.txt. Nothing
# outside the temporary directory is changed before this returns.
download_verified_asset() {
  local asset_name=$1 asset_path=$2
  local checksums_path="${temporary_directory}/SHA256SUMS.txt"
  local line expected_checksum="" actual_checksum="" matches=0

  if ! curl --fail --location --retry 3 --output "$asset_path" "${download_base}/${asset_name}"; then
    fail "Download failed. No installed app was changed. Check https://github.com/${repository}/releases and try again."
  fi
  if ! curl --fail --location --retry 3 --output "$checksums_path" "${download_base}/SHA256SUMS.txt"; then
    fail "SHA256SUMS.txt could not be downloaded for ${release_tag}, so ${asset_name} cannot be verified. Nothing was installed and no installed app was changed."
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ $checksum_line_pattern ]] ||
      fail "Malformed SHA256SUMS.txt for ${release_tag}. Nothing was installed and no installed app was changed."
    if [ "${BASH_REMATCH[2]}" = "$asset_name" ]; then
      expected_checksum="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
      matches=$((matches + 1))
    fi
  done < "$checksums_path"
  if [ "$matches" -ne 1 ]; then
    fail "SHA256SUMS.txt for ${release_tag} does not contain exactly one checksum for ${asset_name}. Nothing was installed and no installed app was changed."
  fi

  actual_checksum="$(sha256_of "$asset_path")" ||
    fail "The SHA-256 checksum of ${asset_name} could not be calculated (sha256sum or shasum is required). Nothing was installed and no installed app was changed."
  if [ "$actual_checksum" != "$expected_checksum" ]; then
    fail "Checksum mismatch for ${asset_name} from ${release_tag}: SHA256SUMS.txt lists ${expected_checksum} but the download is ${actual_checksum}. The download was discarded; nothing was installed and no installed app was changed."
  fi
  echo "Verified ${asset_name} against SHA256SUMS.txt from ${release_tag}."
}

if [ -n "$release_tag" ]; then
  release_description="release ${release_tag}"
else
  if ! resolve_latest_release_tag; then
    fail "The latest stable release could not be determined. No installed app was changed. Check https://github.com/${repository}/releases and try again."
  fi
  release_description="latest stable release (${release_tag})"
fi
download_base="https://github.com/${repository}/releases/download/${release_tag}"

case "$(uname -s)" in
  Darwin)
    archive_path="${temporary_directory}/Imnota-mac.zip"
    echo "Downloading Imnota ${release_description} for macOS..."
    download_verified_asset "Imnota-mac.zip" "$archive_path"
    mkdir -p "$HOME/Applications"
    ditto -x -k "$archive_path" "$temporary_directory"
    test -x "$temporary_directory/Imnota.app/Contents/MacOS/Imnota"
    codesign --verify --deep --strict "$temporary_directory/Imnota.app"
    minimum_macos="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$temporary_directory/Imnota.app/Contents/Info.plist")"
    current_macos="$(/usr/bin/sw_vers -productVersion)"
    if ! /usr/bin/awk -v current="$current_macos" -v minimum="$minimum_macos" 'BEGIN {
      if (current !~ /^[0-9]+\.[0-9]+(\.[0-9]+)?$/ || minimum !~ /^[0-9]+\.[0-9]+(\.[0-9]+)?$/) exit 1;
      split(current, actual, "."); split(minimum, required, ".");
      for (i = 1; i <= 3; i++) {
        if (actual[i] + 0 > required[i] + 0) exit 0;
        if (actual[i] + 0 < required[i] + 0) exit 1;
      }
      exit 0;
    }'; then
      echo "This release requires macOS $minimum_macos or later; this Mac reports $current_macos. No installed app was changed." >&2
      exit 1
    fi
    if [ -e "$HOME/Applications/Imnota.app" ]; then
      backup_path="$HOME/Applications/Imnota-backup-$(date +%Y%m%d-%H%M%S).app"
      mv "$HOME/Applications/Imnota.app" "$backup_path"
      echo "Previous app preserved at $backup_path"
    fi
    if ! ditto "$temporary_directory/Imnota.app" "$HOME/Applications/Imnota.app"; then
      echo "Installation failed. Your projects are unchanged; the previous app is preserved if a backup was created." >&2
      exit 1
    fi
    echo "Imnota installed to ~/Applications/Imnota.app"
    echo "This early release is not Apple-notarised. If macOS blocks it, use System Settings > Privacy & Security > Open Anyway."
    open "$HOME/Applications/Imnota.app"
    ;;
  Linux)
    if [ "$(uname -m)" != "x86_64" ]; then
      echo "The current Linux installer requires an x86_64 computer." >&2
      exit 1
    fi
    application_path="${HOME}/.local/bin/imnota"
    echo "Downloading Imnota ${release_description} for Linux..."
    download_verified_asset "Imnota.AppImage" "$temporary_directory/Imnota.AppImage"
    mkdir -p "$(dirname "$application_path")"
    chmod +x "$temporary_directory/Imnota.AppImage"
    staging_directory="$(mktemp -d "$(dirname "$application_path")/.imnota-install.XXXXXXXX")"
    install -m 755 "$temporary_directory/Imnota.AppImage" "$staging_directory/imnota"
    mv -fT -- "$staging_directory/imnota" "$application_path"
    mkdir -p "$HOME/.local/share/applications"
    cat > "$HOME/.local/share/applications/imnota.desktop" <<EOF
[Desktop Entry]
Name=Imnota
Comment=Turn annotated screenshots into AI-ready context.
Exec="${application_path}"
Terminal=false
Type=Application
Categories=Graphics;Utility;
EOF
    echo "Imnota installed to ${application_path}"
    nohup "$application_path" >/dev/null 2>&1 &
    ;;
  *)
    echo "Unsupported platform: $(uname -s). Use the Windows PowerShell installer or download a release manually." >&2
    exit 1
    ;;
esac
