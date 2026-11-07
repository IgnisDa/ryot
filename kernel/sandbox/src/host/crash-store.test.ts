import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { CRASH_WINDOW_MS, QUARANTINE_MS, SandboxCrashStore } from "./crash-store";
import { testExecutionId } from "./host.test-support";
import { SandboxStateStore } from "./state-store";

const storeLayer = SandboxCrashStore.layer.pipe(Layer.provideMerge(SandboxStateStore.memoryLayer));

const identities = Effect.sync(() => [testExecutionId("owner"), testExecutionId("content")]);

const quarantine = (store: SandboxCrashStore["Service"], keys: ReadonlyArray<string>) =>
	Effect.forEach(["crash-1", "crash-2", "crash-3"], (event) => store.strike(keys, event), {
		discard: true,
	});

const startProbation = Effect.fnUntraced(function* (
	store: SandboxCrashStore["Service"],
	keys: ReadonlyArray<string>,
) {
	yield* quarantine(store, keys);
	yield* TestClock.adjust(Duration.millis(QUARANTINE_MS + 1));
});

layer(storeLayer)((test) => {
	test.effect(
		"counts distinct crashes and blocks owner and content rotation until quarantine ends",
		() =>
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const keys = yield* identities;
				yield* store.strike(keys, "crash-1");
				yield* store.strike(keys, "crash-1");
				yield* store.strike(keys, "crash-2");
				expect(yield* store.acquire(keys, "run-1")).toBe("allowed");
				yield* store.strike(keys, "crash-3");
				for (const key of keys) {
					expect(yield* store.acquire([key], "rotation")).toBe("blocked");
				}
				yield* TestClock.adjust(Duration.millis(QUARANTINE_MS - 1));
				expect(yield* store.acquire([keys[0] ?? ""], "rotation")).toBe("blocked");
				yield* TestClock.adjust(Duration.millis(2));
				expect(yield* store.acquire([keys[1] ?? ""], "rotation")).toBe("probation");
			}),
		testTimeout,
	);

	test.effect(
		"removes strikes outside the ten-minute window before counting",
		() =>
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const keys = yield* identities;
				yield* store.strike(keys, "expired-crash");
				yield* TestClock.adjust(Duration.millis(CRASH_WINDOW_MS + 1));
				yield* store.strike(keys, "crash-1");
				yield* store.strike(keys, "crash-2");
				expect(yield* store.acquire(keys, "run")).toBe("allowed");
			}),
		testTimeout,
	);

	test.effect(
		"allows one probation owner and preserves probation after cancellation",
		() =>
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const keys = yield* identities;
				yield* startProbation(store, keys);
				const results = yield* Effect.all(
					[store.acquire(keys, "first"), store.acquire(keys, "second")],
					{ concurrency: "unbounded" },
				);
				expect(results.filter((result) => result === "probation")).toHaveLength(1);
				expect(results.filter((result) => result === "blocked")).toHaveLength(1);
				const owner = results[0] === "probation" ? "first" : "second";
				expect(yield* store.survived(keys, "foreign")).toBe("stale");
				expect(yield* store.acquire(keys, "third")).toBe("blocked");
				yield* store.release(keys, owner);
				expect(yield* store.acquire(keys, "third")).toBe("probation");
				yield* store.survived(keys, "third");
				expect(yield* store.acquire(keys, "fourth")).toBe("allowed");
			}),
		testTimeout,
	);

	test.effect(
		"renews quarantine when an exclusive probation execution crashes",
		() =>
			Effect.gen(function* () {
				const store = yield* SandboxCrashStore;
				const keys = yield* identities;
				yield* startProbation(store, keys);
				expect(yield* store.acquire(keys, "probe")).toBe("probation");
				yield* store.strike(keys, "probe-crash");
				expect(yield* store.acquire(keys, "next")).toBe("blocked");
				expect(yield* store.survived(keys, "probe")).toBe("stale");
			}),
		testTimeout,
	);
});
