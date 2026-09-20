# Test Support Module

This module exposes admin-gated operations used only by the end-to-end suite.

`setEntityInterestMembership` delegates to `InterestService.setEntityInterestMembership` to register an authenticated test session without running reconciliation. This lets tests observe externally triggered population without membership changes dispatching their own ensure-mode population.

System plugin operations use exact plugin identities; updates also require the active source hash. Private plugin updates use the owner's exact installation identity. Installation results are read back by the persisted plugin identity.

`installSystemPlugin`, `updateSystemPlugin`, `uninstallSystemPlugin`, and `reconcilePluginInstallations` retain system-only semantics used by active end-to-end callers.
