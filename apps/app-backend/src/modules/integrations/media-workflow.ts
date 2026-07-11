import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Schema } from "effect";

import {
	MediaImportAdapterResultSchema,
	MediaImportAdapterSummarySchema,
	toMediaImportAdapterSummary,
} from "#modules/imports/media/adapter-result";
import { ProcessNormalizedMediaImportWorkflow } from "#modules/imports/media/normalized-import-workflow";
import { storeImportAdapterResult } from "#modules/imports/runtime/source-payload-store";

import {
	failRun,
	failRunWithAdapterFailures,
	toIntegrationWorkflowError,
} from "./failure-workflow";
import type { IntegrationRunJobData } from "./jobs";
import { IntegrationRunError } from "./jobs";
import { IntegrationRunOperations } from "./operations-workflow";
import type { IntegrationRecord } from "./repository";

const runMediaImportForIntegration = (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) =>
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const childExecutionId = `${executionId}-normalized`;
		yield* engine
			.execute(ProcessNormalizedMediaImportWorkflow, {
				executionId: childExecutionId,
				payload: {
					executionId: childExecutionId,
					runId: payload.runId,
					userId: integration.userId,
					integrationId: integration.id,
				},
			})
			.pipe(
				Effect.mapError((error) => new IntegrationRunError({ message: unknownToMessage(error) })),
			);
	});

const loadAdapterResult = Effect.fn("loadIntegrationAdapterResult")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const operations = yield* IntegrationRunOperations;
	const sandbox = yield* operations
		.runAdapter({
			integration,
			executionId: `${executionId}-adapter`,
			context:
				integration.lot === "sink"
					? {
							rawBody: payload.rawBody ?? "",
							contentType: payload.contentType ?? "application/json",
						}
					: {},
		})
		.pipe(Effect.either);

	if (sandbox._tag === "Left") {
		return { _tag: "failed" as const, message: sandbox.left.message };
	}
	if (sandbox.right.error) {
		return { _tag: "failed" as const, message: sandbox.right.error.message };
	}

	const summary = yield* Activity.make({
		error: IntegrationRunError,
		name: "store-integration-adapter-result",
		success: MediaImportAdapterSummarySchema,
		execute: Schema.decodeUnknown(MediaImportAdapterResultSchema)(sandbox.right.value).pipe(
			Effect.mapError(
				(error) =>
					new IntegrationRunError({
						message: `Integration adapter returned an unexpected shape: ${error.message}`,
					}),
			),
			Effect.flatMap((adapterResult) =>
				storeImportAdapterResult({ runId: payload.runId, adapterResult }).pipe(
					Effect.mapError(toIntegrationWorkflowError),
					Effect.as(toMediaImportAdapterSummary(adapterResult)),
				),
			),
		),
	});
	return { _tag: "loaded" as const, summary };
});

export const processIntegrationMedia = Effect.fn("processIntegrationMedia")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const loadOutcome = yield* loadAdapterResult(integration, payload, executionId).pipe(
		Effect.catchAll((error) => Effect.succeed({ _tag: "failed" as const, message: error.message })),
		Effect.catchAllCause((cause) =>
			Effect.succeed({
				_tag: "failed" as const,
				message: unknownToMessage(Cause.squash(cause)),
			}),
		),
	);

	if (loadOutcome._tag === "failed") {
		yield* failRun("fail-integration-adapter-load", payload.runId, loadOutcome.message);
		return;
	}
	if (loadOutcome.summary.groups === 0 && loadOutcome.summary.failures.length > 0) {
		yield* failRunWithAdapterFailures(
			"record-integration-adapter-failures",
			payload.runId,
			loadOutcome.summary.failures,
		);
		return;
	}

	yield* runMediaImportForIntegration(integration, payload, executionId);
});
