# Feedback delivery contract

Feedback is complete only when the requested user-visible result is present in the reviewed revision and has evidence for that result. A merged PR and green general checks establish neither on their own.

## Turn feedback into a reviewable outcome

For each independently deliverable request, the PR description records:

| Record            | Required content                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requested outcome | What the person can see or do, including the affected screen, state, or error path.                                                                                  |
| Implementation    | The code, test, and documentation paths that implement it.                                                                                                           |
| Postcondition     | A direct observation that would fail if the request were missed. Use a focused test, native walkthrough, visual capture, or a combination appropriate to the change. |
| Boundaries        | Persistence, recovery, permissions, accessibility, and nearby interactions that could regress.                                                                       |
| Evidence          | The executed command or walkthrough, platform, revision, and retained artifact or CI link when one exists.                                                           |

The postcondition names the requested result. “Tests pass” is supporting evidence, not the postcondition. For example, a layout report needs a capture at the reported viewport; a paste-error report needs the failed paste and the resulting notification; a deletion report needs the selected fixture and its resulting filesystem state.

Keep an outcome marked **unverified** when its postcondition has not been observed. Do not convert it to “done” because related code merged.

## Review and integration

One PR may contain the schema, IPC, UI, and tests needed for one outcome. Its review checks that every requested outcome has an implementation path and evidence path. Follow-up fixes stay in that PR when they correct the same outcome; unrelated findings become separate work.

Before merge, record the reviewed head SHA and the checks that apply to it. After merge, compare the resulting `origin/main` SHA with that reviewed head. If integration changed the tested code or the requested interaction, run the affected postcondition again on the integrated revision. CI status alone does not answer this question.

To claim that a nightly contains all merged feedback, the dispatch SHA must equal the observed `origin/main` SHA and every reviewed merge SHA must be its ancestor. The workflow may validly rerun an older main ancestor for recovery, but that run cannot support the broader claim.

## Nightly provenance and installed-version diagnosis

A normal merge does not create a nightly. A nightly starts from the exact accepted `origin/main` SHA and records:

1. the dispatch SHA and resulting workflow run;
2. the release tag, manifest version, asset hashes, and platform artifact tested;
3. the version reported by the running packaged application; and
4. the requested-outcome evidence for that same candidate.

When the app appears to have the wrong build, first identify which value is being compared: the source package version, the nightly candidate version, the downloaded artifact tag, or the version reported by the installed app. Compare the installed app’s reported version with the manifest and tag for the dispatched SHA. A mismatch blocks the delivery claim until it is diagnosed; it does not block unrelated feedback work.

Use [nightly builds](nightly-builds.md) for the publication procedure and [release readiness](release-readiness.md) for stable-release evidence. This contract adds outcome traceability; it does not add an approval step or replace consequential-change review.
