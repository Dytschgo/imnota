import { parentPort, workerData } from 'node:worker_threads';
import { createWindowsSmokePointer } from './windows-smoke-input.js';

interface Point {
  x: number;
  y: number;
}
interface DragInput {
  start: Point;
  end: Point;
  restore: Point;
}

if (parentPort) {
  const input = workerData as DragInput;
  const pointer = createWindowsSmokePointer();
  // Input cadence models a single human gesture. Outcome readiness is checked by
  // the receiving window, with no input retry. A worker can release the mouse while
  // Windows' native DoDragDrop nested loop owns the main thread.
  const pause = (milliseconds: number) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  try {
    pointer.move(input.start);
    pause(100);
    pointer.down();
    pause(100);
    const steps = 20;
    for (let index = 1; index <= steps; index++) {
      pointer.move({
        x: Math.round(input.start.x + ((input.end.x - input.start.x) * index) / steps),
        y: Math.round(input.start.y + ((input.end.y - input.start.y) * index) / steps),
      });
      pause(20);
    }
    pause(100);
    pointer.up();
    parentPort.postMessage({ completed: true });
  } finally {
    pointer.up();
    pointer.move(input.restore);
  }
}
