import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const scriptPath = fileURLToPath(new URL('./update-macos.sh', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const packagedMacZip = path.join(
  repositoryRoot,
  'release',
  `Imnota-${packageJson.version}-universal-mac.zip`,
);
const bashCandidates = [
  process.env.BASH,
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
  process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' : '/usr/bin/bash',
].filter(Boolean);
const bash = bashCandidates.find((candidate) => fs.existsSync(candidate));
if (process.env.IMNOTA_REQUIRE_MAC_UPDATE_TEST === '1') {
  assert.equal(process.platform, 'darwin', 'Native updater verification requires macOS');
  assert.ok(
    bash && fs.existsSync(packagedMacZip),
    'The packaged Mac zip is required for updater verification',
  );
}

function bashPath(value) {
  return value.replaceAll('\\', '/');
}

function runBash(body, args = []) {
  assert.ok(bash, 'Bash is required for this test');
  return spawnSync(bash, ['-c', `source "$1"\n${body}`, 'test', bashPath(scriptPath), ...args], {
    encoding: 'utf8',
  });
}

test('accepts exact stable and nightly release contracts', { skip: !bash }, () => {
  for (const tag of ['v1.2.3', 'v1.2.3-nightly.20260906.14', 'v1.2.3-nightly.20260906.14.2']) {
    const version = tag.slice(1);
    const root = `https://github.com/Dytschgo/imnota/releases/download/${tag}`;
    const result = runBash(
      'validate_release_contract "$2" "$3" "$4"\nprintf "%s|%s" "$RELEASE_VERSION" "$ARCHIVE_NAME"',
      [tag, `${root}/Imnota-${version}-universal-mac.zip`, `${root}/SHA256SUMS.txt`],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${version}|Imnota-${version}-universal-mac.zip`);
  }
});

test('rejects malformed tags and release URL substitutions', { skip: !bash }, () => {
  const cases = [
    [
      '1.2.3',
      'https://github.com/Dytschgo/imnota/releases/download/1.2.3/Imnota-1.2.3-universal-mac.zip',
      'https://github.com/Dytschgo/imnota/releases/download/1.2.3/SHA256SUMS.txt',
    ],
    [
      'v01.2.3',
      'https://github.com/Dytschgo/imnota/releases/download/v01.2.3/Imnota-01.2.3-universal-mac.zip',
      'https://github.com/Dytschgo/imnota/releases/download/v01.2.3/SHA256SUMS.txt',
    ],
    [
      'v1.2.3',
      'https://example.com/Imnota-1.2.3-universal-mac.zip',
      'https://github.com/Dytschgo/imnota/releases/download/v1.2.3/SHA256SUMS.txt',
    ],
    [
      'v1.2.3',
      'https://github.com/Dytschgo/imnota/releases/download/v1.2.3/Imnota-1.2.3-universal-mac.zip',
      'https://github.com/other/imnota/releases/download/v1.2.3/SHA256SUMS.txt',
    ],
  ];

  for (const args of cases) {
    const result = runBash('validate_release_contract "$2" "$3" "$4"', args);
    assert.notEqual(result.status, 0, `unexpectedly accepted ${JSON.stringify(args)}`);
  }
});

test('requires one exact checksum entry for the selected archive', { skip: !bash }, () => {
  const checksum = 'a'.repeat(64);
  const valid = runBash(
    'tmp=$(mktemp)\nprintf "%s  %s\\n" "$2" "$3" > "$tmp"\nread_expected_checksum "$tmp" "$3"\nprintf "%s" "$EXPECTED_CHECKSUM"',
    [checksum.toUpperCase(), 'Imnota-1.2.3-universal-mac.zip'],
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, checksum);

  const duplicate = runBash(
    'tmp=$(mktemp)\nprintf "%s  %s\\n%s  %s\\n" "$2" "$3" "$2" "$3" > "$tmp"\nread_expected_checksum "$tmp" "$3"',
    [checksum, 'Imnota-1.2.3-universal-mac.zip'],
  );
  assert.notEqual(duplicate.status, 0);
});

test('rejects archive traversal and paths outside Imnota.app', { skip: !bash }, () => {
  for (const entry of [
    '../Imnota.app/file',
    'Imnota.app/../payload',
    '/Imnota.app/file',
    'Other.app/file',
    'Imnota.app\\file',
  ]) {
    const result = runBash('archive_entry_is_safe "$2"', [entry]);
    assert.notEqual(result.status, 0, `unexpectedly accepted ${entry}`);
  }
  for (const entry of ['Imnota.app', 'Imnota.app/Contents/MacOS/Imnota', 'Imnota.app/Contents/Frameworks/']) {
    const result = runBash('archive_entry_is_safe "$2"', [entry]);
    assert.equal(result.status, 0, `${entry}: ${result.stderr}`);
  }
});

test('rolls the old bundle back when the verified replacement cannot launch', { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
mkdir -p "$app_path" "$stage_dir/new/Imnota.app"
CURRENT_VERSION=1.2.2
printf old > "$app_path/version"
printf new > "$stage_dir/new/Imnota.app/version"
verify_signature() { return 0; }
launch_app() { return 1; }
set +e
( trap cleanup EXIT; swap_and_launch "$stage_dir/new/Imnota.app" ) >/dev/null 2>&1
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$(cat "$app_path/version")" == old ]]
backup_count=$(find "$root" -maxdepth 1 -name 'Imnota Backup *.app' | wc -l)
[[ "$backup_count" -eq 0 ]]
rm -rf "$root"
`);
  assert.equal(result.status, 0, result.stderr);
});

test(
  'keeps only a hidden rollback copy and cleans verified legacy backups after a successful update',
  { skip: !bash },
  () => {
    const result = runBash(`
root=$(mktemp -d)
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
legacy="$root/Imnota Backup 1.2.1 20260101-010101 42.app"
legacy_dash="$root/Imnota-backup-20260102-020202.app"
untrusted="$root/Imnota Backup 1.2.0 20260101-010102 43.app"
project="$root/User Project.app"
managed="$root/.imnota-backups.noindex/Imnota.app"
mkdir -p "$app_path" "$stage_dir/new/Imnota.app" "$legacy/Contents" "$legacy_dash/Contents" "$untrusted/Contents" "$project" "$managed/Contents"
printf old > "$app_path/version"
printf new > "$stage_dir/new/Imnota.app/version"
printf older > "$managed/version"
printf trusted > "$legacy/Contents/marker"
printf trusted > "$legacy_dash/Contents/marker"
printf untrusted > "$untrusted/Contents/marker"
plist_value() {
  if [[ "$1" == *"1.2.1 20260101-010101 42.app"* || "$1" == *"Imnota-backup-20260102-020202.app"* || "$1" == *".imnota-backups.noindex/Imnota.app"* ]]; then
    printf 'com.dytschgo.imnota\\n'
  else
    printf 'com.example.unrelated\\n'
  fi
}
verify_signature() { return 0; }
launch_app() { return 0; }
CURRENT_VERSION=1.2.2
swap_and_launch "$stage_dir/new/Imnota.app"
[[ "$(cat "$app_path/version")" == new ]]
[[ "$(cat "$root/.imnota-backups.noindex/Imnota.app/version")" == old ]]
[[ "$(find "$root/.imnota-backups.noindex" -maxdepth 1 -type d -name '*.app' | wc -l)" -eq 1 ]]
[[ ! -e "$legacy" ]]
[[ ! -e "$legacy_dash" ]]
[[ -d "$untrusted" && -d "$project" ]]
backup_count=$(find "$root" -maxdepth 1 -name 'Imnota Backup *.app' | wc -l)
[[ "$backup_count" -eq 1 ]]
rm -rf "$root"
`);
    assert.equal(result.status, 0, result.stderr);
  },
);

test('preserves the newest rollback when the managed location is occupied', { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
backup_root="$root/backups"
backup_path="$backup_root/.rollback-123.app"
stage_dir="$root/stage"
mkdir -p "$backup_path" "$backup_root/.rollback-older.app" "$stage_dir"
printf unrelated > "$backup_root/Imnota.app"
is_imnota_bundle() { [[ -d "$1" ]]; }
retain_latest_rollback_backup
cleanup_stale_rollback_backups
[[ -d "$backup_path" ]]
[[ ! -e "$backup_root/.rollback-older.app" ]]
[[ "$(cat "$backup_root/Imnota.app")" == unrelated ]]
rm -rf "$root"
`);
  assert.equal(result.status, 0, result.stderr);
});

test("a failed lock acquisition never removes another updater's lock", { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
mkdir "$root/.imnota-update.lock"
printf 123 > "$root/.imnota-update.lock/pid"
set +e
( trap cleanup EXIT; acquire_lock "$root" ) >/dev/null 2>&1
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$(cat "$root/.imnota-update.lock/pid")" == 123 ]]
rm -rf "$root"
`);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects replacement of the current app during download', { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
app_path="$root/Imnota.app"
mkdir "$app_path"
ORIGINAL_APP_IDENTITY=10:20
EXPECTED_CURRENT_VERSION=1.2.2
stat_identity() { printf '10:21\\n'; }
assert_original_app_unchanged
`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /replaced while the update was being prepared/);
});

test('rejects a saved command after the installed version changes', { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
mkdir "$root/Imnota.app"
plist_value() {
  if [[ "$2" == CFBundleIdentifier ]]; then
    printf 'com.dytschgo.imnota\\n'
  else
    printf '2.0.0\\n'
  fi
}
stat_identity() { printf '10:20\\n'; }
validate_app_path "$root/Imnota.app" 1.9.0
`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /prepared for Imnota 1\.9\.0, but 2\.0\.0 is installed/);
});

test('helper has no privileged or quarantine-bypass commands', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(source, /\bsudo\b/);
  assert.doesNotMatch(source, /\bxattr\b/);
  assert.doesNotMatch(source, /spctl\s+--master-disable/);
  assert.match(source, /--max-time 1800/);
});

test('compares macOS versions numerically and rejects unreadable versions', { skip: !bash }, () => {
  for (const [current, minimum, accepted] of [
    ['12.7.6', '13.0', false],
    ['13.0', '13.0.0', true],
    ['13.0.1', '13.0', true],
    ['13.1', '13.2', false],
    ['13.10', '13.9', true],
    ['14.0', '13.6.9', true],
    ['', '13.0', false],
    ['14.0', 'unknown', false],
  ]) {
    const result = runBash('version_at_least "$2" "$3"', [current, minimum]);
    assert.equal(result.status === 0, accepted, `${current} >= ${minimum}: ${result.stderr}`);
  }
});

test(
  'rejects an incompatible downloaded bundle before asking the installed app to quit or replacing it',
  { skip: !bash },
  () => {
    const result = runBash(`
root=$(mktemp -d)
app_path="$root/Imnota.app"
stage_dir="$root/staging"
mkdir -p "$app_path" "$stage_dir/extracted/Imnota.app/Contents"
printf old > "$app_path/version"
trap 'test "$(cat "$app_path/version")" = old && printf preserved; rm -rf "$root"' EXIT
plist_value() {
  case "$2" in
    CFBundleIdentifier) printf com.dytschgo.imnota ;;
    CFBundleShortVersionString) printf 1.2.3 ;;
    LSMinimumSystemVersion) printf 13.0 ;;
    *) return 1 ;;
  esac
}
macos_version() { printf 12.7.6; }
validate_bundle_symlinks() { :; }
verify_signature() { :; }
verify_universal_binary() { :; }
validate_extracted_bundle "$stage_dir/extracted" 1.2.3
printf 'should-not-quit-or-replace'
`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires macOS 13\.0 or later/);
    assert.equal(result.stdout, 'preserved');
  },
);

test('accepts a compatible macOS bundle and refuses a missing minimum version', { skip: !bash }, () => {
  const accepted = runBash(
    'plist_value() { printf 13.0; }; macos_version() { printf 14.1; }; require_compatible_macos fixture',
  );
  assert.equal(accepted.status, 0, accepted.stderr);
  const missing = runBash(
    'plist_value() { return 1; }; macos_version() { printf 14.1; }; require_compatible_macos fixture',
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /minimum macOS version could not be read/);
});

test(
  'installs and retains a hidden rollback copy from the real packaged macOS zip',
  { skip: process.platform !== 'darwin' || !bash || !fs.existsSync(packagedMacZip) },
  () => {
    const version = packageJson.version;
    const result = runBash(
      `
zip=$2
version=$3
root=$(/usr/bin/mktemp -d)
root="$(cd "$root" && pwd -P)"
/bin/mkdir "$root/extracted"
/usr/bin/ditto -x -k "$zip" "$root/extracted"
/bin/mv "$root/extracted/Imnota.app" "$root/Imnota.app"
/bin/rmdir "$root/extracted"
checksum=$(/usr/bin/shasum -a 256 "$zip" | /usr/bin/awk '{print $1}')
printf '%s  Imnota-%s-universal-mac.zip\\n' "$checksum" "$version" > "$root/SHA256SUMS.txt"
local_zip=$zip
local_sums="$root/SHA256SUMS.txt"
download_file() {
  case "$1" in
    */SHA256SUMS.txt) /bin/cp "$local_sums" "$2" ;;
    *) /bin/cp "$local_zip" "$2" ;;
  esac
}
is_app_running() { return 1; }
launch_app() { return 0; }
main "v$version" \
  "https://github.com/Dytschgo/imnota/releases/download/v$version/Imnota-$version-universal-mac.zip" \
  "https://github.com/Dytschgo/imnota/releases/download/v$version/SHA256SUMS.txt" \
  "$root/Imnota.app" \
  "$version"
/usr/bin/codesign --verify --deep --strict --all-architectures "$root/Imnota.app"
[[ -d "$root/.imnota-backups.noindex/Imnota.app" ]]
shopt -s nullglob
set -- "$root"/"Imnota Backup "*.app
shopt -u nullglob
[[ "$#" -eq 0 ]]
/bin/rm -rf "$root"
`,
      [bashPath(packagedMacZip), version],
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  },
);
