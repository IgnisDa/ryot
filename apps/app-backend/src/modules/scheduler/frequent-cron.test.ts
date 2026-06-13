import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Duration, Effect, Layer, Queue, TestClock } from "effect";

import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-support/effect";

import { FrequentCronSchedulerLive } from "./frequent-cron";

type CapturedRun = { executionId: string; payload: { executionId: string } };

const makeCapture = () => Queue.unbounded<CapturedRun>();

const makeCapturingEngine = (captured: Queue.Queue<CapturedRun>) =>
	makeWorkflowEngine({
		execute: (_workflow, options) =>
			Queue.offer(captured, options as CapturedRun).pipe(Effect.as(options.executionId)),
	});

const schedulerConfig = (frequentCronJobsSchedule: string) =>
	makeAppConfigLayer({ scheduler: { frequentCronJobsSchedule } });

it.scoped("enqueues a frequent run immediately and on each interval", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const layer = FrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(schedulerConfig("every minute")),
		);

		yield* Layer.build(layer);

		const first = yield* Queue.take(captured);
		expect(first.executionId).toMatch(/^frequent-cron-/);
		expect(first.payload.executionId).toBe(first.executionId);

		yield* TestClock.adjust(Duration.minutes(1));
		const second = yield* Queue.take(captured);
		expect(second.executionId).toMatch(/^frequent-cron-/);
		expect(second.payload.executionId).toBe(second.executionId);

		yield* TestClock.adjust(Duration.minutes(1));
		const third = yield* Queue.take(captured);
		expect(third.executionId).toMatch(/^frequent-cron-/);
		expect(third.payload.executionId).toBe(third.executionId);
	}),
);

it.scoped("does not enqueue when background jobs are disabled", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const layer = FrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(makeAppConfigLayer({ server: { disableBackgroundJobs: true } })),
		);

		yield* Layer.build(layer);
		yield* TestClock.adjust(Duration.minutes(10));

		expect(yield* Queue.size(captured)).toBe(0);
	}),
);

it.scoped("falls back to the default 5-minute interval for an unsupported schedule", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const layer = FrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(schedulerConfig("every fortnight")),
		);

		yield* Layer.build(layer);

		const first = yield* Queue.take(captured);
		expect(first.executionId).toMatch(/^frequent-cron-/);

		yield* TestClock.adjust(Duration.minutes(1));
		expect(yield* Queue.size(captured)).toBe(0);

		yield* TestClock.adjust(Duration.minutes(4));
		const second = yield* Queue.take(captured);
		expect(second.executionId).toMatch(/^frequent-cron-/);
	}),
);
