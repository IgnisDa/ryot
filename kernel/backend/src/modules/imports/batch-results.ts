import {
	IngestionAttribution,
	type IngestionBatch,
	type IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import type {
	genericImportApplyResultSchema,
	GenericImportFailure,
} from "@ryot-app/plugin-backend-sdk/imports";
import {
	genericImportChunkSchema,
	genericImportItemIntents,
} from "@ryot-app/plugin-backend-sdk/imports";
import { Effect, Schema } from "effect";

import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { DatabaseSession } from "#platform/db/session";

import { IngestionCaptures } from "./capture-service";
import {
	genericImportOperationIdentity,
	ingestionItemIdentity,
	summarizeIngestionOutcomes,
} from "./outcomes";
import { ImportsRepository } from "./repository";

export const IngestionOperation = Schema.Struct({
	unit: Schema.NonEmptyString,
	recordKind: Schema.NonEmptyString,
	attribution: IngestionAttribution,
	operationId: Schema.NonEmptyString,
	itemIdentity: Schema.NonEmptyString,
});
export type IngestionOperation = typeof IngestionOperation.Type;

export const reconcileIngestionBatch = Effect.fn("imports.reconcileIngestionBatch")(function* (
	scope: IngestionScope,
	batch: IngestionBatch,
	operations: ReadonlyArray<IngestionOperation>,
) {
	const keys = yield* IdempotencyKeys.make;
	const repository = yield* ImportsRepository;
	const database = yield* DatabaseSession;
	const committed = yield* keys.importItems({
		runId: scope.runId,
		userId: scope.userId,
		itemIdentities: operations.map((operation) => operation.itemIdentity),
	});
	const outcomes: Array<{
		unit: string;
		recordKind: string;
		result: "created" | "updated" | "skipped" | "unchanged" | "unsuccessful";
	}> = [];
	for (const operation of operations) {
		const recorded = yield* repository.getOutcome(scope, operation.operationId);
		const item = committed.find((value) => value.itemIdentity === operation.itemIdentity);
		if (item) {
			outcomes.push({ ...operation, result: item.result });
		} else if (recorded) {
			outcomes.push(recorded);
		}
	}
	const summary = summarizeIngestionOutcomes(outcomes);
	yield* database.transaction(
		repository.projectBatch(scope, { ...batch, summary, state: "applied" }),
	);
	return summary;
});

export const genericIngestionOperations = (
	chunk: typeof genericImportChunkSchema.Type,
	runId: IngestionScope["runId"],
): IngestionOperation[] => [
	...chunk.items.flatMap((item) =>
		genericImportItemIntents(item).flatMap((intent) =>
			intent.outcome
				? [
						{
							...intent.outcome,
							operationId: intent.operationId,
							itemIdentity: genericImportOperationIdentity(runId, item, intent.operationId),
							attribution: intent.attribution ?? {
								recordId: item.recordId,
								sourceLabel: item.sourceLabel,
								sourceIdentifier: item.sourceIdentifier,
							},
						},
					]
				: [],
		),
	),
	...chunk.failures.map((failure) => genericIngestionFailureOperation(failure, runId)),
];

export const genericIngestionFailureOperation = (
	failure: GenericImportFailure,
	runId: IngestionScope["runId"],
): IngestionOperation => ({
	unit: failure.unit,
	recordKind: failure.recordKind,
	operationId: failure.operationId,
	itemIdentity: ingestionItemIdentity(runId, failure.operationId),
	attribution: {
		sourceLabel: failure.sourceLabel,
		recordId: String(failure.itemIndex),
		sourceIdentifier: failure.sourceIdentifier,
	},
});

export const reconcileGenericIngestionBatch = Effect.fn("imports.reconcileGenericIngestionBatch")(
	function* (scope: IngestionScope, batch: IngestionBatch) {
		const captures = yield* IngestionCaptures;
		const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
			new TextDecoder().decode(yield* captures.read(scope, batch.captureId, 4 * 1024 * 1024)),
		);
		const operations = genericIngestionOperations(chunk, scope.runId);
		return yield* reconcileIngestionBatch(scope, batch, operations);
	},
);

export const genericIngestionBatchResult = Effect.fn("imports.genericIngestionBatchResult")(
	function* (
		scope: IngestionScope,
		batch: IngestionBatch,
		chunk: typeof genericImportChunkSchema.Type,
	) {
		const repository = yield* ImportsRepository;
		const keys = yield* IdempotencyKeys.make;
		const operations = genericIngestionOperations(chunk, scope.runId).filter((operation) =>
			chunk.items.some((item) =>
				item.events.some(
					(intent) =>
						intent.operationId === operation.operationId && intent.attribution !== undefined,
				),
			),
		);
		const committed = yield* keys.importItems({
			runId: scope.runId,
			userId: scope.userId,
			itemIdentities: operations.map((operation) => operation.itemIdentity),
		});
		const confirmed: Array<(typeof genericImportApplyResultSchema.Type)["confirmed"][number]> = [];
		for (const operation of operations) {
			const recorded = yield* repository.getOutcome(scope, operation.operationId);
			const item = committed.find((value) => value.itemIdentity === operation.itemIdentity);
			const result = item ? item.result : recorded?.result;
			if (
				result === "created" ||
				result === "updated" ||
				result === "unchanged" ||
				result === "skipped"
			) {
				confirmed.push({
					result,
					operationId: operation.operationId,
					attribution: operation.attribution,
					reason: item ? null : (recorded?.reason ?? null),
				});
			}
		}
		return {
			confirmed,
			summary: batch.summary,
			issues: (yield* repository.getBatchIssues(scope, batch.id)).map(({ data }) => data),
		};
	},
);
