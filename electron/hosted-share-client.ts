import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HostedShareList, HostedShareRecord, HostedShareUpload } from '../src/shared/workflow-bridge.js';
import { NativeWorkflowError } from './workflow-errors.js';

const PRODUCTION_ORIGIN = 'https://app.imnota.xyz';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MANAGEMENT_TOKEN = TOKEN;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PNG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png$/;
const PUBLIC_PATH = /^\/s\/[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_MARKDOWN_BYTES = 1_000_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_STORED_SHARE_BYTES = MAX_UPLOAD_BYTES * 2 + 1024 * 1024;
const PENDING_RECOVERY_MS = 24 * 60 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type StoredShare = HostedShareRecord & { managementToken: string };
type PendingShare = {
  requestId: string;
  pairingToken: string;
  createdAt: string;
  deadlineAt: string;
  payloadFingerprint?: string;
};
type JsonObject = Record<string, unknown>;

export interface HostedShareArtifacts {
  title: string;
  markdown: string;
  images: readonly { filename: string; dataBase64: string }[];
}

function publicRecord(record: StoredShare): HostedShareRecord {
  return {
    id: record.id,
    url: record.url,
    title: record.title,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    ...(record.byteSize === undefined ? {} : { byteSize: record.byteSize }),
  };
}

function originForTests(): string {
  const override = process.env.IMNOTA_SHARE_SERVICE_ORIGIN;
  return process.env.NODE_ENV === 'test' && override?.startsWith('https://')
    ? override.replace(/\/$/, '')
    : PRODUCTION_ORIGIN;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function safeText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0) &&
    !hasControlCharacter(value)
  );
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validShareUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === PRODUCTION_ORIGIN &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      PUBLIC_PATH.test(url.pathname) &&
      value === `${PRODUCTION_ORIGIN}${url.pathname}`
    );
  } catch {
    return false;
  }
}

function invalidResponse(message: string): NativeWorkflowError {
  return new NativeWorkflowError('network-failure', message, true);
}

function validateReceipt(value: unknown): StoredShare {
  if (!isObject(value)) throw invalidResponse('The share service returned an invalid response object.');
  if (!UUID.test(typeof value.id === 'string' ? value.id : ''))
    throw invalidResponse('The share service returned an invalid share identifier.');
  if (!validShareUrl(value.url)) throw invalidResponse('The share service returned an unexpected share URL.');
  if (!safeText(value.title, 200))
    throw invalidResponse('The share service returned an invalid share title.');
  if (!validTimestamp(value.createdAt) || !validTimestamp(value.expiresAt))
    throw invalidResponse('The share service returned an invalid share expiration.');
  if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt))
    throw invalidResponse('The share service returned an inconsistent share expiration.');
  if (!MANAGEMENT_TOKEN.test(typeof value.managementToken === 'string' ? value.managementToken : ''))
    throw invalidResponse('The share service returned an invalid management capability.');
  if (
    !Number.isSafeInteger(value.byteSize) ||
    (value.byteSize as number) < 0 ||
    (value.byteSize as number) > MAX_STORED_SHARE_BYTES
  )
    throw invalidResponse('The share service returned an invalid share size.');
  return {
    id: value.id as string,
    url: value.url,
    title: value.title,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    byteSize: value.byteSize as number,
    managementToken: value.managementToken as string,
  };
}

function validateStoredShare(value: unknown): StoredShare | undefined {
  if (!isObject(value)) return undefined;
  const { id, url, title, createdAt, expiresAt, managementToken, byteSize, revokedAt } = value;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  if (!validShareUrl(url) || !safeText(title, 200)) return undefined;
  if (!validTimestamp(createdAt) || !validTimestamp(expiresAt)) return undefined;
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) return undefined;
  if (typeof managementToken !== 'string' || !MANAGEMENT_TOKEN.test(managementToken)) return undefined;
  if (
    byteSize !== undefined &&
    (typeof byteSize !== 'number' ||
      !Number.isSafeInteger(byteSize) ||
      byteSize < 0 ||
      byteSize > MAX_STORED_SHARE_BYTES)
  )
    return undefined;
  if (
    revokedAt !== undefined &&
    (!validTimestamp(revokedAt) || Date.parse(revokedAt) < Date.parse(createdAt))
  )
    return undefined;
  return {
    id,
    url,
    title,
    createdAt,
    expiresAt,
    managementToken,
    ...(byteSize === undefined ? {} : { byteSize }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

function safeServerMessage(value: unknown, fallback: string): string {
  return safeText(value, 500) ? value : fallback;
}

function errorFor(status: number, code: unknown, message: unknown, fallback: string): NativeWorkflowError {
  const safeCode = safeText(code, 100) ? code : undefined;
  const safeMessage = safeServerMessage(message, fallback);
  if (status === 401 || safeCode === 'pairing_expired' || safeCode === 'pairing_used')
    return new NativeWorkflowError(
      'pairing-expired',
      'This pairing code expired or was already used. Create a new code in your browser.',
      true,
    );
  if (status === 413 || status === 507 || safeCode === 'payload_too_large' || safeCode === 'quota_exceeded')
    return new NativeWorkflowError('upload-rejected', safeMessage, false);
  if (status === 429)
    return new NativeWorkflowError('network-failure', `${safeMessage} Try again shortly.`, true);
  return new NativeWorkflowError('network-failure', safeMessage, status >= 500);
}

function isDefinitiveNonCommitStatus(status: number): boolean {
  if (status === 507) return true;
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function withCommitState(error: NativeWorkflowError, requestMayHaveCommitted: boolean): NativeWorkflowError {
  return new NativeWorkflowError(error.code, error.message, error.retryable, {
    ...error.details,
    requestMayHaveCommitted,
  });
}

async function readJson(response: Response): Promise<JsonObject> {
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse('The share service returned no response body.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw invalidResponse('The share service returned an oversized response.');
    }
    chunks.push(next.value);
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as unknown;
    if (!isObject(value)) throw new Error('Expected an object.');
    return value;
  } catch {
    throw invalidResponse('The share service returned invalid JSON.');
  }
}

function validateResponseDestination(response: Response, expected: string): void {
  if (response.redirected || (response.url !== '' && response.url !== expected))
    throw invalidResponse('The share service redirected a private request unexpectedly.');
}

function canonicalBase64Png(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== value) return undefined;
  return decoded.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? decoded : undefined;
}

export class HostedShareClient {
  private readonly active = new Map<string, AbortController>();
  private stateQueue: Promise<void> = Promise.resolve();
  private recovery?: Promise<string[]>;

  constructor(
    private readonly userDataPath: string,
    private readonly openExternal: (url: string) => Promise<void>,
  ) {}

  async openPairing(): Promise<void> {
    await this.openExternal(`${originForTests()}/new`);
  }

  async create(input: HostedShareUpload, artifacts: HostedShareArtifacts): Promise<HostedShareRecord> {
    this.validateUpload(input, artifacts);
    if (this.active.has(input.requestId))
      throw new NativeWorkflowError('invalid-input', 'That upload is already running.', false);

    const controller = new AbortController();
    this.active.set(input.requestId, controller);
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60_000);
    try {
      const payload = {
        requestId: input.requestId,
        title: artifacts.title,
        markdown: artifacts.markdown,
        images: artifacts.images,
        includeArchive: input.includeArchive,
        expiresInDays: input.expiresInDays,
      };
      const payloadFingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      await this.savePending(input, payloadFingerprint);
      const target = `${originForTests()}/api/shares`;
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.pairingToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error',
      });
      validateResponseDestination(response, target);
      let body: JsonObject;
      try {
        body = await readJson(response);
      } catch (error) {
        if (isDefinitiveNonCommitStatus(response.status)) {
          await this.clearPending(input.requestId);
          throw withCommitState(
            errorFor(response.status, undefined, undefined, 'The share service rejected this upload.'),
            false,
          );
        }
        throw error;
      }
      if (!response.ok) {
        const responseError = errorFor(
          response.status,
          isObject(body.error) ? body.error.code : undefined,
          isObject(body.error) ? body.error.message : undefined,
          'The share service rejected this upload.',
        );
        if (isDefinitiveNonCommitStatus(response.status)) {
          await this.clearPending(input.requestId);
          throw withCommitState(responseError, false);
        }
        throw withCommitState(responseError, true);
      }
      const record = validateReceipt(body);
      await this.save(record);
      await this.clearPending(input.requestId);
      return publicRecord(record);
    } catch (error) {
      if (timedOut)
        throw new NativeWorkflowError(
          'network-failure',
          'The share service did not finish this upload within 60 seconds. You can retry recovery from local share history.',
          true,
        );
      if (controller.signal.aborted)
        throw new NativeWorkflowError('session-cancelled', 'Hosted share upload cancelled.', true);
      if (error instanceof NativeWorkflowError) throw error;
      throw new NativeWorkflowError(
        'network-failure',
        'Could not reach the share service. Your local exports remain available.',
        true,
      );
    } finally {
      clearTimeout(deadline);
      this.active.delete(input.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.active.get(requestId)?.abort();
  }

  async list(): Promise<HostedShareList> {
    const recoveryErrors = await this.recoverPending();
    return { records: (await this.read()).map(publicRecord), recoveryErrors };
  }

  async revoke(id: string): Promise<HostedShareRecord> {
    const stored = (await this.read()).find((item) => item.id === id);
    if (!stored)
      throw new NativeWorkflowError('invalid-input', 'This local share record is unavailable.', false);
    const target = `${originForTests()}/api/shares/${encodeURIComponent(id)}/revoke`;
    const { response, body } = await this.requestJson(
      target,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${stored.managementToken}`, Accept: 'application/json' },
      },
      30_000,
      'The share service did not answer the revoke request within 30 seconds.',
    );
    if (!response.ok)
      throw errorFor(
        response.status,
        isObject(body.error) ? body.error.code : undefined,
        isObject(body.error) ? body.error.message : undefined,
        'Could not revoke this share.',
      );
    if (!validTimestamp(body.revokedAt) || Date.parse(body.revokedAt) < Date.parse(stored.createdAt))
      throw invalidResponse('The share service returned an invalid revocation time.');
    const updated: StoredShare = { ...stored, revokedAt: body.revokedAt };
    await this.save(updated);
    return publicRecord(updated);
  }

  private validateUpload(input: HostedShareUpload, artifacts: HostedShareArtifacts): void {
    if (!TOKEN.test(input.pairingToken))
      throw new NativeWorkflowError(
        'invalid-input',
        'Paste the complete one-use pairing code from app.imnota.xyz.',
        false,
      );
    if (!UUID.test(input.requestId))
      throw new NativeWorkflowError('invalid-input', 'The upload request is invalid.', false);
    if (!safeText(artifacts.title, 200))
      throw new NativeWorkflowError('invalid-input', 'The finalized prompt title is invalid.', false);
    const markdownBytes = Buffer.byteLength(artifacts.markdown, 'utf8');
    if (!artifacts.markdown.trim() || markdownBytes > MAX_MARKDOWN_BYTES)
      throw new NativeWorkflowError(
        'invalid-input',
        'The finalized prompt bundle is too large to share.',
        false,
      );
    if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 30)
      throw new NativeWorkflowError('invalid-input', 'Choose an expiration between 1 and 30 days.', false);
    if (typeof input.includeArchive !== 'boolean' || artifacts.images.length > 20)
      throw new NativeWorkflowError(
        'invalid-input',
        'The finalized prompt bundle is too large to share.',
        false,
      );
    const names = new Set<string>();
    let decodedBytes = markdownBytes;
    for (const image of artifacts.images) {
      const decoded = canonicalBase64Png(image.dataBase64);
      if (!SAFE_PNG.test(image.filename) || names.has(image.filename) || !decoded)
        throw new NativeWorkflowError('invalid-input', 'The export contains an invalid PNG artifact.', false);
      names.add(image.filename);
      decodedBytes += decoded.byteLength;
      if (decodedBytes > MAX_UPLOAD_BYTES)
        throw new NativeWorkflowError(
          'invalid-input',
          'The finalized prompt bundle is too large to share.',
          false,
        );
    }
  }

  private async requestJson(
    target: string,
    init: RequestInit,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<{ response: Response; body: JsonObject }> {
    const controller = new AbortController();
    let response: Response | undefined;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      response = await fetch(target, { ...init, signal: controller.signal, redirect: 'error' });
      validateResponseDestination(response, target);
      return { response, body: await readJson(response) };
    } catch (error) {
      if (timedOut) throw new NativeWorkflowError('network-failure', timeoutMessage, true);
      if (error instanceof NativeWorkflowError) {
        if (response && isDefinitiveNonCommitStatus(response.status)) throw withCommitState(error, false);
        throw error;
      }
      throw new NativeWorkflowError(
        'network-failure',
        'Could not reach the share service. Your local exports remain available.',
        true,
      );
    } finally {
      clearTimeout(deadline);
    }
  }

  private file(): string {
    return path.join(this.userDataPath, 'hosted-shares.json');
  }

  private pendingFile(): string {
    return path.join(this.userDataPath, 'hosted-share-pending.json');
  }

  private recoverPending(): Promise<string[]> {
    if (this.recovery) return this.recovery;
    const operation = this.recoverPendingNow().finally(() => {
      if (this.recovery === operation) this.recovery = undefined;
    });
    this.recovery = operation;
    return operation;
  }

  private async recoverPendingNow(): Promise<string[]> {
    let all: Record<string, PendingShare>;
    try {
      all = await this.pending();
    } catch (error) {
      return [error instanceof Error ? error.message : 'Hosted-share recovery metadata could not be read.'];
    }
    const errors: string[] = [];
    for (const pending of Object.values(all)) {
      if (this.active.has(pending.requestId)) continue;
      if (Date.parse(pending.deadlineAt) <= Date.now()) {
        await this.clearPending(pending.requestId);
        errors.push(
          'A previous share upload was not resolved within 24 hours. Its local recovery capability was cleared.',
        );
        continue;
      }
      try {
        const target = `${originForTests()}/api/shares/receipt/${encodeURIComponent(pending.requestId)}`;
        const { response, body } = await this.requestJson(
          target,
          { headers: { Authorization: `Bearer ${pending.pairingToken}`, Accept: 'application/json' } },
          15_000,
          'Receipt recovery did not answer within 15 seconds.',
        );
        if (response.status === 410) {
          await this.clearPending(pending.requestId);
          errors.push('A previous share upload could not be recovered because its receipt expired.');
          continue;
        }
        if (!response.ok) {
          const responseError = errorFor(
            response.status,
            isObject(body.error) ? body.error.code : undefined,
            isObject(body.error) ? body.error.message : undefined,
            response.status === 404
              ? 'A previous share upload has no recoverable receipt.'
              : 'A previous share upload could not be recovered.',
          );
          if (isDefinitiveNonCommitStatus(response.status)) {
            await this.clearPending(pending.requestId);
            errors.push(`${responseError.message} Its local recovery capability was cleared.`);
          } else {
            errors.push(responseError.message);
          }
          continue;
        }
        const record = validateReceipt(body);
        await this.save(record);
        await this.clearPending(pending.requestId);
      } catch (error) {
        if (error instanceof NativeWorkflowError && error.details?.requestMayHaveCommitted === false) {
          try {
            await this.clearPending(pending.requestId);
            errors.push(`${error.message} Its local recovery capability was cleared.`);
          } catch (clearError) {
            errors.push(
              clearError instanceof Error
                ? clearError.message
                : 'A previous share recovery capability could not be cleared.',
            );
          }
          continue;
        }
        errors.push(
          error instanceof NativeWorkflowError
            ? error.message
            : 'A previous share upload could not be recovered.',
        );
      }
    }
    return [...new Set(errors)];
  }

  private async savePending(input: HostedShareUpload, payloadFingerprint: string): Promise<void> {
    await this.enqueueState(async () => {
      const all = await this.pending();
      const existing = all[input.requestId];
      if (existing) {
        if (
          existing.pairingToken !== input.pairingToken ||
          !existing.payloadFingerprint ||
          existing.payloadFingerprint !== payloadFingerprint
        )
          throw new NativeWorkflowError(
            'invalid-input',
            'This request has an unresolved upload with its original pairing code and artifacts. Recover it from local share history before changing the code or publishing options.',
            false,
          );
        return;
      }
      const createdAt = new Date().toISOString();
      all[input.requestId] = {
        requestId: input.requestId,
        pairingToken: input.pairingToken,
        createdAt,
        deadlineAt: new Date(Date.parse(createdAt) + PENDING_RECOVERY_MS).toISOString(),
        payloadFingerprint,
      };
      await this.writePending(all);
    });
  }

  private async clearPending(requestId: string): Promise<void> {
    await this.enqueueState(async () => {
      const all = await this.pending();
      delete all[requestId];
      await this.writePending(all);
    });
  }

  private async pending(): Promise<Record<string, PendingShare>> {
    const pendingFile = this.pendingFile();
    const raw = await fs.readFile(pendingFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    });
    const fileModifiedAt = await fs
      .stat(pendingFile)
      .then((stat) => stat.mtimeMs)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return Date.now();
        throw error;
      });
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new NativeWorkflowError(
        'io-failure',
        'Hosted-share recovery metadata is corrupt. The local file was preserved for inspection.',
        false,
      );
    }
    if (!isObject(value))
      throw new NativeWorkflowError(
        'io-failure',
        'Hosted-share recovery metadata is corrupt. The local file was preserved for inspection.',
        false,
      );
    const validated: Record<string, PendingShare> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        !isObject(entry) ||
        !UUID.test(key) ||
        entry.requestId !== key ||
        !TOKEN.test(typeof entry.pairingToken === 'string' ? entry.pairingToken : '') ||
        (entry.payloadFingerprint !== undefined &&
          !/^[0-9a-f]{64}$/.test(
            typeof entry.payloadFingerprint === 'string' ? entry.payloadFingerprint : '',
          )) ||
        (entry.createdAt === undefined) !== (entry.deadlineAt === undefined) ||
        (entry.createdAt !== undefined &&
          (!validTimestamp(entry.createdAt) ||
            !validTimestamp(entry.deadlineAt) ||
            Date.parse(entry.deadlineAt as string) - Date.parse(entry.createdAt) !== PENDING_RECOVERY_MS))
      )
        throw new NativeWorkflowError(
          'io-failure',
          'Hosted-share recovery metadata is corrupt. The local file was preserved for inspection.',
          false,
        );
      const createdAt =
        typeof entry.createdAt === 'string' ? entry.createdAt : new Date(fileModifiedAt).toISOString();
      validated[key] = {
        requestId: key,
        pairingToken: entry.pairingToken as string,
        createdAt,
        deadlineAt:
          typeof entry.deadlineAt === 'string'
            ? entry.deadlineAt
            : new Date(Date.parse(createdAt) + PENDING_RECOVERY_MS).toISOString(),
        ...(typeof entry.payloadFingerprint === 'string'
          ? { payloadFingerprint: entry.payloadFingerprint }
          : {}),
      };
    }
    return validated;
  }

  private async writePending(value: Record<string, PendingShare>): Promise<void> {
    await this.atomicWrite(this.pendingFile(), JSON.stringify(value));
  }

  private async read(): Promise<StoredShare[]> {
    const raw = await fs.readFile(this.file(), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new NativeWorkflowError(
        'io-failure',
        'Local hosted-share history is corrupt. The local file was preserved for inspection.',
        false,
      );
    }
    if (!Array.isArray(parsed))
      throw new NativeWorkflowError(
        'io-failure',
        'Local hosted-share history is corrupt. The local file was preserved for inspection.',
        false,
      );
    const records = parsed.map(validateStoredShare);
    if (records.some((record) => record === undefined))
      throw new NativeWorkflowError(
        'io-failure',
        'Local hosted-share history is corrupt. The local file was preserved for inspection.',
        false,
      );
    return records as StoredShare[];
  }

  private async save(record: StoredShare): Promise<void> {
    await this.enqueueState(async () => {
      const records = (await this.read()).filter((item) => item.id !== record.id);
      records.unshift(record);
      await this.atomicWrite(this.file(), JSON.stringify(records, null, 2));
    });
  }

  private enqueueState<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.stateQueue.then(operation);
    this.stateQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async atomicWrite(target: string, content: string): Promise<void> {
    await fs.mkdir(this.userDataPath, { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, content, { mode: 0o600 });
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
