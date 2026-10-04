# Security Review Dispositions

A pre-approval security review produced these findings.

| Finding                                                           | Disposition | Owner                                       |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------- |
| `deno_web` globals reach unmetered native memory and shared state | FIX         | Sidecar isolate surface, S1                 |
| Execution identity and `BridgeService` checks unspecified         | FIX         | Backend host-call gate, S2                  |
| Granted-path file access unenforced                               | FIX         | File access in the backend, S2              |
| Sidecar OS confinement unspecified                                | FIX         | OS confinement, S1 and S2                   |
| Cross-user exposure in a shared user tier                         | FIX         | Residual risk accepted with mitigations, S1 |
| No wall-clock deadline                                            | FIX         | Sidecar limits, S1; backend backstop, S2    |
| Protocol framing, attribution, and backpressure                   | FIX         | Protocol, S1                                |
| Crash attribution and quarantine                                  | FIX         | Culprit reporting S1; supervisor S2         |
| S2 had no admission bound                                         | FIX         | S2                                          |
| Unrouted `console` methods reach shared stderr                    | FIX         | Sidecar isolate surface, S1                 |
| Crash-resistance probes                                           | FIX         | S1 acceptance                               |
| Tier routing must come from the execution principal               | FIX         | Trust tiers, S2                             |
| Snapshot digest, module hashes, stack sanitization                | FIX         | Sidecar limits and lifecycle, S1; S2        |
| OS-backed randomness and per-isolate reseeding                    | FIX         | Sidecar isolate surface, S1                 |
| Shared V8 platform threads escape CPU metering and priority       | FIX         | Admission inside the sidecar, S1            |
| Inline settlement must stay synchronous                           | FIX         | Backend changes, S2                         |
| Journal and run frame outside the memory budget                   | FIX         | Backend changes, S2                         |
| Rule for grant-carrying executions                                | FIX         | Backend changes, S2                         |
| Memory growth over time                                           | FIX         | Recycling, S1                               |
| Per-tenant fairness for global HTTP admission                     | FIX         | S3                                          |
| One connection's large frames block others                        | FIX         | Protocol chunking, S1                       |
| Fairness gaming with many accounts where signup is open           | DEFER       | Open Risks                                  |
| Repeated exploit attempts against one long-lived memory layout    | FIX         | Recycling, S1                               |
| Host-call latency as a cross-tenant timing signal                 | FIX         | Coarse timers, S1                           |
| macOS development has no seccomp or Landlock                      | DEFER       | OS confinement; production fails closed     |
