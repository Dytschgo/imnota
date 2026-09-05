import { readFileSync } from 'node:fs';

const platforms = ['windows', 'macos', 'linux'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function passed(value) {
  return isObject(value) && value.status === 'passed' && nonEmptyString(value.evidence);
}

/**
 * Validate human-authored local release evidence against the exact candidate.
 * This is a local guard only: it is not cryptographic attestation or remote
 * branch protection, and it cannot prevent someone from creating a tag manually.
 */
export function validateReleaseEvidence(evidence, candidate) {
  const errors = [];

  if (!isObject(evidence)) return ['Evidence must be a JSON object.'];
  if (evidence.schemaVersion !== 1) errors.push('schemaVersion must be 1.');

  if (!isObject(evidence.candidate)) {
    errors.push('candidate must contain the release commit SHA and version.');
  } else {
    if (evidence.candidate.sha !== candidate.sha)
      errors.push(`candidate.sha must match the exact release commit (${candidate.sha}).`);
    if (evidence.candidate.version !== candidate.version)
      errors.push(`candidate.version must match ${candidate.version}.`);
  }

  if (!Array.isArray(evidence.featureChecks) || evidence.featureChecks.length === 0) {
    errors.push('featureChecks must contain at least one passed changed-behaviour check.');
  } else {
    evidence.featureChecks.forEach((check, index) => {
      if (!isObject(check) || !nonEmptyString(check.name) || !passed(check))
        errors.push(`featureChecks[${index}] needs name, status "passed", and evidence.`);
    });
  }

  if (!isObject(evidence.platformChecks)) {
    errors.push('platformChecks must include windows, macos, and linux.');
  } else {
    for (const platform of platforms) {
      const check = evidence.platformChecks[platform];
      if (!isObject(check) || !passed(check.package) || !passed(check.installSmoke))
        errors.push(
          `platformChecks.${platform} needs passed package and installSmoke checks, each with evidence.`,
        );
    }
  }

  if (!isObject(evidence.acceptance)) {
    errors.push('acceptance must record the feature decision and independent reviewer.');
  } else {
    if (evidence.acceptance.status !== 'accepted') errors.push('acceptance.status must be "accepted".');
    if (!nonEmptyString(evidence.acceptance.author)) errors.push('acceptance.author is required.');
    if (!nonEmptyString(evidence.acceptance.reviewer)) errors.push('acceptance.reviewer is required.');
    if (
      nonEmptyString(evidence.acceptance.author) &&
      nonEmptyString(evidence.acceptance.reviewer) &&
      evidence.acceptance.author.trim().toLowerCase() === evidence.acceptance.reviewer.trim().toLowerCase()
    )
      errors.push('acceptance.reviewer must be independent of acceptance.author.');
    if (evidence.acceptance.rollbackAcknowledged !== true)
      errors.push('acceptance.rollbackAcknowledged must be true.');
    if (evidence.acceptance.knownLimitationsAcknowledged !== true)
      errors.push('acceptance.knownLimitationsAcknowledged must be true.');
  }

  if (!isObject(evidence.rollback) || !nonEmptyString(evidence.rollback.plan))
    errors.push('rollback.plan must describe how to recover if the release fails.');
  if (!Array.isArray(evidence.knownLimitations) || !evidence.knownLimitations.every(nonEmptyString))
    errors.push('knownLimitations must be an array of nonempty strings (use [] when none are known).');

  return errors;
}

export function readReleaseEvidence(evidencePath) {
  let source;
  try {
    source = readFileSync(evidencePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read release evidence at ${evidencePath}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Release evidence at ${evidencePath} is not valid JSON: ${error.message}`);
  }
}

export function assertReleaseEvidence(evidencePath, candidate) {
  const errors = validateReleaseEvidence(readReleaseEvidence(evidencePath), candidate);
  if (errors.length) throw new Error(`Release readiness evidence failed:\n- ${errors.join('\n- ')}`);
}
