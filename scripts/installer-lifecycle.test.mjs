import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const sources = ['install.sh', 'update-macos.sh'].map((name) => {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  // Load the standalone installer's definitions without downloads or installation.
  return [
    name,
    name === 'install.sh' ? source.slice(0, source.indexOf('\nif [ -n "$release_tag" ]; then')) : source,
  ];
});

function run(source, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota-lifecycle-'));
  const script = path.join(root, 'definitions.sh');
  fs.writeFileSync(script, source);
  try {
    return spawnSync(bash, ['-c', `source "$1"\n${body}`, 'test', script.replaceAll('\\', '/')], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, source] of sources) {
  test(`${name}: missing/failing ps is reported before readiness polling`, () => {
    const result = run(
      source,
      `
/usr/bin/pgrep() { printf '200\\n'; }
/bin/ps() { return 127; }
/bin/sleep() { SECONDS=$((SECONDS + $1)); }
wait_for_replacement /missing/Imnota.app
`,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not run \/bin\/ps/);
  });

  test(`${name}: blocked quit request is bounded and leaves the installed app unchanged`, () => {
    // Exercise the actual watchdog, with a virtual deadline and a blocked child.
    const result = run(
      source,
      `
is_app_running() { return 0; }
/usr/bin/osascript() { exec /bin/sleep 120; }
/bin/sleep() { SECONDS=$((SECONDS + $1)); command /bin/sleep 0.01; }
type bounded_quit_request >/dev/null || exit 1
wait_for_app_to_quit
`,
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /quit request.*timed out.*No installed app was changed/);
  });

  for (const mode of [
    'graceful',
    'term',
    'helper',
    'unstoppable',
    'changed-owner',
    'reused-before-term',
    'ps-failure',
    'pid-ps-failure',
  ]) {
    test(`${name}: rollback quiesces only owned replacement processes (${mode})`, () => {
      const result = run(
        source,
        `
root=$(mktemp -d)
root="$(cd "$root" && pwd -P)"
trap 'rm -rf "$root"' EXIT
stage_dir="$root/stage"; staging_directory="$stage_dir"
app_path="$root/Imnota.app"; application_path="$app_path"
mkdir -p "$app_path/Contents/MacOS" "$stage_dir/old.app"
printf old > "$stage_dir/old.app/marker"
printf new > "$app_path/marker"
printf '#!/bin/sh\\nexit 0\\n' > "$app_path/Contents/MacOS/Imnota"
chmod +x "$app_path/Contents/MacOS/Imnota"
backup_path="$stage_dir/old.app"; rollback_path="$backup_path"; rollback_owned=1
replacement_started=1; replacement_launched=1
mode=${mode}; alive=1
executable_path="$app_path/Contents/MacOS/Imnota"
if [[ "$mode" == helper ]]; then
  executable_path="$app_path/Contents/Frameworks/Imnota Helper.app/Contents/MacOS/Imnota Helper"
  mkdir -p "$(dirname "$executable_path")"
  cp "$app_path/Contents/MacOS/Imnota" "$executable_path"
fi
/bin/ps() {
  [[ "$mode" != ps-failure ]] || return 127
  if [[ "$*" == *"$$"* ]]; then printf shell; return 0; fi
  if [[ "$*" == *-axo* ]]; then
    if [[ "$alive" == 1 ]]; then printf '200 %s\\n' "$executable_path"; fi
    printf '201 /other/Imnota.app/Contents/MacOS/Imnota\\n'
  elif [[ "$*" == *'stat='* ]]; then printf S
  elif [[ "$*" == *'200'* && "$alive" == 1 ]]; then
    [[ "$mode" != pid-ps-failure ]] || return 2
    if [[ "$mode" == changed-owner && "$SECONDS" -ge 5 ]] ||
      [[ "$mode" == reused-before-term && -f "$root/last-check" ]]; then
      printf /other/process
    else
      if [[ "$mode" == reused-before-term && "$SECONDS" -ge 5 ]]; then touch "$root/last-check"; fi
      printf '%s' "$executable_path"
    fi
  elif [[ "$*" == *'201'* ]]; then printf /other/Imnota.app/Contents/MacOS/Imnota
  else return 1; fi
}
bounded_quit_request() { printf quit >> "$root/signals"; if [[ "$mode" == graceful ]]; then alive=0; fi; return 0; }
/bin/sleep() { SECONDS=$((SECONDS + $1)); }
kill() {
  [[ "$*" == '-TERM 200' ]] || { printf 'Unowned signal: %s\\n' "$*" >&2; return 1; }
  printf term >> "$root/signals"
  [[ "$mode" == unstoppable ]] || alive=0
}
mv() {
  [[ "$alive" == 0 || "$mode" == unstoppable || "$mode" == ps-failure || "$mode" == changed-owner || "$mode" == reused-before-term || "$mode" == pid-ps-failure ]] || exit 91
  command mv "$@"
}
/bin/mv() { mv "$@"; }
set +e
( trap cleanup EXIT; exit 1 ) > "$root/out" 2>&1
status=$?
set -e
cat "$root/out"
[[ "$status" == 1 && "$(cat "$app_path/marker")" == old ]]
if [[ "$mode" == unstoppable || "$mode" == ps-failure || "$mode" == pid-ps-failure ]]; then
  [[ "$(cat "$stage_dir/failed-Imnota.app/marker")" == new ]]
  grep -q "Failed replacement preserved at: $stage_dir/failed-Imnota.app" "$root/out"
else
  [[ ! -e "$stage_dir" ]]
fi
if [[ "$mode" == graceful || "$mode" == changed-owner || "$mode" == reused-before-term ]]; then [[ "$(cat "$root/signals")" == quit ]]; fi
if [[ "$mode" == term || "$mode" == helper || "$mode" == unstoppable ]]; then [[ "$(cat "$root/signals")" == quitterm ]]; fi
if [[ "$mode" == ps-failure || "$mode" == pid-ps-failure ]]; then
  [[ ! -e "$root/signals" ]]
  grep -q 'Could not run /bin/ps' "$root/out"
fi
! grep -q 'Unowned signal'  "$root/out"
`,
      );
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    });
  }
}

test('native harness checks macOS absolute tool paths', () => {
  const source = fs.readFileSync(path.join(directory, 'install.native-mac.test.mjs'), 'utf8');
  assert.doesNotMatch(source, /\/usr\/bin\/ps/);
  assert.match(source, /fs\.constants\.X_OK/);
});

test('native harness verifies pristine installed signatures before executable substitution', () => {
  const source = fs.readFileSync(path.join(directory, 'install.native-mac.test.mjs'), 'utf8');
  const open = source.slice(source.indexOf('open() {'), source.indexOf('/usr/bin/osascript() {'));
  assert.match(
    open,
    /command \/usr\/bin\/codesign --verify[\s\S]*signature-verified[\s\S]*start_fixture_process/,
  );
  assert.doesNotMatch(source, /'--all-architectures', f\.app/);
});

test('native fixture process cleanup uses validated PIDs without a shell', () => {
  const source = fs.readFileSync(path.join(directory, 'install.native-mac.test.mjs'), 'utf8');
  const cleanup = source.slice(
    source.indexOf('function stopFixtureProcesses('),
    source.indexOf('\nfunction run('),
  );
  assert.doesNotMatch(cleanup, /\/bin\/bash/);
  assert.match(cleanup, /process\.kill/);
  assert.match(cleanup, /\^\[0-9\]\+\$/);
});
