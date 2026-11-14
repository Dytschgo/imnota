# October 31 nightly VM reproducer

`scripts/verify-nightly-vm.ps1` is a historical reproducer for application/verifier source `b80ef9f2901acae6569eb056aa63d57cc114e5e4` and nightly `0.4.1-nightly.20261031.41222265922`. It is not a current release verifier. It refuses to download or install if tracked files other than the orchestration script differ from that source, including staged and unstaged edits. A full Git checkout containing the pinned commit is required.

For read-only source validation, run `./scripts/verify-nightly-vm.ps1 -CheckSourceOnly` from that checkout's root. Current main must fail this check. To reproduce the old run, supply the guarded harness in the matching historical checkout; actual dependency preparation, downloads and installation still require the approved managed Windows guest. This is not authorization to start a guest or expand its policy.

The original wrapper revision `8947eee2e06ffe3033dfbe295189d0d9ad65d253` passed 32 installed UI assertion groups in Lab Manager run `20261101T012007Z-57a47ed9942d`. Node 22.23.3 blocked the Node 24 Windows MCP relay, so the result remained partial. The artifact-directory setup failure was corrected, cleanup was confirmed, and the reservation was released. These are historical results, not verification of today's source or nightly. The guarded wrapper records its own hash separately from the pinned application/verifier source; its read-only check does not establish a new native UI pass.

Use the current [nightly procedure](../nightly-builds.md) and [feedback delivery contract](../feedback-delivery-contract.md) for publication and candidate acceptance.
