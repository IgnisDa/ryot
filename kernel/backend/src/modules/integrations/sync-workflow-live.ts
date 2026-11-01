import { Effect, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationRecoveryPage, type IntegrationSyncRun } from "./jobs";
import { IntegrationsService } from "./service";
import { type IntegrationSyncPayload, IntegrationSyncWorkflow } from "./sync-workflow";

export const runIntegrationSyncWorkflow = Effect.fn("IntegrationSyncWorkflow")(
	function* (payload: IntegrationSyncPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
		const engine = yield* WorkflowEngine;
		const integrations = yield* IntegrationsService;
		yield* admitWorkflow(payload.accountGeneration).pipe(Effect.orDie);

		yield* makeActivity({
			error: Schema.Never,
			success: Schema.Void,
			name: "admit-yank-integration-runs",
			execute: integrations.prepareYankRuns(payload.userId).pipe(Effect.orDie),
		});
		const before = yield* makeActivity({
			error: Schema.Never,
			success: Schema.String,
			name: "capture-integration-worklist-cutoff",
			execute: integrations.captureRecoveryCutoff().pipe(Effect.orDie),
		});
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
			yield* dispatchAdmittedWorkflow(
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
			).pipe(
				Effect.catchCause((cause) =>
					Effect.logError("integration sync run dispatch failed", cause).pipe(
						Effect.annotateLogs({ runId: run.runId }),
					),
				),
			);
		});
		let after: null | IngestionRecoveryCursor = null;
		for (let page = 0; ; page++) {
			const recovery: typeof IntegrationRecoveryPage.Type = yield* makeActivity({
				error: Schema.Never,
				success: IntegrationRecoveryPage,
				name: `integration-worklist-page:${page}`,
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
