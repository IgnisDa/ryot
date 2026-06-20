import { expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Queue, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { CronRunPayload } from "./cron-workflow";
import { frequentCronExecutionId, FrequentCronSchedulerLive } from "./frequent-cron";

type CapturedRun = { executionId: string; payload: { executionId: string } };

const makeCapture = () => Queue.unbounded<CapturedRun>();

const makeCapturingEngine = (captured: Queue.Queue<CapturedRun>) =>
	makeWorkflowEngine({
		execute: (_workflow, options) => {
			if (!Schema.is(CronRunPayload)(options.payload)) {
				return Effect.die("Unexpected workflow execution");
			}
			return Queue.offer(captured, {
				executionId: options.executionId,
				payload: { executionId: options.payload.executionId },
			}).pipe(Effect.as(options.executionId));
		},
	});

const schedulerLayer = (captured: Queue.Queue<CapturedRun>, frequentCronJobsSchedule: string) =>
	FrequentCronSchedulerLive.pipe(
		Layer.provide(Layer.succeed(WorkflowEngine, makeCapturingEngine(captured))),
		Layer.provide(makeAppConfigLayer({ scheduler: { frequentCronJobsSchedule } })),
	);

const minuteMs = Duration.toMillis(Duration.minutes(1));

it.effect("enqueues one deterministic run per interval bucket", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();

		yield* Layer.build(schedulerLayer(captured, "every minute"));

		yield* TestClock.adjust(Duration.minutes(1));
		const first = yield* Queue.take(captured);
		expect(first.executionId).toBe(frequentCronExecutionId(minuteMs, minuteMs));
		expect(first.payload.executionId).toBe(first.executionId);

		yield* TestClock.adjust(Duration.minutes(1));
		const second = yield* Queue.take(captured);
		expect(second.executionId).toBe(frequentCronExecutionId(minuteMs, 2 * minuteMs));
		expect(second.payload.executionId).toBe(second.executionId);
	}),
);

it.effect("two schedulers sharing a bucket enqueue the same execution id", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();

		yield* Layer.build(schedulerLayer(captured, "every minute"));
		yield* TestClock.adjust(Duration.seconds(30));
		yield* Layer.build(schedulerLayer(captured, "every minute"));
		yield* TestClock.adjust(Duration.seconds(30));

		const first = yield* Queue.take(captured);
		const second = yield* Queue.take(captured);
		expect(first.executionId).toBe(frequentCronExecutionId(minuteMs, minuteMs));
		expect(second.executionId).toBe(first.executionId);
	}),
);

it.effect("does not enqueue when dispatchers are disabled", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();
		const engine = makeCapturingEngine(captured);
		const layer = FrequentCronSchedulerLive.pipe(
			Layer.provide(Layer.succeed(WorkflowEngine, engine)),
			Layer.provide(makeAppConfigLayer({ scheduler: { disableDispatchers: true } })),
		);

		yield* Layer.build(layer);
		yield* TestClock.adjust(Duration.minutes(10));

		expect(yield* Queue.size(captured)).toBe(0);
	}),
);

it.effect("falls back to the default 5-minute interval for an unsupported schedule", () =>
	Effect.gen(function* () {
		const captured = yield* makeCapture();

		yield* Layer.build(schedulerLayer(captured, "every fortnight"));

		yield* TestClock.adjust(Duration.minutes(1));
		expect(yield* Queue.size(captured)).toBe(0);

		yield* TestClock.adjust(Duration.minutes(4));
		const first = yield* Queue.take(captured);
		expect(first.executionId).toBe(frequentCronExecutionId(5 * minuteMs, 5 * minuteMs));
	}),
);
