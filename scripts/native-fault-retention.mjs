import { lstatSync, readdirSync, realpathSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

/** Called after the launcher's child exits. Never removes the original failed operands. */
export function retainFaultOperands(proof, outcome) {
  if (!proof || !outcome) return; // No observed child exit: keep originals and report termination as unknown.
  const temporary = realpathSync.native(tmpdir());
  const entries = [];
  let bytes = 0;
  function canonical(target, directory) {
    const stat = lstatSync(target, { bigint: true });
    if (
      realpathSync.native(target) !== resolve(target) ||
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
    )
      throw new Error('Refusing an indirect retained fault operand.');
    return stat;
  }
  canonical(proof.runRoot, true);
  canonical(proof.artifactRoot, true);
  if (dirname(proof.runRoot) !== temporary || !basename(proof.runRoot).startsWith('imnota-smoke-result-'))
    throw new Error('Retained run is outside its owned temporary namespace.');
  const marker = join(proof.runRoot, '.imnota-native-fault-owned.json');
  canonical(marker, false);
  const marked = JSON.parse(readFileSync(marker, 'utf8'));
  if (
    marked.nonce !== proof.nonce ||
    marked.artifactRoot !== proof.artifactRoot ||
    marked.profileRoot !== join(proof.runRoot, 'profile')
  )
    throw new Error('Retained run binding changed.');
  const within = (parent, target) => {
    const rel = relative(parent, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (within(proof.runRoot, proof.artifactRoot) || within(proof.artifactRoot, proof.runRoot))
    throw new Error('Retained operand roots overlap.');
  function copy(root, destination, category) {
    canonical(root, true);
    mkdirSync(destination);
    function visit(source, target) {
      const stat = lstatSync(source);
      canonical(source, stat.isDirectory());
      if (stat.isDirectory()) {
        if (source !== root) mkdirSync(target);
        for (const name of readdirSync(source).sort()) visit(join(source, name), join(target, name));
      } else {
        bytes += stat.size;
        if (bytes > 1024 * 1024 * 1024 || entries.length >= 20000)
          throw new Error('Retained synthetic evidence exceeds its bound.');
        const content = readFileSync(source);
        writeFileSync(target, content, { flag: 'wx' });
        entries.push({
          category,
          relative: relative(root, source),
          bytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
        });
      }
    }
    visit(root, destination);
  }
  // The early receipt survives later result/capture failures. Only this nonce's fixture is eligible.
  const receipt = join(proof.runRoot, 'fault-session.json');
  let fixture;
  try {
    canonical(receipt, false);
    const session = JSON.parse(readFileSync(receipt, 'utf8'));
    if (
      session.nonce !== proof.nonce ||
      dirname(session.fixture) !== temporary ||
      !/^imnota-smoke-[a-zA-Z0-9_-]+$/.test(basename(session.fixture))
    )
      throw new Error('Unowned retained fixture receipt.');
    const fixtureMarker = join(session.fixture, '.imnota-native-fault-fixture.json');
    canonical(fixtureMarker, false);
    if (JSON.parse(readFileSync(fixtureMarker, 'utf8')).nonce !== proof.nonce)
      throw new Error('Retained fixture nonce changed.');
    if (
      within(session.fixture, proof.artifactRoot) ||
      within(proof.artifactRoot, session.fixture) ||
      within(proof.runRoot, session.fixture) ||
      within(session.fixture, proof.runRoot)
    )
      throw new Error('Retained fixture roots overlap.');
    fixture = session.fixture;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Failure before session startup can legitimately have no fixture; the run/profile still matter.
  }
  copy(proof.runRoot, join(proof.artifactRoot, 'retained-run'), 'run');
  if (fixture) copy(fixture, join(proof.artifactRoot, 'retained-fixture'), 'fixture');
  writeFileSync(
    join(proof.artifactRoot, 'retained-operands.json'),
    JSON.stringify(
      { nonce: proof.nonce, child: outcome, originalRun: proof.runRoot, originalFixture: fixture, entries },
      null,
      2,
    ),
    { flag: 'wx' },
  );
}

function evidenceInventory(root) {
  const entries = [];
  let total = 0;
  function visit(target) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || realpathSync.native(target) !== resolve(target))
      throw new Error('Indirect native fault evidence.');
    if (stat.isDirectory()) {
      for (const name of readdirSync(target).sort()) visit(join(target, name));
      return;
    }
    const name = relative(root, target).replaceAll('\\', '/');
    if (name === 'upload-manifest.json') return;
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Non-regular native fault evidence.');
    total += stat.size;
    if (total > 2 * 1024 * 1024 * 1024 || entries.length >= 250000)
      throw new Error('Native fault upload exceeds its evidence bound.');
    const bytes = readFileSync(target);
    entries.push({
      relative: name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  visit(resolve(root));
  return entries.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
}

export function writeFaultEvidenceManifest(root) {
  const entries = evidenceInventory(root);
  writeFileSync(join(root, 'upload-manifest.json'), JSON.stringify({ schemaVersion: 1, entries }, null, 2), {
    flag: 'wx',
  });
}

/** Read-only validation after artifact download, including hidden journals and ownership markers. */
export function verifyFaultEvidenceManifest(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'upload-manifest.json'), 'utf8'));
  const actual = evidenceInventory(root);
  if (
    manifest.schemaVersion !== 1 ||
    !actual.length ||
    JSON.stringify(manifest.entries) !== JSON.stringify(actual)
  )
    throw new Error('Downloaded native fault evidence differs from its complete upload manifest.');
  console.log(`Verified native fault artifact manifest: ${actual.length} files, including hidden operands.`);
  return actual.length;
}
