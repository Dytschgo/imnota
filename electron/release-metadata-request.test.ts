// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createCiReleaseMetadataRequest } from './release-metadata-request.js';
import { discoverRelease } from './releases.js';

const api = 'https://api.github.com/repos/Dytschgo/imnota/releases';
const token = 'synthetic-ci-token';
const environment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  IMNOTA_CI_RELEASE_TOKEN: token,
  ...overrides,
});

function release(version: string, prerelease = false, draft = false) {
  const base = `https://github.com/Dytschgo/imnota/releases/download/v${version}/`;
  return {
    tag_name: `v${version}`,
    draft,
    prerelease,
    body: draft ? 'Synthetic unpublished notes' : 'Published notes',
    assets: [`${prerelease ? 'nightly' : 'latest'}-mac.yml`, `Imnota-${version}-universal-mac.zip`].map(
      (name) => ({ name, size: 100, browser_download_url: base + name }),
    ),
  };
}

it('discovers the actual release schema when anonymous metadata requests are rate limited', async () => {
  const request = vi.fn<typeof fetch>(async (_target, options) => {
    if (new Headers(options?.headers).get('Authorization') !== `Bearer ${token}`)
      return new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    return new Response(JSON.stringify(release('0.4.0')));
  });
  const candidate = await discoverRelease(
    'stable',
    'darwin',
    createCiReleaseMetadataRequest(environment(), request),
  );
  expect(candidate?.version).toBe('0.4.0');
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(candidate)).not.toContain(token);
});

it('keeps drafts unavailable when authenticated metadata includes unpublished releases', async () => {
  const published = '0.4.1-nightly.20261113.1234';
  const request = vi.fn<typeof fetch>(async (target) =>
    String(target).endsWith('/latest')
      ? new Response(null, { status: 404 })
      : new Response(
          JSON.stringify([release('0.5.0-nightly.20261113.1235', true, true), release(published, true)]),
        ),
  );
  const candidate = await discoverRelease(
    'nightly',
    'darwin',
    createCiReleaseMetadataRequest(environment(), request),
  );
  expect(candidate?.version).toBe(published);
  expect(candidate?.releaseNotes).toBe('Published notes');
  expect(JSON.stringify(candidate)).not.toContain('unpublished');
});

it('keeps an authenticated API rejection failed without retrying anonymously or exposing credentials', async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
  await expect(
    discoverRelease('stable', 'darwin', createCiReleaseMetadataRequest(environment(), request)),
  ).rejects.toThrow('GitHub release information is unavailable. Try again later.');
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  { GITHUB_ACTIONS: undefined },
  { GITHUB_ACTIONS: 'false' },
  { RUNNER_ENVIRONMENT: 'self-hosted' },
  { IMNOTA_CI_RELEASE_TOKEN: undefined },
])(
  'preserves the ordinary unauthenticated request outside explicit hosted-CI credentials: %j',
  (overrides) => {
    const env = environment(overrides);
    const request = vi.fn<typeof fetch>();
    expect(createCiReleaseMetadataRequest(env, request)).toBe(request);
    expect(env.IMNOTA_CI_RELEASE_TOKEN).toBeUndefined();
  },
);

it('consumes the launch token before children can inherit it and authenticates only canonical GET metadata', async () => {
  const env = environment();
  const request = vi.fn<typeof fetch>(async () => new Response('{}'));
  const releaseRequest = createCiReleaseMetadataRequest(env, request);
  expect(env.IMNOTA_CI_RELEASE_TOKEN).toBeUndefined();
  const headers = new Headers({ Accept: 'application/vnd.github+json' });
  const signal = AbortSignal.timeout(1000);
  await releaseRequest(`${api}/latest`, { headers, signal, redirect: 'follow' });
  await releaseRequest(`${api}?per_page=100&page=10`);
  const options = request.mock.calls[0]![1]!;
  expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(new Headers(options.headers).get('Accept')).toBe('application/vnd.github+json');
  expect(headers.has('Authorization')).toBe(false);
  expect(options.signal).toBe(signal);
  expect(options.redirect).toBe('error');
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([
  ['https://example.invalid/private', undefined],
  [`${api}/tags/v0.4.0`, undefined],
  ['https://api.github.com/repos/other/private/releases/latest', undefined],
  [`${api}?per_page=100&page=11`, undefined],
  [`${api}/latest?secret=value`, undefined],
  [`${api}/latest`, { method: 'POST' }],
  [`${api}/latest`, { body: 'unexpected' }],
] as const)(
  'refuses credentials outside the exact read-only metadata boundary: %s',
  async (target, options) => {
    const request = vi.fn<typeof fetch>();
    const releaseRequest = createCiReleaseMetadataRequest(environment(), request);
    await expect(releaseRequest(target, options)).rejects.toThrow('CI release credentials');
    expect(request).not.toHaveBeenCalled();
  },
);

it('rejects malformed CI credentials without echoing them', () => {
  const invalid = 'synthetic-token\nnot-a-header';
  const env = environment({ IMNOTA_CI_RELEASE_TOKEN: invalid });
  expect(() => createCiReleaseMetadataRequest(env)).toThrow('Invalid CI release credentials.');
  expect(env.IMNOTA_CI_RELEASE_TOKEN).toBeUndefined();
});
