import { afterAll, assert, beforeAll, describe, expect, it as fullIt } from "@effect/vitest";

export { afterAll, assert, beforeAll, describe, expect };

type BannedItMethod = "effect" | "scoped" | "layer" | "prop" | "flakyTest";

/**
 * The only sanctioned runner surface for `tests/src/tests/**`. `it.effect` (and the other
 * TestClock-/per-file-layer-bearing variants) are withheld at the type level: `it.effect` installs
 * the Effect `TestClock`, which deadlocks the real-time waits these E2E suites depend on. Use
 * `it.live` (no `Scope`) or `it.scopedLive` (per-test `Scope` for `Effect.acquireRelease`).
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the third-party `it` to hide TestClock-bearing variants is only expressible as an assertion
export const it = fullIt as unknown as typeof fullIt & Record<BannedItMethod, never>;
