# Test Support Module

This module exposes admin-gated operations used only by the end-to-end suite.

`setEntityInterestMembership` delegates to `InterestService.setEntityInterestMembership` to register an authenticated test session without running reconciliation. This lets tests observe externally triggered population without membership changes dispatching their own ensure-mode population.

`installSystemPlugin`, `uninstallSystemPlugin`, and `reconcilePluginInstallations` retain system-only semantics used by active end-to-end callers.
