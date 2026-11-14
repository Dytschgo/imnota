import { TextDecoder } from 'node:util';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function decodeMcpUtf8(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new SyntaxError('Invalid UTF-8.');
  }
}

type Frame = { text: string; error?: never } | { error: 'too-large' | 'invalid-utf8'; text?: never };

/** Bound unfinished frames too; discard an oversized frame through its newline, then recover. */
export async function* readMcpFrames(input: NodeJS.ReadableStream, maximum: number): AsyncGenerator<Frame> {
  let parts: Buffer[] = [];
  let size = 0;
  let oversized = false;
  const finish = (): Frame => {
    try {
      if (oversized) return { error: 'too-large' };
      const bytes = Buffer.concat(parts, size);
      return { text: decodeMcpUtf8(bytes.at(-1) === 13 ? bytes.subarray(0, -1) : bytes) };
    } catch {
      return { error: 'invalid-utf8' };
    } finally {
      parts = [];
      size = 0;
      oversized = false;
    }
  };
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const length = end - offset;
      if (!oversized) {
        // CRLF is framing, just as with the previous readline transport. Permit
        // one extra byte only when it is a possible terminal CR.
        if (
          size + length > maximum + 1 ||
          (size + length === maximum + 1 && bytes[end - 1] !== 13 && length > 0)
        ) {
          oversized = true;
          parts = [];
          size = 0;
        } else {
          // Copy only retained bytes; a tiny unfinished suffix must not pin a large chunk.
          parts.push(Buffer.from(bytes.subarray(offset, end)));
          size += length;
        }
      }
      offset = end + (newline < 0 ? 0 : 1);
      if (newline >= 0) yield finish();
    }
  }
  if (oversized || size) yield finish();
}

/** A session does not read its next request until the current response is consumed. */
export async function writeMcpResponse(output: NodeJS.WritableStream, response: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    output.once('error', failed);
    try {
      output.write(`${JSON.stringify(response)}\n`, (error?: Error | null) => {
        // Writable emits its error after calling the failed write callback.
        if (error) reject(error);
        else {
          output.off('error', failed);
          resolve();
        }
      });
    } catch (error) {
      output.off('error', failed);
      reject(error);
    }
  });
}
