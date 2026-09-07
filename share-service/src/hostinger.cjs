// Hostinger's process loader requires its entry point synchronously.
// Import the ESM server so its private-storage preparation can finish before listen().
void import('./server.js').catch((error) => {
  console.error('Share service startup failed:', error);
  process.exitCode = 1;
});
