import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HostedShareRecord, HostedShareUpload } from '../src/shared/workflow-bridge.js';
import { NativeWorkflowError } from './workflow-errors.js';

const PRODUCTION_ORIGIN = 'https://app.imnota.xyz';
const TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const SAFE_PNG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png$/;

type StoredShare = HostedShareRecord & { managementToken: string };
type ShareResponse = HostedShareRecord & { managementToken: string };
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

function errorFor(status: number, code: string | undefined, fallback: string): NativeWorkflowError {
  if (status === 401 || code === 'pairing_expired' || code === 'pairing_used')
    return new NativeWorkflowError(
      'pairing-expired',
      'This pairing code expired or was already used. Create a new code in your browser.',
      true,
    );
  if (status === 413 || status === 507 || code === 'payload_too_large' || code === 'quota_exceeded')
    return new NativeWorkflowError('upload-rejected', fallback, false);
  if (status === 429)
    return new NativeWorkflowError('network-failure', `${fallback} Try again shortly.`, true);
  return new NativeWorkflowError('network-failure', fallback, status >= 500);
}
function validateReceipt(body: Partial<ShareResponse>): asserts body is ShareResponse {
  if (!body.id || !body.url || !body.expiresAt || !body.managementToken)
    throw new NativeWorkflowError(
      'network-failure',
      'The share service returned an incomplete response.',
      true,
    );
  let url: URL;
  try {
    url = new URL(body.url);
  } catch {
    throw new NativeWorkflowError(
      'network-failure',
      'The share service returned an invalid share URL.',
      true,
    );
  }
  if (url.origin !== PRODUCTION_ORIGIN || !/^\/s\/[A-Za-z0-9_-]{16,}$/.test(url.pathname))
    throw new NativeWorkflowError(
      'network-failure',
      'The share service returned an unexpected share URL.',
      true,
    );
}

export class HostedShareClient {
  private readonly active = new Map<string, AbortController>();
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly userDataPath: string,
    private readonly openExternal: (url: string) => Promise<void>,
  ) {}

  async openPairing(): Promise<void> {
    await this.openExternal(`${originForTests()}/new`);
  }

  async create(input: HostedShareUpload, artifacts: HostedShareArtifacts): Promise<HostedShareRecord> {
    if (!TOKEN.test(input.pairingToken))
      throw new NativeWorkflowError(
        'invalid-input',
        'Paste the complete one-use pairing code from app.imnota.xyz.',
        false,
      );
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId))
      throw new NativeWorkflowError('invalid-input', 'The upload request is invalid.', false);
    if (
      !artifacts.markdown.trim() ||
      Buffer.byteLength(artifacts.markdown, 'utf8') > 1_000_000 ||
      artifacts.images.length > 20 ||
      artifacts.images.reduce(
        (total, image) => total + Buffer.from(image.dataBase64, 'base64').byteLength,
        Buffer.byteLength(artifacts.markdown, 'utf8'),
      ) >
        25 * 1024 * 1024
    )
      throw new NativeWorkflowError(
        'invalid-input',
        'The finalized prompt bundle is too large to share.',
        false,
      );
    if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 30)
      throw new NativeWorkflowError('invalid-input', 'Choose an expiration between 1 and 30 days.', false);
    if (this.active.has(input.requestId))
      throw new NativeWorkflowError('invalid-input', 'That upload is already running.', false);
    if (
      artifacts.images.some(
        (image) => !SAFE_PNG.test(image.filename) || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.dataBase64),
      )
    )
      throw new NativeWorkflowError('invalid-input', 'The export contains an invalid PNG artifact.', false);
    const controller = new AbortController();
    this.active.set(input.requestId, controller);
    const deadline = setTimeout(() => controller.abort(), 60_000);
    try {
      await this.savePending(input);
      const response = await fetch(`${originForTests()}/api/shares`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.pairingToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          requestId: input.requestId,
          title: artifacts.title.slice(0, 200),
          markdown: artifacts.markdown,
          images: artifacts.images,
          includeArchive: input.includeArchive,
          expiresInDays: input.expiresInDays,
        }),
        signal: controller.signal,
        redirect: 'error',
      });
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > 65_536)
        throw new NativeWorkflowError(
          'network-failure',
          'The share service returned an oversized response.',
          true,
        );
      const body = JSON.parse(raw) as unknown as {
        error?: { code?: string; message?: string };
      } & Partial<ShareResponse>;
      if (!response.ok)
        throw errorFor(
          response.status,
          body.error?.code,
          body.error?.message ?? 'The share service rejected this upload.',
        );
      validateReceipt(body);
      const record: StoredShare = {
        id: body.id,
        url: body.url,
        title: body.title ?? artifacts.title,
        createdAt: body.createdAt ?? new Date().toISOString(),
        expiresAt: body.expiresAt,
        byteSize: body.byteSize,
        managementToken: body.managementToken,
      };
      await this.save(record);
      await this.clearPending(input.requestId);
      return publicRecord(record);
    } catch (error) {
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
  async list(): Promise<readonly HostedShareRecord[]> {
    await this.recoverPending().catch(() => undefined);
    return (await this.read()).map(publicRecord);
  }
  async revoke(id: string): Promise<HostedShareRecord> {
    const stored = (await this.read()).find((item) => item.id === id);
    if (!stored)
      throw new NativeWorkflowError('invalid-input', 'This local share record is unavailable.', false);
    const response = await fetch(`${originForTests()}/api/shares/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${stored.managementToken}`, Accept: 'application/json' },
    });
    const body = (await response.json().catch(() => ({}))) as {
      revokedAt?: string;
      error?: { code?: string; message?: string };
    };
    if (!response.ok)
      throw errorFor(
        response.status,
        body.error?.code,
        body.error?.message ?? 'Could not revoke this share.',
      );
    const updated: StoredShare = { ...stored, revokedAt: body.revokedAt ?? new Date().toISOString() };
    await this.save(updated);
    return publicRecord(updated);
  }
  private file(): string {
    return path.join(this.userDataPath, 'hosted-shares.json');
  }
  private pendingFile(): string {
    return path.join(this.userDataPath, 'hosted-share-pending.json');
  }
  private async recoverPending(): Promise<void> {
    const raw = await fs.readFile(this.pendingFile(), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!raw) return;
    const pending = JSON.parse(raw) as { requestId?: unknown; pairingToken?: unknown };
    if (typeof pending.requestId !== 'string' || typeof pending.pairingToken !== 'string') return;
    const response = await fetch(
      `${originForTests()}/api/shares/receipt/${encodeURIComponent(pending.requestId)}`,
      {
        headers: { Authorization: `Bearer ${pending.pairingToken}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status === 404) return;
    if (response.status === 410) {
      await this.clearPending(pending.requestId);
      return;
    }
    const body = (await response.json()) as Partial<ShareResponse>;
    if (!response.ok) return;
    validateReceipt(body);
    await this.save({
      id: body.id,
      url: body.url,
      title: body.title ?? 'Imnota prompt',
      createdAt: body.createdAt ?? new Date().toISOString(),
      expiresAt: body.expiresAt,
      byteSize: body.byteSize,
      managementToken: body.managementToken,
    });
    await this.clearPending(pending.requestId);
  }
  private async savePending(input: HostedShareUpload): Promise<void> {
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.writeFile(
      this.pendingFile(),
      JSON.stringify({ requestId: input.requestId, pairingToken: input.pairingToken }),
      { mode: 0o600 },
    );
  }
  private async clearPending(requestId: string): Promise<void> {
    const raw = await fs
      .readFile(this.pendingFile(), 'utf8')
      .catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? '' : Promise.reject(error)));
    if (raw.includes(requestId)) await fs.unlink(this.pendingFile());
  }
  private async read(): Promise<StoredShare[]> {
    const raw = await fs.readFile(this.file(), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '[]';
      throw error;
    });
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is StoredShare =>
          Boolean(
            entry &&
            typeof entry === 'object' &&
            typeof (entry as StoredShare).id === 'string' &&
            typeof (entry as StoredShare).managementToken === 'string',
          ),
        )
      : [];
  }
  private async save(record: StoredShare): Promise<void> {
    const operation = this.writeQueue.then(() => this.saveNow(record));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
  private async saveNow(record: StoredShare): Promise<void> {
    const records = (await this.read()).filter((item) => item.id !== record.id);
    records.unshift(record);
    await fs.mkdir(this.userDataPath, { recursive: true });
    const temp = `${this.file()}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(records, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.file());
  }
}
