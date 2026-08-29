# Flaky-test policy

A failed attempt is a failed BTH run. Automatic retry does not rewrite it into PASS.

If a team must diagnose a suspected flaky test:

1. Keep the original failed run and output hashes.
2. Re-run as a separate `bth check` or `bth verify` record.
3. Record both run ids and classify the test outside the PASS oracle.
4. Fix, quarantine with an explicit owner/expiry, or remove the source of nondeterminism.
5. Do not lower `minimumTests` to hide skipped/quarantined coverage.

BTH currently has no automatic retry switch. A project-owned retry command may produce one process result, but the team must not present that as proof that every attempt is stable. Cross-machine adoption measurements should report first-attempt success and rerun success separately.
