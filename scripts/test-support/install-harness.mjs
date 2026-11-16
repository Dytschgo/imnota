import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Shared harness for scripts/install.*.test.mjs. Those tests run the real
// installers with only the network and the platform-specific commands
// replaced, so a refusal is observed as "nothing was installed or executed",
// not as an internal function result. Each platform lives in its own test
// file so `node --test` runs them in parallel processes.

const shellInstaller = fileURLToPath(new URL('../install.sh', import.meta.url));
export const releaseRoot = 'https://github.com/Dytschgo/imnota/releases';

const bashCandidates = [
  process.env.BASH,
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/usr/bin/bash',
].filter(Boolean);
export const bash = bashCandidates.find((candidate) => fs.existsSync(candidate));
// Pre-verification control flow is portable. Replacement tests must use the
// supported platform's own filesystem utilities (GNU mv on Linux, BSD ditto on
// macOS); a stubbed uname does not turn another host into that platform.
export const linuxReplacementSkip =
  !bash || (process.platform !== 'linux' && 'Requires native Linux replacement utilities; runs in Linux CI');
export const nativeMacSkip =
  !bash || (process.platform !== 'darwin' && 'Requires native macOS ditto and PlistBuddy');

export function slashes(value) {
  return value.replaceAll('\\', '/');
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function checksumLine(name, content) {
  return `${sha256(content)}  ${name}`;
}

export function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota install [test]-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directories = {
    root,
    releases: path.join(root, 'releases'),
    home: path.join(root, 'home'),
    temporary: path.join(root, 'tmp'),
    log: path.join(root, 'requests.log'),
  };
  for (const directory of [directories.releases, directories.home, directories.temporary])
    fs.mkdirSync(directory);
  fs.writeFileSync(directories.log, '');
  return directories;
}

export function publish(directories, tag, files) {
  const directory = path.join(directories.releases, tag);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content);
}

export function requests(directories) {
  return fs.readFileSync(directories.log, 'utf8').split(/\r?\n/).filter(Boolean);
}

export function assertNoTemporaryFiles(directories) {
  assert.deepEqual(fs.readdirSync(directories.temporary), []);
}

const bashFakes = String.raw`
uname() {
  case "\${1:-}" in
    -m) printf '%s\n' "\${FAKE_UNAME_M:-x86_64}" ;;
    *) printf '%s\n' "$FAKE_UNAME_S" ;;
  esac
}
curl() {
  local output="" url="" head=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --output) output=$2; shift 2 ;;
      --write-out | --retry) shift 2 ;;
      --head) head=1; shift ;;
      --*) shift ;;
      *) url=$1; shift ;;
    esac
  done
  printf '%s\n' "$url" >> "$FAKE_LOG"
  if [ "$head" = 1 ]; then
    [ -n "\${FAKE_LATEST_URL:-}" ] || return 22
    printf '%s' "$FAKE_LATEST_URL"
    return 0
  fi
  local source="$FAKE_RELEASES/\${url#https://github.com/Dytschgo/imnota/releases/download/}"
  [ -f "$source" ] || return 22
  cp "$source" "$output"
  [ "\${FAKE_PARTIAL_DOWNLOAD:-}" != "\${url##*/}" ]
}
ditto() {
  printf 'ditto\n' >> "$FAKE_LOG"
  if [ "\${FAKE_PORTABLE_MAC:-}" = 1 ]; then
    local destination="$2"
    if [ "$1" = -x ]; then destination="$4/Imnota.app"; fi
    mkdir -p "$destination"
    cp -R "$FAKE_MAC_BUNDLE/." "$destination/"
    if [ "$1" != -x ]; then
      [ "\${FAKE_MAC_MISSING_EXECUTABLE:-}" != 1 ] || rm "$destination/Contents/MacOS/Imnota"
      [ "\${FAKE_MAC_COPY_FAILURE:-}" != 1 ] || return 1
    fi
    return 0
  fi
  [ "\${FAKE_NATIVE_DITTO:-}" = 1 ] || return 1
  if [ "$1" != -x ] && [ "\${FAKE_MAC_COPY_FAILURE:-}" = 1 ]; then return 1; fi
  command ditto "$@"
}
codesign() {
  printf 'codesign\n' >> "$FAKE_LOG"
  if [[ "\${!#}" == */Applications/Imnota.app ]] && [ "\${FAKE_MAC_VERIFY_FAILURE:-}" = 1 ]; then return 1; fi
  return "\${FAKE_CODESIGN_EXIT:-1}"
}
fake_plist() {
  local bundle="\${3%/Contents/Info.plist}"
  if [[ "$2" == *CFBundleIdentifier ]]; then cat "$bundle/bundle-id"; else printf 13.0; fi
}
fake_sw_vers() { printf 14.0; }
mv() {
  if [[ "\${2:-}" == */previous-Imnota.app ]] && [ "\${FAKE_MAC_RESTORE_FAILURE:-}" = 1 ]; then return 1; fi
  command mv "$@" || return $?
  if [[ "\${3:-}" == */previous-Imnota.app ]] && [ "\${FAKE_MAC_INTERRUPT:-}" = 1 ]; then kill -TERM "$$"; fi
}
/usr/bin/pgrep() {
  if [ "\${FAKE_OLD_RUNNING:-0}" = 1 ] && [ ! -f "$FAKE_LOG.quit" ]; then printf '100\n'; return 0; fi
  [ "\${FAKE_LAUNCHED:-0}" = 1 ] || return 1
  [ "\${FAKE_MAC_READINESS:-}" != missing ] || return 1
  if [ "\${FAKE_MAC_READINESS:-}" = exits ] && [ "\${FAKE_POLL:-0}" -gt 0 ]; then return 1; fi
  printf '200\n'
}
/bin/ps() {
  if [[ "$*" == *"$$"* ]]; then printf shell; return 0; fi
  if [[ "$*" == *-axo* ]]; then return 0; fi
  if [ "\${FAKE_MAC_READINESS:-}" = exits ] && [ "\${FAKE_POLL:-0}" -gt 0 ]; then return 1; fi
  if [[ "$*" == *'stat=,comm='* ]]; then
    if [ "\${FAKE_MAC_READINESS:-}" = zombie ]; then printf 'Z '; else printf 'S '; fi
  fi
  if [ "$2" = stat= ]; then
    if [ "\${FAKE_MAC_READINESS:-}" = zombie ]; then printf 'Z\n'; else printf 'S\n'; fi
    return 0
  fi
  if [ "\${FAKE_MAC_READINESS:-}" = wrong-path ]; then printf '/other/Imnota.app/Contents/MacOS/Imnota\n'; return 0; fi
  printf '%s/Imnota\n' "$(cd "$HOME/Applications/Imnota.app/Contents/MacOS" && pwd -P)"
}
/usr/bin/osascript() {
  printf 'quit\n' >> "$FAKE_LOG"
  if [ "\${FAKE_MAC_QUIT_REFUSED:-}" != 1 ]; then touch "$FAKE_LOG.quit"; fi
}
/bin/sleep() { command /bin/sleep 0.01; SECONDS=$((SECONDS + $1)); FAKE_POLL=$((\${FAKE_POLL:-0} + 1)); }
open() { FAKE_LAUNCHED=1; FAKE_POLL=0; printf 'open\n' >> "$FAKE_LOG"; [ "\${FAKE_MAC_OPEN_FAILURE:-}" != 1 ]; }
# Never execute even the synthetic AppImage.
nohup() { :; }
install() {
  [ "\${FAKE_INSTALL_FAILURE:-}" != 1 ] || return 1
  command install "$@"
}
source "$1"
`.replaceAll('\\$', '$');

export function runShellInstaller(
  directories,
  {
    platform = 'Linux',
    latest,
    tag,
    partial = '',
    installFailure = '',
    nativeDitto = false,
    codesignExit = 1,
    macCopyFailure = false,
    portableMac = false,
    macVerifyFailure = false,
    macMissingExecutable = false,
    macRestoreFailure = false,
    macInterrupt = false,
    macOpenFailure = false,
    macRunning = false,
    macQuitRefused = false,
    macReadiness = '',
  } = {},
) {
  assert.ok(bash, 'Bash is required for this test');
  const env = {
    ...process.env,
    HOME: slashes(directories.home),
    TMPDIR: slashes(directories.temporary),
    FAKE_UNAME_S: platform,
    FAKE_PARTIAL_DOWNLOAD: partial,
    FAKE_INSTALL_FAILURE: installFailure,
    FAKE_NATIVE_DITTO: nativeDitto ? '1' : '',
    FAKE_CODESIGN_EXIT: String(codesignExit),
    FAKE_MAC_COPY_FAILURE: macCopyFailure ? '1' : '',
    FAKE_PORTABLE_MAC: portableMac ? '1' : '',
    FAKE_MAC_BUNDLE: slashes(path.join(directories.root, 'fixture.app')),
    FAKE_MAC_VERIFY_FAILURE: macVerifyFailure ? '1' : '',
    FAKE_MAC_MISSING_EXECUTABLE: macMissingExecutable ? '1' : '',
    FAKE_MAC_RESTORE_FAILURE: macRestoreFailure ? '1' : '',
    FAKE_MAC_INTERRUPT: macInterrupt ? '1' : '',
    FAKE_MAC_OPEN_FAILURE: macOpenFailure ? '1' : '',
    FAKE_OLD_RUNNING: macRunning ? '1' : '',
    FAKE_MAC_QUIT_REFUSED: macQuitRefused ? '1' : '',
    FAKE_MAC_READINESS: macReadiness,
    FAKE_LOG: slashes(directories.log),
    FAKE_RELEASES: slashes(directories.releases),
    FAKE_LATEST_URL: latest ?? '',
    IMNOTA_RELEASE_TAG: tag ?? '',
  };
  let script = shellInstaller;
  if (portableMac) {
    script = path.join(directories.root, 'portable-installer.sh');
    fs.writeFileSync(
      script,
      fs
        .readFileSync(shellInstaller, 'utf8')
        .replaceAll('/usr/libexec/PlistBuddy', 'fake_plist')
        .replaceAll('/usr/bin/sw_vers', 'fake_sw_vers'),
    );
  }
  return spawnSync(bash, ['-c', bashFakes, 'test', slashes(script)], {
    encoding: 'utf8',
    env,
  });
}

export const appImage = '#!/bin/sh\nexit 0\n';

export function hostileChecksums(assetName, content) {
  return ['*', '[]', '$', `../${assetName}`, assetName.toLowerCase()]
    .map((name) => checksumLine(name, 'unrelated bytes'))
    .concat(checksumLine(assetName, content))
    .join('\n');
}
