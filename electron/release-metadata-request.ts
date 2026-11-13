import { RELEASES_API_URL } from './releases.js';

const metadataTargets = new Set([
  `${RELEASES_API_URL}/latest`,
  ...Array.from({ length: 10 }, (_, page) => `${RELEASES_API_URL}?per_page=100&page=${page + 1}`),
]);

/** Consume the launch-only token before app-created children can inherit it. */
export function createCiReleaseMetadataRequest(
  environment: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): typeof fetch {
  const token = environment.IMNOTA_CI_RELEASE_TOKEN;
  delete environment.IMNOTA_CI_RELEASE_TOKEN;
  if (environment.GITHUB_ACTIONS !== 'true' || environment.RUNNER_ENVIRONMENT !== 'github-hosted' || !token)
    return request;
  if (token.length > 2048 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token))
    throw new Error('Invalid CI release credentials.');
  return async (target, options) => {
    if (
      typeof target !== 'string' ||
      !metadataTargets.has(target) ||
      (options?.method ?? 'GET').toUpperCase() !== 'GET' ||
      options?.body != null
    )
      throw new Error('CI release credentials are restricted to read-only Imnota release metadata.');
    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return request(target, { ...options, headers, redirect: 'error' });
  };
}
