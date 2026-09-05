#!/usr/bin/env bash

set -euo pipefail

repository="Dytschgo/imnota"
download_base="https://github.com/${repository}/releases/latest/download"
temporary_directory="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_directory"
}

trap cleanup EXIT

case "$(uname -s)" in
  Darwin)
    archive_path="${temporary_directory}/Imnota-mac.zip"
    echo "Downloading the latest Imnota release for macOS..."
    if ! curl --fail --location --retry 3 --output "$archive_path" "${download_base}/Imnota-mac.zip"; then
      echo "Download failed. No installed app was changed. Check https://github.com/${repository}/releases and try again." >&2
      exit 1
    fi
    curl --fail --location --retry 3 --output "$temporary_directory/SHA256SUMS.txt" "${download_base}/SHA256SUMS.txt"
    (cd "$temporary_directory" && grep '  Imnota-mac.zip$' SHA256SUMS.txt | shasum -a 256 -c -)
    mkdir -p "$HOME/Applications"
    ditto -x -k "$archive_path" "$temporary_directory"
    test -x "$temporary_directory/Imnota.app/Contents/MacOS/Imnota"
    codesign --verify --deep --strict "$temporary_directory/Imnota.app"
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
    echo "Downloading the latest Imnota release for Linux..."
    mkdir -p "$(dirname "$application_path")"
    curl --fail --location --retry 3 --output "$temporary_directory/Imnota.AppImage" "${download_base}/Imnota.AppImage"
    chmod +x "$temporary_directory/Imnota.AppImage"
    install -m 755 "$temporary_directory/Imnota.AppImage" "${application_path}.new"
    mv "${application_path}.new" "$application_path"
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
