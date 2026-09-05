import { spawnSync } from 'node:child_process';
import process from 'node:process';
import electron from 'electron';

const env = { ...process.env, IMNOTA_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const packagedExecutable = process.argv[2];
const result = spawnSync(packagedExecutable ?? electron, packagedExecutable ? [] : ['.'], {
  env,
  stdio: 'inherit',
  timeout: 120000,
});
process.exit(result.status ?? 1);
