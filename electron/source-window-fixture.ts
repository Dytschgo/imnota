import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

let activeTitle: string | null = null;
const enabled = () =>
  process.env.IMNOTA_SMOKE === '1' && process.env.IMNOTA_SMOKE_CAPTURE_SOURCE === 'synthetic';

/** Only the owned native fixture may enter the otherwise empty synthetic window list. */
export function sourceWindowFixtureTitle(): string | null {
  return enabled() ? activeTitle : null;
}

type FixtureLaunch = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** Native OS surface with synthetic text; never opens a user document or changes OS permissions. */
export async function withSourceWindowFixture<T>(
  work: (title: string) => Promise<T>,
  launch: FixtureLaunch = spawn,
): Promise<T> {
  if (!enabled() || !['win32', 'darwin'].includes(process.platform))
    throw new Error('Native source fixture requires isolated Windows/macOS synthetic verification.');
  if (activeTitle) throw new Error('A native source fixture is already active.');
  // The Windows app name is deliberately a title-suffix inference, not a process-name assertion.
  const title = `Imnota source ${randomUUID()} - Notepad`;
  const command =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      : '/usr/bin/osascript';
  const args =
    process.platform === 'win32'
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-Command',
          `
      Add-Type -AssemblyName System.Windows.Forms
          Add-Type 'using System; using System.Runtime.InteropServices; public static class ImnotaSourceFixture { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command); }'
      $form = New-Object System.Windows.Forms.Form
      $form.Text = '${title}'
      $form.Width = 360; $form.Height = 220
      $form.StartPosition = 'CenterScreen'
          $form.Add_Shown({ [ImnotaSourceFixture]::ShowWindow($form.Handle, 1) | Out-Null; $form.Activate() })
      $timer = New-Object System.Windows.Forms.Timer
      $timer.Interval = 120000
      $timer.Add_Tick({ $form.Close() }); $timer.Start()
      [System.Windows.Forms.Application]::Run($form)
      $timer.Dispose(); $form.Dispose()
    `,
        ]
      : [
          '-e',
          `display dialog "Synthetic source fixture" with title "${title}" buttons {"Close"} giving up after 120`,
        ];
  const child = launch(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure: Error | undefined;
  let output = '';
  child.once('error', (error) => {
    failure = error;
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', (bytes: Buffer) => {
    output = (output + bytes.toString('utf8')).slice(-2000);
  });
  activeTitle = title;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (failure) throw failure;
    return await work(title);
  } catch (error) {
    if (failure)
      throw new Error(`Native source fixture could not start: ${failure.message}`, { cause: error });
    if (output) throw new Error(`Native source fixture failed: ${output}`, { cause: error });
    throw error;
  } finally {
    try {
      // Signal only the exact ChildProcess we created. Never close or kill by application/window name.
      if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('Native source fixture closure was not confirmed.')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      activeTitle = null;
    }
  }
}
