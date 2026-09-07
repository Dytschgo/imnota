import fsp from 'node:fs/promises';
import path from 'node:path';

export async function cleanupExpired({ db, config, now = Date.now() }) {
  const cutoff = now - config.cleanupGraceMs;
  const records = db.prepare(`
    SELECT id FROM shares
    WHERE (expires_at <= ? AND expires_at <= ?)
       OR (revoked_at IS NOT NULL AND revoked_at <= ?)
  `).all(now, cutoff, cutoff);
  let deletedShares = 0;
  let failedShares = 0;
  for (const record of records) {
    try {
      await fsp.rm(path.join(config.uploadsDir, record.id), { recursive: true, force: true });
      db.prepare('DELETE FROM shares WHERE id = ?').run(record.id);
      deletedShares += 1;
    } catch (error) {
      failedShares += 1;
      console.error(`Cleanup failed for share ${record.id}:`, error);
    }
  }
  const deletedPairings = db.prepare('DELETE FROM pairings WHERE expires_at <= ?').run(cutoff).changes;
  return { deletedShares, failedShares, deletedPairings };
}
