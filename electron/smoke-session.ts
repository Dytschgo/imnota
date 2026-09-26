import { app, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSmokeWorkflow, type SmokeWorkflowHost } from './smoke-workflow.js';
import {
  boundedSmokeDiagnostic,
  pathIsWithin,
  validateCreatedSmokeDirectory,
} from './smoke-native-driver.js';

export interface SmokeSessionHost extends Omit<
  SmokeWorkflowHost,
  'approveNextBackupRestore' | 'approveNextProjectDeletion'
> {
  mainWindow(): BrowserWindow | null;
  captureCapability(): Promise<unknown>;
  /** Record a one-use approval; the session has already verified the fixture path. */
  approveBackupRestore(realPath: string): void;
  approveProjectDeletion(realPath: string): void;
}

async function removeSmokeFixture(temporaryRoot: string, fixture: string): Promise<void> {
  const verifiedFixture = await validateCreatedSmokeDirectory(fixture, 'fixture');
  if (!pathIsWithin(temporaryRoot, verifiedFixture))
    throw new Error('Refusing to remove a smoke fixture outside the verified temporary directory.');
  await fs.rm(verifiedFixture, { recursive: true, force: true });
}

/** Run one isolated smoke session in a disposable fixture and return the process exit code. */
export async function runSmokeSession(host: SmokeSessionHost): Promise<number> {
  const temporaryRoot = await fs.realpath(app.getPath('temp'));
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'imnota-smoke-')));
  const fixtureProject = async (projectPath: string, action: string) => {
    const real = await fs.realpath(projectPath);
    if (!pathIsWithin(fixture, real) || real !== path.resolve(projectPath))
      throw new Error(`Smoke ${action} approval must name a real disposable fixture project.`);
    return real;
  };
  let exitCode = 0;
  let result: unknown;
  try {
    const mode = process.env.IMNOTA_SMOKE_MODE === 'stress' ? 'stress' : 'smoke';
    if (process.env.IMNOTA_SMOKE_CAPTURE_CAPABILITY === 'real-memory-only') {
      result = {
        passed: true,
        version: app.getVersion(),
        mode,
        artifacts: [],
        captureCapability: await host.captureCapability(),
        assertions: ['exact desktopCapturer source and in-memory crop dimensions for every real display'],
      };
    } else {
      result = await runSmokeWorkflow(
        {
          diagnosticsHealth: host.diagnosticsHealth,
          setWorkspace: host.setWorkspace,
          reopenWindow: host.reopenWindow,
          captureFromTray: host.captureFromTray,
          trayAvailable: host.trayAvailable,
          globalCaptureShortcutRegistered: host.globalCaptureShortcutRegistered,
          readProject: host.readProject,
          restoreRecovery: host.restoreRecovery,
          readSettings: host.readSettings,
          async approveNextBackupRestore(projectPath) {
            host.approveBackupRestore(await fixtureProject(projectPath, 'restore'));
          },
          async approveNextProjectDeletion(projectPath) {
            host.approveProjectDeletion(await fixtureProject(projectPath, 'deletion'));
          },
        },
        {
          fixtureRoot: fixture,
          artifactDirectory: process.env.IMNOTA_SMOKE_ARTIFACT_DIR,
          version: app.getVersion(),
          expectedVersion: process.env.IMNOTA_EXPECT_VERSION,
          mode,
        },
      );
    }
  } catch (error) {
    exitCode = 1;
    const failureMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const diagnosticsHealth = host.diagnosticsHealth();
    console.error('Local diagnostics health:', diagnosticsHealth);
    let failureArtifactDirectory: string | undefined;
    if (process.env.IMNOTA_SMOKE_ARTIFACT_DIR) {
      try {
        failureArtifactDirectory = await validateCreatedSmokeDirectory(
          process.env.IMNOTA_SMOKE_ARTIFACT_DIR,
          'artifact',
        );
        await fs.writeFile(
          path.join(failureArtifactDirectory, 'verification-failure.json'),
          JSON.stringify(
            { passed: false, version: app.getVersion(), error: failureMessage, diagnosticsHealth },
            null,
            2,
          ),
          { flag: 'wx' },
        );
      } catch (artifactError) {
        console.error('Failure report unavailable:', artifactError);
      }
    }
    let rendererState: unknown;
    const failedWindow = host.mainWindow();
    if (failedWindow && !failedWindow.isDestroyed()) {
      rendererState = await boundedSmokeDiagnostic(() =>
        failedWindow.webContents.executeJavaScript(
          `({ text: document.body.innerText.slice(-12000), active: document.activeElement?.outerHTML.slice(0, 1000), pointerTrace: window.__imnotaPointerTrace, pointerGeometry: window.__imnotaPointerGeometry })`,
        ),
      );
      if (failureArtifactDirectory) {
        try {
          const captured = await boundedSmokeDiagnostic(() => failedWindow.webContents.capturePage());
          if (captured)
            await fs.writeFile(path.join(failureArtifactDirectory, 'failure.png'), captured.toPNG(), {
              flag: 'wx',
            });
        } catch (captureError) {
          console.error('Failure capture unavailable:', captureError);
        }
      }
    }
    result = {
      passed: false,
      version: app.getVersion(),
      error: failureMessage,
      rendererState,
      diagnosticsHealth,
    };
    console.error(error);
    console.error('Renderer state:', rendererState);
  }
  try {
    if (process.env.IMNOTA_SMOKE_RESULT)
      await fs.writeFile(process.env.IMNOTA_SMOKE_RESULT, JSON.stringify(result, null, 2), { flag: 'wx' });
  } finally {
    await removeSmokeFixture(temporaryRoot, fixture);
  }
  return exitCode;
}
