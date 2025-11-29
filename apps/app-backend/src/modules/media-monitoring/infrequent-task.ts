import { WorkflowEngine, type WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import type { CronTask } from "#modules/scheduler/types";

import {
	mediaMonitoringPayloadFromTarget,
	MediaMonitoringRefreshWorkflow,
} from "./refresh-workflow";
import { MediaMonitoringRepository } from "./repository";

type MediaMonitoringInfrequentCronTask = CronTask<
	SandboxRunError,
	DbRunner | MediaMonitoringRepository | WorkflowEngine | WorkflowInstance
>;

export const mediaMonitoringInfrequentTask: MediaMonitoringInfrequentCronTask = {
	name: "media-monitoring-refresh",
	run: ({ executionId }) =>
		Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const runWithDb = yield* DbRunner;
			const repository = yield* MediaMonitoringRepository;
			const targets = yield* runWithDb(repository.listTargets()).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			);
			for (const target of targets) {
				const targetExecutionId = `${executionId}-${target.entityId}`;
				yield* engine
					.execute(MediaMonitoringRefreshWorkflow, {
						discard: true,
						executionId: targetExecutionId,
						payload: mediaMonitoringPayloadFromTarget(target, targetExecutionId),
					})
					.pipe(
						Effect.catchAllCause((cause) =>
							Effect.logError("media monitoring refresh enqueue failed", target.entityId, cause),
						),
					);
			}
		}),
};
