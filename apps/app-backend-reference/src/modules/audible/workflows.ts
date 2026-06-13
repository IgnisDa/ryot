import { Activity, DurableClock, DurableDeferred, DurableQueue, Workflow } from "@effect/workflow";
import { Effect, Exit, Layer, Match, Schema } from "effect";

import { AudibleRunError, SandboxRunError, toAudibleRunError } from "../../lib/errors";
import { redisKeys } from "../../lib/redis";
import { ReadUploadedQueries } from "./activities";
import {
	AudibleNotifyQueue,
	AudibleNotifyQueueWorkerLive,
	AudibleSandboxQueue,
	AudibleSandboxQueueWorkerLive,
} from "./durable-queues";
import { AudibleRepository } from "./repository";
import {
	AudibleDetailsResult,
	AudibleImportConfirmation,
	AudibleImportItem,
	AudibleRunResult,
	AudibleSearchResult,
} from "./schemas";

const AudibleWorkflowError = Schema.Union(AudibleRunError, SandboxRunError);
const importConfirmationTimeout = "30 seconds";

export const AudibleImportConfirmationSignal = DurableDeferred.make(
	"AudibleImportConfirmationSignal",
	{ success: AudibleImportConfirmation },
);

const AudibleImportConfirmationWaitResult = Schema.Union(
	Schema.TaggedStruct("confirmed", {
		userId: Schema.String,
		confirmedAt: Schema.String,
	}),
	Schema.TaggedStruct("timed_out", {}),
);

export const ResolveAudibleQueryWorkflow = Workflow.make({
	name: "ResolveAudibleQueryWorkflow",
	payload: {
		userId: Schema.String,
		runId: Schema.String,
		query: Schema.String,
	},
	success: AudibleImportItem,
	error: AudibleWorkflowError,
	idempotencyKey: ({ runId, query }) => `${runId}:${query}`,
});

export const ProcessAudibleRunWorkflow = Workflow.make({
	name: "ProcessAudibleRunWorkflow",
	payload: {
		userId: Schema.String,
		runId: Schema.String,
		query: Schema.optional(Schema.String),
		uploadId: Schema.optional(Schema.String),
	},
	success: AudibleRunResult,
	error: AudibleWorkflowError,
	idempotencyKey: ({ runId }) => runId,
});

const mapWorkflowError = (cause: unknown) =>
	cause instanceof SandboxRunError || cause instanceof AudibleRunError
		? cause
		: toAudibleRunError(cause);

const decodeSandboxResult = <A>(schema: Schema.Schema<A>, label: string, value: unknown) =>
	Schema.decodeUnknown(schema)(value).pipe(
		Effect.mapError((error) => new AudibleRunError({ message: `${label}: ${error.message}` })),
	);

// Workflow bodies are replayed on resume/restart; only Activity (and the other
// durable primitives) results are journaled and skipped on replay. Every
// side-effecting repository write is wrapped in a uniquely-named Activity so it
// executes exactly once and is not duplicated when the workflow body re-runs.
const recordStep = <E>(name: string, effect: Effect.Effect<unknown, E>) =>
	Activity.make({
		name,
		error: AudibleWorkflowError,
		execute: effect.pipe(Effect.mapError(mapWorkflowError), Effect.asVoid),
	});

const toExecutionKey = (value: string) => encodeURIComponent(value);

const ResolveAudibleQueryWorkflowLive = ResolveAudibleQueryWorkflow.toLayer((payload) =>
	Effect.gen(function* () {
		const repository = yield* AudibleRepository;

		yield* recordStep(
			"search-audible-running",
			repository.addStep(payload.runId, "search-audible", "running", {
				query: payload.query,
			}),
		);
		const searchRun = yield* DurableQueue.process(AudibleSandboxQueue, {
			context: { page: 1, pageSize: 3, query: payload.query },
			runId: payload.runId,
			driverName: "search",
			scriptSlug: "audiobook.audible",
			executionId: `${payload.runId}:${toExecutionKey(payload.query)}:search`,
		});
		const searchResult = yield* decodeSandboxResult(
			AudibleSearchResult,
			"Invalid Audible search result",
			searchRun.result,
		).pipe(Effect.mapError(mapWorkflowError));
		yield* recordStep(
			"search-audible-completed",
			repository.addStep(payload.runId, "search-audible", "completed", {
				query: payload.query,
				results: searchResult.items.length,
			}),
		);

		const topMatch = searchResult.items[0];
		if (!topMatch) {
			return {
				asin: null,
				query: payload.query,
				title: null,
				author: null,
				status: "not_found" as const,
				details: { query: payload.query },
				imageUrl: null,
				sourceUrl: null,
			};
		}

		yield* recordStep(
			"fetch-audible-details-running",
			repository.addStep(payload.runId, "fetch-audible-details", "running", {
				asin: topMatch.externalId,
				query: payload.query,
			}),
		);
		const detailsRun = yield* DurableQueue.process(AudibleSandboxQueue, {
			context: { externalId: topMatch.externalId },
			runId: payload.runId,
			driverName: "details",
			scriptSlug: "audiobook.audible",
			executionId: `${payload.runId}:${topMatch.externalId}:details`,
		});
		const details = yield* decodeSandboxResult(
			AudibleDetailsResult,
			"Invalid Audible details result",
			detailsRun.result,
		).pipe(Effect.mapError(mapWorkflowError));
		yield* recordStep(
			"fetch-audible-details-completed",
			repository.addStep(payload.runId, "fetch-audible-details", "completed", {
				asin: details.asin,
				query: payload.query,
			}),
		);

		return {
			asin: details.asin,
			query: payload.query,
			title: details.title,
			author: details.author,
			status: "matched" as const,
			details,
			imageUrl: details.imageUrl,
			sourceUrl: details.sourceUrl,
		};
	}),
);

const ProcessAudibleRunWorkflowLive = ProcessAudibleRunWorkflow.toLayer((payload) =>
	Effect.gen(function* () {
		const repository = yield* AudibleRepository;

		yield* repository.getRunById(payload.runId).pipe(Effect.mapError(mapWorkflowError));

		const uploadId = payload.uploadId;
		const queries = payload.query?.trim()
			? [payload.query.trim()]
			: uploadId
				? yield* Effect.gen(function* () {
						yield* recordStep(
							"status-reading-upload",
							repository.updateStatus(payload.runId, "reading_upload"),
						);
						yield* recordStep(
							"read-upload-running",
							repository.addStep(payload.runId, "read-upload", "running", {
								uploadId,
							}),
						);
						const uploadedQueries = yield* ReadUploadedQueries({
							uploadId,
							userId: payload.userId,
						});
						yield* recordStep(
							"read-upload-completed",
							repository.addStep(payload.runId, "read-upload", "completed", {
								queryCount: uploadedQueries.length,
								uploadId,
							}),
						);
						return uploadedQueries;
					})
				: yield* new AudibleRunError({ message: "Workflow requires a query or uploadId" });

		yield* recordStep("status-processing", repository.updateStatus(payload.runId, "processing"));
		yield* recordStep(
			"process-queries-running",
			repository.addStep(payload.runId, "process-queries", "running", {
				queryCount: queries.length,
			}),
		);

		const items = yield* Effect.forEach(
			queries,
			(query) =>
				ResolveAudibleQueryWorkflow.execute({
					userId: payload.userId,
					runId: payload.runId,
					query,
				}),
			{ concurrency: 3 },
		).pipe(Effect.mapError(mapWorkflowError));

		yield* recordStep(
			"process-queries-completed",
			repository.addStep(payload.runId, "process-queries", "completed", {
				queryCount: queries.length,
				matchedItems: items.filter((item) => item.status === "matched").length,
			}),
		);
		yield* recordStep(
			"persist-import-preview-running",
			repository.addStep(payload.runId, "persist-import-preview", "running", {
				itemCount: items.length,
			}),
		);
		yield* Activity.make({
			name: "persist-import-items",
			error: AudibleWorkflowError,
			execute: Effect.forEach(items, (item) => repository.upsertItem(payload.runId, item), {
				concurrency: 3,
			}).pipe(Effect.mapError(mapWorkflowError), Effect.asVoid),
		}).pipe(
			ProcessAudibleRunWorkflow.withCompensation(() =>
				repository.cleanupItems(payload.runId).pipe(Effect.orDie),
			),
		);
		yield* recordStep(
			"persist-import-preview-completed",
			repository.addStep(payload.runId, "persist-import-preview", "completed", {
				itemCount: items.length,
			}),
		);

		const result = {
			runId: payload.runId,
			matchedItems: items.filter((item) => item.status === "matched").length,
			processedQueries: queries.length,
		};
		const token = yield* DurableDeferred.token(AudibleImportConfirmationSignal);
		yield* recordStep(
			"save-confirmation-token",
			repository.saveConfirmationToken(payload.runId, token),
		);
		yield* recordStep(
			"await-import-confirmation-running",
			repository.addStep(payload.runId, "await-import-confirmation", "running", {
				timeout: importConfirmationTimeout,
			}),
		);

		const confirmation = yield* DurableDeferred.raceAll({
			name: `audible-import-confirmation:${payload.runId}`,
			error: Schema.Never,
			success: AudibleImportConfirmationWaitResult,
			effects: [
				DurableDeferred.await(AudibleImportConfirmationSignal).pipe(
					Effect.map((event) => ({
						_tag: "confirmed" as const,
						userId: event.userId,
						confirmedAt: event.confirmedAt,
					})),
				),
				DurableClock.sleep({
					name: "audible-import-confirmation-timeout",
					duration: importConfirmationTimeout,
					inMemoryThreshold: "0 millis",
				}).pipe(Effect.as({ _tag: "timed_out" as const })),
			],
		});

		const confirmed = yield* Match.value(confirmation).pipe(
			Match.tag("timed_out", () =>
				Effect.gen(function* () {
					yield* recordStep(
						"await-import-confirmation-failed",
						repository.addStep(payload.runId, "await-import-confirmation", "failed", {
							timeout: importConfirmationTimeout,
						}),
					);
					yield* recordStep("expire-import", repository.expireImport(payload.runId));
					return false;
				}),
			),
			Match.tag("confirmed", (event) =>
				Effect.gen(function* () {
					yield* recordStep(
						"await-import-confirmation-completed",
						repository.addStep(payload.runId, "await-import-confirmation", "completed", {
							userId: event.userId,
							confirmedAt: event.confirmedAt,
						}),
					);
					return true;
				}),
			),
			Match.exhaustive,
		);
		if (!confirmed) {
			return result;
		}

		yield* recordStep("save-final-result", repository.saveFinalResult(payload.runId, result));
		yield* DurableQueue.process(AudibleNotifyQueue, {
			id: `${payload.runId}:completed`,
			channel: redisKeys.audibleNotifications,
			message: JSON.stringify(result),
		});

		return result;
	}).pipe(
		Effect.tapError((error) =>
			Effect.gen(function* () {
				const repository = yield* AudibleRepository;
				yield* repository.updateStatus(payload.runId, "failed").pipe(Effect.orDie);
				yield* repository
					.addStep(payload.runId, "run-failed", "failed", { message: error.message })
					.pipe(Effect.orDie);
			}),
		),
	),
);

export const WorkflowDefinitionsLive = Layer.mergeAll(
	ResolveAudibleQueryWorkflowLive,
	ProcessAudibleRunWorkflowLive,
	AudibleSandboxQueueWorkerLive,
	AudibleNotifyQueueWorkerLive,
);

export const pollWorkflowTag = (result: Workflow.Result<AudibleRunResult, unknown> | undefined) => {
	if (!result) {
		return "not_started";
	}

	return Match.value(result).pipe(
		Match.tag("Suspended", () => "suspended"),
		Match.orElse(({ exit }) => (Exit.isSuccess(exit) ? "completed" : "failed")),
	);
};
