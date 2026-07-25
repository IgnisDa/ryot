# Phase 2 - Global Provider Rate Limiting

Status: done (completed 2026-08-07). Phase 1 is complete, and the focused, benchmark, hermetic E2E,
and standard-suite Phase 2 gates passed with live-provider smoke excluded as documented.

Goal: trusted installed plugins declare deployment-global request limits for external provider
origins, and the sole durable HTTP executor enforces those limits across users, workflows, scripts,
and backend instances. Waiting and 429 recovery suspend workflows durably without holding sandbox
processes or bridge sessions.

Explicitly not in this phase: tenant fairness, interactive priority, reserved capacity, endpoint
weights, configurable bursts, provider-specific adaptive headers, integration/notification delivery
limits, exactly-once external mutation delivery, or another queue/rate-limit library.

Read `00-overview.md` and the completed Phase 1 plan first. Phase 2 must modify admission around the
existing durable HTTP request; it must not change the plugin `host.httpCall` API or restore direct
bridge execution.

## 1. Plugin Policy Contract

Add a top-level plugin manifest section for HTTP rate-limit declarations. Derive its TypeScript type
from Effect Schema and keep it strict.

The minimum shape is conceptually:

```ts
{
  key: "anilist",
  origins: ["https://graphql.anilist.co"],
  requests: 90,
  intervalMs: 60_000,
}
```

Required validation:

- non-empty globally stable key;
- at least one normalized HTTP(S) origin with no path, query, fragment, credentials, or wildcard;
- positive integer request count and interval;
- no duplicate keys or origins inside one plugin;
- identical declarations from multiple installed plugins are accepted;
- differing declarations sharing a key or origin reject the prospective plugin snapshot;
- manifest updates validate the complete prospective policy set under the existing plugin
  ingestion lock and commit it atomically with the plugin manifest;
- rate policies contain no user, script, provider-row, credential, or endpoint-operation scope.

The policy is matched globally by normalized request URL origin. Scripts do not opt into or name the
policy at each call. This ensures AniList anime, manga, person, import, and search traffic shares one
bucket even though the application has several logical providers and script roles.

Add declarations only for external provider APIs with known global limits. Do not add entries for
Plex, Jellyfin, Radarr, Sonarr, notification delivery, or arbitrary integration endpoints merely
because they use HTTP.

Implementer decision: the first-party catalog declares exactly AniList at 90 requests per minute for
`https://graphql.anilist.co` and MusicBrainz at one request per second for
`https://musicbrainz.org`. Cover Art Archive and every other origin remain unmatched.

## 2. Authoritative Policy Resolution

Extend plugin validation and process-local snapshots with normalized origin/key lookups, but use the
active plugin manifests in PostgreSQL as the admission authority. Existing plugin invalidation is
asynchronous, so a process-local snapshot alone could miss a newly constrained origin and execute it
unthrottled.

Resolve every newly observed durable HTTP origin through a short repository activity against the
authoritative manifests. Return either a proven-unmatched result or the canonical active declaration
plus a stable hash of that declaration. Process-local lookups may optimize validation/display but
cannot authorize an unmatched request. The plugin-manifest transaction commit is the sole policy
activation point; Redis stores no second policy catalog that must be atomically activated with it.

This lookup also permits proven-unmatched trusted integration destinations to continue while Redis
admission is unavailable. A matched provider call still waits for Redis coordination to recover.

Required behavior:

- installation/reingestion validates and commits one prospective policy set under the existing
  ingestion lock before exposing the corresponding process-local plugin snapshot;
- Redis invalidation still rebuilds process-local plugin snapshots, but HTTP enforcement remains
  correct while an instance catches up because classification reads PostgreSQL;
- a request resolves the live active policy before reservation and re-resolves it after a durable
  wait;
- running workflows do not pin rate policies;
- unmatched origins proceed directly to the durable HTTP activity;
- provider policy matching does not restrict trusted integration calls to private or undeclared
  destinations;
- uninstall/update refuses any conflicting prospective policy state but does not preserve an old
  policy solely because a workflow once used it.

Keep policy resolution generic. The kernel must not contain AniList/TMDB-specific branches.

## 3. Distributed Admission Service

Add one generic backend infrastructure service that atomically reserves the next permitted time for
a policy key in Redis using an evenly spaced leaky-bucket/GCRA schedule.

For a declaration of `requests / intervalMs`, the nominal spacing is `intervalMs / requests`.
Reservation returns a token containing the absolute eligible time and active declaration hash, and
updates global state atomically so concurrent backend instances cannot receive the same slot.

State requirements:

- namespace admission by deployment's existing Redis prefix plus policy key;
- store only operational schedule/blocked-until data, not user or request payloads;
- use server-consistent time suitable for atomic Redis coordination rather than trusting plugin or
  sandbox clocks;
- support an atomic blocked-until advance for 429 handling;
- support an atomic reservation confirmation that compares the token's declaration hash and checks
  the latest blocked-until value without consuming another GCRA slot;
- tolerate duplicate reservation attempts conservatively;
- never reclaim an abandoned reservation;
- expire idle keys after a safe multiple of the declaration interval without affecting active
  blocked state;
- expose typed unavailable/corrupt-state failures to workflow code;
- fail closed when Redis is unavailable.

Implementer decision: use Redis Lua `EVAL`, with `TIME` read inside the script so classification does
not trust an application clock. Each prefixed policy key is a hash containing declaration hash `h`,
next eligible timestamp `n`, and blocked-until timestamp `b`. Its base TTL is
`max(10 * intervalMs, 60 seconds)` and is extended past a future blocked-until timestamp. Reservation,
confirmation, block advancement, state validation, and expiry refresh are atomic in that script. No
third-party rate-limit or job-queue library is used.

## 4. Durable HTTP Admission Flow

Wrap the Phase 1 durable HTTP executor with this sequence:

1. Resolve the request URL against authoritative PostgreSQL plugin manifests in a short activity.
2. If unmatched, execute the Phase 1 HTTP activity immediately.
3. If matched, ask the admission service for an eligible timestamp.
4. If the timestamp is in the future, call `DurableClock.sleep` using a deterministic name derived
   from the durable HTTP call identity.
5. After resume, re-resolve the live declaration from PostgreSQL. If its hash changed or the origin
   became unmatched, discard the old reservation and follow the new classification. Otherwise,
   atomically confirm the reservation against its declaration hash and current Redis blocked-until
   value without consuming another slot. If blocked-until advanced after reservation, durably sleep
   until the returned later timestamp and repeat resolution/confirmation. Abandoned old slots are
   not reclaimed.
6. Execute one bounded HTTP network attempt as an activity whose deterministic identity contains
   both the parent durable HTTP call index and a monotonically increasing attempt number.
7. Persist its success or non-rate-limit typed failure through the Phase 1 journal.

No rate wait happens inside:

- the Deno sandbox process;
- the loopback bridge session;
- the HTTP network-attempt timeout;
- a database transaction;
- an Effect workflow activity body using ordinary sleep.

The network attempt retains Phase 1 request/response limits, TLS behavior, private destination
support, and at-least-once external mutation contract.

### Coordination retries

PostgreSQL policy lookup and Redis reservation, confirmation, and blocked-until updates execute as
short workflow activities. A coordination failure is not the terminal HTTP result and is not
retried by sleeping inside an activity. The workflow durably sleeps with a bounded infrastructure
backoff, increments a deterministic coordination-attempt counter, and invokes a newly named
activity. This avoids replaying one persisted failed activity forever and does not occupy a worker
while coordination is unavailable.

Implementer decision: coordination starts with a deterministic one-second durable backoff, doubles
after each consecutive failure, and is capped at 30 seconds. Every retry receives a new deterministic
activity identity; a successful coordination call resets the failure streak.

## 5. 429 and Retry-After

The HTTP activity must preserve response headers on non-2xx failures so the workflow executor can
interpret generic rate-limit information.

For a policy-matched `429`:

1. Parse `Retry-After` as delta seconds or HTTP date.
2. If valid, atomically advance the policy's global blocked-until time to at least that timestamp.
3. If absent or invalid, advance blocked-until by the declaration's full `intervalMs` from the
   response time, not merely by the per-request GCRA spacing.
4. Durably sleep and retry under the same parent durable HTTP call identity but a new deterministic
   network-attempt identity (`attempt + 1`), so the workflow engine does not replay the persisted
   429 activity result forever.
5. Continue without a fixed attempt count while the parent workflow remains active.

Do not journal intermediate 429 responses as the call's terminal failure. Cancellation ends the
retry loop. Non-429 HTTP errors, invalid request errors, response-limit failures, and exhausted
network-attempt behavior become normal durable failures and replay to plugin code.

MusicBrainz can return HTTP `503`; this is a normal non-`429` failure and is not retried
automatically. Generic automatic recovery is only for policy-matched HTTP `429`; unmatched failures
and all other status failures receive no automatic retry.

Do not parse or adapt to provider-specific remaining/reset headers in this phase.

## 6. Cancellation, Policy Changes, and Recovery

- Cancelling the parent prevents future reservations/network attempts for that durable call.
- Already-running network attempts may finish; their result is ignored if the workflow is terminal.
- Reserved slots are not reclaimed.
- Plugin policy changes affect the next reservation immediately.
- Complete Redis admission-state loss can forget reservations and admit early after recovery;
  configure the existing Redis durability appropriately and rely on generic 429 handling to restore
  blocked state when upstream detects the lost schedule. It must never cause the workflow to fail
  solely because the sandbox execution timeout elapsed.
- Redis unavailability does not affect authoritative PostgreSQL classification: proven-unmatched
  calls continue, while matched calls suspend/retry coordination with incremented activity
  identities and never execute unthrottled.
- Backend/workflow restarts reconstruct waiting work from authoritative workflow state and durable
  clock/activity records.
- Multiple server instances share the same Redis admission key and cannot maintain independent
  in-memory buckets.

## 7. Observability

Add bounded backend observability for:

- policy key/origin;
- reservation wait duration;
- immediate versus delayed admission;
- 429 count and selected retry timestamp;
- coordination failure/recovery;
- cancellation before admission;
- network-attempt duration after admission.
- authoritative policy-resolution and Redis-admission duration, correlated by sandbox workflow
  execution ID.

Never attach request headers, bodies, credentials, full URLs with sensitive query strings, user IDs,
or response bodies. Observability must not become correctness state.

Do not add fairness/priority metrics that imply unsupported scheduling guarantees.

## 8. Tests and E2E

### Performance checkpoint

Re-run the Phase 1 hermetic provider benchmark for both an unmatched origin and a matched request
that receives immediate admission. Report policy-resolution, Redis-admission, durable-activity, and
total orchestration time separately; exclude intentional GCRA/429 wait from regression arithmetic.
An added p95 orchestration cost greater than `1 second` triggers review. This is deliberately lax and
may be accepted by the owner with the measured result and rationale recorded here. Delayed calls are
judged by accuracy of their scheduled wait and by holding no sandbox/worker resource, not by being as
fast as unrestricted calls.

The benchmark remains intentionally log-correlated rather than adding timing storage, an endpoint, or
test-support log plumbing. Backend records keyed by `sandboxWorkflowExecutionId` separately emit
authoritative policy-resolution, Redis-reservation, and durable-network-activity `durationMs`; the
benchmark summary separately reports total orchestration for matched-immediate and unmatched runs.
Exact automated aggregation of the three activity timings is therefore unavailable in the benchmark
JSON and must be derived from emitted backend logs for the recorded run.

### Phase 2 benchmark rerun (2026-08-07)

Run on the Phase 1 baseline Apple M4 host with Bun 1.3.14, three warm-ups, and 15 measured samples:

```bash
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

The command passed after the Redis `observedAtMs` clock-source fix. The controlled provider used two
sequential 25-ms local requests. Its unmatched total orchestration was 348/453 ms p50/p95. The matched
fast-policy workload was 377/553 ms, an added 100-ms p95 below the one-second review threshold.

| Workload                         | Policy resolution p50 / p95 | Redis reservation p50 / p95 | Network activity p50 / p95 | Total orchestration p50 / p95 |
| -------------------------------- | ---------------------------: | ---------------------------: | ----------------------------: | -----------------------------: |
| Unmatched controlled local origin |                     5 / 9 ms |                          n/a |                    31 / 45 ms |                   348 / 453 ms |
| Matched fast-policy local origin  |                     5 / 8 ms |                     1 / 4 ms |                    32 / 39 ms |                   377 / 553 ms |

The activity percentiles were derived from emitted safe timing records. Policy and reservation logs
are replay-tagged and can repeat, so those distributions cover emitted records rather than unique
logical calls. The unmatched network records also include the Youtubei workload because both used the
same unmatched controlled origin and the safe log contract intentionally omits script identity; its
total orchestration column remains the exact controlled-provider summary.

Immediate admission is verified for this run: all 90 emitted matched reservation records across 18
workflow executions, including warm-ups and replay-tagged repeats, reported `status=immediate` and
`waitMs=0`. No intentional GCRA or `429` wait is included in the matched timing comparison.

### Phase 2 verification (2026-08-07)

- Plugin-kit, media, fitness, backend, sandbox SDK, sandbox compiler, and tests package checks passed.
- Their affected unit/integration suites passed; the complete backend suite passed 19 Turbo tasks.
- `global-provider-rate-limiting.test.ts` passed all four hermetic cases separately, including real
  container-backed Redis coordination across two backend processes and restart recovery.
- The standard discovered `tests/` suite passed all 22 Turbo tasks with
  `providers-live-smoke.test.ts` explicitly excluded. This workspace's local environment opts into
  live smoke, so exclusion preserves the documented standard-suite boundary rather than treating
  external provider availability as a Phase 2 prerequisite.
- The benchmark command above passed and stayed below the one-second added-p95 review threshold.
- The required codebase cleanup pass completed before the final verification runs.

### Unit and backend integration tests

Cover:

- manifest normalization and every invalid/conflicting policy shape;
- identical declarations accepted across plugins;
- origin matching and unmatched pass-through;
- exact global spacing under concurrent reservations;
- reservations from multiple service instances sharing Redis;
- abandoned reservations not reclaimed;
- live policy update while a workflow waits;
- reservation confirmation delayed by a later blocked-until update without consuming another slot;
- authoritative declaration-hash changes and process-local snapshot lag;
- Redis outage using PostgreSQL to pass proven-unmatched calls while matched calls wait;
- coordination failure followed by durable backoff and a new deterministic activity attempt;
- cancellation before and during wait;
- valid delta/date `Retry-After`, malformed fallback, and blocked-until monotonicity;
- repeated 429 followed by success with no fixed attempt cap;
- non-429 failure replayed once;
- no sandbox process/bridge session retained during wait;
- no transaction spans reservation, sleep, or HTTP;
- sensitive HTTP data absent from rate-limit state and logs.

Use real time for integration tests that exercise Effect durable workflow behavior; do not use a
test clock where the existing workflow test harness requires live timing.

### `tests/` E2E

Add hermetic E2E coverage using a runtime-installed test plugin and controlled HTTP endpoint. Generic
platform behavior belongs under `tests/src/tests/kernel/sandbox/`; plugin-specific declaration
fixtures belong with existing plugin fixtures.

Required E2E cases:

1. Install a plugin declaring one constrained origin.
2. Start provider operations under separate users concurrently.
3. Observe the controlled endpoint and prove requests share one deployment-global schedule.
4. Prove all async jobs eventually complete with their expected provider results.
5. Return 429 plus `Retry-After`, prove the job remains pending, then succeeds without a sandbox
   timeout failure.
6. Restart/recover the relevant backend/workflow path while requests wait and prove continuation.
7. Prove an unmatched trusted integration-style destination remains unrestricted.
8. Attempt conflicting plugin installation and prove atomic rejection without changing the active
   policy.

Do not use a live provider for standard rate-limit E2E. Keep existing live-provider smoke opt-in.
Run each affected/new standard E2E file separately, then the standard discovered suite according to
`tests/README.md`.

## 9. Documentation and Cleanup

- Document the manifest policy schema in plugin-kit/plugin authoring documentation.
- Document global scope, static declaration semantics, no fairness guarantee, live updates, and
  generic 429 behavior.
- Update sandbox runtime documentation with the exact durable admission sequence and storage
  ownership.
- Remove temporary test-only limiter adapters and any direct/uncoordinated provider bucket.
- Search for provider-specific sleeps/retries that became redundant; remove only behavior proved
  superseded by global admission.
- Keep integration/notification behavior outside the limiter documented accurately.
- Run the `codebase-cleanup` skill over changed code and directly affected modules before the phase
  gate.

## Done Criteria

1. Installed plugin manifests can declare strict, validated global origin policies.
2. Conflicting declarations reject atomically; identical declarations coexist.
3. All policy-matched HTTP calls across users/scripts/backend instances share one Redis schedule.
4. Waiting uses durable workflow sleep and holds no sandbox process, bridge session, transaction, or
   network attempt.
5. Generic `Retry-After` 429 handling waits and retries the same durable call until success or
   cancellation.
6. Redis coordination failure never causes unthrottled provider calls.
7. Unmatched trusted integration destinations remain available and receive no new automatic
   business retry.
8. Unit/integration concurrency, recovery, cancellation, and redaction tests pass.
9. Immediate-admission and unmatched-origin benchmark results add no more than the permissive
   one-second p95 review threshold, or an owner-approved waiver and rationale are recorded.
10. Required hermetic `tests/` E2E cases pass individually and in the standard suite.
11. Backend, SDK, plugin-kit, plugin, and tests package checks/tests pass.
12. Documentation describes the implemented static global limiter and does not promise fairness or
    adaptive quotas.
13. No provider-specific limiter branch or third-party scheduling framework exists.

## Stop Conditions

Stop and ask the owner if implementation discovers:

- a provider requires more than one simultaneous quota dimension to avoid failure;
- a required API cannot be classified by normalized origin;
- a provider performs non-idempotent mutations on an origin declared as retryable provider traffic;
- Redis cannot provide atomic shared admission with the existing infrastructure;
- a 429 response cannot expose retry headers through the durable HTTP failure contract;
- waiting still occupies a sandbox process or activity worker;
- standard E2E would require live provider availability;
- fairness or priority becomes necessary to satisfy an existing product contract;
- any need to change the Phase 1 script-facing host API.
