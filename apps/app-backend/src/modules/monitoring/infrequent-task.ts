import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import type { CronTask } from "#modules/scheduler/types";

import { monitoringPayloadFromTarget, MonitoringRefreshWorkflow } from "./refresh-workflow";
import { MonitoringRepository } from "./repository";

type MonitoringInfrequentCronTask = CronTask<
	SandboxRunError,
	DbRunner | MonitoringRepository | WorkflowEngine | WorkflowInstance
>;

export const monitoringInfrequentTask: MonitoringInfrequentCronTask = {
	name: "monitoring-refresh",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* MonitoringRepository;
			const targets = yield* runWithDb(repository.listTargets()).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			);
			for (const target of targets) {
				const targetExecutionId = `${executionId}-${target.entityId}`;
				yield* MonitoringRefreshWorkflow.execute(
					monitoringPayloadFromTarget(target, targetExecutionId),
					{ discard: true },
				).pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError("monitoring refresh enqueue failed", target.entityId, cause),
					),
				);
			}
		}),
};
