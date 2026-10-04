import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import type { ProjectSearchResponse } from '../src/shared/project-search.js';
import type { ContentSearchResponse } from '../src/shared/content-search.js';
import type { ProjectSnapshot } from '../src/shared/types.js';
import type { RecentlyDeletedItem } from '../src/shared/recently-deleted.js';
import {
  nativeFaultCases,
  FAULT_QUEUED_NAME,
  FAULT_DESCRIPTION,
  FAULT_MARKDOWN,
  type NativeFaultKind,
} from '../src/shared/native-faults.js';
import { COMMITTED_WRITE_WARNING } from '../src/shared/write-outcome.js';
import { contentItemRelativePaths } from './content-paths.js';
import { NativeUiDriver, type SmokeCapture } from './smoke-native-driver.js';
import type { SmokeWorkflowHost } from './smoke-workflow.js';
import { OwnedSmokeFaultController } from './smoke-fault-controller.js';
import { faultDigest, faultIdentity } from './smoke-fault-ownership.js';

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const json = JSON.stringify;
type FileEvidence = {
  relative: string;
  sha256: string;
  bytes: number;
  identity: Awaited<ReturnType<typeof faultIdentity>>;
};

/** Only walks this newly created synthetic project; retains exact operands, not reserialized JSON. */
async function preserve(root: string, destination: string): Promise<FileEvidence[]> {
  await faultIdentity(root, true);
  await fs.mkdir(destination);
  const files: FileEvidence[] = [];
  async function visit(relative: string) {
    const source = path.join(root, relative);
    const stat = await fs.lstat(source);
    if (stat.isDirectory()) {
      await faultIdentity(source, true);
      if (relative) await fs.mkdir(path.join(destination, relative));
      for (const entry of (await fs.readdir(source)).sort()) await visit(path.join(relative, entry));
    } else {
      const identity = await faultIdentity(source);
      const bytes = await fs.readFile(source);
      requireThat(files.length < 200 && bytes.length <= 20_000_000, 'Fixture evidence exceeded its bound.');
      await fs.writeFile(path.join(destination, relative), bytes, { flag: 'wx' });
      files.push({
        relative: relative.replaceAll('\\', '/'),
        identity,
        sha256: faultDigest(bytes),
        bytes: bytes.length,
      });
    }
  }
  await visit('');
  return files;
}

async function fixture(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  controller: OwnedSmokeFaultController,
  name: string,
) {
  await driver.evaluate(`(async () => {
    const settings = await window.imnota.setPreferenceSettings({onboarding:{completed:true},updates:{whatsNewAcknowledgedVersion:${json(controller.proof.version)}}});
    if (!settings.ok) throw new Error(settings.error.message);
    await window.imnota.setSettings({confirmBeforeDeletion:false});
  })()`);
  const png = path.join(controller.fixture, `${name}.png`);
  const pixels = Buffer.alloc(48 * 32 * 4, 204);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
  await fs.writeFile(png, nativeImage.createFromBitmap(pixels, { width: 48, height: 32 }).toPNG(), {
    flag: 'wx',
  });
  const snapshot = await driver.evaluate<ProjectSnapshot>(`(async () => {
    const created = await window.imnota.createProject({name:${json(name)},description:'fixture-own-project'});
    const projectPath = created.projectPath, collectionId = created.project.collections[0].id;
    await window.imnota.importImageFiles({projectPath,collectionId,paths:[${json(png)}]});
    await window.imnota.createContentItem({projectPath,collectionId,kind:'drawing'});
    const mixed = await window.imnota.createContentItem({projectPath,collectionId,kind:'text'});
    const item = mixed.project.contentItems.find(item=>item.kind==='text');
    const content = await window.imnota.loadContentItem({projectPath,itemId:item.id});
    await window.imnota.saveContentItem({projectPath,itemId:item.id,contentRevision:content.contentRevision,markdown:${json('# Fixture owned\n\nfixture-own-text\n')}});
    return window.imnota.loadProject(projectPath);
  })()`);
  const shot = snapshot.project.screenshots[0];
  requireThat(shot, 'Fixture screenshot missing.');
  // Setup uses the actual production screenshot save before arming any fault.
  await driver.evaluate(`(async () => {
    const loaded = await window.imnota.loadScreenshotContent({projectPath:${json(snapshot.projectPath)},screenshot:${json(shot)}});
    await window.imnota.saveScreenshotContent({projectPath:${json(snapshot.projectPath)},
      screenshot:{...${json(shot)},description:'fixture-own-shot'},annotations:loaded.annotations,contentRevision:loaded.contentRevision});
  })()`);
  const metadataPath = path.join(snapshot.projectPath, 'project.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  metadata.contentItems.find((item: { kind: string }) => item.kind === 'drawing').description =
    'fixture-own-draw';
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  driver.setWindow(await host.reopenWindow());
  await driver.click({ selector: '.side-nav-primary .nav-item', text: 'Projects', exact: true });
  await driver.waitFor({ selector: '.library' });
  await driver.click({ selector: '.project-row-main', text: name, exact: false });
  await driver.waitFor({ selector: `[data-testid="screenshot-${shot.id}"]` });
  await driver.resize({ width: 1280, height: 800 });
  return snapshot;
}

async function search(driver: NativeUiDriver, controller: OwnedSmokeFaultController, query: string) {
  return driver.evaluate<{ projects: ProjectSearchResponse; content: ContentSearchResponse }>(`(async () => ({
    projects: await window.imnota.searchProjects({query:${json(query)}}),
    content: await window.imnota.searchContent({workspacePath:${json(controller.fixture)},query:${json(query)}})
  }))()`);
}

function assertSearch(
  result: Awaited<ReturnType<typeof search>>,
  projectPath: string,
  itemId: string,
  present: boolean,
) {
  requireThat(
    result.projects.results.some(
      (value) => value.target.projectPath === projectPath && value.target.itemId === itemId,
    ) === present,
    'Project search returned stale or missing fixture content.',
  );
  requireThat(
    result.content.results.some((value) => value.projectPath === projectPath && value.itemId === itemId) ===
      present,
    'Content search returned stale or missing fixture content.',
  );
}

async function capture(driver: NativeUiDriver, directory: string, name: string) {
  const value = await driver.capture(directory, name);
  return {
    ...value,
    sha256: faultDigest(await fs.readFile(path.join(directory, name))),
    focus:
      await driver.evaluate(`({ tag:document.activeElement?.tagName, text:document.activeElement?.textContent,
      role:document.activeElement?.getAttribute('role'), testId:document.activeElement?.getAttribute('data-testid') })`),
  };
}

async function warningLayouts(driver: NativeUiDriver, directory: string) {
  const captures = [await capture(driver, directory, 'restore-warning-1280x800.png')];
  const geometries = [];
  for (const requested of [
    { width: 1064, height: 655 },
    { width: 1440, height: 920 },
  ]) {
    let limitation: string | undefined;
    try {
      await driver.resize(requested);
    } catch (error) {
      // Only the driver's explicit unchanged-host geometry refusal is optional.
      // Capture, timeout and renderer errors remain failures of the entire case.
      if (!(error instanceof Error) || !error.message.startsWith('OS clamped the requested ')) throw error;
      limitation = error.message;
    }
    const actual = await capture(
      driver,
      directory,
      `restore-warning-requested-${requested.width}x${requested.height}.png`,
    );
    captures.push(actual);
    geometries.push({ requested, actual: actual.cssViewport, verified: !limitation, limitation });
  }
  await driver.resize({ width: 1280, height: 800 });
  return { captures, geometries };
}

async function waitObservation(
  controller: OwnedSmokeFaultController,
  predicate: (value: Awaited<ReturnType<typeof controller.command>>) => boolean,
) {
  const deadline = Date.now() + 15000;
  do {
    const value = await controller.command('observe');
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error('The real renderer did not reach the required fault postcondition in 15 seconds.');
}

async function observedSave(
  controller: OwnedSmokeFaultController,
  expectedSaved: boolean,
  action: () => Promise<unknown>,
) {
  const armed = await controller.command('arm-save');
  await action();
  const deadline = Date.now() + 15000;
  do {
    controller.assertHealthy();
    const receipt = controller.caseEvents.find((event) => {
      const value = event.value as import('../src/shared/native-faults.js').FaultObservation | undefined;
      return (
        event.event === 'renderer' &&
        value?.requestId === armed.requestId &&
        ['save:completed', 'save:refused', 'save:error'].includes(value.event)
      );
    });
    if (receipt) {
      const state = receipt.value as import('../src/shared/native-faults.js').FaultObservation;
      requireThat(
        state.event === (expectedSaved ? 'save:completed' : 'save:refused'),
        'The native save handler did not produce the expected completion/refusal.',
      );
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error('The newly armed native save attempt did not complete within 15 seconds.');
}

function assertForeignBytes(controller: OwnedSmokeFaultController, bytes: Buffer) {
  const recorded = controller.caseEvents.filter((event) => event.event === 'foreign-metadata').at(-1);
  requireThat(
    recorded && recorded.sha256 === faultDigest(bytes) && recorded.bytes === bytes.length,
    'Foreign metadata bytes differ from the exact recorded external write.',
  );
}

async function restoreCase(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  controller: OwnedSmokeFaultController,
  caseId: string,
  directory: string,
) {
  const kind = caseId.split('-')[0] as NativeFaultKind;
  const snapshot = await fixture(driver, host, controller, `Fixture ${controller.proof.caseSet} ${caseId}`);
  const item =
    kind === 'screenshot'
      ? snapshot.project.screenshots[0]
      : snapshot.project.contentItems!.find((item) => item.kind === kind)!;
  const members =
    kind === 'screenshot'
      ? [
          `collections/${item.collectionId}/screenshots/${snapshot.project.screenshots[0].storedFilename}`,
          snapshot.project.screenshots[0].annotationFile,
          snapshot.project.screenshots[0].descriptionFile,
        ]
      : Object.values(
          contentItemRelativePaths(snapshot.project.contentItems!.find((value) => value.id === item.id)!),
        );
  const before = await Promise.all(
    members.map(async (relative) => ({
      relative,
      bytes: await fs.readFile(path.join(snapshot.projectPath, relative)),
    })),
  );
  const query =
    kind === 'screenshot' ? 'fixture-own-shot' : kind === 'drawing' ? 'fixture-own-draw' : 'fixture-own-text';
  const prime = await search(driver, controller, query);
  assertSearch(prime, snapshot.projectPath, item.id, true);
  await driver.click({ selector: `[data-testid="item-delete-${item.id}"]` });
  await driver.waitFor({ selector: `[data-testid="screenshot-${item.id}"]` }, { absent: true });
  await driver.waitFor({ selector: '.toast-action', text: 'Undo', exact: true }, { absent: true });
  const deleted = await driver.evaluate<RecentlyDeletedItem[]>(
    `window.imnota.listRecentlyDeleted(${json(snapshot.projectPath)})`,
  );
  const record = deleted.find((value) => value.itemId === item.id);
  requireThat(record?.kind === kind, 'Real Recently deleted grant missing.');
  const beforeFiles = await preserve(snapshot.projectPath, path.join(directory, 'before'));
  await controller.arm({
    caseId,
    projectPath: snapshot.projectPath,
    projectId: snapshot.project.id,
    kind,
    itemId: item.id,
    token: record.undoToken,
  });
  const initial = await waitObservation(
    controller,
    (value) => Boolean(value.acceptedRevision) && !value.pendingMetadata && value.nativeMutations === 0,
  );
  requireThat(initial.acceptedRevision && !initial.pendingMetadata, 'Restore fixture watch is not ready.');
  await driver.click({ selector: '[data-testid="recently-deleted-open"]' });
  await driver.click({ selector: `[data-testid="recently-deleted-${item.id}"] button` });
  const success = ['restore-eio', 'restore-eacces', 'restore-eperm'].includes(controller.proof.caseSet);
  const selector = '[data-testid="recently-deleted-dialog"]';
  await driver.waitFor({
    selector: `${selector} [role="${success ? 'status' : 'alert'}"]`,
    text: success ? 'Restored' : undefined,
  });
  const renderer = await waitObservation(controller, (state) =>
    success
      ? !state.pendingMetadata && Boolean(state.acceptedRevision)
      : state.pendingMetadata && !state.acceptedRevision,
  );
  const text = await driver.evaluate<string>(`document.querySelector(${json(selector)}).innerText`);
  requireThat(text.includes(COMMITTED_WRITE_WARNING), 'Restore omitted the complete durability warning.');
  if (success) {
    requireThat(
      text.includes(`Restored “${record.title}”.`),
      'Restore status omitted the actual item title.',
    );
    requireThat(renderer.selectedItemId === item.id, 'Restored item was not selected.');
    requireThat(
      await driver.evaluate(
        `document.activeElement === document.querySelector(${json(`${selector} [role="status"]`)})`,
      ),
      'Restore did not focus its real status.',
    );
  } else
    requireThat(
      !(await driver.exists({ selector: `${selector} [role="status"]`, text: 'Restored' })),
      'Unconfirmed Restore announced completion.',
    );
  const journalRoot = path.join(
    snapshot.projectPath,
    kind === 'screenshot' ? '.imnota-undo' : '.imnota-content-undo',
    record.undoToken,
  );
  const manifest = JSON.parse(await fs.readFile(path.join(journalRoot, 'manifest.json'), 'utf8')) as {
    phase: string;
  };
  const restored = await fs.readFile(path.join(journalRoot, 'undo-after.bin'));
  const undoBefore = await fs.readFile(path.join(journalRoot, 'undo-before.bin'));
  const disk = await fs.readFile(path.join(snapshot.projectPath, 'project.json'));
  const afterFiles = await preserve(snapshot.projectPath, path.join(directory, 'after'));
  requireThat(
    faultDigest(undoBefore) === initial.acceptedRevision,
    'Undo-before differs from the accepted deleted revision.',
  );
  for (const original of beforeFiles.filter(
    (file) => file.relative.includes(record.undoToken) && !file.relative.endsWith('/manifest.json'),
  )) {
    const retained = afterFiles.find((file) => file.relative === original.relative);
    requireThat(
      retained?.sha256 === original.sha256 && retained.bytes === original.bytes,
      'Restore altered a protected journal before-image.',
    );
  }
  const failedConfirmation =
    controller.proof.caseSet === 'restore-confirmation' || controller.proof.caseSet === 'restore-marker';
  requireThat(
    manifest.phase === (failedConfirmation ? 'undoing' : 'restored'),
    'Unexpected real Restore journal phase.',
  );
  for (const member of before)
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, member.relative))).equals(member.bytes),
      `Restored member bytes differ: ${member.relative}`,
    );
  const events = controller.caseEvents;
  const results = events.filter(
    (event) =>
      event.event === 'ipc-result' &&
      ['screenshots:undo-delete', 'content:undo-delete'].includes(String(event.channel)),
  );
  const cas = events.filter(
    (event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas',
  );
  if (success) {
    requireThat(
      results.length === 1 && results[0].revision === faultDigest(restored),
      'Main did not return the exact Restore revision once.',
    );
    requireThat(
      cas.length === 1 &&
        (cas[0].input as { expectedRevision?: string }).expectedRevision === faultDigest(restored),
      'Queued metadata did not CAS once against Restore.',
    );
    requireThat(
      JSON.parse(disk.toString()).name === FAULT_QUEUED_NAME &&
        renderer.acceptedRevision === faultDigest(disk),
      'Queued metadata was not saved and adopted.',
    );
    requireThat(
      events.some(
        (event) =>
          event.event === 'renderer' &&
          (event.value as { acceptedRevision?: string }).acceptedRevision === faultDigest(restored),
      ),
      'No real renderer observation of Restore adoption before CAS.',
    );
  } else {
    requireThat(cas.length === 0, 'Unconfirmed Restore permitted a metadata CAS.');
    const foreign = controller.proof.caseSet === 'restore-later-change' || caseId.endsWith('changed');
    requireThat(
      foreign ? (assertForeignBytes(controller, disk), true) : disk.equals(restored),
      'Refused Restore changed the required disk bytes.',
    );
  }
  const layouts = await warningLayouts(driver, directory);
  const ownSearch = await search(driver, controller, query);
  assertSearch(ownSearch, snapshot.projectPath, item.id, true);
  const consumed = [
    'metadata',
    ...(controller.proof.caseSet === 'restore-confirmation' ? ['confirmation'] : []),
    ...(controller.proof.caseSet === 'restore-marker' ? ['marker'] : []),
    ...(controller.proof.caseSet === 'restore-later-change' ? ['response'] : []),
    ...(controller.proof.caseSet === 'restore-renderer-readback' ? ['readback'] : []),
  ];
  if (!success) {
    // Exercise the actual save shortcut against the refusal, never a synthetic flush result.
    await driver.press('Escape');
    await observedSave(controller, false, () =>
      driver.press('S', [process.platform === 'darwin' ? 'meta' : 'control']),
    );
    const retained = await controller.command('observe');
    {
      requireThat(
        retained.pendingMetadata && !retained.acceptedRevision,
        'Retry save lost the Restore refusal or pending edit.',
      );
      requireThat(
        (await fs.readFile(path.join(snapshot.projectPath, 'project.json'))).equals(disk),
        'Retry save changed refused Restore bytes.',
      );
      if (controller.proof.caseSet === 'restore-later-change' || caseId.endsWith('changed'))
        assertForeignBytes(controller, await fs.readFile(path.join(snapshot.projectPath, 'project.json')));
      requireThat(
        !controller.caseEvents.some(
          (event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas',
        ),
        'Refused Restore retry attempted metadata CAS.',
      );
    }
  }
  let externalEvidence;
  // No reopening a foreign/unconfirmed project to manufacture successful recovery.
  if (success || controller.proof.caseSet === 'restore-marker') {
    driver.setWindow(await host.reopenWindow());
    await driver.waitFor({ selector: `[data-testid="screenshot-${item.id}"]` });
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, 'project.json'))).equals(disk),
      'Explicit reopening changed committed metadata.',
    );
    const remains = await fs.stat(journalRoot).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    requireThat(!remains, 'Explicit recovery did not clean the completed Restore journal.');
    for (const member of before)
      requireThat(
        (await fs.readFile(path.join(snapshot.projectPath, member.relative))).equals(member.bytes),
        'Recovery replayed or changed restored content.',
      );
  }
  if (success) {
    requireThat(
      !controller.caseEvents.some(
        (event) => event.event === 'watch' && (event.value as { kind: string }).kind === 'external-change',
      ),
      'An own Restore or queued CAS emitted a false external change.',
    );
    const externalItem =
      kind === 'screenshot'
        ? snapshot.project.screenshots[0]
        : snapshot.project.contentItems!.find((value) => value.kind === 'text')!;
    const relative =
      kind === 'screenshot'
        ? snapshot.project.screenshots[0].descriptionFile
        : contentItemRelativePaths(snapshot.project.contentItems!.find((value) => value.kind === 'text')!)
            .markdown!;
    const externalPath = path.join(snapshot.projectPath, relative);
    const prior = await fs.readFile(externalPath);
    const priorStat = await fs.stat(externalPath);
    const next = Buffer.from(prior.toString().replace('fixture-own-', 'fixture-ext-'));
    requireThat(
      next.length === prior.length && !next.equals(prior),
      'External fixture edit must be distinct and same-size.',
    );
    const start = controller.caseEvents.length;
    await fs.writeFile(externalPath, next);
    await fs.utimes(externalPath, priorStat.atime, priorStat.mtime);
    const barrier = await waitObservation(controller, (value) => Boolean(value.externalChange));
    requireThat(
      controller.caseEvents
        .slice(start)
        .some(
          (event) => event.event === 'watch' && (event.value as { kind: string }).kind === 'external-change',
        ),
      'No genuine fs.watch external-change observation.',
    );
    const oldQuery = kind === 'screenshot' ? 'fixture-own-shot' : 'fixture-own-text';
    const newQuery = oldQuery.replace('own', 'ext');
    const updatedSearch = await search(driver, controller, newQuery);
    const invalidatedSearch = await search(driver, controller, oldQuery);
    assertSearch(updatedSearch, snapshot.projectPath, externalItem.id, true);
    assertSearch(invalidatedSearch, snapshot.projectPath, externalItem.id, false);
    await controller.command('queue-fixture-metadata');
    await observedSave(controller, false, () =>
      driver.press('S', [process.platform === 'darwin' ? 'meta' : 'control']),
    );
    const retained = await waitObservation(
      controller,
      (value) => value.pendingMetadata && Boolean(value.externalChange),
    );
    requireThat(
      !controller.caseEvents
        .slice(start)
        .some((event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas'),
      'External member change did not block metadata saving.',
    );
    externalEvidence = {
      relative,
      beforeSha256: faultDigest(prior),
      afterSha256: faultDigest(next),
      bytes: next.length,
      priorMtime: priorStat.mtime.toISOString(),
      actualMtime: (await fs.stat(externalPath)).mtime.toISOString(),
      barrier,
      retained,
      updatedSearch,
      invalidatedSearch,
    };
  }
  await controller.disarm(consumed);
  return {
    beforeFiles,
    afterFiles,
    externalEvidence,
    revisions: {
      deleted: faultDigest(undoBefore),
      restored: faultDigest(restored),
      live: faultDigest(disk),
      adopted: renderer.acceptedRevision,
    },
    journal: { token: record.undoToken, phase: manifest.phase },
    renderer,
    prime,
    ownSearch,
    captures: layouts.captures,
    geometries: layouts.geometries,
    consumed,
  };
}

async function recoveryCase(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  controller: OwnedSmokeFaultController,
  caseId: string,
  directory: string,
) {
  const snapshot = await fixture(driver, host, controller, `Fixture ${controller.proof.caseSet} ${caseId}`);
  const shot = snapshot.project.screenshots[0];
  const text = snapshot.project.contentItems!.find((item) => item.kind === 'text')!;
  await driver.click({ selector: `[data-testid="screenshot-${shot.id}"]` });
  await driver.waitFor({ selector: 'textarea[aria-label="Description"]' });
  await driver.waitFor({ selector: '.konvajs-content' });
  await driver.click({ selector: `[data-testid="screenshot-${text.id}"]` });
  await driver.waitFor({ selector: '[data-testid="markdown-input"]' });
  const beforeFiles = await preserve(snapshot.projectPath, path.join(directory, 'before'));
  const textFile = Object.values(contentItemRelativePaths(text))[0];
  await controller.arm({
    caseId,
    projectPath: snapshot.projectPath,
    projectId: snapshot.project.id,
    repairTarget: textFile,
    repairBefore: faultDigest(await fs.readFile(path.join(snapshot.projectPath, textFile))),
  });
  const before = await waitObservation(
    controller,
    (value) => Boolean(value.acceptedRevision) && !value.pendingMetadata,
  );
  const staged = await controller.command('stage-recovery-drafts');
  requireThat(
    staged.pendingContent && staged.pendingScreenshot && staged.pendingMetadata,
    'Independent real drafts were not all queued.',
  );
  await driver.waitFor({ selector: '[data-testid="error-fallback-app"]' });
  requireThat(
    await driver.evaluate(`document.activeElement?.textContent === 'Reload'`),
    'Root fallback did not focus Reload.',
  );
  await controller.command('clear-render-failure');
  await observedSave(controller, false, () =>
    driver.click({ selector: '[data-testid="error-fallback-app"] button', text: 'Reload', exact: true }),
  );
  await driver.waitFor({
    selector: '[data-testid="error-fallback-app"] button',
    text: 'Save and reload',
    exact: true,
  });
  const first = await controller.command('observe');
  const firstFiles = await preserve(snapshot.projectPath, path.join(directory, 'first-save'));
  const firstCapture = await capture(driver, directory, 'recovery-refused-1280x800.png');
  requireThat(first.pendingMetadata, 'Failed recovery discarded queued metadata.');
  const lineage = controller.proof.caseSet.startsWith('recovery-lineage-');
  if (lineage) {
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, textFile), 'utf8')) === FAULT_MARKDOWN,
      'Independent Markdown draft did not commit exactly.',
    );
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, shot.descriptionFile), 'utf8')) ===
        FAULT_DESCRIPTION,
      'Independent screenshot draft did not commit exactly.',
    );
    const transitions = controller.caseEvents
      .filter((event) => event.event === 'ipc-result' && event.transition)
      .map((event) => event.transition as { before: string; after: string });
    requireThat(
      transitions.length === 2 &&
        transitions[0].before === before.acceptedRevision &&
        transitions[1].before === transitions[0].after,
      'Real independent commits did not form one revision chain.',
    );
    requireThat(
      !controller.caseEvents.some(
        (event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas',
      ),
      'First failed recovery attempted metadata CAS.',
    );
    requireThat(
      first.warning.includes(COMMITTED_WRITE_WARNING) && first.externalChange,
      'Recovery did not retain its real durability warning and watch outage.',
    );
    if (caseId === 'foreign') await controller.writeForeignMetadata();
  }
  if (!lineage) {
    const journals = firstFiles.filter(
      (file) => file.relative.startsWith('.imnota-transactions/') && file.relative.endsWith('/manifest.json'),
    );
    requireThat(journals.length > 0, 'Failed precommit save did not retain a recovery transaction.');
    for (const file of journals) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, 'first-save', file.relative), 'utf8'),
      ) as {
        phase: string;
        entries: Array<{
          before: { present: boolean; blob: string; size: number; sha256: string };
          after: { present: boolean; blob: string; size: number; sha256: string };
        }>;
      };
      requireThat(
        ['staged', 'applying'].includes(manifest.phase),
        'Failed precommit journal is not recoverable.',
      );
      for (const entry of manifest.entries)
        for (const image of [entry.before, entry.after]) {
          if (!image.present) continue;
          requireThat(path.basename(image.blob) === image.blob, 'Recovery blob escaped its journal.');
          const stored = firstFiles.find(
            (value) => value.relative === `${path.posix.dirname(file.relative)}/${image.blob}`,
          );
          requireThat(
            stored?.sha256 === image.sha256 && stored.bytes === image.size,
            'Recovery before/after image is missing or corrupt.',
          );
        }
    }
    const beforeText = beforeFiles.find((file) => file.relative === textFile)!;
    const firstText = firstFiles.find((file) => file.relative === textFile)!;
    requireThat(
      caseId === 'baseline-repair'
        ? firstText.sha256 === beforeText.sha256
        : [beforeText.sha256, faultDigest(FAULT_MARKDOWN)].includes(firstText.sha256),
      'Failed repair left unknown member bytes.',
    );
    requireThat(first.pendingContent, 'Precommit failure discarded the real content draft.');
  }
  const foreign = lineage && caseId === 'foreign';
  // One deliberate user retry, never an automatic test rerun.
  await observedSave(controller, !foreign, () =>
    driver.click({
      selector: '[data-testid="error-fallback-app"] button',
      text: 'Save and reload',
      exact: true,
    }),
  );
  if (foreign) {
    await driver.waitFor({
      selector: '[data-testid="error-fallback-app"] button',
      text: 'Save and reload',
      exact: true,
    });
    const refused = await controller.command('observe');
    requireThat(refused.pendingMetadata, 'Foreign recovery lost the queued draft.');
    assertForeignBytes(controller, await fs.readFile(path.join(snapshot.projectPath, 'project.json')));
    requireThat(
      !controller.caseEvents.some(
        (event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas',
      ),
      'Foreign recovery permitted CAS.',
    );
  } else {
    await driver.waitFor({ selector: '[data-testid="error-fallback-app"]' }, { absent: true });
    await driver.waitFor({ selector: `[data-testid="screenshot-${text.id}"]` });
    const project = JSON.parse(await fs.readFile(path.join(snapshot.projectPath, 'project.json'), 'utf8'));
    requireThat(project.name === FAULT_QUEUED_NAME, 'Recovery did not save queued metadata.');
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, textFile), 'utf8')) === FAULT_MARKDOWN,
      'Retry did not preserve Markdown bytes.',
    );
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, shot.descriptionFile), 'utf8')) ===
        FAULT_DESCRIPTION,
      'Retry did not preserve screenshot bytes.',
    );
  }
  if (!foreign) {
    const beforeOpen = await fs.readFile(path.join(snapshot.projectPath, 'project.json'));
    const reopened = await host.restoreRecovery(snapshot.projectPath);
    requireThat(
      reopened.project.id === snapshot.project.id &&
        (await fs.readFile(path.join(snapshot.projectPath, 'project.json'))).equals(beforeOpen),
      'Production open/recovery changed the saved fixture metadata.',
    );
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, textFile), 'utf8')) === FAULT_MARKDOWN &&
        (await fs.readFile(path.join(snapshot.projectPath, shot.descriptionFile), 'utf8')) ===
          FAULT_DESCRIPTION,
      'Production open/recovery changed saved independent draft bytes.',
    );
  }
  const consumed = lineage
    ? [
        'react-app',
        'commit-content:save',
        'commit-projects:save-screenshot',
        'outage',
        ...(foreign ? [] : ['commit-workflow:project-watch:cas']),
      ]
    : ['react-app', 'candidate', ...(caseId === 'failed-repair' ? ['repair'] : [])];
  const afterFiles = await preserve(snapshot.projectPath, path.join(directory, 'after'));
  const actual = JSON.parse(
    await fs.readFile(path.join(snapshot.projectPath, 'project.json'), 'utf8'),
  ) as ProjectSnapshot['project'];
  requireThat(
    actual.screenshots.length === snapshot.project.screenshots.length &&
      actual.contentItems?.length === snapshot.project.contentItems?.length,
    'Recovery created duplicate/conflict members.',
  );
  if (lineage) {
    const writes = controller.caseEvents.filter((event) => event.event === 'ipc-result');
    requireThat(
      writes.filter((event) => event.channel === 'content:save').length === 1 &&
        writes.filter((event) => event.channel === 'projects:save-screenshot').length === 1,
      'Recovery replayed an independently committed draft.',
    );
    const cas = controller.caseEvents.filter(
      (event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas',
    );
    if (!foreign) {
      const transition = writes.find((event) => event.channel === 'projects:save-screenshot')!.transition as {
        after: string;
      };
      requireThat(
        cas.length === 1 &&
          (cas[0].input as { expectedRevision: string }).expectedRevision === transition.after,
        'Healthy recovery metadata did not CAS against the exact last own draft revision.',
      );
      await waitObservation(controller, (state) => Boolean(state.acceptedRevision) && !state.pendingMetadata);
      await observedSave(controller, true, () =>
        driver.press('S', [process.platform === 'darwin' ? 'meta' : 'control']),
      );
      requireThat(
        controller.caseEvents.filter(
          (event) => event.event === 'ipc-invocation' && event.channel === 'workflow:project-watch:cas',
        ).length === 1,
        'A clean guard save repeated the metadata CAS.',
      );
    }
  }
  await controller.disarm(consumed);
  return { beforeFiles, firstFiles, afterFiles, before, staged, first, captures: [firstCapture], consumed };
}

async function uiCase(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  controller: OwnedSmokeFaultController,
  caseId: string,
  directory: string,
) {
  const snapshot = await fixture(driver, host, controller, `Fixture ${caseId}`);
  const shot = snapshot.project.screenshots[0];
  const drawing = snapshot.project.contentItems!.find((item) => item.kind === 'drawing')!;
  await controller.arm({ caseId, projectPath: snapshot.projectPath, projectId: snapshot.project.id });
  const captures = [];
  if (caseId === 'panel-retry-reset') {
    await driver.click({ selector: `[data-testid="screenshot-${drawing.id}"]` });
    await driver.waitFor({ selector: '[data-testid="drawing-editor"]' });
    await controller.command('render-panel-failure');
    await driver.waitFor({ selector: '[data-testid="error-fallback-panel"]' });
    requireThat(
      await driver.evaluate(`document.activeElement?.textContent === 'Try again'`),
      'Panel primary action is not focused.',
    );
    captures.push(await capture(driver, directory, 'panel-fallback.png'));
    await controller.command('clear-render-failure');
    await driver.click({
      selector: '[data-testid="error-fallback-panel"] button',
      text: 'Try again',
      exact: true,
    });
    await driver.waitFor({ selector: '[data-testid="drawing-editor"]' });
    await controller.command('render-panel-failure');
    await driver.waitFor({ selector: '[data-testid="error-fallback-panel"]' });
    await controller.command('clear-render-failure');
    await driver.click({ selector: `[data-testid="screenshot-${shot.id}"]` });
    await driver.waitFor({ selector: '[data-testid="error-fallback-panel"]' }, { absent: true });
    await driver.waitFor({ selector: '.konvajs-content' });
  } else {
    const original = await fs.readFile(path.join(snapshot.projectPath, shot.descriptionFile));
    await driver.click({ selector: `[data-testid="item-delete-${shot.id}"]` });
    await driver.waitFor({ selector: '.toast-action', text: 'Undo', exact: true });
    const bounds = await driver.waitFor({ selector: '.toast-action', text: 'Undo', exact: true });
    await driver.evaluate(
      `window.__imnotaFaultToast = { element:document.querySelector('.toast-action'), start:performance.now(), generation:document.querySelector('.toast')?.dataset.faultGeneration, duration:Number(document.querySelector('.toast')?.dataset.faultDuration) }`,
    );
    if (caseId === 'undo-hover')
      driver.browserWindow.webContents.sendInputEvent({
        type: 'mouseMove',
        ...{ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) },
      });
    else {
      // Actual keyboard traversal; never element.focus() or a scripted click.
      let focused = false;
      for (let i = 0; i < 40; i++) {
        if (await driver.evaluate(`document.activeElement === document.querySelector('.toast-action')`)) {
          focused = true;
          break;
        }
        await driver.press('Tab');
      }
      requireThat(focused, 'Undo was not reachable through native keyboard traversal.');
      driver.browserWindow.webContents.sendInputEvent({ type: 'mouseMove', ...{ x: 10, y: 10 } });
    }
    await controller.command('queue-fixture-metadata');
    await driver.evaluate(`new Promise((resolve,reject) => {
      const deadline=performance.now()+15000;
      const check=()=>{ const observed=window.__imnotaFaultToast;
        if (document.querySelector('.toast-action')!==observed.element) return reject(new Error('Undo generation changed or expired'));
        if(observed.duration!==4000 || document.querySelector('.toast')?.dataset.faultGeneration!==observed.generation) return reject(new Error('Unexpected Undo lifetime or generation'));
        if(performance.now()>=observed.start+observed.duration) return resolve(true);
        if(performance.now()>deadline) return reject(new Error('Undo timer observation exceeded deadline'));
        requestAnimationFrame(check); }; check(); })`);
    controller.releaseUiBarrier();
    await waitObservation(controller, (state) => !state.pendingMetadata);
    captures.push(await capture(driver, directory, `${caseId}-past-original-deadline.png`));
    await driver.click({ selector: '.toast-action', text: 'Undo', exact: true });
    await driver.waitFor({ selector: `[data-testid="screenshot-${shot.id}"]` });
    requireThat(
      (await fs.readFile(path.join(snapshot.projectPath, shot.descriptionFile))).equals(original),
      'Held Undo restored different bytes.',
    );
    await driver.click({ selector: `[data-testid="item-delete-${shot.id}"]` });
    await driver.waitFor({ selector: '.toast-action', text: 'Undo', exact: true });
    driver.browserWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 });
    await driver.press('Tab');
    requireThat(
      !(await driver.evaluate(`document.querySelector('.toast-action')===document.activeElement`)),
      'Expiry control still holds keyboard focus.',
    );
    await driver.waitFor({ selector: '.toast-action', text: 'Undo', exact: true }, { absent: true });
    requireThat(
      !(await driver.exists({ selector: `[data-testid="screenshot-${shot.id}"]` })),
      'Released Undo unexpectedly activated.',
    );
  }
  const afterFiles = await preserve(snapshot.projectPath, path.join(directory, 'after'));
  const consumed = caseId === 'panel-retry-reset' ? ['react-panel-1', 'react-panel-2'] : ['ui-save-barrier'];
  await controller.disarm(consumed);
  return { afterFiles, captures, consumed };
}

export async function exerciseNativeFaultCases(
  driver: NativeUiDriver,
  host: SmokeWorkflowHost,
  controller: OwnedSmokeFaultController,
) {
  const cases = [];
  const artifacts: SmokeCapture[] = [];
  for (const caseId of nativeFaultCases(controller.proof.caseSet)) {
    const directory = path.join(controller.proof.artifactRoot, caseId);
    await fs.mkdir(directory);
    const start = controller.events.length;
    console.log(`Native fault case starting: ${controller.proof.caseSet}/${caseId}`);
    try {
      const evidence = controller.proof.caseSet.startsWith('restore-')
        ? await restoreCase(driver, host, controller, caseId, directory)
        : controller.proof.caseSet === 'recovery-ui'
          ? await uiCase(driver, host, controller, caseId, directory)
          : await recoveryCase(driver, host, controller, caseId, directory);
      controller.assertHealthy();
      const result = {
        schemaVersion: 1,
        passed: true,
        caseId,
        caseSet: controller.proof.caseSet,
        ownership: controller.proof,
        pid: process.pid,
        argv: process.argv,
        cwd: process.cwd(),
        platform: process.platform,
        architecture: process.arch,
        versions: process.versions,
        evidence,
        events: controller.events.slice(start),
        disarmed: true,
      };
      await fs.writeFile(path.join(directory, 'case.json'), json(result, null, 2), { flag: 'wx' });
      cases.push({ caseId, passed: true, disarmed: true, sha256: faultDigest(json(result, null, 2)) });
      artifacts.push(...evidence.captures);
      console.log(`Native fault case passed: ${controller.proof.caseSet}/${caseId}`);
    } catch (error) {
      controller.cancel();
      try {
        await fs.writeFile(
          path.join(directory, 'failure.json'),
          json(
            {
              caseId,
              passed: false,
              error: error instanceof Error ? error.stack : String(error),
              events: controller.events.slice(start),
              retainedFixture: controller.fixture,
              profile: controller.proof.profileRoot,
              disarmed: true,
            },
            null,
            2,
          ),
          { flag: 'wx' },
        );
      } catch (captureError) {
        throw new AggregateError(
          [error, captureError],
          'Native fault and evidence recording both failed; original operands retained.',
        );
      }
      throw error;
    }
  }
  return {
    cases,
    artifacts,
    caseSet: controller.proof.caseSet,
    nonce: controller.proof.nonce,
    disarmed: true,
  };
}
