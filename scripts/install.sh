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
application_path=""
rollback_path=""
installation_parent=""
replacement_started=0
transaction_committed=0
keep_staging=0
lock_directory=""
lock_owned=0
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$transaction_committed" -eq 0 ] && { [ "$replacement_started" -eq 1 ] || { [ -n "$rollback_path" ] && [ -d "$rollback_path" ] && [ ! -L "$rollback_path" ]; }; }; then
    # Move a partial copy aside before restoring; never delete the only old app.
    if { [ ! -e "$application_path" ] && [ ! -L "$application_path" ]; } ||
      mv -- "$application_path" "$staging_directory/failed-Imnota.app"; then
      if [ -n "$rollback_path" ] && [ -d "$rollback_path" ] && [ ! -L "$rollback_path" ]; then
        if mv -- "$rollback_path" "$application_path"; then
          echo "Installation failed. The previous Imnota app was restored to $application_path." >&2
        else
          keep_staging=1
          echo "Automatic restore failed. Your previous app is preserved at $rollback_path; move it back to $application_path before reopening Imnota." >&2
        fi
      fi
    else
      keep_staging=1
      echo "Could not move the failed replacement aside. Your previous app is preserved at $rollback_path; recovery files are at $staging_directory." >&2
    fi
  fi
  if [ "$lock_owned" -eq 1 ]; then
    rm -f -- "$lock_directory/pid" || true
    rmdir -- "$lock_directory" 2>/dev/null || true
  fi
  if [ -n "$staging_directory" ] && [ "$keep_staging" -eq 0 ]; then
    rm -rf -- "$staging_directory" || echo "Warning: could not clean installer staging at $staging_directory." >&2
  fi
  rm -rf -- "$temporary_directory" || true
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' HUP INT TERM

fail() {
  echo "$1" >&2
  exit 1
}

# Keep these predicates in sync with update-macos.sh. The curl installer is
# standalone, so it cannot source a helper from the repository or installed app.
is_imnota_bundle() {
  local bundle=$1 bundle_id
  [[ -d "$bundle" && ! -L "$bundle" ]] || return 1
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist" 2>/dev/null)" || return 1
  [[ "$bundle_id" == "com.dytschgo.imnota" ]]
}

is_legacy_backup_name() {
  local name=$1
  [[ "$name" =~ ^Imnota[[:space:]]Backup[[:space:]][0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*[[:space:]][0-9]{8}-[0-9]{6}[[:space:]][0-9]+\.app$ ]] ||
    [[ "$name" =~ ^Imnota-backup-[0-9]{8}-[0-9]{6}(\.[0-9A-Za-z-]+)?\.app$ ]]
}

# HOME may itself be an OS alias (for example /var on macOS). Anchor the
# installation in that physical home, but refuse an aliased Applications folder.
validate_installation_parent() {
  local physical_home
  physical_home="$(cd -- "$HOME" && pwd -P)" || fail "The home folder could not be resolved. No installed app was changed."
  installation_parent="$physical_home/Applications"
  [[ ! -L "$installation_parent" ]] || fail "The Applications folder is a symlink. No installed app was changed."
  if [[ ! -e "$installation_parent" ]]; then
    mkdir -- "$installation_parent" || fail "The Applications folder could not be created."
  fi
  safe_physical_directory "$installation_parent" || fail "The Applications folder must be a physical directory owned by you. No installed app was changed."
}

safe_physical_directory() {
  [[ -d "$1" && ! -L "$1" && -O "$1" && -w "$1" && -x "$1" ]] || return 1
  [[ "$(cd -- "$1" && pwd -P)" == "$1" ]]
}

bundle_is_direct_child() {
  local candidate=$1 parent=$2
  [[ "${candidate%/*}" == "$parent" && -d "$candidate" && ! -L "$candidate" ]] || return 1
  [[ "$(cd -- "$candidate" && pwd -P)" == "$candidate" ]]
}

cleanup_previous_backups() {
  local parent=$1 candidate root="$1/.imnota-backups.noindex"
  safe_physical_directory "$parent" || return 0
  for candidate in "$parent"/Imnota-backup-*.app "$parent"/Imnota\ Backup\ *.app; do
    is_legacy_backup_name "${candidate##*/}" || continue
    bundle_is_direct_child "$candidate" "$parent" || continue
    is_imnota_bundle "$candidate" || continue
    rm -rf -- "$candidate" || echo "Warning: could not remove old Imnota backup: $candidate" >&2
  done
  if safe_physical_directory "$root"; then
    for candidate in "$root/Imnota.app" "$root"/.rollback-*.app; do
      [[ "${candidate##*/}" == Imnota.app || "${candidate##*/}" =~ ^\.rollback-[0-9]+\.app$ ]] || continue
      bundle_is_direct_child "$candidate" "$root" || continue
      is_imnota_bundle "$candidate" || continue
      rm -rf -- "$candidate" || echo "Warning: could not remove old Imnota backup: $candidate" >&2
    done
    rmdir -- "$root" 2>/dev/null || true
  fi
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
    validate_installation_parent
    application_path="$installation_parent/Imnota.app"
    [[ ! -L "$application_path" ]] || fail "The installation path is a symlink. No installed app was changed."
    # Share the updater lock so successful-install cleanup cannot remove another
    # live transaction's rollback copy.
    lock_directory="$installation_parent/.imnota-update.lock"
    mkdir -- "$lock_directory" 2>/dev/null || fail "Another install/update may be running or was interrupted. No installed app was changed. After confirming no installer is running, remove $lock_directory and try again."
    lock_owned=1
    printf '%s\n' "$$" > "$lock_directory/pid"
    staging_directory="$(mktemp -d "$installation_parent/.imnota-install.XXXXXXXX")"
    if [ -e "$application_path" ]; then
      is_imnota_bundle "$application_path" || fail "The existing Imnota.app is not an identified Imnota bundle. No installed app was changed."
      rollback_path="$staging_directory/previous-Imnota.app"
      mv -- "$application_path" "$rollback_path"
    fi
    replacement_started=1
    if ! ditto "$temporary_directory/Imnota.app" "$application_path"; then
      fail "Installation failed while copying the verified bundle."
    fi
    [[ -d "$application_path" && -x "$application_path/Contents/MacOS/Imnota" ]] ||
      fail "The installed replacement is missing its executable."
    codesign --verify --deep --strict "$application_path" ||
      fail "The installed replacement failed its final signature check."
    open "$application_path" || fail "The installed app could not be opened; restoring the previous version."
    transaction_committed=1
    cleanup_previous_backups "$installation_parent"
    echo "Imnota installed to ~/Applications/Imnota.app"
    echo "This early release is not Apple-notarised. If macOS blocks it, use System Settings > Privacy & Security > Open Anyway."
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
