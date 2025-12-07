import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer, Schedule } from "effect";

import { AudibleRepository } from "../modules/audible/repository";
import { ProcessAudibleRunWorkflow } from "../modules/audible/workflows";

export const SchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const repository = yield* AudibleRepository;

		yield* Effect.gen(function* () {
			const schedules = yield* repository.listEnabledSchedules();
			yield* Effect.forEach(schedules, (schedule) =>
				Effect.repeat(
					Effect.gen(function* () {
						const run = yield* repository.createSchedulerRun(schedule.query);
						yield* engine.execute(ProcessAudibleRunWorkflow, {
							discard: true,
							executionId: run.id,
							payload: {
								userId: run.userId,
								runId: run.id,
								query: schedule.query,
							},
						});
					}).pipe(
						Effect.catchAllCause((cause) =>
							Effect.logWarning("scheduled audible run failed", cause),
						),
					),
					Schedule.spaced(`${schedule.intervalSeconds} seconds`),
				).pipe(Effect.forkScoped),
			);
		}).pipe(
			Effect.catchAllCause((cause) => Effect.logWarning("reference scheduler skipped", cause)),
		);
	}),
);
