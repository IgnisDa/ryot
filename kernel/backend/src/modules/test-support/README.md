# Test Support

This module exposes admin-gated operations used only by the end-to-end suite.

`listAutomationTriggers`, `listAutomationRuns`, `listAutomationAttempts`, and
`listAutomationRecipients` inspect retained execution records in pages of 100 using an optional
offset. These records are not available through the production RyotQL catalog.

`runReminderScan` calls the production notification recovery and reminder scan owners. It uses the
real clock, configured disablement and normal batching. It does not seed or rewrite lifecycle state.

`setEntityWatchMembership` delegates to `InterestService.setEntityWatchMembership` to register an
authenticated test session without reconciliation. Tests can then observe externally triggered
population without membership changes dispatching ensure-mode population.

`installSystemPlugin`, `updateSystemPlugin`, `uninstallSystemPlugin`, and
`reconcilePluginInstallations` retain system-only semantics. System updates require the active
source hash; private updates use the owner's exact installation ID.
