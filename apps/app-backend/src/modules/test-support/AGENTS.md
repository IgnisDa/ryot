# Test Support Module

This module exposes admin-gated operations used only by the end-to-end suite.

`setEntityInterestMembership` delegates to `InterestService.setEntityInterestMembership` to register an authenticated test session without running reconciliation. This lets tests observe externally triggered population without membership changes dispatching their own ensure-mode population.

TODO(plugins): `installSystemPlugin`, `listSystemPlugins`, and `uninstallSystemPlugin` are test-only replacements for the administrator plugin endpoints that `/plugins` no longer provides; they drive system-scoped ingestion directly. Task 11 should consider gating this whole module behind configuration.
