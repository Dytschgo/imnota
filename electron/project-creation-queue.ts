import { AsyncLocalStorage } from 'node:async_hooks';

let tail: Promise<void> = Promise.resolve();
const holding = new AsyncLocalStorage<true>();

/**
 * Runs project creation one operation at a time so a new folder name is chosen and
 * reserved before the next operation looks for a free one. Blank and template creation
 * share this queue. A call made from inside a queued operation (such as the IPC handler
 * creating a template) joins that operation instead of waiting behind itself.
 */
export async function withinProjectCreationQueue<T>(operation: () => Promise<T>): Promise<T> {
  if (holding.getStore()) return operation();
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await holding.run(true, operation);
  } finally {
    release();
  }
}
