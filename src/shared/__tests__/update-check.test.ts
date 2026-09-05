import { expect, it, vi } from 'vitest';
import { createUpdateCheck } from '../../../electron/update-check';
it('coalesces concurrent refreshes and allows retry after failure', async () => {
  const check = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
  const report = vi.fn();
  const refresh = createUpdateCheck(check, report);
  const first = refresh();
  expect(refresh()).toBe(first);
  await first;
  expect(check).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledOnce();
  await refresh();
  expect(check).toHaveBeenCalledTimes(2);
});
