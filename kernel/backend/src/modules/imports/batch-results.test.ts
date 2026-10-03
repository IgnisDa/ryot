import { expect, it } from "@effect/vitest";
import type {
	IngestionBatch,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { GenericImportChunk } from "@ryot-app/sandbox-sdk/imports";
import { Effect, Layer } from "effect";

import { genericIngestionBatchResult, reconcileGenericIngestionBatch } from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import {
	ingestionTestDatabase,
	ingestionTestNow,
	ingestionTestReceipt,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ImportsRepository } from "./repository";

const batch: IngestionBatch = {
	ordinal: 0,
	id: "batch",
	summary: [],
	state: "applying",
	captureId: "capture",
	inputFingerprint: "fingerprint",
};
const chunk: GenericImportChunk = {
	failures: [],
	items: [
		{
			itemIndex: 0,
			recordId: "group",
			relationships: [],
			sourceLabel: "Group",
			sourceIdentifier: "group",
			subjectEntityAlias: "track",
			entities: [
				{
					name: "Track",
					alias: "track",
					properties: {},
					operationId: "support",
					entitySchemaSlug: "track",
				},
			],
			events: ["committed", "skipped", "failed", "unapplied"].map((operationId) => ({
				operationId,
				properties: {},
				entityAlias: "track",
				eventSchemaSlug: "play",
				occurredAt: ingestionTestNow,
				outcome: { unit: "plays", recordKind: "play" },
				attribution: {
					recordId: operationId,
					sourceLabel: "History",
					sourceIdentifier: `track/${operationId}`,
				},
			})),
		},
	],
};
const recorded = (operationId: string, result: "skipped" | "unsuccessful"): IngestionOutcome => ({
	result,
	operationId,
	unit: "plays",
	receiptId: null,
	recordKind: "play",
	inputFingerprint: "fingerprint",
	reason: { key: null, code: result },
	attribution: {
		recordId: operationId,
		sourceLabel: "History",
		sourceIdentifier: `track/${operationId}`,
	},
});

it.effect(
	"reconciles a late committed receipt before cancellation and returns only attributed event completion facts",
	() =>
		Effect.gen(function* () {
			const receipts = [
				ingestionTestReceipt("committed", "event:create", { processed: [], eventId: "event-1" }),
			];
			const outcomes = new Map(
				[
					recorded("committed", "unsuccessful"),
					recorded("skipped", "skipped"),
					recorded("failed", "unsuccessful"),
				].map((outcome) => [outcome.operationId, outcome]),
			);
			const projections: IngestionBatch[] = [];
			const dependencies = Layer.mergeAll(
				ingestionTestDatabase(() => receipts),
				Layer.mock(IngestionCaptures)({
					read: () => Effect.succeed(Buffer.from(JSON.stringify(chunk))),
				}),
				Layer.mock(ImportsRepository)({
					getBatchIssues: () => Effect.succeed([]),
					getOutcome: (_scope, id) => Effect.succeed(outcomes.get(id) ?? null),
					projectBatch: (_scope, value) =>
						Effect.sync(() => {
							projections.push(value);
							return true;
						}),
				}),
			);
			yield* Effect.gen(function* () {
				const summary = yield* reconcileGenericIngestionBatch(ingestionTestScope, batch);
				expect(summary).toEqual([
					{
						unit: "plays",
						recordKind: "play",
						counts: { created: 1, updated: 0, skipped: 1, unchanged: 0, unsuccessful: 1 },
					},
				]);
				expect(projections).toEqual([{ ...batch, summary, state: "applied" }]);
				const result = yield* genericIngestionBatchResult(
					ingestionTestScope,
					{ ...batch, summary },
					chunk,
				);
				expect(result.confirmed).toEqual([
					{
						reason: null,
						result: "created",
						operationId: "committed",
						attribution: {
							recordId: "committed",
							sourceLabel: "History",
							sourceIdentifier: "track/committed",
						},
					},
					{
						result: "skipped",
						operationId: "skipped",
						reason: { key: null, code: "skipped" },
						attribution: {
							recordId: "skipped",
							sourceLabel: "History",
							sourceIdentifier: "track/skipped",
						},
					},
				]);
			}).pipe(Effect.provideContext(yield* Layer.build(dependencies)));
		}),
);
