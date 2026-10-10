import { DateTime, Effect, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationRecoveryPage, IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { type IntegrationSyncPayload, IntegrationSyncWorkflow } from "./sync-workflow";

export const runIntegrationSyncWorkflow = Effect.fn("IntegrationSyncWorkflow")(
	function* (payload: IntegrationSyncPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
		const engine = yield* WorkflowEngine;
		const integrations = yield* IntegrationsService;
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			IntegrationSyncWorkflow,
			payload.accountGeneration,
			executionId,
		).pipe(Effect.orDie);

		const before = yield* makeActivity({
			error: Schema.Never,
			success: Schema.String,
			name: "integration-recovery-snapshot",
			execute: Effect.map(DateTime.nowAsDate, (date) => date.toISOString()),
		});
		const admitted = yield* makeActivity({
			error: Schema.Never,
			name: "prepare-integration-sync-runs",
			success: Schema.Array(IntegrationSyncRun),
			execute: integrations
				.prepareYankRuns(payload.userId, payload.accountGeneration)
				.pipe(Effect.orDie),
		});
		const dispatched = new Set<string>();
		const dispatch = Effect.fnUntraced(function* (run: IntegrationSyncRun) {
			if (dispatched.has(run.runId)) {
				return;
			}
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
			yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				ProcessIntegrationRunWorkflow,
				run.accountGeneration,
				{
					discard: true,
					executionId: run.runId,
					payload: {
						runId: run.runId,
						userId: run.userId,
						integrationId: run.integrationId,
						accountGeneration: run.accountGeneration,
					},
				},
				(admission) => admission.pipe(Effect.orDie),
				(execution) =>
					execution.pipe(
						Effect.catchCause((cause) =>
							Effect.logError("integration sync run dispatch failed", cause).pipe(
								Effect.annotateLogs({ runId: run.runId }),
							),
						),
					),
			);
			dispatched.add(run.runId);
		});
		for (const run of admitted) {
			yield* dispatch(run);
		}
		let after: IngestionRecoveryCursor | null = null;
		for (let page = 0; ; page++) {
			const recovery: typeof IntegrationRecoveryPage.Type = yield* makeActivity({
				error: Schema.Never,
				success: IntegrationRecoveryPage,
				name: `integration-readiness-recovery:${page}`,
				execute: integrations.prepareRecoveryRuns({ after, before }).pipe(Effect.orDie),
			});
			for (const run of recovery.runs) {
				yield* dispatch(run);
			}
			if (!recovery.next) {
				break;
			}
			after = recovery.next;
		}
	},
	(effect, payload, executionId) =>
		Effect.annotateLogs(effect, {
			executionId,
			userId: payload.userId,
			workflow: "IntegrationSyncWorkflow",
		}),
);

export const IntegrationSyncWorkflowDefinitionsLive = implementWorkflow(
	IntegrationSyncWorkflow,
	runIntegrationSyncWorkflow,
);
