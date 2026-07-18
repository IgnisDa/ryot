# Make Youtubei and Approved Dependencies Replay-Safe

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

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

- [ ] `@ryot/sandbox-sdk/youtubei` owns the supported injected fetch adapter and its private Promise
      runtime interop.
- [ ] The media plugin no longer implements its own privileged host-to-fetch transport.
- [ ] Approved dependency `Date`/random behavior is deterministic and reset for every replay.
- [ ] Direct authored ambient time/randomness remains rejected at compile time and runtime.
- [ ] Youtubei recreates identical request/session inputs after replay without serializing its client.
- [ ] Multiple sequential internal fetches resume from recorded durable HTTP responses.
- [ ] A caught/transformed internal pending error cannot produce a false Youtubei failure or success.
- [ ] The approved dependency audit and focused regression tests cover every SDK-exported dependency.
- [ ] The Youtubei tracer passes forced backend/sandbox interruption tests.
- [ ] The post-tracer benchmark is recorded; any guardrail miss is optimized or owner-waived in the
      Phase 1 plan before Task 04 starts.

## User stories addressed

- User story 2
- User story 3
- User story 6
- User story 8
- User story 12
- User story 13
