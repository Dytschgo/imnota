// jest-dom matchers only apply to DOM nodes. Node-environment tests skip loading them.
if (typeof document !== 'undefined') await import('@testing-library/jest-dom/vitest');

export {};
