# Test Support

This module exposes admin-gated operations used only by the end-to-end suite.

`setEntityWatchMembership` delegates to `InterestService.setEntityWatchMembership` to register an
authenticated test session without reconciliation. Tests can then observe externally triggered
population without membership changes dispatching ensure-mode population.

`installSystemPlugin`, `updateSystemPlugin`, `uninstallSystemPlugin`, and
`reconcilePluginInstallations` retain system-only semantics. System updates require the active
source hash; private updates use the owner's exact installation ID.
