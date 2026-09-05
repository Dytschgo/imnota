import { execFileSync } from 'node:child_process';

// Report filenames only, never matching credentials. This is a release guard, not a substitute for review.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const credential =
  /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const forbidden =
  /(?:^|\/)(?:\.env(?:\..*)?|workspace|Imnota Workspace|node_modules|release|dist|screenshots|annotations|notes)(?:\/|$)|\.(?:p12|pfx|mobileprovision|log)$/i;
const failures = [];
for (const file of files) {
  if (forbidden.test(file)) failures.push(file);
  const content = execFileSync('git', ['show', `:${file}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (credential.test(content)) failures.push(file);
}
if (failures.length) {
  console.error('Release scan failed. Review these staged files:', [...new Set(failures)].join(', '));
  process.exit(1);
}
console.log(
  `Release scan passed: ${files.length} staged/tracked files; no known credential patterns or forbidden data paths.`,
);
