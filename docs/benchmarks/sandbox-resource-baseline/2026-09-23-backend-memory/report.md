# Backend idle memory and post-import growth

## Status

**Complete.** Settled idle memory of the Bun backend on the benchmark VM fell from 424 to
362 MiB after GC (−62 MiB, −15%). The trusted sandbox runtime payload and the email stack no
longer load at boot, and the server bundle is split so they stay out of the resident entry chunk.
The saving persists through imports: after 6 waves of 20 imports the backend holds 697 MiB after
GC, against 761 MiB on the baseline.

Post-import growth is bounded and is not a JS heap leak. After every drained wave, the GC'd JS
heap and external memory return to the same values. The growth is native memory outside the
heap, from two sources:

- JIT-compiled code, which is retained for the process lifetime;
- allocator pages pinned by scattered surviving objects.

Both grow by smaller amounts each wave, and neither is owned by Ryot code.

- Baseline: `325c0c6f3d`, image
  `ghcr.io/ignisda/ryot@sha256:b7058226b70c8b093df0b292cadfd3bc291c711739c2f3c813f26b165e84ddab`.
- Candidate: `468aedcbd5`, image
  `ghcr.io/ignisda/ryot@sha256:92817c7d9341100b694da9c43d613330272266af8ba63306ed35e5f8c3bf4c74`.
  The change is in commit `40709f2750`.

## Memory states

Every figure is the backend process only, from `/proc/self/smaps_rollup`. PostgreSQL (≈ 61 MiB
idle) and Redis (≈ 7 MiB idle) are separate containers and are reported separately.

"After GC" means a checkpoint taken right after `Bun.gc(true)`. It is a measurement aid only; no
production path forces GC.

| State             | Definition                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Module evaluated  | `dist/main.js` imported with unreachable DB/Redis, measured at process exit              |
| First boot        | Empty database: migrations, plugin ingestion, runtime materialization, 60 s after health |
| Idle, disabled    | Restarted with `SCHEDULER_DISABLE_DISPATCHERS=true`, 10 min after health                 |
| Idle, enabled     | Restarted with dispatchers enabled, 10 min after health                                  |
| Post-wave settled | After a wave of 20 standard imports, drained (below), then 120 s                         |
| Recovery          | 15 min after the last wave                                                               |

A wave is **drained** only when all of these read zero:

- unprocessed `cluster_messages`;
- `automation_run` rows that are `queued` or `running`;
- `sandbox_workflow_reference` rows;
- `import_run` rows that are `pending` or `running`;
- live Deno processes (`activeProcessCount`).

Every wave in every run below drained; the drain records are in `raw/`. Waves ran with
dispatchers disabled, like earlier campaigns. Each standard import starts 110 Deno processes, so
a wave starts 2,200.

## Where idle memory goes

Local arm64 measurements: `ryot-mem` compose stack, same Dockerfile. Each variant `main.js` was
swapped into the same container and measured over 3 rounds. The standalone figures are the cost
of importing that module alone into bare Bun, so they overlap and do not add up.

| Component                                          | Cost                          | Evidence                                   |
| -------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| Bare Bun 1.4.0                                     | 16 MiB                        | empty script                               |
| Evaluating the 29 MB `main.js`                     | 430–470 MiB RSS               | module-evaluated state                     |
| – JSC Baseline JIT code for module initialization  | ≈ 150 MiB of the above        | `BUN_JSC_useJIT=false` A/B                 |
| – JS heap / external at that point                 | 107 / 68 MiB                  | `heapStats`                                |
| Sandbox runtime payload literal (13 MB of source)  | ≈ 40 MiB                      | payload stub variant                       |
| `@react-email/components` + template               | +67 MiB standalone            | isolated import                            |
| `nodemailer`                                       | +21 MiB standalone            | isolated import                            |
| `better-auth`                                      | +46 MiB standalone            | isolated import                            |
| `effect/unstable/httpapi`                          | +80 MiB standalone            | isolated import                            |
| Scalar API reference (`/docs`)                     | ≈ 7 MiB, within noise        | `ScalarLive` removed from a `both` variant |
| Plugin ingestion and kernel-script compile at boot | +40 MiB (+10 of it compiling) | boot trace                                 |
| Dispatchers enabled vs disabled, same fixture      | +8 MiB local, none on the VM  | idle states (below)                        |

The heap itself holds code structure: about 210,000 `Function` objects and 1.0M objects in
total after GC. A catalog of module-level maps, caches, pools and queues found no unbounded
retention: each was bounded, scoped to a request or entity, or replaced rather than appended to.

**Dispatchers.** Historical reports showed dispatchers-enabled idle as 138 MiB higher. That
comparison mixed fixtures: the enabled state ran after a workload had populated the database.
With the same fixture on the VM, enabled at 5 min was 431 MiB and disabled 437 MiB. Enabling
dispatchers has no material idle cost.

## Changes

The two largest optional costs above are only needed on rare paths:

- the runtime payload repairs a missing or corrupt runtime directory;
- the email stack is used on SMTP notification delivery.

1. **Runtime payload loads only when repair is needed.**
   - The generator now also writes `runtime-payload-metadata.generated.ts`, which holds the
     content hash and file metadata.
   - Boot verifies the materialized directory against that hash, or finds a verified repair
     directory. It imports `runtime-payload.generated` only when neither exists
     (`kernel/backend/src/lib/infrastructure/sandbox-runtime/dependencies.ts`).
   - Previously the 13 MB literal was evaluated, schema-decoded and re-hashed on every boot, then
     kept reachable for the process lifetime.
2. **Email stack loads on first send.** `@react-email/components`, the transactional template
   and `nodemailer` are dynamic imports inside `NotificationMailer.send` and `sendEmail`
   (`kernel/backend/src/modules/notifications/delivery.ts`).
3. **Server bundle split.** `apps/server` builds with `bun build --splitting`. Without splitting,
   Bun inlines dynamic imports into the entry chunk and evaluates them at load. The main chunk no
   longer contains the payload or the email stack. The scripts build is unchanged.

### Local results (settled idle, dispatchers disabled, 3 rounds, MiB)

| Variant                         | Settled RSS |  After GC | Heap after GC | External after GC |  Δ settled |
| ------------------------------- | ----------: | --------: | ------------: | ----------------: | ---------: |
| Baseline                        |       608.8 |     592.1 |         101.5 |              44.1 |          — |
| Lazy payload, no split          |       591.3 |     578.9 |          78.4 |              20.7 |      −17.5 |
| Lazy payload, split             |       563.6 |     546.1 |          76.8 |              19.9 |      −45.2 |
| Lazy payload + email, no split  |       545.2 |     536.0 |          72.8 |              18.8 |      −63.6 |
| **Lazy payload + email, split** |   **494.3** | **486.4** |      **72.6** |          **19.2** | **−114.5** |

Module-evaluated memory fell from ≈ 430 to 270–286 MiB.

The measured variants overlap. The email stack and the payload each account for part of the
saving, and splitting stops them from being evaluated inside the entry chunk.

### VM results (2 vCPU / 4 GB, OTLP export off, MiB)

| State                            | Baseline | Candidate |     Δ |
| -------------------------------- | -------: | --------: | ----: |
| First boot (empty DB)            |    680.6 |     703.4 | +22.8 |
| Restart boot, disabled           |    503.2 |     430.1 | −73.1 |
| Idle, disabled, 10 min           |    426.4 |     365.1 | −61.3 |
| Idle, disabled, 10 min, after GC |    424.2 |     362.1 | −62.1 |
| Restart boot, enabled            |    496.3 |     385.8 | −110.5 |
| Idle, enabled, 10 min            |    433.0 |     360.8 |  −72.2 |
| Idle, enabled, 10 min, after GC  |    430.9 |     358.3 |  −72.6 |
| Pre-waves, after GC              |    454.3 |     352.0 | −102.3 |

First boot is the one state that rises. On an empty data directory the payload is imported to
materialize the runtime, and that happens during migrations and plugin ingestion.

### Behavior preserved

- **Repair path.** A deleted runtime directory is rebuilt from the lazily imported payload. This
  was verified on the split build: after deleting it, an import completed with 114 spawns.
- **Existing tests.** `dependencies.test.ts` covers cold, concurrent, warm-hash and tampered
  directory materialization; `delivery.test.ts` covers delivery.
- **Unchanged:** sandbox concurrency 2, the YTM optimization, and the workflow and deadlock
  fixes.

## Post-import growth

### Facts

VM backend RSS after GC following each drained wave (MiB). Heap and external are the baseline's:

| Point           | Baseline RSS | Heap used | External | Candidate RSS |
| --------------- | -----------: | --------: | -------: | ------------: |
| Pre-waves       |        454.3 |     101.1 |     44.2 |     352.0 |
| Wave 1          |        607.4 |     123.2 |     59.3 |      539.8 |
| Wave 2          |        644.2 |     123.8 |     59.8 |      580.7 |
| Wave 3          |        684.5 |     124.3 |     60.3 |      621.4 |
| Wave 4          |        709.4 |     124.1 |     60.1 |      661.2 |
| Wave 5          |        732.9 |     124.2 |     60.1 |      678.3 |
| Wave 6          |        760.8 |     124.1 |     60.1 |      697.3 |
| Recovery 15 min |        746.3 |     123.5 |     60.2 |     687.9 |

- **The JS heap and external memory are flat.** After wave 1 they read 124 ± 1 and 60 ± 1 MiB
  after every wave, with the same object count (≈ 1.08M). Nothing reachable accumulates across
  waves.
- **RSS growth is anonymous native memory.** The file-backed part stays at 67–69 MiB throughout.
- **Growth by wave:** a one-time step in wave 1 (+153 MiB), then +37, +40, +25, +24 and +28 MiB
  per 2,200 spawns.
- **Recovery:** 15 minutes idle returns 15 MiB.
- **Peak:** the highest cgroup reading during the waves was 1.22 GB, including page cache. The
  highest `docker stats` readings were 1,002 MiB for the backend and 1.35 GB for the whole stack.
- **Candidate:** the idle saving persists through imports. The candidate stays 63 MiB below the
  baseline after wave 6 and 58 MiB below after recovery. Its heap and external memory after GC
  read 94 ± 2 and 35 ± 2 MiB after every wave, 30 and 25 MiB below the baseline, because the
  runtime payload and the email stack never load. Growth has the same shape: +188 MiB in wave 1,
  then +41, +41, +40, +17 and +19 MiB. Recovery returns 9 MiB.
- **Candidate peak:** 1.19 GB cgroup; `docker stats` 958 MiB for the backend and 1.29 GB for the
  stack.
- **Wave durations:** baseline 989–1,023 s (mean 1,003 s); candidate 1,014–1,079 s (mean
  1,040 s, +3.6%). The candidate ran second on the same VM, after the baseline.

### JIT A/B (local, 6 waves × 20, all drained, MiB after GC)

| Point     | JIT on |      Δ | JIT off (`BUN_JSC_useJIT=false`) |           Δ |
| --------- | -----: | -----: | -------------------------------: | ----------: |
| Pre-waves |  577.5 |        |                            399.6 |             |
| Wave 1    |  879.2 | +301.7 |                            507.3 |      +107.7 |
| Wave 2    |  964.8 |  +85.6 |                            516.1 |        +8.8 |
| Wave 3    |  985.4 |  +20.6 |                            523.8 |        +7.7 |
| Wave 4    | 1014.6 |  +29.2 |                            534.6 |       +10.8 |
| Wave 5    | 1027.7 |  +13.1 |                            537.9 |        +3.3 |
| Wave 6    | 1059.2 |  +31.5 |                            545.0 |        +7.1 |

With JIT off, the wave-1 step is 194 MiB smaller and later waves add a third as much or less. In
both runs heap and external memory after GC stay flat across waves: about 125 and 61 MiB with
JIT on, about 104 and 42 MiB with JIT off. Wave durations with JIT off ranged 511–1,361 s. The
long waves overlapped the spawn and churn reproductions below and are not a JIT-off timing
result.

### Isolated reproductions (Linux container, same image, bare Bun, RSS after GC)

| Reproduction                                                            | Result                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 6 × 2,200 `deno eval` spawns, raw `Bun.spawn` with piped stdio          | 35.8 → 45.3 after batch 1, then 45.2–46.0: flat              |
| Same through Effect `ChildProcess` + stream pipelines (as `runtime.ts`) | 35.3 → 69.0 after batch 1, then 72.8–78.3, 75.9 at end       |
| 8 cycles allocating 440 MiB of objects, all released                    | returns to 22 MiB (JIT off) / 38 MiB (JIT on) within 10 s    |
| Same, keeping 1% of each cycle's objects alive                          | 298 → 374 MiB after 10 s; +6–10 MiB per cycle, JIT on or off |

### Explanation

1. **JIT code (about two thirds of wave-1 growth).** JSC tiers hot import-path code (Effect
   fibers, schema codecs, SQL, HTTP) up to the DFG and FTL tiers. Compiled code and its metadata
   live in executable memory that JSC keeps for the process lifetime. The JIT-off A/B puts this
   at ≈ 194 MiB of the wave-1 step, plus part of each later wave as new paths warm up. This is
   the same upstream boundary as the Baseline JIT idle cost. It is not disabled in production,
   because interpreter-only execution trades memory for CPU on a 2 vCPU host.
2. **Allocator fragmentation (the rest).** During a wave the heap peaks at 220–290 MiB and falls
   back to ≈ 124 MiB after GC. The 1% survivor reproduction shows that a small number of
   scattered long-lived objects keeps most of a churned heap's pages resident in Bun's
   allocators. Long-lived state created during a wave does this: cluster entity state, pooled
   connections, and caches refilled mid-wave. The per-cycle growth falls as freed space is
   reused, matching the declining per-wave deltas.
3. **Process spawning is not the source.** Raw `Bun.spawn` is flat after warmup. The Effect
   process path levels off after a one-time ≈ 34 MiB warmup. Neither accounts for tens of MiB
   per wave.

## Facts, hypotheses, unresolved

**Facts**

- Idle backend RSS on the VM is 362 MiB after the change, down from 424 MiB.
- The saving persists under load: after 6 waves the candidate holds 697 MiB after GC, 63 MiB
  below the baseline.
- After a drain, the JS heap and external memory return to the same values after every wave.
- Post-import growth is anonymous native memory and grows more slowly each wave. It did not
  flatten within 6 waves (13,200 spawns).
- Disabling the JIT removes ≈ 194 MiB of the wave-1 step and most of the later growth.
- Process spawning alone does not grow memory beyond a one-time warmup.

**Hypotheses** (supported by the reproductions above, not proven inside Ryot)

- Growth that remains with JIT off comes from allocator pages pinned by scattered survivors of
  each wave's churn, and it is bounded by the size of the peak working set.
- Growth that remains with JIT on and is not explained by fragmentation is late tier-up of rarer
  code paths. It ends once the set of executed code stops growing.

**Unresolved**

- The long-run plateau. Six waves were not enough to show where growth stops. A 24-hour soak
  with mixed traffic would show whether native memory stops growing within one GB.
- Which allocator holds the pinned pages: JSC's libpas or Bun's mimalloc. A native heap profile
  (for example `heaptrack` against a debug Bun) was not taken.
- The candidate's 3.6% longer mean wave duration. The change touches no import-path code; the
  payload import runs only on runtime repair and the email stack only on delivery. Run order and
  VM variance were not separated, since a repeat baseline was not run.
- Whether `effect/unstable/process` stream pipelines keep the ≈ 30 MiB warmup permanently or
  lose it under memory pressure.

## Recommendation

**The remaining memory is bounded and acceptable for the 2 vCPU / 4 GB target.**

- **Idle:** the backend now settles at ≈ 362 MiB. With PostgreSQL and Redis, the stack stays
  under 450 MiB.
- **After 13,200 sandbox executions:**
  - The backend held ≈ 697 MiB after GC on the candidate (≈ 761 MiB on the baseline).
  - Per-wave growth was falling.
  - The highest cgroup reading, page cache included, was 1.19 GB (1.22 GB on the baseline). The
    whole stack peaked at 1.29 GB in `docker stats`, well inside 4 GB.
- **No Ryot-owned leak was found.** The remaining growth is at the JSC/Bun boundary.

Further idle reductions, measured and ranked by size, not implemented here:

1. **Stop the JIT from compiling boot-only code (≈ 150 MiB).** This needs upstream JSC or Bun
   support, since production JIT flags were ruled out.
2. **`effect/unstable/httpapi` (≈ 80 MiB standalone).** It is core to the server and not
   deferrable.
3. **`better-auth` (≈ 46 MiB standalone).** It is needed on the first authenticated request, so
   deferring it only moves the cost.
4. **Scalar `/docs` (≈ 7 MiB, within 3-round noise).** Not worth deferring.
5. **Migrations.** Their code could be deferred until a pending migration exists. The saving is
   small and was not measured separately.

## Method notes and limitations

- **Environment.** Both VM runs used the `ryot-benchmark` Coolify project, with OTLP export
  removed from the compose file and the database and Redis reset. After each run the backend was
  left stopped.
- **Same run sequence for both.** Each ran first boot, setup of the benchmark user and workload
  plugin, a disabled restart for 10 min, an enabled restart for 10 min, then a disabled restart
  and 6 waves of 20 imports with drain proof, and 15 min of recovery.
- **Image pull.** The candidate image was pulled on the VM during baseline wave 1. That wave's
  duration (1,023 s) is in line with the others (989–1,010 s), and memory is measured after the
  drain, so the wave is kept.
- **Probe and code.** The probe is `e2e/src/scripts/sandbox-resource-baseline/memory-probe.ts`.
  It uses the admin-gated `captureBackendProfile` and `sampleSandboxRuntime` endpoints. No
  instrumentation was added to source.
- **Local measurements** ran on macOS arm64 in Docker Desktop, with a different allocator page
  size and different absolute numbers than the VM. Only the differences between variants and
  JIT settings are used from them.
- **Single runs.** Each VM variant ran once. Idle differences are much larger than the
  checkpoint-to-checkpoint noise of ≈ 5 MiB. The per-wave deltas carry more noise.
- **Data.** Raw heap snapshots and profiles are not checked in. The `raw/` directory holds the
  probe's JSON lines, the `docker stats` lines, and the two churn reproduction scripts with
  their output. The spawn reproduction was a bundled one-off and only its output is kept.
