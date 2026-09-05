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
    curl --fail --location --retry 3 --output "$archive_path" "${download_base}/Imnota-mac.zip"
    mkdir -p "$HOME/Applications"
    ditto -x -k "$archive_path" "$temporary_directory"
    ditto "$temporary_directory/Imnota.app" "$HOME/Applications/Imnota.app"
    echo "Imnota installed to ~/Applications/Imnota.app"
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
