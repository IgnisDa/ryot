import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { JobQueue } from "#platform/jobs/queue";
import { makeAppConfigLayer } from "#testing/effect";

import { FrequentCronSchedulerLive } from "./frequent-cron";

type Queued = {
	readonly kind: string;
	readonly key: string | undefined;
	readonly runAt: number | undefined;
};

const schedulerLayer = (
	queued: Queued[],
	scheduler: { disableDispatchers?: boolean; frequentCronJobsSchedule?: string },
) =>
	FrequentCronSchedulerLive.pipe(
		Layer.provide(
			Layer.succeed(
				JobQueue,
				JobQueue.of({
					pruneFailed: () => Effect.void,
					enqueue: (kind, _payload, options = {}) =>
						Effect.sync(() => {
							queued.push({ kind: kind.name, key: options.key, runAt: options.runAt?.getTime() });
							return true;
						}),
				}),
			),
		),
		Layer.provide(makeAppConfigLayer({ scheduler })),
	);

const minuteMs = Duration.toMillis(Duration.minutes(1));

it.effect(
	"queues one occurrence at the next interval boundary",
	() =>
		Effect.gen(function* () {
			const queued: Queued[] = [];
			yield* TestClock.adjust(Duration.seconds(90));

			yield* Layer.build(schedulerLayer(queued, { frequentCronJobsSchedule: "every minute" }));

			expect(queued).toEqual([
				{ runAt: 2 * minuteMs, key: "frequent-cron", kind: "frequent-cron" },
			]);
		}),
	testTimeout,
);

it.effect(
	"does not queue when dispatchers are disabled",
	() =>
		Effect.gen(function* () {
			const queued: Queued[] = [];

			yield* Layer.build(schedulerLayer(queued, { disableDispatchers: true }));

			expect(queued).toEqual([]);
		}),
	testTimeout,
);

it.effect(
	"falls back to the default 5-minute interval for an unsupported schedule",
	() =>
		Effect.gen(function* () {
			const queued: Queued[] = [];
			yield* TestClock.adjust(Duration.minutes(1));

			yield* Layer.build(schedulerLayer(queued, { frequentCronJobsSchedule: "every fortnight" }));

			expect(queued).toEqual([
				{ runAt: 5 * minuteMs, key: "frequent-cron", kind: "frequent-cron" },
			]);
		}),
	testTimeout,
);
