import { createReadStream } from 'node:fs';
import type { LocalMcpServer } from './mcp-server.js';

/** Electron's Windows process.stdin is EOF-only; consume the inherited fd without replacing it. */
export async function runMcpStdio(
  server: Pick<LocalMcpServer, 'startStdio'>,
  enabled: boolean,
  platform: NodeJS.Platform = process.platform,
  fd = 0,
  output: NodeJS.WritableStream = process.stdout,
): Promise<boolean> {
  if (platform !== 'win32' || !enabled) return server.startStdio();
  // This CLI owns fd 0. EOF closes it; failure destroys the stream before main exits fail-closed.
  const input = createReadStream('', { fd, autoClose: true });
  let failOutput!: (error: Error) => void;
  const outputFailed = new Promise<never>((_resolve, reject) => {
    failOutput = reject;
  });
  output.on('error', failOutput);
  try {
    return await Promise.race([
      outputFailed,
      server.startStdio(input, output).then(async (started) => {
        // Drain accepted replies before main's app.exit; a broken pipe must reject, not open a dialog.
        await new Promise<void>((resolveWrite, reject) =>
          output.write('', (error) => (error ? reject(error) : resolveWrite())),
        );
        return started;
      }),
    ]);
  } finally {
    input.destroy();
    output.off('error', failOutput);
    // A pending fd read cannot be cancelled portably; on failure main exits instead of waiting forever.
    if (input.readableEnded && !input.closed)
      await new Promise<void>((resolveClose) => input.once('close', resolveClose));
  }
}
