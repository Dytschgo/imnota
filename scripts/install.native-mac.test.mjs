import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const archive = process.env.IMNOTA_NATIVE_MAC_ARCHIVE;
const version = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8')).version;
const installer = path.join(repository, 'scripts/install.sh');
const updater = path.join(repository, 'scripts/update-macos.sh');
const archiveName = `Imnota-${version}-universal-mac.zip`;
const release = `https://github.com/Dytschgo/imnota/releases/download/v${version}`;
const skip =
  process.platform !== 'darwin'
    ? 'Requires native macOS'
    : !archive && 'Set IMNOTA_NATIVE_MAC_ARCHIVE to the built universal ZIP';

// Transport and GUI launch are substituted without production fixture hooks.
// All extraction, plist/signature/architecture checks and filesystem operations
// are native. After the final signature check, fake open replaces the fixture's
// executable with /bin/sleep named Imnota and starts it from the installed path.
// pgrep/ps and the readiness deadline are real; Electron/GUI health is simulated.
const common = String.raw`
start_fixture_process() {
  local bundle=$1 duration=$2
  # Substitute only after the production installed-signature check has passed.
  command /bin/cp /bin/sleep "$bundle/Contents/MacOS/Imnota" || return 1
  "$bundle/Contents/MacOS/Imnota" "$duration" >/dev/null 2>&1 &
  fixture_pid=$!
  printf '%s\n' "$fixture_pid" >> "$FIXTURE_ROOT/processes"
}
open() {
  printf 'open\n' >> "$FIXTURE_ROOT/launches"
  if [[ "$FAULT" == open ]]; then return 1; fi
  if [[ "$FAULT" == hold ]]; then printf 'ready\n'; read -r release; fi
  if [[ "$FAULT" == no-process ]]; then return 0; fi
  if [[ "$FAULT" == exits ]]; then
    start_fixture_process "$1" 0 || return 1
    wait "$fixture_pid"
    return 0
  fi
  start_fixture_process "$1" 120 || return 1
}
/usr/bin/osascript() {
  # Only the fixture PID can be asked to quit; never a personal app.
  [[ "$FAULT" == quit || "$FAULT" == refuses-quit ]] || return 1
  printf 'quit\n' >> "$FIXTURE_ROOT/launches"
  if [[ "$FAULT" == refuses-quit ]]; then return 0; fi
  kill "$fixture_pid" || return 1
  wait "$fixture_pid" 2>/dev/null || true
}
/usr/bin/open() { open "$@"; }
ditto() {
  command /usr/bin/ditto "$@" || return $?
  if [[ "$1" != -x && "$FAULT" == copy ]]; then return 1; fi
}
codesign() {
  # Corrupt only the installed copy, then let real codesign reject it.
  local selected
  for selected in "$@"; do :; done
  if [[ "$FAULT" == verification && "$selected" == "$HOME/Applications/Imnota.app" ]]; then
    printf tampered >> "$HOME/Applications/Imnota.app/Contents/MacOS/Imnota"
  fi
  command /usr/bin/codesign "$@"
}
/usr/bin/codesign() { codesign "$@"; }
/bin/mv() {
  if [[ "$FAULT" == copy && "$2" == */extracted/Imnota.app ]]; then return 1; fi
  if [[ "$FAULT" == restore && "$2" == */.rollback-*.app ]]; then return 1; fi
  if [[ "$FAULT" == move-aside && "$3" == */failed-Imnota.app ]]; then return 1; fi
  command /bin/mv "$@" || return $?
  if [[ "$FAULT" == interrupt* && "$3" == */.rollback-*.app ]]; then
    kill -TERM "$$"
    [[ "$FAULT" != interrupt-failed-move ]] || return 1
  fi
}
`;

const installBody =
  common +
  String.raw`
curl() {
  local output='' url=''
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output) output=$2; shift 2 ;;
      --retry) shift 2 ;;
      --*) shift ;;
      *) url=$1; shift ;;
    esac
  done
  case "$url" in
    "$FIXTURE_RELEASE/Imnota-mac.zip") /bin/cp "$FIXTURE_ARCHIVE" "$output" ;;
    "$FIXTURE_RELEASE/SHA256SUMS.txt") /bin/cp "$FIXTURE_ROOT/SHA256SUMS.txt" "$output" ;;
    *) printf 'Unexpected network request: %s\n' "$url" >&2; return 1 ;;
  esac
}
if [[ "$FAULT" == quit || "$FAULT" == refuses-quit ]]; then
  start_fixture_process "$HOME/Applications/Imnota.app" 120
  deadline=$((SECONDS + 10))
  while [[ "$(command /usr/bin/ps -ww -o comm= -p "$fixture_pid")" != "$HOME/Applications/Imnota.app/Contents/MacOS/Imnota" ]]; do
    (( SECONDS < deadline )) || exit 1
    /bin/sleep 0.1
  done
fi
source "$1"
`;

const updateBody =
  common +
  String.raw`
source "$1"
download_file() {
  case "$1" in
    "$FIXTURE_RELEASE/$FIXTURE_ARCHIVE_NAME") /bin/cp "$FIXTURE_ARCHIVE" "$2" ;;
    "$FIXTURE_RELEASE/SHA256SUMS.txt") /bin/cp "$FIXTURE_ROOT/SHA256SUMS.txt" "$2" ;;
    *) printf 'Unexpected network request: %s\n' "$1" >&2; return 1 ;;
  esac
}
if [[ "$FAULT" == collision || "$FAULT" == collision-symlink ]]; then
  /bin/mkdir -p "$HOME/Applications/.imnota-backups.noindex"
  if [[ "$FAULT" == collision ]]; then
    /bin/mkdir "$HOME/Applications/.imnota-backups.noindex/.rollback-$$.app"
    printf stale > "$HOME/Applications/.imnota-backups.noindex/.rollback-$$.app/marker"
  else
    /bin/ln -s "$FIXTURE_ROOT/outside/Imnota.app" "$HOME/Applications/.imnota-backups.noindex/.rollback-$$.app"
  fi
fi
if [[ "$FAULT" == restore || "$FAULT" == move-aside ]]; then
  launch_app() { return 1; }
fi
if [[ "$FAULT" == quit || "$FAULT" == refuses-quit ]]; then
  start_fixture_process "$HOME/Applications/Imnota.app" 120
  deadline=$((SECONDS + 10))
  while [[ "$(command /usr/bin/ps -ww -o comm= -p "$fixture_pid")" != "$HOME/Applications/Imnota.app/Contents/MacOS/Imnota" ]]; do
    (( SECONDS < deadline )) || exit 1
    /bin/sleep 0.1
  done
fi
main "$FIXTURE_TAG" "$FIXTURE_RELEASE/$FIXTURE_ARCHIVE_NAME" "$FIXTURE_RELEASE/SHA256SUMS.txt" "$HOME/Applications/Imnota.app" "$FIXTURE_VERSION"
`;

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${executable}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

let archiveDigest;

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'imnota-native-install-')));
  t.after(() => {
    stopFixtureProcesses(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const home = path.join(root, 'home');
  const parent = path.join(home, 'Applications');
  const app = path.join(parent, 'Imnota.app');
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'));
  const digest = (archiveDigest ??= createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
  fs.writeFileSync(
    path.join(root, 'SHA256SUMS.txt'),
    `${digest}  Imnota-mac.zip\n${digest}  ${archiveName}\n`,
  );
  return { root, home, parent, app };
}

function seedOld(f) {
  command('/usr/bin/ditto', ['-x', '-k', path.resolve(archive), f.parent]);
  // Mark the previous fixture; only the replacement must pass signature checks.
  fs.writeFileSync(path.join(f.app, 'previous-installation'), 'previous');
  return fs.statSync(f.app).ino;
}

function lookalike(parent, name, id = 'com.dytschgo.imnota') {
  const bundle = path.join(parent, name);
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'Contents/Info.plist'),
    `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`,
  );
  fs.writeFileSync(path.join(bundle, 'personal-file'), 'preserve');
  return bundle;
}

function environment(f, fault) {
  return {
    ...process.env,
    HOME: f.home,
    TMPDIR: path.join(f.root, 'tmp'),
    IMNOTA_RELEASE_TAG: `v${version}`,
    FIXTURE_ROOT: f.root,
    FIXTURE_ARCHIVE: path.resolve(archive),
    FIXTURE_RELEASE: release,
    FIXTURE_ARCHIVE_NAME: archiveName,
    FIXTURE_VERSION: version,
    FIXTURE_TAG: `v${version}`,
    FAULT: fault,
  };
}

function invocation(kind) {
  return [
    '-c',
    kind === 'install' ? installBody : updateBody,
    'native-test',
    kind === 'install' ? installer : updater,
  ];
}

function stopFixtureProcesses(root) {
  const list = path.join(root, 'processes');
  if (!fs.existsSync(list)) return;
  for (const pid of fs.readFileSync(list, 'utf8').trim().split('\n').filter(Boolean)) {
    // Check ownership again; an exited process's PID must not target another app.
    const executable = spawnSync('/usr/bin/ps', ['-ww', '-o', 'comm=', '-p', pid], { encoding: 'utf8' });
    if (executable.status === 0 && executable.stdout.trim().startsWith(root + '/')) {
      const stopped = spawnSync(
        '/bin/bash',
        [
          '-c',
          String.raw`
kill -TERM "$2" 2>/dev/null || true
deadline=$((SECONDS + 5))
while [[ "$(/usr/bin/ps -ww -o comm= -p "$2" 2>/dev/null)" == "$1/"* ]]; do
  (( SECONDS < deadline )) || exit 1
  /bin/sleep 0.1
done
`,
          'fixture-cleanup',
          root,
          pid,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(stopped.status, 0, `Fixture process ${pid} did not exit: ${stopped.stderr}`);
    }
  }
}

function run(f, kind, fault = '') {
  try {
    return spawnSync('/bin/bash', invocation(kind), {
      env: environment(f, fault),
      encoding: 'utf8',
      timeout: 120000,
    });
  } finally {
    stopFixtureProcesses(f.root);
  }
}

function success(result) {
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Observed running Imnota replacement/);
}

function restored(f, inode, result) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(fs.statSync(f.app).ino, inode, result.stderr);
  assert.equal(fs.readFileSync(path.join(f.app, 'previous-installation'), 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(f.parent), ['Imnota.app']);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'tmp')), []);
}

test(
  'native macOS installer and updater transactions against the built archive',
  { skip, timeout: 1200000 },
  async (t) => {
    assert.ok(
      path.isAbsolute(archive) && fs.statSync(archive).isFile(),
      'Archive must be an existing absolute path',
    );
    assert.match(command('/bin/bash', ['--version']), /version 3\.2\./, 'Exercise the system Bash 3.2');
    assert.equal(
      spawnSync('/usr/bin/pgrep', ['-x', 'Imnota']).status,
      1,
      'Close Imnota before native transaction tests; fixtures must never quit a personal app',
    );
    for (const kind of ['install', 'update']) {
      await t.test(
        `${kind}: scratch/repeat installs retire identified backups and preserve look-alikes`,
        (t) => {
          const f = fixture(t);
          if (kind === 'update') seedOld(f);
          else fs.rmdirSync(f.parent);
          success(run(f, kind));
          assert.deepEqual(fs.readdirSync(f.parent), ['Imnota.app']);
          const retired = [
            lookalike(f.parent, 'Imnota-backup-20260101-010101.app'),
            lookalike(f.parent, 'Imnota Backup 0.1.0 20260101-010101 42.app'),
            lookalike(f.parent, '.imnota-backups.noindex/Imnota.app'),
            lookalike(f.parent, '.imnota-backups.noindex/.rollback-123.app'),
          ];
          const preserved = [
            lookalike(f.parent, 'Imnota-backup-20260102-010101.app', 'com.example.personal'),
            lookalike(f.parent, 'Imnota-backup-my-project.app'),
            lookalike(f.parent, '.imnota-backups.noindex/.rollback-personal.app'),
            lookalike(f.parent, 'My Workspace.app'),
          ];
          const outside = lookalike(f.root, 'outside/Imnota.app');
          const link = path.join(f.parent, 'Imnota-backup-20260103-010101.app');
          fs.symlinkSync(outside, link);
          for (let iteration = 0; iteration < 2; iteration++) success(run(f, kind));
          for (const bundle of retired) assert.equal(fs.existsSync(bundle), false, bundle);
          for (const bundle of [...preserved, outside])
            assert.equal(fs.readFileSync(path.join(bundle, 'personal-file'), 'utf8'), 'preserve');
          assert.ok(fs.lstatSync(link).isSymbolicLink());
          assert.equal(
            fs.readdirSync(f.parent).some((name) => /^\.imnota-(install|update)\./.test(name)),
            false,
          );
          assert.equal(fs.existsSync(path.join(f.parent, '.imnota-update.lock')), false);
          assert.deepEqual(fs.readdirSync(path.join(f.parent, '.imnota-backups.noindex')), [
            '.rollback-personal.app',
          ]);
          command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', f.app]);
          assert.deepEqual(fs.readFileSync(path.join(f.root, 'launches'), 'utf8').trim().split('\n'), [
            'open',
            'open',
            'open',
          ]);
        },
      );

      for (const fault of ['copy', 'verification', 'open', 'no-process', 'exits']) {
        await t.test(`${kind}: ${fault} failure restores the previous bundle`, (t) => {
          const f = fixture(t);
          const inode = seedOld(f);
          restored(f, inode, run(f, kind, fault));
        });
      }

      await t.test(`${kind}: a symlinked managed backup root preserves its target`, (t) => {
        const f = fixture(t);
        const inode = seedOld(f);
        const outside = path.join(f.root, 'outside');
        const personal = lookalike(outside, 'Imnota.app');
        const link = path.join(f.parent, '.imnota-backups.noindex');
        fs.symlinkSync(outside, link);
        const result = run(f, kind);
        if (kind === 'install') success(result);
        else {
          assert.notEqual(result.status, 0, result.stdout);
          assert.match(result.stderr, /rollback folder is not a safe directory/);
          assert.equal(fs.statSync(f.app).ino, inode);
        }
        assert.ok(fs.lstatSync(link).isSymbolicLink());
        assert.equal(fs.readFileSync(path.join(personal, 'personal-file'), 'utf8'), 'preserve');
      });

      await t.test(`${kind}: symlinked Applications is refused without touching its target`, (t) => {
        const f = fixture(t);
        const outside = path.join(f.root, 'outside');
        const personal = lookalike(outside, 'Imnota.app');
        const backup = lookalike(outside, 'Imnota-backup-20260101-010101.app');
        fs.rmdirSync(f.parent);
        fs.symlinkSync(outside, f.parent);
        const result = run(f, kind);
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /symlink|canonical/);
        for (const bundle of [personal, backup])
          assert.equal(fs.readFileSync(path.join(bundle, 'personal-file'), 'utf8'), 'preserve');
        assert.deepEqual(fs.readdirSync(outside).sort(), ['Imnota-backup-20260101-010101.app', 'Imnota.app']);
      });
    }

    await t.test('install: unidentified Imnota.app with personal files survives refusal', (t) => {
      const f = fixture(t);
      fs.mkdirSync(f.app);
      fs.writeFileSync(path.join(f.app, 'personal-file'), 'preserve');
      const result = run(f, 'install');
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /not an identified Imnota bundle/);
      assert.deepEqual(fs.readdirSync(f.app), ['personal-file']);
      assert.equal(fs.readFileSync(path.join(f.app, 'personal-file'), 'utf8'), 'preserve');
    });

    for (const fault of ['quit', 'refuses-quit']) {
      await t.test(`install: running fixture ${fault} before replacement`, (t) => {
        const f = fixture(t);
        const inode = seedOld(f);
        const result = run(f, 'install', fault);
        const launches = fs.readFileSync(path.join(f.root, 'launches'), 'utf8');
        assert.match(launches, /^quit/m);
        if (fault === 'refuses-quit') {
          assert.equal(result.status, 1, result.stderr);
          assert.match(result.stderr, /did not quit within 60 seconds.*No installed app was changed/);
          assert.doesNotMatch(launches, /^open/m);
          restored(f, inode, result);
        } else {
          success(result);
          assert.ok(launches.indexOf('quit') < launches.indexOf('open'));
          assert.equal(fs.existsSync(path.join(f.app, 'previous-installation')), false);
          assert.deepEqual(fs.readdirSync(f.parent), ['Imnota.app']);
        }
      });
    }

    for (const fault of ['collision', 'collision-symlink']) {
      await t.test(`update: ${fault} leaves the current app and stale rollback untouched`, (t) => {
        const f = fixture(t);
        const inode = seedOld(f);
        lookalike(f.root, 'outside/Imnota.app');
        const result = run(f, 'update', fault);
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /backup path collision/);
        assert.equal(fs.statSync(f.app).ino, inode);
        const root = path.join(f.parent, '.imnota-backups.noindex');
        const stale = path.join(root, fs.readdirSync(root)[0]);
        if (fault === 'collision') assert.equal(fs.readFileSync(path.join(stale, 'marker'), 'utf8'), 'stale');
        else assert.ok(fs.lstatSync(stale).isSymbolicLink());
      });
    }

    for (const fault of ['interrupt', 'interrupt-failed-move']) {
      await t.test(`update: ${fault} after rename restores the previous bundle`, (t) => {
        const f = fixture(t);
        const inode = seedOld(f);
        const result = run(f, 'update', fault);
        assert.equal(result.status, 130, result.stderr);
        restored(f, inode, result);
      });
    }

    for (const fault of ['restore', 'move-aside']) {
      await t.test(`update: failed ${fault} preserves and reports the actual old-app path`, (t) => {
        const f = fixture(t);
        const inode = seedOld(f);
        const result = run(f, 'update', fault);
        assert.notEqual(result.status, 0, result.stdout);
        const match = result.stderr.match(/previous app is preserved at: (.+)/);
        assert.ok(match, result.stderr);
        assert.equal(fs.statSync(match[1]).ino, inode);
        assert.equal(fs.readFileSync(path.join(match[1], 'previous-installation'), 'utf8'), 'previous');
        assert.doesNotMatch(result.stderr, /installation was left in place/);
      });
    }

    for (const holderKind of ['install', 'update']) {
      await t.test(`${holderKind}: live transaction excludes the other installer`, async (t) => {
        const f = fixture(t);
        seedOld(f);
        const holder = spawn('/bin/bash', invocation(holderKind), {
          env: environment(f, 'hold'),
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 180000,
        });
        const completion = new Promise((resolve) => holder.once('close', resolve));
        t.after(async () => {
          if (!holder.stdin.destroyed) holder.stdin.end('release\n');
          await completion;
          stopFixtureProcesses(f.root);
        });
        let output = '';
        let errors = '';
        holder.stderr.on('data', (data) => {
          errors += data;
        });
        await new Promise((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error(`No launch handoff: ${errors}`)), 120000);
          holder.once('error', reject);
          holder.once('exit', () => {
            clearTimeout(deadline);
            reject(new Error(`Holder exited before handoff: ${errors}`));
          });
          holder.stdout.on('data', (data) => {
            output += data;
            if (output.includes('ready\n')) {
              clearTimeout(deadline);
              resolve();
            }
          });
        });
        const inode = fs.statSync(f.app).ino;
        const recoveryRoot =
          holderKind === 'install'
            ? path.join(
                f.parent,
                fs.readdirSync(f.parent).find((name) => name.startsWith('.imnota-install.')),
              )
            : path.join(f.parent, '.imnota-backups.noindex');
        const recovery = path.join(
          recoveryRoot,
          holderKind === 'install'
            ? 'previous-Imnota.app'
            : fs.readdirSync(recoveryRoot).find((name) => name.startsWith('.rollback-')),
        );
        const recoveryInode = fs.statSync(recovery).ino;
        const contender = run(f, holderKind === 'install' ? 'update' : 'install');
        assert.notEqual(contender.status, 0, contender.stdout);
        assert.match(contender.stderr, /Another (install\/update|update) may be running/);
        assert.equal(fs.statSync(f.app).ino, inode);
        assert.equal(fs.statSync(recovery).ino, recoveryInode);
        assert.ok(fs.existsSync(path.join(f.parent, '.imnota-update.lock', 'pid')));
        holder.stdin.end('release\n');
        assert.equal(await completion, 0, errors);
        stopFixtureProcesses(f.root);
        assert.deepEqual(fs.readdirSync(f.parent), ['Imnota.app']);
      });
    }
  },
);
