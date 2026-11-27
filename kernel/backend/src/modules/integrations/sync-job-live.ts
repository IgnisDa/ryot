import { Effect } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import type { IntegrationRecoveryPage, IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { IntegrationSyncJob, type IntegrationSyncPayload } from "./sync-job";

export const runIntegrationSyncJob = Effect.fn("IntegrationSyncJob")(
	function* (payload: IntegrationSyncPayload, job: JobContext) {
		yield* Effect.annotateCurrentSpan({ jobId: job.id, userId: payload.userId });
		const engine = yield* WorkflowEngine;
		const integrations = yield* IntegrationsService;

		yield* integrations.prepareYankRuns(payload.userId);
		const before = yield* integrations.captureRecoveryCutoff();
		const dispatch = Effect.fnUntraced(function* (run: IntegrationSyncRun) {
			const released = yield* integrations
				.releaseRecoveryRun(run)
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("integration readiness recovery failed", cause).pipe(Effect.as(false)),
					),
				);
			if (!released) {
				return;
			}
			yield* dispatchAdmittedWorkflow(engine, ProcessIntegrationRunWorkflow, run.accountUserId, {
				discard: true,
				executionId: run.runId,
				payload: {
					runId: run.runId,
					userId: run.userId,
					integrationId: run.integrationId,
					accountUserId: run.accountUserId,
				},
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logError("integration sync run dispatch failed", cause).pipe(
						Effect.annotateLogs({ runId: run.runId }),
					),
				),
			);
		});
		let after: null | IngestionRecoveryCursor = null;
		for (;;) {
			const recovery: typeof IntegrationRecoveryPage.Type = yield* integrations.prepareRecoveryRuns(
				{ after, before },
			);
			for (const run of recovery.runs) {
				yield* dispatch(run);
			}
			if (!recovery.next) {
				break;
			}
			after = recovery.next;
		}
	},
	(effect, payload) => Effect.annotateLogs(effect, { userId: payload.userId }),
);

export const IntegrationSyncJobLive = registerJobHandler(IntegrationSyncJob, runIntegrationSyncJob);
