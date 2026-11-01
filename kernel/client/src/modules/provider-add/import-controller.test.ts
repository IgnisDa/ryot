import { expect, it } from "@effect/vitest";
import type { ImportEntityRunResult } from "@ryot-app/contract/modules/entity-providers/schemas";
import { ProviderEntityImportBacklogFull } from "@ryot-app/contract/modules/entity-providers/schemas";
import { EntityId, EntitySchemaSlug, PluginId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
	importProviderEntity,
	PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE,
	PROVIDER_IMPORT_FAILED_MESSAGE,
	PROVIDER_IMPORT_TIMEOUT_MESSAGE,
	PROVIDER_IMPORT_UNAVAILABLE_MESSAGE,
	type ProviderEntityImportEntry,
} from "#/modules/provider-add/import-controller";
import { ProviderAddLoadError } from "#/modules/provider-add/service";

const completed = {
	status: "completed",
	data: {
		name: "Sample",
		properties: {},
		providerId: null,
		populatedAt: null,
		externalId: "ext-1",
		id: EntityId.make("entity-1"),
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		entitySchemaSlug: EntitySchemaSlug.make("item"),
		entitySchemaPluginId: PluginId.make("provider-owner"),
	},
} satisfies ImportEntityRunResult;

const scripted = (results: readonly ImportEntityRunResult[]) => {
	const pending = [...results];
	return () => Effect.sync(() => pending.shift() ?? ({ status: "running" } as const));
};

it.effect("polls a pending job until it completes", () =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				onProgress: () => undefined,
				start: Effect.succeed({ jobId: "job-1" }),
				poll: scripted([{ status: "running" }, { status: "running" }, completed]),
			}),
		);

		expect(yield* Fiber.join(fiber)).toEqual({ status: "imported", entityId: "entity-1" });
	}),
);

it.effect("surfaces a failed run result without waiting further", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			start: Effect.succeed({ jobId: "job-1" }),
			poll: scripted([
				{ status: "failed", reason: { stage: "population", code: "import-failed" } },
			]),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_FAILED_MESSAGE });
	}),
);

it.effect("times out after 120 seconds of running poll time", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				onProgress: () => undefined,
				start: Effect.succeed({ jobId: "job-1" }),
				poll: () =>
					Effect.sync(() => {
						attempts += 1;
					}).pipe(Effect.andThen(Effect.sleep("20 seconds")), Effect.as({ status: "running" })),
			}),
		);

		for (let interval = 0; interval < 7; interval += 1) {
			yield* TestClock.adjust("20 seconds");
		}

		expect(yield* Fiber.join(fiber)).toEqual({
			status: "failed",
			message: PROVIDER_IMPORT_TIMEOUT_MESSAGE,
		});
		expect(attempts).toBeGreaterThanOrEqual(6);
	}),
);

const latePollScenarios: ReadonlyArray<{
	name: string;
	poll: () => Effect.Effect<ImportEntityRunResult, ProviderAddLoadError>;
}> = [
	{ name: "terminal result", poll: () => Effect.succeed(completed) },
	{
		name: "typed poll error",
		poll: () => Effect.fail(new ProviderAddLoadError({ stage: "import", cause: "offline" })),
	},
];

for (const scenario of latePollScenarios) {
	it.effect(`uses the timeout when a ${scenario.name} arrives after the deadline`, () =>
		Effect.gen(function* () {
			const existingClock = yield* Clock.Clock;
			let monotonicMillis = 0;
			const monotonicTimeNanos = () => BigInt(monotonicMillis) * 1_000_000n;
			const clock: Clock.Clock = {
				monotonicTimeNanosUnsafe: monotonicTimeNanos,
				currentTimeNanos: existingClock.currentTimeNanos,
				currentTimeMillis: existingClock.currentTimeMillis,
				sleep: (duration) => existingClock.sleep(duration),
				monotonicTimeNanos: Effect.sync(monotonicTimeNanos),
				currentTimeNanosUnsafe: () => existingClock.currentTimeNanosUnsafe(),
				currentTimeMillisUnsafe: () => existingClock.currentTimeMillisUnsafe(),
			};
			let attempts = 0;
			const entry = yield* importProviderEntity({
				onProgress: () => undefined,
				start: Effect.succeed({ jobId: "job-1" }),
				poll: () =>
					Effect.sync(() => {
						attempts += 1;
						if (attempts === 2) {
							monotonicMillis = 120_001;
						}
						return attempts;
					}).pipe(
						Effect.flatMap((attempt) =>
							attempt === 1
								? Effect.succeed({ status: "running" } satisfies ImportEntityRunResult)
								: scenario.poll(),
						),
					),
			}).pipe(Effect.provideService(Clock.Clock, clock));

			expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_TIMEOUT_MESSAGE });
		}),
	);
}

it.effect("reports a stable message when the job cannot be started", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			poll: () => Effect.die("unreachable"),
			start: Effect.fail(new ProviderAddLoadError({ stage: "import", cause: "offline" })),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_UNAVAILABLE_MESSAGE });
	}),
);

it.effect("reports unavailable when a result poll fails", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			start: Effect.succeed({ jobId: "job-1" }),
			poll: () => Effect.fail(new ProviderAddLoadError({ stage: "import", cause: "offline" })),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_UNAVAILABLE_MESSAGE });
	}),
);

it.effect("does not spend the running timeout while queued", () =>
	Effect.gen(function* () {
		const progress: ProviderEntityImportEntry["status"][] = [];
		let pollInterrupted = false;
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				start: Effect.succeed({ jobId: "job-1" }),
				onProgress: (entry) => progress.push(entry.status),
				poll: (() => {
					let calls = 0;
					return () => {
						const call = calls++;
						if (call === 0) {
							return Effect.succeed({ status: "running" } satisfies ImportEntityRunResult);
						}
						if (call === 1) {
							return Effect.sleep("60 seconds").pipe(
								Effect.as({ status: "queued" } satisfies ImportEntityRunResult),
							);
						}
						if (call === 2) {
							return Effect.sleep("3 minutes").pipe(
								Effect.as({ status: "running" } satisfies ImportEntityRunResult),
							);
						}
						return Effect.never.pipe(
							Effect.onExit(() =>
								Effect.sync(() => {
									pollInterrupted = true;
								}),
							),
						);
					};
				})(),
			}),
		);

		yield* TestClock.adjust("60 seconds");
		yield* TestClock.adjust("3 minutes");
		yield* TestClock.adjust("60 seconds");

		expect(yield* Fiber.join(fiber)).toEqual({
			status: "failed",
			message: PROVIDER_IMPORT_TIMEOUT_MESSAGE,
		});
		expect(progress).toEqual(["importing", "queued", "importing"]);
		expect(pollInterrupted).toBe(true);
	}),
);

it.effect("uses monotonic time when wall time jumps during polling", () =>
	Effect.gen(function* () {
		const existingClock = yield* Clock.Clock;
		const initialWallMillis = yield* existingClock.currentTimeMillis;
		let wallMillis = initialWallMillis;
		const wallTimeNanos = () => BigInt(wallMillis) * 1_000_000n;
		const clock: Clock.Clock = {
			currentTimeNanosUnsafe: wallTimeNanos,
			currentTimeMillisUnsafe: () => wallMillis,
			currentTimeNanos: Effect.sync(wallTimeNanos),
			currentTimeMillis: Effect.sync(() => wallMillis),
			sleep: (duration) => existingClock.sleep(duration),
			monotonicTimeNanos: existingClock.monotonicTimeNanos,
			monotonicTimeNanosUnsafe: () => existingClock.monotonicTimeNanosUnsafe(),
		};
		let calls = 0;
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				onProgress: () => undefined,
				start: Effect.succeed({ jobId: "job-1" }),
				poll: () => {
					const call = calls++;
					if (call === 0) {
						return Effect.succeed({ status: "running" } satisfies ImportEntityRunResult);
					}
					return Effect.sleep("40 seconds").pipe(
						Effect.andThen(
							Effect.sync(() => {
								if (call === 1) {
									wallMillis = initialWallMillis + 3 * 60 * 60 * 1000;
								}
								if (call === 2) {
									wallMillis = initialWallMillis - 3 * 60 * 60 * 1000;
								}
							}),
						),
						Effect.as({ status: "running" } satisfies ImportEntityRunResult),
					);
				},
			}).pipe(Effect.provideService(Clock.Clock, clock)),
		);

		for (let interval = 0; interval < 3; interval += 1) {
			yield* TestClock.adjust("40 seconds");
		}

		expect(yield* Fiber.join(fiber)).toEqual({
			status: "failed",
			message: PROVIDER_IMPORT_TIMEOUT_MESSAGE,
		});
		expect(wallMillis).toBe(initialWallMillis - 3 * 60 * 60 * 1000);
	}),
);

it.effect("tells the user to retry later when their import backlog is full", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			poll: () => Effect.die("unreachable"),
			start: Effect.fail(
				new ProviderAddLoadError({
					stage: "import",
					cause: new ProviderEntityImportBacklogFull({
						reason: { limit: 50, retryAfterSeconds: 30, code: "import-backlog-full" },
					}),
				}),
			),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE });
	}),
);
