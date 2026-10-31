import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test(
  'native ACL observer confirms absence and refuses failed or incomplete observations',
  {
    skip: process.platform !== 'darwin' && 'Requires native macOS security APIs',
  },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota-security-test-'));
    const fixture = path.join(root, 'directory');
    const helper = path.join(root, 'observer');
    const source = fileURLToPath(new URL('../native/macos-security-observer.c', import.meta.url));
    const command = (executable, args) => spawnSync(executable, args, { encoding: 'utf8' });
    const observe = (directory = fixture) => command(helper, ['acl', directory]);
    const check = (result) => assert.equal(result.status, 0, result.stderr);
    fs.mkdirSync(fixture);
    try {
      check(command('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', source, '-o', helper]));
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
      check(command('/bin/chmod', ['+a', 'everyone deny readsecurity', fixture]));
      const denied = observe();
      assert.notEqual(denied.status, 0, 'Denied security observation must refuse');
      assert.equal(denied.stdout, '');
      check(command('/bin/chmod', ['-N', fixture]));

      const link = path.join(root, 'link');
      fs.symlinkSync(fixture, link);
      for (const value of [link, path.join(root, 'missing'), 'relative']) {
        const refused = observe(value);
        assert.notEqual(refused.status, 0);
        assert.equal(refused.stdout, '');
      }
    } finally {
      command('/bin/chmod', ['-N', fixture]);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
