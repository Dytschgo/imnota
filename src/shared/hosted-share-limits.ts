/** Default service limits. Count every stored Markdown copy, including bundle cards. */
export const HOSTED_MARKDOWN_BYTES = 1024 * 1024;
export const HOSTED_UPLOAD_BYTES = 25 * 1024 * 1024;
export const HOSTED_IMAGE_BYTES = 10 * 1024 * 1024;
export const HOSTED_BUNDLE_COUNT = 20;
export const HOSTED_IMAGE_PIXELS = 64_000_000;

export interface HostedSharePartSummary {
  markdownBytes: number;
  uploadBytes: number;
  imageBundleNumbers: readonly number[];
  bundleNumbers: readonly number[];
}
