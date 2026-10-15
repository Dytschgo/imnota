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
rollback_owned=0
backup_root=""
transaction_committed=0
replacement_launched=0
replacement_pid=""
replacement_pids=""
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
  [[ "$rollback_owned" -eq 1 && -n "$backup_path" && -d "$backup_path" && ! -L "$backup_path" ]] || return 0

  if ! quiesce_replacement "$app_path"; then
    keep_staging=1
    warn "Failed replacement preserved at: $stage_dir/failed-${APP_NAME}.app (or $app_path if moving it fails). Quit that process before reopening the restored app."
  fi
  if [[ -e "$app_path" || -L "$app_path" ]]; then
    local failed_path="$stage_dir/failed-${APP_NAME}.app"
    if ! /bin/mv -- "$app_path" "$failed_path"; then
      warn "Could not move the failed replacement aside. Your previous app is preserved at: $backup_path"
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
  rollback_owned=0
  return 0
}

cleanup() {
  local status=$?
  trap - EXIT

  if (( status != 0 && transaction_committed == 0 )); then
    restore_previous_version || true
  fi

  if [[ -n "$stage_dir" && -d "$stage_dir" && "$keep_staging" -eq 0 ]]; then
    /bin/rm -rf -- "$stage_dir" 2>/dev/null || warn "Could not clean update staging at: $stage_dir"
  fi
  if [[ -n "$backup_root" && -d "$backup_root" && ! -L "$backup_root" ]]; then
    /bin/rmdir -- "$backup_root" 2>/dev/null || true
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
  [[ -O "$canonical_parent" && -w "$canonical_parent" && -x "$canonical_parent" ]] ||
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

safe_physical_directory() {
  [[ -d "$1" && ! -L "$1" && -O "$1" && -w "$1" && -x "$1" ]] || return 1
  [[ "$(cd -- "$1" && pwd -P)" == "$1" ]]
}

bundle_is_direct_child() {
  local candidate=$1 parent=$2
  [[ "${candidate%/*}" == "$parent" && -d "$candidate" && ! -L "$candidate" ]] || return 1
  [[ "$(cd -- "$candidate" && pwd -P)" == "$candidate" ]]
}

cleanup_legacy_backups() {
  local parent=$1 candidate name
  safe_physical_directory "$parent" || return 0
  while IFS= read -r -d '' candidate; do
    name="${candidate##*/}"
    is_legacy_backup_name "$name" || continue
    bundle_is_direct_child "$candidate" "$parent" || continue
    is_imnota_bundle "$candidate" || continue
    if ! /bin/rm -rf -- "$candidate"; then
      warn "Could not retire an old Imnota rollback backup: $candidate"
    fi
  done < <(
    /usr/bin/find "$parent" -maxdepth 1 -type d \
      \( -name "${APP_NAME} Backup *.app" -o -name "${APP_NAME}-backup-*.app" \) -print0
  )
}

cleanup_rollback_backups() {
  local candidate
  safe_physical_directory "$backup_root" || return 0
  while IFS= read -r -d '' candidate; do
    [[ "${candidate##*/}" == "$APP_NAME.app" || "${candidate##*/}" =~ ^\.rollback-[0-9]+\.app$ ]] || continue
    bundle_is_direct_child "$candidate" "$backup_root" || continue
    is_imnota_bundle "$candidate" || continue
    /bin/rm -rf -- "$candidate" ||
      warn "Could not retire a stale Imnota rollback backup: $candidate"
  done < <(/usr/bin/find "$backup_root" -maxdepth 1 -type d \( -name '.rollback-*.app' -o -name "${APP_NAME}.app" \) -print0)
  /bin/rmdir -- "$backup_root" 2>/dev/null || true
}

verify_signature() {
  /usr/bin/codesign --verify --deep --strict --all-architectures "$1"
}

verify_universal_binary() {
  # Current lipo consumes one arch after -verify_arch and reads a second as
  # another input file, so verify each architecture in its own call.
  local arch
  for arch in x86_64 arm64; do
    /usr/bin/lipo "$1" -verify_arch "$arch" || return 1
  done
}

extract_archive() {
  /usr/bin/ditto -x -k "$1" "$2"
}

# These lifecycle helpers must stay identical in the two standalone Mac scripts.
# Bound the AppleEvent AND its sender: a modal dialog must not outlive our deadline.
bounded_quit_request() {
  local deadline=$1 bundle=${2:-} sender status
  if [[ -n "$bundle" ]]; then
    /usr/bin/osascript -e 'on run argv
with timeout of 5 seconds
  tell application (item 1 of argv) to quit
end timeout
end run' "$bundle" &
  else
    /usr/bin/osascript -e 'with timeout of 5 seconds
  tell application id "com.dytschgo.imnota" to quit
end timeout' &
  fi
  sender=$!
  while kill -0 "$sender" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      kill -TERM "$sender" 2>/dev/null || true
      # This is our unreaped request sender, never an application process.
      kill -KILL "$sender" 2>/dev/null || true
      wait "$sender" 2>/dev/null || true
      echo "Imnota quit request timed out." >&2
      return 1
    fi
    /bin/sleep 1
  done
  wait "$sender" && return 0
  status=$?
  echo "Imnota quit request failed (status $status)." >&2
  return 1
}

request_quit() {
  bounded_quit_request "$1"
}

wait_for_app_to_quit() {
  local timeout=60 deadline=$((SECONDS + 60))
  is_app_running || return 0
  if ! request_quit "$deadline"; then
    echo "Imnota quit request failed or timed out. No installed app was changed." >&2
    exit 1
  fi
  while is_app_running; do
    if (( SECONDS >= deadline )); then
      echo "Imnota did not quit within $timeout seconds. Save your work, close it, and try again. No installed app was changed." >&2
      exit 1
    fi
    /bin/sleep 1
  done
}

require_process_inspection() {
  /bin/ps -ww -o comm= -p "$$" >/dev/null || {
    echo "Could not run /bin/ps; replacement process ownership cannot be verified." >&2
    return 1
  }
}

# 0 = live owned process, 1 = absent/unowned, 2 = inspection unavailable.
replacement_pid_belongs_to_bundle() {
  local pid=$1 bundle=$2 executable state physical_parent status
  [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] || return 1
  if executable="$(/bin/ps -ww -o comm= -p "$pid")"; then :; else
    status=$?
    if (( status != 1 )); then
      echo "Could not run /bin/ps for replacement PID $pid (status $status)." >&2
      return 2
    fi
    require_process_inspection || return 2
    return 1
  fi
  [[ "$executable" == "$bundle/"* ]] || return 1
  if [[ ! -x "$executable" || -L "$executable" ]] ||
    ! physical_parent="$(cd -- "${executable%/*}" && pwd -P)" ||
    [[ "$physical_parent/${executable##*/}" != "$executable" ]]; then
    echo "Could not verify physical replacement executable: $executable" >&2
    return 2
  fi
  if state="$(/bin/ps -o stat= -p "$pid")"; then :; else
    status=$?
    if (( status != 1 )); then
      echo "Could not run /bin/ps for replacement PID $pid (status $status)." >&2
      return 2
    fi
    require_process_inspection || return 2
    return 1
  fi
  [[ -n "$state" && "$state" != *Z* ]]
}

# Inspect every process, including Electron helpers, without matching by app name.
# Keep the observed PID too, so a missing/incomplete listing cannot hide it.
find_replacement_pids() {
  local bundle=$1 listing pid executable status
  replacement_pids=""
  listing="$(/bin/ps -ww -axo pid=,comm=)" || {
    echo "Could not run /bin/ps to enumerate replacement processes." >&2
    return 1
  }
  if [[ -n "$replacement_pid" ]]; then
    listing="$replacement_pid $bundle/Contents/MacOS/Imnota
$listing"
  fi
  while read -r pid executable; do
    [[ "$executable" == "$bundle/"* ]] || continue
    if replacement_pid_belongs_to_bundle "$pid" "$bundle"; then
      replacement_pids="$replacement_pids $pid"
    else
      status=$?
      (( status != 2 )) || return 1
    fi
  done <<< "$listing"
}

quiesce_replacement() {
  local bundle=$1 deadline=$((SECONDS + 10)) grace=$((SECONDS + 5)) pid status
  (( replacement_launched != 0 )) || return 0
  require_process_inspection || return 1
  find_replacement_pids "$bundle" || return 1
  [[ -n "$replacement_pids" ]] || return 0
  # Only ask the exact replacement bundle to quit after confirming it owns a PID.
  bounded_quit_request "$((SECONDS + 3))" "$bundle" || true
  while (( SECONDS < grace )); do
    find_replacement_pids "$bundle" || return 1
    [[ -n "$replacement_pids" ]] || return 0
    /bin/sleep 1
  done
  find_replacement_pids "$bundle" || return 1
  for pid in $replacement_pids; do
    # Recheck immediately before TERM; never signal a reused/unrelated PID.
    if replacement_pid_belongs_to_bundle "$pid" "$bundle"; then
      kill -TERM "$pid" 2>/dev/null || true
    else
      status=$?
      (( status != 2 )) || return 1
    fi
  done
  while :; do
    find_replacement_pids "$bundle" || return 1
    [[ -n "$replacement_pids" ]] || return 0
    (( SECONDS < deadline )) || {
      echo "The replacement could not be stopped; its bundle will be preserved." >&2
      return 1
    }
    /bin/sleep 1
  done
}

is_app_running() {
  /usr/bin/pgrep -x "$APP_NAME" >/dev/null 2>&1
}

launch_app() {
  /usr/bin/open "$1"
}

# Keep replacement observation in sync with the other standalone Mac installer.
# open only acknowledges a launch request; require the same live replacement PID
# on two polls at least one second apart. This is process readiness, not UI health.
replacement_pid_is_running() {
  local executable
  replacement_pid_belongs_to_bundle "$1" "$2" || return $?
  executable="$(/bin/ps -ww -o comm= -p "$1")" || return 1
  [[ "$executable" == "$2/Contents/MacOS/Imnota" ]]
}

wait_for_replacement() {
  local bundle=$1 timeout=30 deadline=$((SECONDS + 30)) pid pids observed_pid="" observed_at=0
  require_process_inspection || return 1
  while (( SECONDS < deadline )); do
    require_process_inspection || return 1
    if [[ -n "$observed_pid" ]]; then
      replacement_pid_is_running "$observed_pid" "$bundle" || {
        echo "The replacement exited before reopening could be confirmed; restoring the previous version." >&2
        return 1
      }
      if (( SECONDS > observed_at )); then
        printf 'Observed running Imnota replacement (PID %s) from %s.\n' "$observed_pid" "$bundle"
        return 0
      fi
    else
      pids="$(/usr/bin/pgrep -x Imnota 2>/dev/null)" || pids=""
      for pid in $pids; do
        if replacement_pid_is_running "$pid" "$bundle"; then
          observed_pid=$pid
          replacement_pid=$pid
          observed_at=$SECONDS
          break
        fi
      done
    fi
    /bin/sleep 1
  done
  echo "The replacement was not observed running from $bundle within $timeout seconds; restoring the previous version." >&2
  return 1
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

swap_and_launch() {
  local replacement=$1
  backup_root="${app_path%/*}/.imnota-backups.noindex"
  if [[ -e "$backup_root" || -L "$backup_root" ]]; then
    [[ -d "$backup_root" && ! -L "$backup_root" ]] ||
      die "The managed rollback folder is not a safe directory."
  else
    /bin/mkdir -- "$backup_root" || die "The managed rollback folder could not be created."
  fi
  safe_physical_directory "$backup_root" || die "The managed rollback folder is not a physical directory owned by you."
  /bin/chmod 700 "$backup_root" || die "The managed rollback folder could not be secured."
  local rollback_target="$backup_root/.rollback-$$.app" interrupted=0 previous_identity
  previous_identity="$(stat_identity "$app_path")" || die "The existing app identity could not be recorded before replacement."
  [[ ! -e "$rollback_target" && ! -L "$rollback_target" ]] || die "A backup path collision prevented the update."

  # Defer catchable interruption until the rename's result and ownership are
  # recorded. A pre-existing path must never become transaction rollback state.
  trap 'interrupted=1' HUP INT TERM
  if /bin/mv -- "$app_path" "$rollback_target"; then
    backup_path="$rollback_target"
    rollback_owned=1
  else
    # mv can be interrupted after rename but before reporting success. Claim
    # only the original inode, never a stale or substituted rollback directory.
    if [[ ! -e "$app_path" && ! -L "$app_path" && -d "$rollback_target" && ! -L "$rollback_target" ]] &&
      [[ "$(stat_identity "$rollback_target")" == "$previous_identity" ]]; then
      backup_path="$rollback_target"
      rollback_owned=1
    fi
    trap 'exit 130' HUP INT TERM
    (( interrupted == 0 )) || exit 130
    die "The existing app could not be moved into the rollback area."
  fi
  trap 'exit 130' HUP INT TERM
  (( interrupted == 0 )) || exit 130
  /bin/mv -- "$replacement" "$app_path" || die "The verified update could not be moved into place."
  verify_signature "$app_path" || die "The installed replacement failed its final signature check."
  replacement_launched=1
  launch_app "$app_path" || die "The updated app could not be opened; restoring the previous version."

  wait_for_replacement "$app_path" || die "The updated app did not successfully reopen."

  transaction_committed=1
  cleanup_rollback_backups
  cleanup_legacy_backups "${app_path%/*}"
  printf 'Transaction rollback and verified old Imnota backups were retired.\n'
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
