import { createHash } from 'node:crypto';

/** Identity of one saved export set, shared by MCP discovery and explicit UI handoff. */
export function promptBundleId(projectKey: string, collectionId: string, setName: string): string {
  const digest = createHash('sha256').update([projectKey, collectionId, setName].join('\0')).digest('hex');
  return `b_${digest.slice(0, 32)}`;
}
