import { AsyncLocalStorage } from 'node:async_hooks';

let tail: Promise<void> = Promise.resolve();
/** The operation that owns the queue right now; undefined while it is free. */
let current: object | undefined;
const holding = new AsyncLocalStorage<object>();

/**
 * Runs project creation one operation at a time so a new folder name is chosen and
 * reserved before the next operation looks for a free one. Blank and template creation
 * share this queue. A call made from inside a queued operation (such as the IPC handler
 * creating a template) joins that operation instead of waiting behind itself, but only
 * while that operation still holds the queue: async work it left running after it
 * finished inherits its turn and must wait like any other caller.
 */
export async function withinProjectCreationQueue<T>(operation: () => Promise<T>): Promise<T> {
  const inherited = holding.getStore();
  if (inherited && inherited === current) return operation();
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const turn = {};
  current = turn;
  try {
    return await holding.run(turn, operation);
  } finally {
    current = undefined;
    release();
  }
}
