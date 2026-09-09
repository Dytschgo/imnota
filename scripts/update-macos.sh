#!/bin/bash

set -Eeuo pipefail

readonly APP_ID="com.dytschgo.imnota"
readonly APP_NAME="Imnota"
readonly RELEASE_ROOT="https://github.com/Dytschgo/imnota/releases/download"

stage_dir=""
lock_dir=""
lock_owned=0
app_path=""
backup_path=""
backup_root=""
transaction_committed=0
keep_staging=0
rollback_failed=0
ORIGINAL_APP_IDENTITY=""
EXPECTED_CURRENT_VERSION=""

die() {
  printf 'Update failed: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

release_lock() {
  if (( lock_owned != 0 )) && [[ -n "$lock_dir" && -d "$lock_dir" ]]; then
    local recorded_pid=""
    if [[ -f "$lock_dir/pid" ]]; then
      IFS= read -r recorded_pid < "$lock_dir/pid" || true
    fi
    if [[ "$recorded_pid" == "$$" ]]; then
      /bin/rm -f -- "$lock_dir/pid" 2>/dev/null || true
      /bin/rmdir -- "$lock_dir" 2>/dev/null || true
    fi
  fi
  lock_owned=0
}

restore_previous_version() {
  [[ -n "$backup_path" && -d "$backup_path" ]] || return 0

  if [[ -e "$app_path" || -L "$app_path" ]]; then
    local failed_path="$stage_dir/failed-${APP_NAME}.app"
    if ! /bin/mv -- "$app_path" "$failed_path"; then
      warn "Could not move the failed replacement aside."
      keep_staging=1
      rollback_failed=1
      return 1
    fi
  fi

  if ! /bin/mv -- "$backup_path" "$app_path"; then
    warn "Automatic rollback failed. Your previous app is preserved at: $backup_path"
    keep_staging=1
    rollback_failed=1
    return 1
  fi

  backup_path=""
  return 0
}

cleanup() {
  local status=$?
  trap - EXIT

  if (( status != 0 && transaction_committed == 0 )); then
    restore_previous_version || true
  fi

  if [[ -n "$stage_dir" && -d "$stage_dir" && "$keep_staging" -eq 0 ]]; then
    /bin/rm -rf -- "$stage_dir" 2>/dev/null || true
  fi
  release_lock

  if (( status != 0 )); then
    if (( rollback_failed == 0 )); then
      printf '\nThe existing Imnota installation was left in place.\n' >&2
    else
      printf '\nAutomatic rollback did not complete. Use the recovery path below before reopening Imnota.\n' >&2
    fi
    if (( keep_staging != 0 )) && [[ -n "$stage_dir" ]]; then
      printf 'Recovery files were preserved at: %s\n' "$stage_dir" >&2
    fi
  fi

  exit "$status"
}

require_macos() {
  [[ "$(/usr/bin/uname -s)" == "Darwin" ]] || die "This updater can only run on macOS."
}

validate_release_contract() {
  local tag=$1
  local archive_url=$2
  local sums_url=$3

  if [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-nightly\.[0-9]{8}\.[1-9][0-9]*(\.[1-9][0-9]*)?)?$ ]]; then
    die "The release tag is not a supported stable or nightly Imnota tag."
  fi

  RELEASE_VERSION="${tag#v}"
  ARCHIVE_NAME="${APP_NAME}-${RELEASE_VERSION}-universal-mac.zip"
  local expected_root="${RELEASE_ROOT}/${tag}"

  [[ "$archive_url" == "${expected_root}/${ARCHIVE_NAME}" ]] ||
    die "The archive URL does not exactly match the selected official release."
  [[ "$sums_url" == "${expected_root}/SHA256SUMS.txt" ]] ||
    die "The checksum URL does not exactly match the selected official release."
}

validate_app_path() {
  local supplied_path=$1
  local expected_version=$2
  [[ "$supplied_path" == /* ]] || die "The current app path must be absolute."
  [[ "$supplied_path" == */"${APP_NAME}.app" ]] || die "The current app path must end in ${APP_NAME}.app."
  [[ "$supplied_path" != *$'\n'* && "$supplied_path" != *$'\r'* ]] || die "The current app path contains invalid characters."

  case "$supplied_path" in
    /Volumes/*) die "Updates cannot be installed from a disk image or mounted volume." ;;
    */AppTranslocation/*) die "Move Imnota to a permanent folder before updating." ;;
  esac

  [[ -d "$supplied_path" && ! -L "$supplied_path" ]] || die "The current Imnota app bundle was not found."

  local parent supplied_parent canonical_parent
  supplied_parent="${supplied_path%/*}"
  canonical_parent="$(cd -- "$supplied_parent" && pwd -P)" || die "The app folder could not be resolved."
  app_path="${canonical_parent}/${APP_NAME}.app"
  [[ "$app_path" == "$supplied_path" ]] || die "The current app path must be canonical and cannot contain symlinked folders."
  [[ -w "$canonical_parent" && -x "$canonical_parent" ]] ||
    die "The app folder is not writable. Move Imnota to a folder you own, then try again."

  local current_id
  current_id="$(plist_value "$app_path/Contents/Info.plist" CFBundleIdentifier)" ||
    die "The current app bundle identifier could not be read."
  [[ "$current_id" == "$APP_ID" ]] || die "The selected app is not an official Imnota bundle."
  CURRENT_VERSION="$(plist_value "$app_path/Contents/Info.plist" CFBundleShortVersionString)" ||
    die "The current app version could not be read."
  [[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]] ||
    die "The current app version is invalid."
  [[ "$expected_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]] ||
    die "The expected current app version is invalid."
  [[ "$CURRENT_VERSION" == "$expected_version" ]] ||
    die "This update command was prepared for Imnota $expected_version, but $CURRENT_VERSION is installed. Check for updates again."
  EXPECTED_CURRENT_VERSION="$expected_version"
  ORIGINAL_APP_IDENTITY="$(stat_identity "$app_path")" || die "The current app identity could not be recorded."
}

acquire_lock() {
  local parent=$1
  lock_dir="${parent}/.imnota-update.lock"

  if /bin/mkdir -- "$lock_dir" 2>/dev/null; then
    lock_owned=1
    printf '%s\n' "$$" > "$lock_dir/pid" || die "The update lock could not be recorded."
    return 0
  fi

  die "Another update may be running or was interrupted. After confirming no Imnota update Terminal is running, use Finder's Go > Go to Folder to remove this lock folder, then try again: $lock_dir"
}

download_file() {
  /usr/bin/curl --fail --location --show-error --progress-bar \
    --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 1800 --retry 2 --retry-delay 1 \
    --output "$2" "$1"
}

sha256_file() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

macos_version() {
  /usr/bin/sw_vers -productVersion
}

version_at_least() {
  local current=$1 minimum=$2 index
  [[ "$current" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ && "$minimum" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || return 1
  local current_parts minimum_parts
  IFS=. read -r -a current_parts <<< "$current"
  IFS=. read -r -a minimum_parts <<< "$minimum"
  for index in 0 1 2; do
    local actual=$((10#${current_parts[$index]:-0})) required=$((10#${minimum_parts[$index]:-0}))
    (( actual > required )) && return 0
    (( actual < required )) && return 1
  done
  return 0
}

require_compatible_macos() {
  local minimum current
  minimum="$(plist_value "$1/Contents/Info.plist" LSMinimumSystemVersion)" ||
    die "The downloaded app's minimum macOS version could not be read."
  current="$(macos_version)" || die "The current macOS version could not be read."
  version_at_least "$current" "$minimum" ||
    die "This release requires macOS $minimum or later; this Mac reports $current. The installed app was not changed."
}

stat_identity() {
  /usr/bin/stat -f '%d:%i' "$1"
}

is_imnota_bundle() {
  local bundle=$1 bundle_id
  [[ -d "$bundle" && ! -L "$bundle" ]] || return 1
  bundle_id="$(plist_value "$bundle/Contents/Info.plist" CFBundleIdentifier)" || return 1
  [[ "$bundle_id" == "$APP_ID" ]]
}

is_legacy_backup_name() {
  local name=$1
  [[ "$name" =~ ^${APP_NAME}[[:space:]]Backup[[:space:]][0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*[[:space:]][0-9]{8}-[0-9]{6}[[:space:]][0-9]+\.app$ ]] ||
    [[ "$name" =~ ^${APP_NAME}-backup-[0-9]{8}-[0-9]{6}(\.[0-9A-Za-z-]+)?\.app$ ]]
}

cleanup_legacy_backups() {
  local parent=$1 candidate name
  while IFS= read -r -d '' candidate; do
    name="${candidate##*/}"
    is_legacy_backup_name "$name" || continue
    is_imnota_bundle "$candidate" || continue
    if ! /bin/mv -- "$candidate" "$stage_dir/retired-${name}"; then
      warn "Could not retire an old Imnota rollback backup: $candidate"
    fi
  done < <(
    /usr/bin/find "$parent" -maxdepth 1 -type d \
      \( -name "${APP_NAME} Backup *.app" -o -name "${APP_NAME}-backup-*.app" \) -print0
  )
}

retain_latest_rollback_backup() {
  local active_backup="$backup_root/${APP_NAME}.app"
  [[ -n "$backup_path" && -d "$backup_path" ]] || return 0

  if [[ -e "$active_backup" || -L "$active_backup" ]]; then
    if ! is_imnota_bundle "$active_backup"; then
      warn "The managed rollback location contains an unexpected item; preserving the newest rollback at: $backup_path"
      return 0
    fi
    if ! /bin/mv -- "$active_backup" "$stage_dir/retired-rollback.app"; then
      warn "Could not retire the previous rollback backup; preserving the newest rollback at: $backup_path"
      return 0
    fi
  fi

  if /bin/mv -- "$backup_path" "$active_backup"; then
    backup_path="$active_backup"
  else
    warn "Could not place the rollback backup in its managed location; it was preserved at: $backup_path"
  fi
}

cleanup_stale_rollback_backups() {
  local candidate
  while IFS= read -r -d '' candidate; do
    [[ "$candidate" != "$backup_path" ]] || continue
    is_imnota_bundle "$candidate" || continue
    /bin/mv -- "$candidate" "$stage_dir/retired-${candidate##*/}" ||
      warn "Could not retire a stale Imnota rollback backup: $candidate"
  done < <(/usr/bin/find "$backup_root" -maxdepth 1 -type d -name '.rollback-*.app' -print0)
}

verify_signature() {
  /usr/bin/codesign --verify --deep --strict --all-architectures "$1"
}

verify_universal_binary() {
  /usr/bin/lipo "$1" -verify_arch x86_64 arm64
}

extract_archive() {
  /usr/bin/ditto -x -k "$1" "$2"
}

request_quit() {
  /usr/bin/osascript -e "tell application id \"$APP_ID\" to quit"
}

is_app_running() {
  /usr/bin/pgrep -x "$APP_NAME" >/dev/null 2>&1
}

launch_app() {
  /usr/bin/open "$1"
}

read_expected_checksum() {
  local sums_file=$1
  local archive_name=$2
  local line="" checksum="" listed_name="" count=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([[:xdigit:]]{64})[[:space:]][[:space:]](.+)$ ]]; then
      checksum="${BASH_REMATCH[1]}"
      listed_name="${BASH_REMATCH[2]}"
      if [[ "$listed_name" == "$archive_name" ]]; then
        EXPECTED_CHECKSUM="$(printf '%s' "$checksum" | /usr/bin/tr '[:upper:]' '[:lower:]')"
        count=$((count + 1))
      fi
    fi
  done < "$sums_file"

  [[ "$count" -eq 1 ]] || die "SHA256SUMS.txt must contain exactly one checksum for $archive_name."
}

archive_entry_is_safe() {
  local entry=$1 component
  [[ -n "$entry" && "$entry" != /* && "$entry" != *\\* ]] || return 1
  [[ "$entry" != *$'\r'* ]] || return 1
  [[ "$entry" == "$APP_NAME.app" || "$entry" == "$APP_NAME.app/"* ]] || return 1

  local components=()
  IFS='/' read -r -a components <<< "$entry"
  for component in "${components[@]}"; do
    [[ -n "$component" && "$component" != "." && "$component" != ".." ]] || return 1
  done
  return 0
}

validate_archive_entries() {
  local archive=$1 listing=$2 entry="" count=0
  /usr/bin/zipinfo -1 "$archive" > "$listing" || die "The downloaded zip could not be inspected."
  while IFS= read -r entry || [[ -n "$entry" ]]; do
    archive_entry_is_safe "$entry" || die "The downloaded zip contains an unsafe path."
    count=$((count + 1))
  done < "$listing"
  [[ "$count" -gt 0 ]] || die "The downloaded zip is empty."
}

normalize_relative_path() {
  local input=$1 component result="" depth=0 index
  local components=() stack=()
  IFS='/' read -r -a components <<< "$input"

  for component in "${components[@]}"; do
    case "$component" in
      ""|".") ;;
      "..")
        (( depth > 0 )) || return 1
        depth=$((depth - 1))
        unset 'stack[depth]'
        ;;
      *)
        stack[$depth]="$component"
        depth=$((depth + 1))
        ;;
    esac
  done

  for ((index = 0; index < depth; index++)); do
    if [[ -n "$result" ]]; then
      result="$result/${stack[$index]}"
    else
      result="${stack[$index]}"
    fi
  done
  printf '%s\n' "$result"
}

validate_bundle_symlinks() {
  local bundle=$1 list_file=$2 link="" link_rel="" link_dir="" target="" normalized=""
  /usr/bin/find "$bundle" -type l -print0 > "$list_file" || die "The extracted app symlinks could not be inspected."

  while IFS= read -r -d '' link; do
    target="$(/usr/bin/readlink "$link")" || die "A symlink in the app could not be read."
    [[ "$target" != /* && "$target" != *$'\n'* && "$target" != *$'\r'* ]] ||
      die "The extracted app contains an unsafe symlink."

    link_rel="${link#"$bundle"/}"
    if [[ "$link_rel" == */* ]]; then
      link_dir="${link_rel%/*}"
    else
      link_dir=""
    fi
    normalized="$(normalize_relative_path "$link_dir/$target")" ||
      die "The extracted app contains a symlink that leaves the app bundle."
    [[ -n "$normalized" && -e "$link" ]] || die "The extracted app contains a broken symlink."
  done < "$list_file"
}

validate_extracted_bundle() {
  local extracted=$1 version=$2
  local new_app="${extracted}/${APP_NAME}.app"
  local entries=()

  shopt -s dotglob nullglob
  entries=("$extracted"/*)
  shopt -u dotglob nullglob
  [[ "${#entries[@]}" -eq 1 && "${entries[0]}" == "$new_app" && -d "$new_app" && ! -L "$new_app" ]] ||
    die "The zip must contain exactly one top-level Imnota.app bundle."

  local info_plist="$new_app/Contents/Info.plist"
  local bundle_id bundle_version
  bundle_id="$(plist_value "$info_plist" CFBundleIdentifier)" || die "The downloaded bundle identifier could not be read."
  bundle_version="$(plist_value "$info_plist" CFBundleShortVersionString)" || die "The downloaded bundle version could not be read."
  [[ "$bundle_id" == "$APP_ID" ]] || die "The downloaded app has the wrong bundle identifier."
  [[ "$bundle_version" == "$version" ]] || die "The downloaded app version does not match the selected release."

  validate_bundle_symlinks "$new_app" "$stage_dir/symlinks.bin"
  verify_signature "$new_app" || die "The downloaded app failed code-signature verification."
  verify_universal_binary "$new_app/Contents/MacOS/$APP_NAME" || die "The downloaded app is not a universal Intel and Apple silicon build."
  require_compatible_macos "$new_app"
}

assert_original_app_unchanged() {
  local current_identity current_version
  [[ -d "$app_path" && ! -L "$app_path" ]] || die "The current app changed while the update was being prepared."
  current_identity="$(stat_identity "$app_path")" || die "The current app identity could not be checked."
  [[ "$current_identity" == "$ORIGINAL_APP_IDENTITY" ]] ||
    die "The current app was replaced while the update was being prepared. Run the update again."
  current_version="$(plist_value "$app_path/Contents/Info.plist" CFBundleShortVersionString)" ||
    die "The current app version could not be checked."
  [[ "$current_version" == "$EXPECTED_CURRENT_VERSION" ]] ||
    die "The installed Imnota version changed while the update was being prepared. Check for updates again."
}

wait_for_app_to_quit() {
  local elapsed=0 timeout=60 next_quit_request=10
  is_app_running || return 0
  if ! request_quit && is_app_running; then
    die "Imnota could not be asked to quit."
  fi

  while is_app_running; do
    (( elapsed < timeout )) || die "Imnota did not quit within ${timeout} seconds. Save your work, close it, and try again."
    /bin/sleep 1
    elapsed=$((elapsed + 1))
    if (( elapsed < timeout && elapsed == next_quit_request )) && is_app_running; then
      if ! request_quit && is_app_running; then
        die "Imnota could not be asked to finish quitting."
      fi
      next_quit_request=$((next_quit_request + 10))
    fi
  done
}

swap_and_launch() {
  local replacement=$1
  backup_root="${app_path%/*}/.imnota-backups.noindex"
  if [[ -e "$backup_root" || -L "$backup_root" ]]; then
    [[ -d "$backup_root" && ! -L "$backup_root" ]] ||
      die "The managed rollback folder is not a safe directory."
  else
    /bin/mkdir -- "$backup_root" || die "The managed rollback folder could not be created."
  fi
  /bin/chmod 700 "$backup_root" || die "The managed rollback folder could not be secured."
  backup_path="$backup_root/.rollback-$$.app"
  [[ ! -e "$backup_path" && ! -L "$backup_path" ]] || die "A backup path collision prevented the update."

  /bin/mv -- "$app_path" "$backup_path" || die "The existing app could not be moved into the rollback area."
  /bin/mv -- "$replacement" "$app_path" || die "The verified update could not be moved into place."
  verify_signature "$app_path" || die "The installed replacement failed its final signature check."
  launch_app "$app_path" || die "The updated app could not be opened; restoring the previous version."

  transaction_committed=1
  retain_latest_rollback_backup
  cleanup_stale_rollback_backups
  cleanup_legacy_backups "${app_path%/*}"
  printf 'The rollback copy is kept in Imnota-managed support storage.\n'
}

main() {
  [[ "$#" -eq 5 ]] ||
    die "Usage: update-macos.sh <tag> <zip-url> <sha256sums-url> <current-app-path> <expected-current-version>"
  trap cleanup EXIT
  trap 'exit 130' HUP INT TERM

  require_macos
  local tag=$1 archive_url=$2 sums_url=$3 supplied_app_path=$4 expected_current_version=$5
  validate_release_contract "$tag" "$archive_url" "$sums_url"
  validate_app_path "$supplied_app_path" "$expected_current_version"

  local app_parent="${app_path%/*}"
  acquire_lock "$app_parent"
  stage_dir="$(/usr/bin/mktemp -d "${app_parent}/.imnota-update.XXXXXX")" ||
    die "A same-folder update staging area could not be created."
  /bin/chmod 700 "$stage_dir"

  local archive="$stage_dir/$ARCHIVE_NAME"
  local sums="$stage_dir/SHA256SUMS.txt"
  local extracted="$stage_dir/extracted"
  /bin/mkdir -- "$extracted"

  printf 'Downloading Imnota %s...\n' "$RELEASE_VERSION"
  download_file "$sums_url" "$sums" || die "SHA256SUMS.txt could not be downloaded."
  download_file "$archive_url" "$archive" || die "The Imnota update could not be downloaded."

  read_expected_checksum "$sums" "$ARCHIVE_NAME"
  local actual_checksum
  actual_checksum="$(sha256_file "$archive")" || die "The downloaded zip checksum could not be calculated."
  actual_checksum="$(printf '%s' "$actual_checksum" | /usr/bin/tr '[:upper:]' '[:lower:]')"
  [[ "$actual_checksum" == "$EXPECTED_CHECKSUM" ]] || die "The downloaded zip does not match SHA256SUMS.txt."

  validate_archive_entries "$archive" "$stage_dir/archive-entries.txt"
  extract_archive "$archive" "$extracted" || die "The verified update could not be extracted."
  validate_extracted_bundle "$extracted" "$RELEASE_VERSION"

  printf 'The update is verified. Waiting for Imnota to close safely...\n'
  wait_for_app_to_quit
  assert_original_app_unchanged

  swap_and_launch "$extracted/${APP_NAME}.app"
  printf 'Imnota %s was installed successfully.\n' "$RELEASE_VERSION"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
