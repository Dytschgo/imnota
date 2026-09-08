import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.resolve(
  process.env.IMNOTA_SHARE_DATA_DIR ?? path.join(os.homedir(), '.imnota-shares'),
);
const hashPath = path.resolve(dataDir, 'owner-access-key.sha256');
if (path.dirname(hashPath) !== dataDir)
  throw new Error('The owner access-key hash file must remain inside the private data directory.');

await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
const accessKey = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(accessKey, 'utf8').digest('hex');
try {
  await fs.writeFile(hashPath, `${hash}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
} catch (error) {
  if (error?.code === 'EEXIST')
    throw new Error(`Owner access is already provisioned at ${hashPath}. Refusing to replace it.`);
  throw error;
}

console.log('Owner access key (shown once; save it in the owner password manager):');
console.log(accessKey);
console.log(`SHA-256 hash written to ${hashPath}`);
