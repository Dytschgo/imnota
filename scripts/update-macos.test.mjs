import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
  const portableStat =
    process.platform === 'darwin' ? '' : 'stat_identity() { /usr/bin/stat -c "%d:%i" "$1"; }';
  return spawnSync(
    bash,
    ['-c', `source "$1"\n${portableStat}\n${body}`, 'test', bashPath(scriptPath), ...args],
    {
      encoding: 'utf8',
    },
  );
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
root="$(cd "$root" && pwd -P)"
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
mkdir -p "$app_path" "$stage_dir/new/Imnota.app"
CURRENT_VERSION=1.2.2
printf old > "$app_path/version"
printf new > "$stage_dir/new/Imnota.app/version"
verify_signature() { return 0; }
launch_app() { return 1; }
# No process was launched; Git Bash ps cannot emulate macOS process options.
/bin/ps() { if [[ "$*" != *-axo* ]]; then printf shell; fi; }
set +e
( trap cleanup EXIT; swap_and_launch "$stage_dir/new/Imnota.app" ) >/dev/null 2>&1
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$(cat "$app_path/version")" == old ]]
backup_count=$(find "$root" -maxdepth 1 -name 'Imnota Backup *.app' | wc -l)
[[ "$backup_count" -eq 0 ]]
[[ ! -e "$root/.imnota-backups.noindex" && ! -e "$stage_dir" ]]
rm -rf "$root"
`);
  assert.equal(result.status, 0, result.stderr);
});

test('rolls back on final signature failure without deleting earlier backups', { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
managed="$root/.imnota-backups.noindex/Imnota.app"
mkdir -p "$app_path" "$stage_dir/new/Imnota.app" "$managed"
printf old > "$app_path/version"
printf older > "$managed/version"
printf new > "$stage_dir/new/Imnota.app/version"
verify_signature() { return 1; }
launch_app() { printf unexpected; }
set +e
output=$( ( trap cleanup EXIT; swap_and_launch "$stage_dir/new/Imnota.app" ) 2>&1 )
status=$?
set -e
[[ "$status" -ne 0 && "$output" != *unexpected* ]]
[[ "$(cat "$app_path/version")" == old ]]
[[ "$(cat "$managed/version")" == older ]]
[[ "$(find "$root/.imnota-backups.noindex" -maxdepth 1 -name '.rollback-*.app' | wc -l)" -eq 0 ]]
[[ ! -e "$stage_dir" ]]
rm -rf "$root"
`);
  assert.equal(result.status, 0, result.stderr);
});

test('successful update removes the empty rollback directory', { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
mkdir -p "$app_path" "$stage_dir/new/Imnota.app"
printf old > "$app_path/version"
printf new > "$stage_dir/new/Imnota.app/version"
plist_value() { printf com.dytschgo.imnota; }
verify_signature() { return 0; }
launch_app() { return 0; }
wait_for_replacement() { return 0; }
( trap cleanup EXIT; swap_and_launch "$stage_dir/new/Imnota.app" )
[[ "$(cat "$app_path/version")" == new ]]
[[ ! -e "$root/.imnota-backups.noindex" && ! -e "$stage_dir" ]]
rm -rf "$root"
`);
  assert.equal(result.status, 0, result.stderr);
});

test(
  'removes transaction and managed rollback copies and verified legacy backups after repeated successful updates',
  { skip: !bash },
  () => {
    const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
legacy="$root/Imnota Backup 1.2.1 20260101-010101 42.app"
legacy_dash="$root/Imnota-backup-20260102-020202.app"
untrusted="$root/Imnota Backup 1.2.0 20260101-010102 43.app"
project="$root/User Project.app"
managed="$root/.imnota-backups.noindex/Imnota.app"
unknown="$root/.imnota-backups.noindex/Other.app"
foreign="$root/.imnota-backups.noindex/.rollback-foreign.app"
bad_name="$root/Imnota-backup-user-files.app"
stale="$root/.imnota-backups.noindex/.rollback-123.app"
mkdir -p "$app_path" "$stage_dir/new/Imnota.app" "$legacy/Contents" "$legacy_dash/Contents" "$untrusted/Contents" "$project" "$managed/Contents" "$unknown" "$foreign" "$bad_name" "$stale"
printf old > "$app_path/version"
printf new > "$stage_dir/new/Imnota.app/version"
printf older > "$managed/version"
printf trusted > "$legacy/Contents/marker"
printf trusted > "$legacy_dash/Contents/marker"
printf untrusted > "$untrusted/Contents/marker"
plist_value() {
  if [[ "$1" == *"1.2.1 20260101-010101 42.app"* || "$1" == *"Imnota-backup-20260102-020202.app"* || "$1" == *".imnota-backups.noindex/Imnota.app"* || "$1" == *".rollback-123.app"* || "$1" == *".rollback-$$.app"* || "$1" == *"Imnota-backup-user-files.app"* ]]; then
    printf 'com.dytschgo.imnota\\n'
  else
    printf 'com.example.unrelated\\n'
  fi
}
verify_signature() { return 0; }
launch_app() { return 0; }
wait_for_replacement() { return 0; }
CURRENT_VERSION=1.2.2
swap_and_launch "$stage_dir/new/Imnota.app"
[[ "$(cat "$app_path/version")" == new ]]
[[ ! -e "$managed" && ! -e "$stale" && ! -e "$backup_path" ]]
[[ ! -e "$legacy" ]]
[[ ! -e "$legacy_dash" ]]
[[ -d "$untrusted" && -d "$project" && -d "$unknown" && -d "$foreign" && -d "$bad_name" ]]
for iteration in 1 2; do
  mkdir -p "$stage_dir/new/Imnota.app"
  printf newer > "$stage_dir/new/Imnota.app/version"
  swap_and_launch "$stage_dir/new/Imnota.app"
  [[ ! -e "$backup_path" && ! -e "$managed" ]]
  [[ "$(cat "$app_path/version")" == newer ]]
done
backup_count=$(find "$root" -maxdepth 1 -name 'Imnota Backup *.app' | wc -l)
[[ "$backup_count" -eq 1 ]]
rm -rf "$root"
`);
    assert.equal(result.status, 0, result.stderr);
  },
);

test(
  'removes identified rollback bundles while preserving an unrelated managed item',
  { skip: !bash },
  () => {
    const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
backup_root="$root/backups"
backup_path="$backup_root/.rollback-123.app"
stage_dir="$root/stage"
mkdir -p "$backup_path" "$backup_root/.rollback-456.app" "$stage_dir"
printf unrelated > "$backup_root/Imnota.app"
is_imnota_bundle() { [[ -d "$1" ]]; }
cleanup_rollback_backups
[[ ! -e "$backup_path" ]]
[[ ! -e "$backup_root/.rollback-456.app" ]]
[[ "$(cat "$backup_root/Imnota.app")" == unrelated ]]
rm -rf "$root"
`);
    assert.equal(result.status, 0, result.stderr);
  },
);

test("a failed lock acquisition never removes another updater's lock", { skip: !bash }, () => {
  const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
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
root="$(cd "$root" && pwd -P)"
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

test('verifies each architecture in its own lipo call for current lipo', { skip: !bash }, () => {
  // Current lipo consumes one arch after -verify_arch and reads a second as
  // another input file; the stub reproduces that parsing so the real
  // verify_universal_binary body runs against it.
  const result = runBash(`
stub_dir=$(mktemp -d)
cat > "$stub_dir/lipo" <<'STUB'
#!/bin/bash
verify=0
arch=""
inputs=0
for a in "$@"; do
  if [[ "$a" == -verify_arch ]]; then verify=1; continue; fi
  if (( verify )) && [[ -z "$arch" ]]; then arch="$a"; continue; fi
  inputs=$((inputs + 1))
done
if (( verify )) && [[ "$inputs" -ne 1 ]]; then
  printf 'lipo: -verify_arch requires exactly one input file\\n' >&2
  exit 1
fi
case " $STUB_ARCHS " in
  *" $arch "*) exit 0 ;;
  *) exit 1 ;;
esac
STUB
touch "$stub_dir/Imnota"
declare -f verify_universal_binary | sed "s|/usr/bin/lipo|bash $stub_dir/lipo|g" > "$stub_dir/fn.sh"
source "$stub_dir/fn.sh"
export STUB_ARCHS="x86_64 arm64"
verify_universal_binary "$stub_dir/Imnota"
set +e
export STUB_ARCHS="arm64"
verify_universal_binary "$stub_dir/Imnota"
status=$?
set -e
[[ "$status" -ne 0 ]]
rm -rf "$stub_dir"
`);
  assert.equal(result.status, 0, result.stderr);
});

test(
  'rejects an incompatible downloaded bundle before asking the installed app to quit or replacing it',
  { skip: !bash },
  () => {
    const result = runBash(`
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
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
  'installs and removes the transaction rollback from the real packaged macOS zip',
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
wait_for_replacement() { return 0; }
main "v$version" \
  "https://github.com/Dytschgo/imnota/releases/download/v$version/Imnota-$version-universal-mac.zip" \
  "https://github.com/Dytschgo/imnota/releases/download/v$version/SHA256SUMS.txt" \
  "$root/Imnota.app" \
  "$version"
/usr/bin/codesign --verify --deep --strict --all-architectures "$root/Imnota.app"
[[ ! -e "$root/.imnota-backups.noindex" ]]
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

for (const kind of ['directory', 'symlink']) {
  test(
    `rollback collision with a stale ${kind} never claims or restores it`,
    {
      skip:
        !bash ||
        (kind === 'symlink' &&
          process.platform === 'win32' &&
          'Native symlink collision runs on macOS/Linux'),
    },
    () => {
      const result = runBash(
        `
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
trap 'rm -rf "$root"' EXIT
app_path="$root/Imnota.app"
stage_dir="$root/stage"
backup_root="$root/.imnota-backups.noindex"
mkdir -p "$app_path" "$stage_dir/new.app" "$backup_root" "$root/stale.app"
printf current > "$app_path/marker"
printf stale > "$root/stale.app/marker"
if [[ "$2" == symlink ]]; then
  ln -s "$root/stale.app" "$backup_root/.rollback-$$.app"
else
  cp -R "$root/stale.app" "$backup_root/.rollback-$$.app"
fi
set +e
output=$( ( trap cleanup EXIT; swap_and_launch "$stage_dir/new.app" ) 2>&1 )
status=$?
set -e
[[ "$status" -ne 0 && "$output" == *"backup path collision"* ]]
[[ "$(cat "$app_path/marker")" == current ]]
[[ "$(cat "$backup_root/.rollback-$$.app/marker")" == stale ]]
`,
        [kind],
      );
      assert.equal(result.status, 0, result.stderr);
    },
  );
}

for (const moveStatus of [0, 1]) {
  test(
    `updater interruption after the old-app rename (mv status ${moveStatus}) restores only its claimed rollback`,
    { skip: !bash },
    (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota-updater-interrupt-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const result = runBash(
        `
root="$(cd "$2" && pwd -P)"
app_path="$root/Imnota.app"
stage_dir="$root/stage"
mkdir -p "$app_path" "$stage_dir/new.app"
printf old > "$app_path/marker"
move_status=$3
/bin/mv() {
  command /bin/mv "$@" || return $?
  if [[ "$3" == */.rollback-*.app ]]; then kill -TERM "$$"; return "$move_status"; fi
}
trap cleanup EXIT
swap_and_launch "$stage_dir/new.app"
`,
        [bashPath(root), String(moveStatus)],
      );
      assert.equal(result.status, 130, result.stderr);
      assert.equal(fs.readFileSync(path.join(root, 'Imnota.app', 'marker'), 'utf8'), 'old');
      assert.equal(fs.existsSync(path.join(root, '.imnota-backups.noindex')), false);
      assert.equal(fs.existsSync(path.join(root, 'stage')), false);
    },
  );
}

for (const boundary of ['move-aside', 'restore']) {
  test(
    `updater failed ${boundary} preserves the old app and reports its actual rollback path`,
    { skip: !bash },
    () => {
      const result = runBash(
        `
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
trap 'rm -rf "$root"' EXIT
app_path="$root/Imnota.app"
stage_dir="$root/stage"
mkdir -p "$app_path" "$stage_dir/new.app"
printf old > "$app_path/marker"
printf new > "$stage_dir/new.app/marker"
verify_signature() { return 1; }
/bin/mv() {
  if [[ "$2" == "$app_path" && "$3" == */failed-Imnota.app && "$2" != */.rollback-* && "$2" != */new.app && "$FAIL_BOUNDARY" == move-aside ]]; then return 1; fi
  if [[ "$2" == */.rollback-*.app && "$FAIL_BOUNDARY" == restore ]]; then return 1; fi
  command /bin/mv "$@"
}
FAIL_BOUNDARY=$2
set +e
output=$( ( trap cleanup EXIT; swap_and_launch "$stage_dir/new.app" ) 2>&1 )
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$(cat "$root/.imnota-backups.noindex/.rollback-$$.app/marker")" == old ]]
[[ "$output" == *"previous app is preserved at: $root/.imnota-backups.noindex/.rollback-$$.app"* ]]
[[ "$output" != *"installation was left in place"* ]]
[[ -d "$stage_dir" ]]
`,
        [boundary],
      );
      assert.equal(result.status, 0, result.stderr);
    },
  );
}

test(
  'updater cleanup preserves symlinked candidates, managed roots and unknown rollback names',
  { skip: !bash },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota-updater-cleanup-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const parent = path.join(root, 'apps');
    const backupRoot = path.join(parent, '.imnota-backups.noindex');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(backupRoot, '.rollback-personal.app'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'Imnota.app'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'Imnota.app', 'marker'), 'personal');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    const legacy = path.join(parent, 'Imnota-backup-20260101-010101.app');
    const rollback = path.join(backupRoot, '.rollback-123.app');
    for (const link of [legacy, rollback]) fs.symlinkSync(path.join(outside, 'Imnota.app'), link, linkType);
    const result = runBash(
      `
parent="$(cd "$2/apps" && pwd -P)"
backup_root="$parent/.imnota-backups.noindex"
plist_value() { printf com.dytschgo.imnota; }
cleanup_legacy_backups "$parent"
cleanup_rollback_backups
`,
      [bashPath(root)],
    );
    assert.equal(result.status, 0, result.stderr);
    for (const link of [legacy, rollback]) assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(backupRoot, '.rollback-personal.app')));
    fs.rmSync(backupRoot, { recursive: true });
    fs.symlinkSync(outside, backupRoot, linkType);
    const managed = runBash(
      `
parent="$(cd "$2/apps" && pwd -P)"
backup_root="$parent/.imnota-backups.noindex"
plist_value() { printf com.dytschgo.imnota; }
cleanup_rollback_backups
`,
      [bashPath(root)],
    );
    assert.equal(managed.status, 0, managed.stderr);
    assert.equal(fs.readFileSync(path.join(outside, 'Imnota.app', 'marker'), 'utf8'), 'personal');
  },
);

for (const readiness of ['missing', 'exits', 'wrong-path', 'zombie', 'observed']) {
  test(
    `accepted update open with replacement ${readiness} ${readiness === 'observed' ? 'retires' : 'restores'} rollback`,
    { skip: !bash },
    () => {
      const result = runBash(
        `
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
trap 'rm -rf "$root"' EXIT
app_path="$root/Imnota.app"
stage_dir="$root/.imnota-update.test"
mkdir -p "$app_path/Contents/MacOS" "$stage_dir/new/Imnota.app/Contents/MacOS"
printf old > "$app_path/version"
printf new > "$stage_dir/new/Imnota.app/version"
printf '#!/bin/sh\\nexit 0\\n' > "$stage_dir/new/Imnota.app/Contents/MacOS/Imnota"
chmod +x "$stage_dir/new/Imnota.app/Contents/MacOS/Imnota"
verify_signature() { return 0; }
plist_value() { if [[ "$2" == CFBundleIdentifier ]]; then printf com.dytschgo.imnota; else printf 1.2.3; fi; }
launch_app() { return 0; }
poll=0
# The real wait/predicate sees synthetic process observations and a virtual clock.
/usr/bin/pgrep() {
  [[ "$readiness" != missing ]] || return 1
  if [[ "$readiness" == exits && "$poll" -gt 0 ]]; then return 1; fi
  printf '200\\n'
}
/bin/ps() {
  if [[ "$*" == *"$$"* ]]; then printf shell; return 0; fi
  if [[ "$*" == *-axo* ]]; then return 0; fi
  if [[ "$readiness" == exits && "$poll" -gt 0 ]]; then return 1; fi
  if [[ "$2" == stat= ]]; then
    if [[ "$readiness" == zombie ]]; then printf Z; else printf S; fi
    return 0
  fi
  if [[ "$readiness" == wrong-path ]]; then printf '/other/Imnota.app/Contents/MacOS/Imnota'; else printf '%s' "$app_path/Contents/MacOS/Imnota"; fi
}
/bin/sleep() { SECONDS=$((SECONDS + $1)); poll=$((poll + 1)); }
readiness=$2
set +e
output=$( ( trap cleanup EXIT; swap_and_launch "$stage_dir/new/Imnota.app" ) 2>&1 )
status=$?
set -e
printf '%s\\n' "$output" >&2
if [[ "$readiness" == observed ]]; then
  [[ "$status" -eq 0 && "$(cat "$app_path/version")" == new ]]
  [[ "$output" == *Observed*replacement* ]]
else
  [[ "$status" -ne 0 && "$(cat "$app_path/version")" == old ]]
  [[ "$output" == *replacement* ]]
fi
[[ ! -e "$root/.imnota-backups.noindex" && ! -e "$stage_dir" ]]
`,
        [readiness],
      );
      assert.equal(result.status, 0, result.stderr);
    },
  );
}
