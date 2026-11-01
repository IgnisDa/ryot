# Work reduction

Working notes for the performance program that follows the V1 → V2 port. Goal: the same product
behavior with far less work per operation, so the e2e suite gets fast and stable under its own load,
and the operational gates finish within budget.

Starting hypothesis (owner's): the sandbox runtime is no longer the bottleneck; too much work happens
outside it, in the kernel's durability, planning, and bookkeeping layers.

## Environment

- Benchmark VM: `tmp/server.ip` (Hetzner, AMD EPYC-Genoa, 4 vCPU, 7.6 GiB RAM, no swap, Ubuntu 26.04,
  Linux 7.0). Dedicated to this work; it can be wiped.
- Toolchains: Bun 1.4.4 (`/opt/bun`), Rust 1.93.1, Node 24.22.1, Docker. The e2e harness requires
  UID/GID 1001 on Linux, so everything runs as `ryot-backend` (1001) and the native sandbox is
  root-provisioned with `kernel/sandbox/native/provision.sh`.
- Checkout: `/opt/ryot/src` (a mirror of this worktree, not a git repository). Results:
  `/opt/ryot/results/<run-id>/`.
- Tests never run locally (local load causes flakiness); checks can.

## Tooling (`scripts/`)

| Script | Where | Purpose |
| --- | --- | --- |
| `vm-provision.sh` | VM, root, once | Packages, user 1001, toolchains, sysctls. |
| `vm-sync.sh` | local | Mirror non-ignored files to the VM and `bun install`. |
| `vm-build.sh` | VM, root, systemd | Build e2e artifacts as 1001, provision the native sandbox, install Chromium. |
| `vm-e2e.sh ID [files]` | VM, root, systemd | One measured e2e run: vitest JSON, pg_stat_statements of the shared database, OTEL span metrics, vmstat/docker/ps samples, server and PostgreSQL logs. |
| `pgwatch.sh`, `analyze.py`, `otel/collector.yml` | VM / local | Adopted from the earlier perf audit (`tmp/perf-audit`). |

Long jobs always run as `systemd-run --unit=ryot-<name> --collect …` so a dropped SSH session loses
nothing. Observe with `systemctl status` / `journalctl -u`.

## Strategy

1. **Baseline.** Whole standard suite on the VM with instrumentation. Per-file and per-test wall time,
   failures, database statement counts and time, span metrics, host CPU/memory saturation.
2. **Flow probes.** Run single representative flows on an idle server and measure their cost:
   signup and user bootstrap, one event create (no hooks / with hooks / with projection), entity
   population from a provider, import of N items, a 101-set workout, backup round trip. For each:
   latency, statements, transactions, durable workflows/activities (cluster message rows), sandbox
   executions, and time spent waiting (polling, durable clocks, reconciler ticks) versus working.
3. **Attribution.** Split time and resources into sandbox, database, kernel CPU, and idle waits;
   rank design-level causes by measured share.
4. **Redesign slices.** Each slice states the expected effect, is measured before/after with the
   same probes, and keeps product behavior.

## Log

See [`log.md`](log.md).
