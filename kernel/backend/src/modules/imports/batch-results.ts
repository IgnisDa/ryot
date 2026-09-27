import {
	IngestionAttribution,
	type IngestionBatch,
	type IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { genericImportApplyResultSchema } from "@ryot-app/sandbox-sdk/imports";
import { genericImportChunkSchema } from "@ryot-app/sandbox-sdk/imports";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { projectEntityIngestionReceipt } from "#modules/entities/mutation-outcomes";
import { projectEventIngestionReceipt } from "#modules/events/mutation-receipts";
import { MutationReceipts } from "#modules/mutations/receipts";
import { projectRelationshipIngestionReceipt } from "#modules/relationships/mutation-pipeline";

import { IngestionCaptures } from "./capture-service";
import { summarizeIngestionOutcomes } from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";

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
	const receipts = yield* MutationReceipts.make;
	const repository = yield* ImportsRepository;
	const database = yield* DatabaseSession;
	const committed = yield* receipts.getCommittedItems({
		...scope,
		rootExecutionId: scope.runId,
		itemIdentities: operations.map((operation) => operation.itemIdentity),
	});
	const outcomes: Array<{
		recordKind: string;
		unit: string;
		result: "created" | "updated" | "unchanged" | "skipped" | "unsuccessful";
	}> = [];
	for (const operation of operations) {
		const recorded = yield* repository.getOutcome(scope, operation.operationId);
		const receipt = committed.find((value) => value.itemIdentity === operation.itemIdentity);
		if (!receipt) {
			if (recorded) {
				outcomes.push(recorded);
			}
			continue;
		}
		const result =
			(yield* projectEntityIngestionReceipt(receipt.commandKind, receipt.result)) ??
			(yield* projectRelationshipIngestionReceipt(receipt.commandKind, receipt.result)) ??
			(yield* projectEventIngestionReceipt(receipt.commandKind, receipt.result));
		if (result === null) {
			return yield* new ImportRunError({
				message: `Ingestion write owner '${receipt.commandKind}' has no result projection`,
			});
		}
		outcomes.push({ ...operation, result });
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
): IngestionOperation[] =>
	chunk.items.flatMap((item) =>
		[
			...item.entities,
			...item.relationships,
			...item.events,
			...(item.collectionMemberships ?? []),
		].flatMap((intent) =>
			intent.outcome
				? [
						{
							...intent.outcome,
							operationId: intent.operationId,
							itemIdentity: JSON.stringify(["ingestion", runId, intent.operationId]),
							attribution: intent.attribution ?? {
								recordId: item.recordId,
								sourceLabel: item.sourceLabel,
								sourceIdentifier: item.sourceIdentifier,
							},
						},
					]
				: [],
		),
	);

export const reconcileGenericIngestionBatch = Effect.fn("imports.reconcileGenericIngestionBatch")(
	function* (scope: IngestionScope, batch: IngestionBatch) {
		const captures = yield* IngestionCaptures;
		const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
			new TextDecoder().decode(yield* captures.read(scope, batch.captureId, 4 * 1024 * 1024)),
		);
		const operations = genericIngestionOperations(chunk, scope.runId);
		for (const failure of chunk.failures) {
			operations.push({
				unit: failure.unit,
				recordKind: failure.recordKind,
				operationId: stableStringify(["source", failure.sourceIdentifier, failure.itemIndex]),
				itemIdentity: stableStringify(["source", failure.sourceIdentifier, failure.itemIndex]),
				attribution: {
					sourceLabel: failure.sourceLabel,
					recordId: String(failure.itemIndex),
					sourceIdentifier: failure.sourceIdentifier,
				},
			});
		}
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
		const receipts = yield* MutationReceipts.make;
		const operations = genericIngestionOperations(chunk, scope.runId).filter((operation) =>
			chunk.items.some((item) =>
				item.events.some(
					(intent) =>
						intent.operationId === operation.operationId && intent.attribution !== undefined,
				),
			),
		);
		const committed = yield* receipts.getCommittedItems({
			...scope,
			rootExecutionId: scope.runId,
			itemIdentities: operations.map((operation) => operation.itemIdentity),
		});
		const confirmed: Array<(typeof genericImportApplyResultSchema.Type)["confirmed"][number]> = [];
		for (const operation of operations) {
			const recorded = yield* repository.getOutcome(scope, operation.operationId);
			const receipt = committed.find((value) => value.itemIdentity === operation.itemIdentity);
			const result = receipt
				? yield* projectEventIngestionReceipt(receipt.commandKind, receipt.result)
				: recorded?.result;
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
					reason: receipt ? null : (recorded?.reason ?? null),
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
