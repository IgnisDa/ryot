import { Activity } from "@effect/workflow";
import { EntityId, type IntegrationId } from "@ryot/contract/schema/brands";
import type {
	MediaImportPopulationWorkflowInput,
	MediaImportResolutionWorkflowInput,
} from "@ryot/plugin-media/workflows/schemas";
import {
	mediaImportResolutionActivitySlugByProvider,
	MediaImportPopulationWorkflowOutput,
	MediaImportResolutionWorkflowOutput,
} from "@ryot/plugin-media/workflows/schemas";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { jsonByteLength } from "#lib/infrastructure/sandbox-runtime/limits";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { makeImporterConfig } from "../runtime/importer-config";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { mediaEntityGroupItemIndex } from "./groups";
import { getResolutionCandidates } from "./resolution-candidates";
import { PopulationProvider, type EntityIdsByKey, type ProgressReporter } from "./shared-workflow";
import type { ImportEntityRef, ImportMediaEntityGroup } from "./types";
import { importEntityRefKey } from "./types";
import { MediaImportWorkflowOperations } from "./types-workflow";
import { chunkWorkflowItems, type WorkflowChunkRejection } from "./workflow-chunks";

const resolutionScriptSlugs: Readonly<Record<string, string>> =
	mediaImportResolutionActivitySlugByProvider;

const workflowChunkRejectionMessage = (workflow: string, reason: WorkflowChunkRejection) => {
	if (reason === "context") {
		return `${workflow} item exceeds the workflow context limit`;
	}
	if (reason === "steps") {
		return `${workflow} item exceeds the durable step limit`;
	}
	return `${workflow} item is not JSON serializable`;
};

const encodeWorkflowItems = <Item>(items: ReadonlyArray<Item>) =>
	Effect.forEach(items, (item) =>
		Schema.encodeUnknown(jsonValueSchema)(item).pipe(
			Effect.map((json) => ({ item, encoded: { json } })),
			Effect.orElseSucceed(() => ({ item, encoded: null })),
		),
	).pipe(
		Effect.map((results) => ({
			unencodable: results.flatMap(({ item, encoded }) => (encoded ? [] : [item])),
			packable: results.flatMap(({ item, encoded }) =>
				encoded ? [{ item, json: encoded.json }] : [],
			),
		})),
	);

const populationFailureStage = (rejected: boolean, childStage?: "membership" | "population") => {
	if (rejected) {
		return "input_transformation" as const;
	}
	if (childStage === "membership") {
		return "database_commit" as const;
	}
	return "provider_details" as const;
};

const indexWorkflowResults = <Result extends { index: number }>(input: {
	workflow: string;
	results: readonly Result[];
	items: ReadonlyArray<{ index: number }>;
}) => {
	const counts = new Map<number, number>();
	const expectedIndexes = new Set(input.items.map(({ index }) => index));
	for (const { index } of input.results) {
		counts.set(index, (counts.get(index) ?? 0) + 1);
	}
	const missing = input.items.flatMap(({ index }) => (counts.has(index) ? [] : [index]));
	const duplicates = [...counts].flatMap(([index, count]) => (count > 1 ? [index] : []));
	const unexpected = [...counts.keys()].filter((index) => !expectedIndexes.has(index));

	if (missing.length > 0 || duplicates.length > 0 || unexpected.length > 0) {
		const defects = [
			...(missing.length > 0 ? [`missing indexes: ${missing.join(", ")}`] : []),
			...(duplicates.length > 0 ? [`duplicate indexes: ${duplicates.join(", ")}`] : []),
			...(unexpected.length > 0 ? [`unexpected indexes: ${unexpected.join(", ")}`] : []),
		];
		return {
			message: `${input.workflow} returned malformed results (${defects.join("; ")})`,
			resultByIndex: null,
		};
	}

	return {
		message: null,
		resultByIndex: new Map(input.results.map((result) => [result.index, result])),
	};
};

const recordResolutionFailure = (input: {
	index: number;
	message: string;
	group: ImportMediaEntityGroup;
	context: Record<string, unknown> | null;
	payload: Pick<ImportRunJobData, "runId">;
	ref: Extract<ImportEntityRef, { kind: "unresolved" }>;
}) =>
	Activity.make({
		error: ImportRunError,
		name: `record-resolution-failure-${input.index}`,
		execute: recordImportRunFailure({
			message: input.message,
			context: input.context,
			runId: input.payload.runId,
			stage: "provider_resolution",
			sourceLabel: input.ref.sourceLabel,
			sourceIdentifier: input.ref.identifierValue,
			entitySchemaSlug: input.ref.entitySchemaSlug,
			itemIndex: mediaEntityGroupItemIndex(input.group, input.index),
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const resolveMediaEntityGroupsWithPlugin = Effect.fn("resolveMediaEntityGroupsWithPlugin")(
	function* (input: {
		executionId: string;
		reportProgress: ProgressReporter;
		entityGroups: ImportMediaEntityGroup[];
		payload: Pick<ImportRunJobData, "runId" | "userId">;
	}) {
		const config = yield* AppConfig;
		const sandbox = yield* SandboxExecutionService;
		const importer = makeImporterConfig(config);
		const items: Array<(typeof MediaImportResolutionWorkflowInput.Type)["items"][number]> = [];
		let failures = 0;

		for (const [index, group] of input.entityGroups.entries()) {
			const ref = group.entityRef;
			if (ref.kind === "resolved") {
				continue;
			}
			const candidates = getResolutionCandidates({
				importer,
				identifierType: ref.identifierType,
				entitySchemaSlug: ref.entitySchemaSlug,
			}).flatMap((providerSlug) => {
				const scriptSlug = resolutionScriptSlugs[providerSlug];
				return scriptSlug ? [{ providerSlug, scriptSlug }] : [];
			});
			if (candidates.length === 0) {
				failures += 1;
				yield* recordResolutionFailure({
					group,
					index,
					ref,
					payload: input.payload,
					context: { identifierType: ref.identifierType },
					message: `No providers configured to resolve ${ref.identifierType}`,
				});
				continue;
			}
			items.push({
				index,
				candidates,
				value: ref.identifierValue,
				identifierType: ref.identifierType,
			});
		}

		const encoded = yield* encodeWorkflowItems(items);
		const { chunks, rejected } = chunkWorkflowItems(
			encoded.packable.map((packed) => ({
				item: packed,
				steps: packed.item.candidates.length,
				bytes: jsonByteLength(packed.json),
			})),
		);
		const rejectedMessageByIndex = new Map<number, string>([
			...encoded.unencodable.map(
				(item) =>
					[
						item.index,
						workflowChunkRejectionMessage("Media import resolution workflow", "json"),
					] as const,
			),
			...rejected.map(
				({ item, reason }) =>
					[
						item.item.index,
						workflowChunkRejectionMessage("Media import resolution workflow", reason),
					] as const,
			),
		]);
		const malformedMessageByIndex = new Map<number, string>();
		const resultByIndex = new Map<
			number,
			(typeof MediaImportResolutionWorkflowOutput.Type)["results"][number]
		>();
		if (chunks.length > 0) {
			const resolveResolutionScript = sandbox
				.resolveWorkflowScript({
					pluginSlug: "media",
					workflowSlug: "media-import-resolution",
					executionId: `${input.executionId}-resolution`,
				})
				.pipe(Effect.mapError(toWorkflowError));
			const scriptId = yield* resolveResolutionScript;
			const executeResolutionChunk = (chunk: (typeof chunks)[0], chunkIndex: number) =>
				sandbox
					.executeWorkflow({
						scriptId,
						authority: { type: "user", userId: input.payload.userId },
						input: { items: chunk.items.map(({ json }) => json) },
						executionId: `${input.executionId}-resolution-chunk-${chunkIndex}`,
					})
					.pipe(
						Effect.flatMap(Schema.decodeUnknown(MediaImportResolutionWorkflowOutput)),
						Effect.mapError(toWorkflowError),
					);
			const outputs = yield* Effect.forEach(
				chunks,
				(chunk, chunkIndex) => executeResolutionChunk(chunk, chunkIndex),
				{ concurrency: config.sandbox.workerConcurrency },
			);
			for (const [chunkIndex, chunk] of chunks.entries()) {
				const indexed = indexWorkflowResults({
					results: outputs[chunkIndex]?.results ?? [],
					workflow: "Media import resolution workflow",
					items: chunk.items.map(({ item }) => item),
				});
				if (indexed.message) {
					for (const { item } of chunk.items) {
						malformedMessageByIndex.set(item.index, indexed.message);
					}
				} else {
					for (const [index, result] of indexed.resultByIndex ?? []) {
						resultByIndex.set(index, result);
					}
				}
			}
		}

		for (const [index, group] of input.entityGroups.entries()) {
			const ref = group.entityRef;
			if (ref.kind === "unresolved") {
				const result = resultByIndex.get(index);
				const malformedMessage = malformedMessageByIndex.get(index);
				const rejectedMessage = rejectedMessageByIndex.get(index);
				if (result?.status === "resolved") {
					group.entityRef = {
						kind: "resolved",
						sourceLabel: ref.sourceLabel,
						externalId: result.externalId,
						providerSlug: result.providerSlug,
						entitySchemaSlug: ref.entitySchemaSlug,
					};
				} else if (result || malformedMessage || rejectedMessage) {
					failures += 1;
					const errors = result?.status === "unresolved" ? result.errors : [];
					yield* recordResolutionFailure({
						ref,
						group,
						index,
						payload: input.payload,
						context: errors.length > 0 ? { errors } : null,
						message:
							rejectedMessage ??
							malformedMessage ??
							(errors.length > 0
								? errors.join("; ")
								: `Could not resolve ${ref.identifierType} to a supported provider`),
					});
				}
			}
			yield* input.reportProgress(index + 1);
		}
		return failures;
	},
);

const PopulationProviderEntry = Schema.Struct({
	index: Schema.Number,
	provider: Schema.NullOr(PopulationProvider),
});

export const populateMediaEntityGroupsWithPlugin = Effect.fn("populateMediaEntityGroupsWithPlugin")(
	function* (input: {
		executionId: string;
		reportProgress: ProgressReporter;
		entityGroups: ImportMediaEntityGroup[];
		payload: Pick<ImportRunJobData, "runId" | "userId"> & { integrationId?: IntegrationId };
	}) {
		const config = yield* AppConfig;
		const sandbox = yield* SandboxExecutionService;
		const operations = yield* MediaImportWorkflowOperations;
		const entityIdsByKey: EntityIdsByKey = new Map();
		let failures = 0;

		const providers = yield* Activity.make({
			error: ImportRunError,
			name: "load-population-providers",
			success: Schema.Array(PopulationProviderEntry),
			execute: Effect.forEach(
				input.entityGroups,
				(group, index) =>
					group.entityRef.kind === "resolved"
						? operations
								.resolveProvider(group.entityRef.providerSlug)
								.pipe(Effect.map((provider) => ({ index, provider })))
						: Effect.succeed({ index, provider: null }),
				{ concurrency: 1 },
			).pipe(Effect.mapError(toWorkflowError)),
		});
		const providerByIndex = new Map(providers.map(({ index, provider }) => [index, provider]));
		const items: Array<(typeof MediaImportPopulationWorkflowInput.Type)["items"][number]> = [];

		for (const [index, group] of input.entityGroups.entries()) {
			const ref = group.entityRef;
			if (ref.kind !== "resolved") {
				continue;
			}
			const provider = providerByIndex.get(index);
			if (!provider) {
				failures += 1;
				yield* Activity.make({
					error: ImportRunError,
					name: `record-populate-script-failure-${index}`,
					execute: recordImportRunFailure({
						context: null,
						runId: input.payload.runId,
						sourceLabel: ref.sourceLabel,
						stage: "input_transformation",
						sourceIdentifier: ref.externalId,
						entitySchemaSlug: ref.entitySchemaSlug,
						message: `Provider not found for slug: ${ref.providerSlug}`,
						itemIndex: mediaEntityGroupItemIndex(group, index),
					}).pipe(Effect.mapError(toWorkflowError)),
				});
				continue;
			}
			items.push({
				index,
				externalId: ref.externalId,
				userId: input.payload.userId,
				providerId: provider.providerId,
				entitySchemaSlug: provider.entitySchemaSlug,
				origin: input.payload.integrationId
					? {
							kind: "integration",
							importRunId: input.payload.runId,
							integrationId: input.payload.integrationId,
						}
					: { kind: "import", importRunId: input.payload.runId },
			});
		}

		const encoded = yield* encodeWorkflowItems(items);
		const { chunks, rejected } = chunkWorkflowItems(
			encoded.packable.map((packed) => ({
				steps: 1,
				item: packed,
				bytes: jsonByteLength(packed.json),
			})),
		);
		const rejectedMessageByIndex = new Map<number, string>([
			...encoded.unencodable.map(
				(item) =>
					[
						item.index,
						workflowChunkRejectionMessage("Media import population workflow", "json"),
					] as const,
			),
			...rejected.map(
				({ item, reason }) =>
					[
						item.item.index,
						workflowChunkRejectionMessage("Media import population workflow", reason),
					] as const,
			),
		]);
		const malformedMessageByIndex = new Map<number, string>();
		const resultByIndex = new Map<
			number,
			(typeof MediaImportPopulationWorkflowOutput.Type)["results"][number]
		>();
		if (chunks.length > 0) {
			const resolvePopulationScript = sandbox
				.resolveWorkflowScript({
					pluginSlug: "media",
					workflowSlug: "media-import-population",
					executionId: `${input.executionId}-population`,
				})
				.pipe(Effect.mapError(toWorkflowError));
			const scriptId = yield* resolvePopulationScript;
			const executePopulationChunk = (chunk: (typeof chunks)[0], chunkIndex: number) =>
				sandbox
					.executeWorkflow({
						scriptId,
						authority: { type: "user", userId: input.payload.userId },
						input: { items: chunk.items.map(({ json }) => json) },
						executionId: `${input.executionId}-population-chunk-${chunkIndex}`,
					})
					.pipe(
						Effect.flatMap(Schema.decodeUnknown(MediaImportPopulationWorkflowOutput)),
						Effect.mapError(toWorkflowError),
					);
			const outputs = yield* Effect.forEach(
				chunks,
				(chunk, chunkIndex) => executePopulationChunk(chunk, chunkIndex),
				{ concurrency: config.sandbox.workerConcurrency },
			);
			for (const [chunkIndex, chunk] of chunks.entries()) {
				const indexed = indexWorkflowResults({
					results: outputs[chunkIndex]?.results ?? [],
					workflow: "Media import population workflow",
					items: chunk.items.map(({ item }) => item),
				});
				if (indexed.message) {
					for (const { item } of chunk.items) {
						malformedMessageByIndex.set(item.index, indexed.message);
					}
				} else {
					for (const [index, result] of indexed.resultByIndex ?? []) {
						resultByIndex.set(index, result);
					}
				}
			}
		}

		for (const [index, group] of input.entityGroups.entries()) {
			const ref = group.entityRef;
			const result = resultByIndex.get(index);
			const failure = result?.status === "failed" ? result : null;
			const malformedMessage = malformedMessageByIndex.get(index);
			const rejectedMessage = rejectedMessageByIndex.get(index);
			if (ref.kind === "resolved" && result?.status === "completed") {
				entityIdsByKey.set(importEntityRefKey(ref), EntityId.make(result.entityId));
			} else if (ref.kind === "resolved" && (failure || malformedMessage || rejectedMessage)) {
				failures += 1;
				yield* Activity.make({
					error: ImportRunError,
					name: `record-populate-failure-${index}`,
					execute: recordImportRunFailure({
						context: null,
						runId: input.payload.runId,
						sourceLabel: ref.sourceLabel,
						sourceIdentifier: ref.externalId,
						entitySchemaSlug: ref.entitySchemaSlug,
						itemIndex: mediaEntityGroupItemIndex(group, index),
						stage: populationFailureStage(Boolean(rejectedMessage), failure?.stage),
						message:
							rejectedMessage ??
							malformedMessage ??
							failure?.message ??
							"Population workflow failed",
					}).pipe(Effect.mapError(toWorkflowError)),
				});
			}
			yield* input.reportProgress(index + 1);
		}

		return { failures, entityIdsByKey };
	},
);
