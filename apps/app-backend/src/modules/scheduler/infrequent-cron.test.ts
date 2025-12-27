import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Cron, Duration, Effect, Either, Layer, Queue, TestClock } from "effect";

import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { DEFAULT_INFREQUENT_CRON, parseInfrequentCron } from "./cron";
import { InfrequentCronSchedulerLive } from "./infrequent-cron";

type CapturedRun = { executionId: string; payload: { executionId: string } };

const makeCapture = () => Queue.unbounded<CapturedRun>();

const makeCapturingEngine = (captured: Queue.Queue<CapturedRun>) =>
	makeWorkflowEngine({
		execute: (_workflow, options) =>
			Queue.offer(captured, options as CapturedRun).pipe(Effect.as(options.executionId)),
	});

const schedulerConfig = (infrequentCronJobsSchedule: string) =>
	makeAppConfigLayer({ scheduler: { infrequentCronJobsSchedule } });

it.scoped("enqueues a run with a stable execution id at each cron instant", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const cron = Either.getOrThrow(parseInfrequentCron("every midnight", "Etc/GMT"));
		const firstMs = Cron.next(cron, 0).getTime();
		const secondMs = Cron.next(cron, firstMs).getTime();

		const layer = InfrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(schedulerConfig("every midnight")),
		);

		yield* Layer.build(layer);

		expect(yield* Queue.size(captured)).toBe(0);

		yield* TestClock.adjust(Duration.millis(firstMs));
		const first = yield* Queue.take(captured);
		expect(first.executionId).toBe(`infrequent-cron-${firstMs}`);
		expect(first.payload.executionId).toBe(first.executionId);

		yield* TestClock.adjust(Duration.millis(secondMs - firstMs));
		const second = yield* Queue.take(captured);
		expect(second.executionId).toBe(`infrequent-cron-${secondMs}`);
		expect(second.payload.executionId).toBe(second.executionId);
	}),
);

it.scoped("does not enqueue when background jobs are disabled", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const layer = InfrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(makeAppConfigLayer({ server: { disableBackgroundJobs: true } })),
		);

		yield* Layer.build(layer);
		yield* TestClock.adjust(Duration.days(2));

		expect(yield* Queue.size(captured)).toBe(0);
	}),
);

it.scoped("falls back to midnight for an invalid cron expression", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const cron = Either.getOrThrow(Cron.parse(DEFAULT_INFREQUENT_CRON, "Etc/GMT"));
		const firstMs = Cron.next(cron, 0).getTime();

		const layer = InfrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(schedulerConfig("not a cron expression")),
		);

		yield* Layer.build(layer);

		yield* TestClock.adjust(Duration.millis(firstMs));
		const first = yield* Queue.take(captured);
		expect(first.executionId).toBe(`infrequent-cron-${firstMs}`);
		expect(first.payload.executionId).toBe(first.executionId);
	}),
);
