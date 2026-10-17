# Test Support Module

This module exposes admin-gated operations used only by the end-to-end suite.

`setEntityWatchMembership` delegates to `InterestService.setEntityWatchMembership` to register an authenticated test session without running reconciliation. This lets tests observe externally triggered population without membership changes dispatching their own ensure-mode population.

`installSystemPlugin`, `updateSystemPlugin`, `uninstallSystemPlugin`, and `reconcilePluginInstallations` retain system-only semantics used by active end-to-end callers. System updates require the active source hash; private updates use the owner's exact installation ID.
