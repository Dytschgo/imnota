import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

test(
  'strict observer refuses unsupported, denied and malformed security replies',
  {
    skip: process.platform !== 'darwin' && 'Requires native macOS headers/compiler',
  },
  (t) => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(temporaryRoot, 'imnota-security-replies-'));
    t.after(() => {
      assert.equal(path.dirname(root), temporaryRoot);
      assert.ok(path.basename(root).startsWith('imnota-security-replies-'));
      fs.rmSync(root, { recursive: true });
    });
    const source = fileURLToPath(new URL('../native/macos-security-observer.c', import.meta.url));
    const shim = path.join(root, 'replies.c'),
      helper = path.join(root, 'replies');
    fs.writeFileSync(
      shim,
      `#include <sys/attr.h>
static int test_read(int, struct attrlist *, void *, size_t, unsigned long);
#define fgetattrlist test_read
#define main observer_main
#include ${JSON.stringify(source)}
#undef main
#undef fgetattrlist
static const char *scenario;
static int test_read(int fd, struct attrlist *request, void *buffer, size_t size, unsigned long flags) {
  (void)fd;
  if(request->commonattr != ATTR_CMN_EXTENDED_SECURITY || flags != FSOPT_REPORT_FULLSIZE || size != sizeof(struct security_reply)) { errno=EINVAL; return -1; }
  if(strcmp(scenario,"denied")==0 || strcmp(scenario,"unsupported")==0) { errno=strcmp(scenario,"denied")==0 ? EACCES : EINVAL; return -1; }
  struct security_reply *reply=buffer;
  reply->length=sizeof(*reply); reply->acl.attr_dataoffset=sizeof(attrreference_t); reply->acl.attr_length=0;
  if(strcmp(scenario,"acl")==0) {reply->acl.attr_length=44;reply->length+=44;}
  if(strcmp(scenario,"short")==0) reply->length=4;
  if(strcmp(scenario,"offset")==0) reply->acl.attr_dataoffset=-4;
  if(strcmp(scenario,"truncated")==0) reply->acl.attr_length=44;
  if(strcmp(scenario,"overflow")==0) {reply->acl.attr_length=UINT32_MAX;reply->length=UINT32_MAX;}
  return 0;
}
int main(int argc, char **argv) {if(argc!=4) return 2; scenario=argv[3]; return observer_main(3,argv);}
`,
    );
    const compiled = spawnSync(
      '/usr/bin/xcrun',
      ['clang', '-Wall', '-Wextra', '-Werror', shim, '-o', helper],
      { encoding: 'utf8' },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    for (const scenario of [
      'absent',
      'acl',
      'denied',
      'unsupported',
      'short',
      'offset',
      'truncated',
      'overflow',
    ]) {
      const result = spawnSync(helper, ['acl', root, scenario], { encoding: 'utf8' });
      const accepted = scenario === 'absent' || scenario === 'acl';
      assert.equal(result.status === 0, accepted, result.stderr);
      assert.equal(result.stdout, accepted ? (scenario === 'absent' ? 'no-acl\n' : 'acl\n') : '');
    }
  },
);

test(
  'native ACL observer confirms absence, detects ACLs and refuses denied or invalid paths',
  {
    skip: process.platform !== 'darwin' && 'Requires native macOS security APIs',
  },
  (t) => {
    const temporaryRoot = fs.realpathSync('/tmp');
    const root = fs.mkdtempSync(path.join(temporaryRoot, 'imnota-security-test-'));
    const fixture = path.join(root, 'directory');
    const helper = path.join(root, 'observer');
    const source = fileURLToPath(new URL('../native/macos-security-observer.c', import.meta.url));
    const command = (executable, args) => spawnSync(executable, args, { encoding: 'utf8' });
    const observe = (directory = fixture) => command(helper, ['acl', directory]);
    const check = (result) => assert.equal(result.status, 0, result.stderr);
    const deniedFixture = path.join(root, 'denied');
    let deniedCreated = false;
    t.after(() => {
      // rmdir does not require the child's READ_SECURITY permission. Stat-based
      // recursive removal/chmod cannot safely inspect the denied fixture.
      if (deniedCreated) fs.rmdirSync(deniedFixture);
      assert.equal(path.dirname(root), temporaryRoot);
      assert.ok(path.basename(root).startsWith('imnota-security-test-'));
      fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(fixture);
    check(command('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', source, '-o', helper]));
    console.log(JSON.stringify({ platform: process.platform, release: os.release(), temporaryRoot }));
    check(command('/bin/chmod', ['-N', fixture]));
    const absent = observe();
    check(absent);
    assert.equal(absent.stdout, 'no-acl\n');

    for (const rule of ['everyone allow list', 'everyone allow list,file_inherit,directory_inherit']) {
      check(command('/bin/chmod', ['+a', rule, fixture]));
      const present = observe();
      check(present);
      assert.equal(present.stdout, 'acl\n');
      check(command('/bin/chmod', ['-N', fixture]));
    }
    fs.mkdirSync(deniedFixture);
    deniedCreated = true;
    check(command('/bin/chmod', ['+a', 'everyone deny readsecurity', deniedFixture]));
    const denied = observe(deniedFixture);
    for (const [executable, args] of [
      ['/bin/ls', ['-led', deniedFixture]],
      ['/usr/bin/stat', ['-f', '%u:%OLp', deniedFixture]],
    ]) {
      const diagnostic = command(executable, args);
      console.log(
        JSON.stringify({
          tool: executable,
          status: diagnostic.status,
          stdout: diagnostic.stdout,
          stderr: diagnostic.stderr,
        }),
      );
    }
    // macOS may grant the owner implicit security-read rights despite an ACL deny.
    // A successful owner observation must still report the ACL, never its absence.
    if (denied.status === 0) assert.equal(denied.stdout, 'acl\n');
    else assert.equal(denied.stdout, '');
    // Owner privileges must not stand in for another principal's security-read denial.
    // Only this synthetic fixture/helper become traversable/executable by that account.
    fs.chmodSync(root, 0o755);
    fs.chmodSync(helper, 0o755);
    const foreignDenied = command('/usr/bin/sudo', ['-n', '-u', 'nobody', helper, 'acl', deniedFixture]);
    assert.notEqual(foreignDenied.status, 0);
    assert.equal(foreignDenied.stdout, '');
    assert.match(foreignDenied.stderr, /Could not completely observe the directory ACL/);
    fs.rmdirSync(deniedFixture);
    deniedCreated = false;

    const link = path.join(root, 'link');
    fs.symlinkSync(fixture, link);
    for (const value of [link, path.join(root, 'missing'), 'relative']) {
      const refused = observe(value);
      assert.notEqual(refused.status, 0);
      assert.equal(refused.stdout, '');
    }
  },
);
