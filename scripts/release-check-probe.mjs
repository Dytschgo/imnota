// Secondary observations after a failed live walkthrough, never an acceptance retry.
export async function probeReleaseCheck(
  discover,
  prepare,
  { request = globalThis.fetch, signal = globalThis.AbortSignal.timeout(15_000) } = {},
) {
  const report = { kind: 'secondary-release-check', requests: [] };
  let stage = 'discovery';
  try {
    const release = await discover('nightly', 'darwin', async (target, options = {}) => {
      const url = new globalThis.URL(target);
      const listing = url.pathname === '/repos/Dytschgo/imnota/releases';
      if (
        url.origin !== 'https://api.github.com' ||
        url.username ||
        url.password ||
        (!listing && url.pathname !== '/repos/Dytschgo/imnota/releases/latest') ||
        (!listing && url.search) ||
        (listing && !/^\?per_page=100&page=(?:[1-9]|10)$/.test(url.search)) ||
        report.requests.length >= 12
      )
        throw new Error('Unexpected release diagnostic request.');
      const observation = { endpoint: listing ? `page-${url.searchParams.get('page')}` : 'latest' };
      report.requests.push(observation);
      const response = await request(target, {
        ...options,
        signal: options.signal ? globalThis.AbortSignal.any([signal, options.signal]) : signal,
      });
      observation.status = response.status;
      observation.rateLimit = {};
      for (const name of ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
        const value = response.headers.get(name);
        if (value !== null && /^\d{1,12}$/.test(value)) observation.rateLimit[name] = value;
      }
      return response;
    });
    report.version = release?.version ?? null;
    if (!release) return { ...report, status: 'no-release' };
    stage = 'preparation';
    await prepare(release, '/Applications/Imnota.app', '0.0.0');
    return { ...report, status: 'ready' };
  } catch (error) {
    return {
      ...report,
      status: 'failed',
      stage,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown diagnostic error.',
      ...(typeof error?.cause?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.cause.code)
        ? { causeCode: error.cause.code }
        : {}),
    };
  }
}
