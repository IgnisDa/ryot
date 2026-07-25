# Make Youtubei and Approved Dependencies Replay-Safe

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Complete the mandatory Youtubei tracer and approved-dependency audit from Phase 1 sections 1 and 5.
Move the generic fetch-to-`host.httpCall` adapter currently owned by the media plugin into
`@ryot/sandbox-sdk/youtubei`. Keep privileged `Effect.runPromise` and pending propagation private to
the SDK adapter while ordinary plugin code receives only the replay-safe Effect surface.

Install deterministic dependency globals using persisted execution time and replay-stable seeded
randomness, reset them for every replay, and keep authored ambient time/randomness compiler errors.
Reconstruct the Innertube client on every replay; do not serialize client state. Audit every approved
SDK dependency for hidden I/O, clocks, randomness, process-global cache, workers, dynamic loading,
and import-time effects. Prove sequential internal Youtubei fetches survive forced interruption.

## Acceptance criteria

- [x] `@ryot/sandbox-sdk/youtubei` owns the supported injected fetch adapter and its private Promise
      runtime interop.
- [x] The media plugin no longer implements its own privileged host-to-fetch transport.
- [x] Approved dependency `Date`/random behavior is deterministic and reset for every replay.
- [x] Direct authored ambient time/randomness remains rejected at compile time and runtime.
- [x] Youtubei recreates identical request/session inputs after replay without serializing its client.
- [x] Multiple sequential internal fetches resume from recorded durable HTTP responses.
- [x] A caught/transformed internal pending error cannot produce a false Youtubei failure or success.
- [x] The approved dependency audit and focused regression tests cover every SDK-exported dependency.
- [x] The Youtubei tracer passes forced backend/sandbox interruption tests.
- [x] The post-tracer benchmark is recorded; any guardrail miss is optimized or owner-waived in the
      Phase 1 plan before Task 04 starts.

## Implementation notes

- `@ryot/sandbox-sdk/youtubei` now owns the injected fetch adapter, client construction, private
  Promise runtime bridge, and pending-signal preservation. Media scripts pass their host to this
  supported surface instead of implementing privileged transport.
- The runner scopes deterministic `Date`, `Math.random`, `crypto.randomUUID`, and
  `crypto.getRandomValues` to approved dependency calls. It seeds them from trusted workflow or
  execution identity, resets the sequence for each runner invocation, and restores ambient globals
  afterward. Authored ambient nondeterminism remains blocked by compiler and runtime guards.
- Youtubei clients are reconstructed from execution inputs on every replay. No client or dependency
  cache is serialized, and each sandbox replay runs in a fresh process.
- The forced-replay tracer removes the Redis replay projection after the first Youtubei HTTP request,
  then proves the two sequential calls complete from the durable workflow journal without repeating
  the first request. Its deliberately caught pending failure still suspends instead of becoming a
  terminal result.

## Approved dependency audit

| Dependency      | Audit result                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Effect          | SDK surface remains local. Authored Clock and Random access is compiler- and runtime-rejected.                                                                     |
| Cheerio         | Local HTML parsing only; no hidden I/O, clock, randomness, worker, dynamic loading, or mutable process cache.                                                      |
| Youtubei        | The only I/O-bearing dependency. HTTP is injected through `host.httpCall`; time and randomness are scoped deterministically, and the client is rebuilt per replay. |
| fflate          | Local compression only. `gzipSync` defaults its timestamp to zero while preserving an explicit caller value.                                                       |
| Papa Parse      | Local CSV parsing only; no hidden I/O or nondeterministic runtime behavior.                                                                                        |
| fast-xml-parser | Local XML parsing only; no hidden I/O or nondeterministic runtime behavior.                                                                                        |

Focused SDK tests exercise every approved dependency. Backend integration tests additionally prove
the exact-version read-only runtime bundles, deterministic Youtubei session randomness across fresh
runner invocations, and the existing authored ambient-time/random rejection paths.

## Verification

- `bun turbo --filter=@ryot/sandbox-sdk check`
- `bun turbo --filter=@ryot/sandbox-sdk test`
- `bun turbo --filter=@ryot/media-plugin check`
- `bun turbo --filter=@ryot/media-plugin test`
- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/durable-tracer.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/youtubei-tracer.test.ts'`
- `RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/sandbox-runtime-benchmark.test.ts'`

The benchmark recorded Youtubei p95 at `410 ms` versus the `430 ms` baseline and bounded population
p50 throughput at `1.247` items/s versus `1.524` items/s. No Phase 1 review guardrail triggered; the
authoritative plan contains the complete comparison.

## User stories addressed

- User story 2
- User story 3
- User story 6
- User story 8
- User story 12
- User story 13
