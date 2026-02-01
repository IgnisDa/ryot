# Test Support Module

This module exposes admin-gated operations used only by the end-to-end suite. It composes the services that own each table and must never introduce direct table writes or parallel repositories.

`setEntityInterest` delegates to `InterestService.setInterest` to register an authenticated test stream without running reconciliation. This lets tests observe externally triggered population without declaration dispatching its own ensure-mode population.
