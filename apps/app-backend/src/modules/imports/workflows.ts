import { Activity } from "@effect/workflow";
import { Cause, DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/db";
import type { SandboxRunError } from "#lib/errors";
import { unknownToMessage } from "#lib/errors";
import { CollectionsService } from "#modules/collections/service";
import type { EntitySearchItem } from "#modules/entities/population";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "./jobs";
import type { LoadedMediaImportAdapterResult } from "./media/file-processor";
import { mediaEntityGroupItemIndex } from "./media/groups";
import { MediaImportAdapterResultSchema } from "./media/import-processor";
import { getResolutionCandidates } from "./media/resolution-candidates";
import { LoadedMediaImportAdapterSuccess } from "./media/source-loaders";
import { type ImportEntityRef, importEntityRefKey } from "./media/types";
import { ImportsRepository } from "./repository";
import { PROGRESS_UPDATE_INTERVAL, recordImportRunFailure } from "./runtime/failures";
import { resolveImportPath } from "./runtime/files";
import {
	createImportRunLifecycle,
	ImportRunError,
	toWorkflowError,
} from "./runtime/workflow-helpers";
import { buildNetflixAdapterResult } from "./sources/netflix/processor";

const ResolutionCandidate = Schema.Struct({
	scriptSlug: Schema.String,
	sandboxScriptId: Schema.NullOr(Schema.String),
});

const PopulationScript = Schema.Struct({
	entitySchemaId: Schema.String,
	sandboxScriptId: Schema.String,
});

const LoadMediaImportFailed = Schema.TaggedStruct("failed", {
	message: Schema.String,
	cleanupPaths: Schema.Array(Schema.String),
	fallbackToInitialCleanupPaths: Schema.Boolean,
});

const LoadMediaImportOutcome = Schema.Union(LoadMediaImportFailed, LoadedMediaImportAdapterSuccess);

const EnsureLibraryMembershipOutcome = Schema.Struct({
	message: Schema.NullOr(Schema.String),
});

type MediaImportWorkflowOperations<RLoad, RResolve, RImport, RSearch = never, RCleanup = never> = {
	cleanupArtifacts: (input: {
		cleanupPaths: ReadonlyArray<string>;
		sourcePayloadKey?: string;
	}) => Effect.Effect<void, unknown, RCleanup>;
	loadAdapterResult: (
		payload: ImportRunJobData,
	) => Effect.Effect<
		typeof LoadedMediaImportAdapterSuccess.Type | LoadedMediaImportAdapterResult,
		{ cleanupPaths: ReadonlyArray<string>; message: string },
		RLoad
	>;
	resolveExternalId: (input: {
		value: string;
		userId: string;
		scriptId: string;
		executionId: string;
		identifierType: string;
	}) => Effect.Effect<{ externalId: string | null }, SandboxRunError, RResolve>;
	searchEntities?: (input: {
		query: string;
		userId: string;
		scriptId: string;
		executionId: string;
	}) => Effect.Effect<ReadonlyArray<EntitySearchItem>, SandboxRunError, RSearch>;
	importEntity: (input: {
		userId: string;
		scriptId: string;
		externalId: string;
		executionId: string;
		entitySchemaId: string;
		activityPrefix: string;
	}) => Effect.Effect<{ id: string }, SandboxRunError, RImport>;
};

type MediaImportWorkflowOptions = {
	integrationId?: string;
	skipMarkStarted?: boolean;
};

const calculateProgress = (input: {
	base: number;
	span: number;
	groups: number;
	processed: number;
}) =>
	input.groups > 0
		? Math.min(
				input.base + Math.round((input.processed / input.groups) * input.span),
				input.base + input.span,
			)
		: input.base + input.span;

const isProgressUpdateDue = (processed: number, groups: number) =>
	processed % PROGRESS_UPDATE_INTERVAL === 0 || processed === groups;

const activityKey = (value: string) => Buffer.from(value, "utf8").toString("base64url") || "empty";

export const runOneTimeMediaImportWorkflow = <
	RLoad,
	RResolve,
	RImport,
	RSearch = never,
	RCleanup = never,
>(
	payload: ImportRunJobData,
	executionId: string,
	operations: MediaImportWorkflowOperations<RLoad, RResolve, RImport, RSearch, RCleanup>,
	options: MediaImportWorkflowOptions = {},
) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const collections = yield* CollectionsService;
		const entitiesRepository = yield* EntitiesRepository;

		const initialCleanupPaths = payload.filePath ? resolveImportPath(payload.filePath) : [];
		let cleanupPaths: ReadonlyArray<string> = initialCleanupPaths;
		const { cleanupArtifactsBestEffort, failRunAndCleanup } = createImportRunLifecycle(
			payload,
			operations.cleanupArtifacts,
		);
		const mergeCleanupPaths = (paths: ReadonlyArray<string>) => [
			...new Set([...initialCleanupPaths, ...paths]),
		];

		const createProgressReporter = (input: {
			base: number;
			span: number;
			phase: string;
			groups: number;
		}) => {
			let last = -1;

			return (processed: number) =>
				Effect.gen(function* () {
					if (!isProgressUpdateDue(processed, input.groups)) {
						return;
					}

					const progress = calculateProgress({
						processed,
						base: input.base,
						span: input.span,
						groups: input.groups,
					});
					if (progress === last) {
						return;
					}

					last = progress;
					yield* Activity.make({
						error: ImportRunError,
						name: `report-progress-${input.phase}-${processed}`,
						execute: runWithDb(repository.updateRun({ progress, runId: payload.runId })).pipe(
							Effect.mapError(toWorkflowError),
						),
					});
				});
		};
		const processWorkflow = Effect.gen(function* () {
			if (!options.skipMarkStarted) {
				const startedAt = yield* DateTime.nowAsDate;
				yield* Activity.make({
					error: ImportRunError,
					name: "mark-import-run-started",
					execute: runWithDb(
						repository.updateRun({ runId: payload.runId, status: "running", startedAt }),
					).pipe(Effect.mapError(toWorkflowError)),
				});
			}

			const loadOutcome = yield* Activity.make({
				name: "load-media-import-adapter-result",
				success: LoadMediaImportOutcome,
				execute: operations.loadAdapterResult(payload).pipe(
					Effect.map((loaded) =>
						"_tag" in loaded
							? { ...loaded, cleanupPaths: [...loaded.cleanupPaths] }
							: {
									...loaded,
									_tag: "loaded" as const,
									cleanupPaths: [...loaded.cleanupPaths],
								},
					),
					Effect.catchAll((error) =>
						Effect.succeed({
							fallbackToInitialCleanupPaths: false,
							message: error.message,
							_tag: "failed" as const,
							cleanupPaths: [...error.cleanupPaths],
						}),
					),
					Effect.catchAllCause((cause) =>
						Effect.succeed({
							cleanupPaths: [],
							fallbackToInitialCleanupPaths: true,
							_tag: "failed" as const,
							message: unknownToMessage(Cause.squash(cause)),
						}),
					),
				),
			});

			cleanupPaths =
				loadOutcome._tag === "failed"
					? loadOutcome.fallbackToInitialCleanupPaths
						? mergeCleanupPaths(loadOutcome.cleanupPaths)
						: [...loadOutcome.cleanupPaths]
					: mergeCleanupPaths(loadOutcome.cleanupPaths);
			if (loadOutcome._tag === "failed") {
				yield* failRunAndCleanup({
					message: loadOutcome.message,
					cleanupPaths,
					failureName: "fail-import-run-on-load-error",
					cleanupName: "cleanup-import-artifacts-on-load-failure",
				});
				return;
			}

			const adapterResult =
				loadOutcome._tag === "netflix-search-planned"
					? yield* Effect.gen(function* () {
							const searchEntities = operations.searchEntities;
							if (!searchEntities) {
								return yield* new ImportRunError({
									message: "Netflix search planning requires a workflow-owned search operation",
								});
							}

							const searchResponses = yield* Effect.forEach(loadOutcome.searchJobs, (searchJob) =>
								searchEntities({
									query: searchJob.query,
									userId: payload.userId,
									scriptId: searchJob.scriptId,
									executionId: `${executionId}-search-${activityKey(searchJob.jobKey)}`,
								}).pipe(
									Effect.match({
										onFailure: (error) => ({
											error: error.message,
											jobKey: searchJob.jobKey,
											items: [] as ReadonlyArray<EntitySearchItem>,
										}),
										onSuccess: (items) => ({
											error: null,
											jobKey: searchJob.jobKey,
											items,
										}),
									}),
								),
							);

							return yield* Activity.make({
								error: ImportRunError,
								name: "build-netflix-adapter-result",
								success: MediaImportAdapterResultSchema,
								execute: buildNetflixAdapterResult({
									searchResponses,
									importedAt: loadOutcome.importedAt,
									myListPath: loadOutcome.myListPath,
									profileName: loadOutcome.profileName,
									ratingsPath: loadOutcome.ratingsPath,
									viewingActivityPath: loadOutcome.viewingActivityPath,
								}).pipe(Effect.mapError(toWorkflowError)),
							});
						})
					: loadOutcome.adapterResult;

			const entityGroups = adapterResult.entityGroups.map((group) => ({
				...group,
				events: [...group.events],
				entityRef: { ...group.entityRef },
				collectionMemberships: [...group.collectionMemberships],
			}));
			const failures = adapterResult.failures.map((failure) => ({
				stage: failure.stage,
				message: failure.message,
				itemIndex: failure.itemIndex,
				sourceLabel: failure.sourceLabel,
				sourceIdentifier: failure.sourceIdentifier,
				context: failure.context ? { ...failure.context } : undefined,
			}));
			const groups = entityGroups.length;
			const adapterFailureCount = failures.length;

			yield* Effect.forEach(
				failures,
				(failure, index) =>
					Activity.make({
						error: ImportRunError,
						name: `record-adapter-failure-${index}`,
						execute: recordImportRunFailure({
							runId: payload.runId,
							message: failure.message,
							itemIndex: failure.itemIndex,
							context: failure.context ?? null,
							sourceLabel: failure.sourceLabel,
							sourceIdentifier: failure.sourceIdentifier,
							stage: failure.stage ?? "input_transformation",
						}).pipe(Effect.mapError(toWorkflowError)),
					}),
				{ discard: true },
			);

			yield* Activity.make({
				error: ImportRunError,
				name: "record-total-items",
				execute: runWithDb(
					repository.updateRun({ runId: payload.runId, totalItems: groups + adapterFailureCount }),
				).pipe(Effect.mapError(toWorkflowError)),
			});

			const reportResolutionProgress = createProgressReporter({
				groups,
				base: 0,
				span: 30,
				phase: "resolving-entities",
			});
			const reportPopulateProgress = createProgressReporter({
				groups,
				base: 30,
				span: 60,
				phase: "populating-entities",
			});

			let resolveFailures = 0;

			for (let i = 0; i < entityGroups.length; i += 1) {
				const group = entityGroups[i];
				const ref = group?.entityRef;
				if (!group || !ref || ref.kind === "resolved") {
					yield* reportResolutionProgress(i + 1);
					continue;
				}

				const candidates = getResolutionCandidates({
					identifierType: ref.identifierType,
					entitySchemaSlug: ref.entitySchemaSlug,
				});
				if (candidates.length === 0) {
					resolveFailures += 1;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-resolution-failure-${i}`,
						execute: recordImportRunFailure({
							runId: payload.runId,
							stage: "provider_resolution",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.identifierValue,
							entitySchemaSlug: ref.entitySchemaSlug,
							context: { identifierType: ref.identifierType },
							itemIndex: mediaEntityGroupItemIndex(group, i),
							message: `No providers configured to resolve ${ref.identifierType}`,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
					yield* reportResolutionProgress(i + 1);
					continue;
				}

				const candidateScripts = yield* Activity.make({
					error: ImportRunError,
					name: `load-resolution-candidates-${i}`,
					success: Schema.Array(ResolutionCandidate),
					execute: Effect.forEach(
						candidates,
						(scriptSlug) =>
							runWithDb(entitiesRepository.findEntitySchemaScriptBySlug(scriptSlug)).pipe(
								Effect.map((script) => ({
									scriptSlug,
									sandboxScriptId: script?.sandboxScriptId ?? null,
								})),
							),
						{ concurrency: 1 },
					).pipe(Effect.mapError(toWorkflowError)),
				});

				const lookupErrors: string[] = [];
				let resolved = false;

				for (
					let candidateIndex = 0;
					candidateIndex < candidateScripts.length;
					candidateIndex += 1
				) {
					const candidate = candidateScripts[candidateIndex];
					if (!candidate) {
						continue;
					}

					if (!candidate.sandboxScriptId) {
						lookupErrors.push(`${candidate.scriptSlug}: sandbox script not found`);
						continue;
					}

					const result = yield* operations
						.resolveExternalId({
							userId: payload.userId,
							value: ref.identifierValue,
							identifierType: ref.identifierType,
							scriptId: candidate.sandboxScriptId,
							executionId: `${executionId}-resolve-${i}-${candidateIndex}`,
						})
						.pipe(Effect.either);

					if (result._tag === "Left") {
						lookupErrors.push(`${candidate.scriptSlug}: ${result.left.message}`);
						continue;
					}

					if (result.right.externalId) {
						group.entityRef = {
							kind: "resolved",
							sourceLabel: ref.sourceLabel,
							scriptSlug: candidate.scriptSlug,
							externalId: result.right.externalId,
							entitySchemaSlug: ref.entitySchemaSlug,
						} satisfies Extract<ImportEntityRef, { kind: "resolved" }>;
						resolved = true;
						break;
					}
				}

				if (!resolved) {
					resolveFailures += 1;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-resolution-failure-${i}`,
						execute: recordImportRunFailure({
							runId: payload.runId,
							stage: "provider_resolution",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.identifierValue,
							entitySchemaSlug: ref.entitySchemaSlug,
							itemIndex: mediaEntityGroupItemIndex(group, i),
							context: lookupErrors.length > 0 ? { errors: lookupErrors } : null,
							message:
								lookupErrors.length > 0
									? lookupErrors.join("; ")
									: `Could not resolve ${ref.identifierType} to a supported provider`,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
				}

				yield* reportResolutionProgress(i + 1);
			}

			const entityIdsByKey = new Map<string, string>();
			let populateFailures = 0;

			for (let i = 0; i < entityGroups.length; i += 1) {
				const group = entityGroups[i];
				const ref = group?.entityRef;
				if (!group || ref?.kind !== "resolved") {
					yield* reportPopulateProgress(i + 1);
					continue;
				}

				const itemIndex = mediaEntityGroupItemIndex(group, i);
				const script = yield* Activity.make({
					error: ImportRunError,
					name: `load-population-script-${i}`,
					success: Schema.NullOr(PopulationScript),
					execute: runWithDb(entitiesRepository.findEntitySchemaScriptBySlug(ref.scriptSlug)).pipe(
						Effect.map((found) =>
							found
								? { entitySchemaId: found.entitySchemaId, sandboxScriptId: found.sandboxScriptId }
								: null,
						),
						Effect.mapError(toWorkflowError),
					),
				});

				if (!script) {
					populateFailures += 1;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-populate-script-failure-${i}`,
						execute: recordImportRunFailure({
							itemIndex,
							context: null,
							runId: payload.runId,
							sourceLabel: ref.sourceLabel,
							stage: "input_transformation",
							sourceIdentifier: ref.externalId,
							entitySchemaSlug: ref.entitySchemaSlug,
							message: `Sandbox script not found for slug: ${ref.scriptSlug}`,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
					yield* reportPopulateProgress(i + 1);
					continue;
				}

				const populated = yield* operations
					.importEntity({
						userId: payload.userId,
						externalId: ref.externalId,
						scriptId: script.sandboxScriptId,
						activityPrefix: `populate-${i}-`,
						entitySchemaId: script.entitySchemaId,
						executionId: `${executionId}-entity-${i}`,
					})
					.pipe(Effect.either);

				if (populated._tag === "Left") {
					populateFailures += 1;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-populate-failure-${i}`,
						execute: recordImportRunFailure({
							itemIndex,
							context: null,
							runId: payload.runId,
							stage: "provider_details",
							sourceLabel: ref.sourceLabel,
							message: populated.left.message,
							sourceIdentifier: ref.externalId,
							entitySchemaSlug: ref.entitySchemaSlug,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
					yield* reportPopulateProgress(i + 1);
					continue;
				}

				const libraryMembership = yield* Activity.make({
					name: `ensure-library-membership-${i}`,
					success: EnsureLibraryMembershipOutcome,
					execute: collections.ensureEntityInLibrary(payload.userId, populated.right.id).pipe(
						Effect.as({ message: null }),
						Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
					),
				});
				if (libraryMembership.message) {
					populateFailures += 1;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-library-membership-failure-${i}`,
						execute: recordImportRunFailure({
							itemIndex,
							context: null,
							runId: payload.runId,
							stage: "database_commit",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.externalId,
							message: libraryMembership.message,
							entitySchemaSlug: ref.entitySchemaSlug,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
					yield* reportPopulateProgress(i + 1);
					continue;
				}

				entityIdsByKey.set(importEntityRefKey(ref), populated.right.id);
				yield* reportPopulateProgress(i + 1);
			}

			const events = yield* EventsService;
			const eventSchemas = yield* EventSchemasRepository;
			const entitySchemas = yield* EntitySchemasRepository;
			const reportWriteProgress = createProgressReporter({
				groups,
				span: 9,
				base: 90,
				phase: "writing-events",
			});
			const entitySchemaIdsBySlug = new Map<string, string>();
			const collectionIdsByName = new Map<string, string>();
			const eventSchemaIdsByKey = new Map<string, string>();
			const user = { id: payload.userId, name: "", email: "" };
			const ownershipSyncedAt = yield* Activity.make({
				error: ImportRunError,
				success: Schema.String,
				name: "capture-ownership-synced-at",
				execute: DateTime.nowAsDate.pipe(
					Effect.map((date) => date.toISOString()),
					Effect.mapError(toWorkflowError),
				),
			});

			const getEntitySchemaId = (entitySchemaSlug: string) =>
				Effect.gen(function* () {
					const cached = entitySchemaIdsBySlug.get(entitySchemaSlug);
					if (cached) {
						return cached;
					}

					const entitySchemaId = yield* Activity.make({
						error: ImportRunError,
						name: `load-entity-schema-${activityKey(entitySchemaSlug)}`,
						success: Schema.NullOr(Schema.String),
						execute: runWithDb(entitySchemas.getBuiltinBySlug(entitySchemaSlug)).pipe(
							Effect.map((found) => found?.id ?? null),
							Effect.mapError(toWorkflowError),
						),
					});
					if (entitySchemaId) {
						entitySchemaIdsBySlug.set(entitySchemaSlug, entitySchemaId);
					}

					return entitySchemaId;
				});

			const getCollectionId = (collectionName: string) =>
				Effect.gen(function* () {
					const cached = collectionIdsByName.get(collectionName);
					if (cached) {
						return cached;
					}

					const collectionId = yield* Activity.make({
						error: ImportRunError,
						success: Schema.String,
						name: `get-or-create-collection-${activityKey(collectionName)}`,
						execute: collections.getOrCreateCollection(payload.userId, collectionName).pipe(
							Effect.map((collection) => collection.id),
							Effect.mapError(toWorkflowError),
						),
					});
					collectionIdsByName.set(collectionName, collectionId);
					return collectionId;
				});

			const getEventSchemaId = (entitySchemaId: string, eventSchemaSlug: string) =>
				Effect.gen(function* () {
					const schemaKey = `${entitySchemaId}:${eventSchemaSlug}`;
					const cached = eventSchemaIdsByKey.get(schemaKey);
					if (cached) {
						return cached;
					}

					const eventSchemaId = yield* Activity.make({
						error: ImportRunError,
						success: Schema.NullOr(Schema.String),
						name: `load-event-schema-${activityKey(schemaKey)}`,
						execute: runWithDb(
							eventSchemas.getBuiltinBySlug({ entitySchemaId, slug: eventSchemaSlug }),
						).pipe(
							Effect.map((found) => found?.id ?? null),
							Effect.mapError(toWorkflowError),
						),
					});
					if (eventSchemaId) {
						eventSchemaIdsByKey.set(schemaKey, eventSchemaId);
					}

					return eventSchemaId;
				});

			let writeFailures = 0;
			let importedItems = 0;

			for (let i = 0; i < entityGroups.length; i += 1) {
				const group = entityGroups[i];
				const ref = group?.entityRef;
				if (!group || ref?.kind !== "resolved") {
					yield* reportWriteProgress(i + 1);
					continue;
				}

				const entityId = entityIdsByKey.get(importEntityRefKey(ref));
				if (!entityId) {
					yield* reportWriteProgress(i + 1);
					continue;
				}

				const itemIndex = mediaEntityGroupItemIndex(group, i);
				let groupFailed = false;
				const entitySchemaId = yield* getEntitySchemaId(ref.entitySchemaSlug);
				if (!entitySchemaId) {
					writeFailures += 1;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-entity-schema-missing-${i}`,
						execute: recordImportRunFailure({
							itemIndex,
							context: null,
							runId: payload.runId,
							stage: "database_commit",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.externalId,
							entitySchemaSlug: ref.entitySchemaSlug,
							message: `Entity schema not found: ${ref.entitySchemaSlug}`,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
					yield* reportWriteProgress(i + 1);
					continue;
				}

				for (
					let membershipIndex = 0;
					membershipIndex < group.collectionMemberships.length;
					membershipIndex += 1
				) {
					const membership = group.collectionMemberships[membershipIndex];
					if (!membership) {
						continue;
					}

					const collectionId = yield* getCollectionId(membership.collectionName).pipe(
						Effect.either,
					);
					if (collectionId._tag === "Left") {
						groupFailed = true;
						yield* Activity.make({
							error: ImportRunError,
							name: `record-collection-lookup-failure-${i}-${membershipIndex}`,
							execute: recordImportRunFailure({
								itemIndex,
								context: null,
								runId: payload.runId,
								stage: "database_commit",
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: ref.externalId,
								message: collectionId.left.message,
								entitySchemaSlug: ref.entitySchemaSlug,
							}).pipe(Effect.mapError(toWorkflowError)),
						});
						continue;
					}
					const membershipResult = yield* Activity.make({
						name: `add-collection-membership-${i}-${membershipIndex}`,
						success: EnsureLibraryMembershipOutcome,
						execute: collections
							.addToCollection(user, { entityId, collectionId: collectionId.right, properties: {} })
							.pipe(
								Effect.as({ message: null }),
								Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
							),
					});
					if (membershipResult.message) {
						groupFailed = true;
						yield* Activity.make({
							error: ImportRunError,
							name: `record-collection-write-failure-${i}-${membershipIndex}`,
							execute: recordImportRunFailure({
								itemIndex,
								context: null,
								runId: payload.runId,
								stage: "database_commit",
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: ref.externalId,
								message: membershipResult.message,
								entitySchemaSlug: ref.entitySchemaSlug,
							}).pipe(Effect.mapError(toWorkflowError)),
						});
					}
				}

				for (let eventIndex = 0; eventIndex < group.events.length; eventIndex += 1) {
					const event = group.events[eventIndex];
					if (!event) {
						continue;
					}

					const eventSchemaId = yield* getEventSchemaId(entitySchemaId, event.eventSchemaSlug);
					if (!eventSchemaId) {
						groupFailed = true;
						yield* Activity.make({
							error: ImportRunError,
							name: `record-event-schema-missing-${i}-${eventIndex}`,
							execute: recordImportRunFailure({
								itemIndex,
								context: null,
								runId: payload.runId,
								stage: "database_commit",
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: ref.externalId,
								eventSchemaSlug: event.eventSchemaSlug,
								entitySchemaSlug: ref.entitySchemaSlug,
								message: `Event schema not found: ${event.eventSchemaSlug}`,
							}).pipe(Effect.mapError(toWorkflowError)),
						});
						continue;
					}

					const eventPayload = [
						{
							entityId,
							eventSchemaId,
							occurredAt: event.occurredAt,
							properties: event.properties,
						},
					];
					const eventWrite = yield* Activity.make({
						name: `write-event-${i}-${eventIndex}`,
						success: EnsureLibraryMembershipOutcome,
						execute: (options.integrationId
							? events.createForIntegration({
									userId: payload.userId,
									payload: eventPayload,
									importRunId: payload.runId,
									integrationId: options.integrationId,
								})
							: events.createForImport(payload.userId, eventPayload, payload.runId)
						).pipe(
							Effect.as({ message: null }),
							Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
						),
					});
					if (eventWrite.message) {
						groupFailed = true;
						yield* Activity.make({
							error: ImportRunError,
							name: `record-event-write-failure-${i}-${eventIndex}`,
							execute: recordImportRunFailure({
								itemIndex,
								context: null,
								runId: payload.runId,
								stage: "database_commit",
								message: eventWrite.message,
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: ref.externalId,
								eventSchemaSlug: event.eventSchemaSlug,
								entitySchemaSlug: ref.entitySchemaSlug,
							}).pipe(Effect.mapError(toWorkflowError)),
						});
					}
				}

				if (group.ownershipProvider) {
					const ownershipResult = yield* Activity.make({
						name: `mark-library-ownership-${i}`,
						success: EnsureLibraryMembershipOutcome,
						execute: collections
							.markEntityOwnedInLibrary({
								entityId,
								userId: payload.userId,
								syncedAt: ownershipSyncedAt,
								provider: group.ownershipProvider,
							})
							.pipe(
								Effect.as({ message: null }),
								Effect.catchAll((error) => Effect.succeed({ message: unknownToMessage(error) })),
							),
					});
					if (ownershipResult.message) {
						groupFailed = true;
						yield* Activity.make({
							error: ImportRunError,
							name: `record-ownership-write-failure-${i}`,
							execute: recordImportRunFailure({
								itemIndex,
								context: null,
								runId: payload.runId,
								stage: "database_commit",
								sourceLabel: ref.sourceLabel,
								message: ownershipResult.message,
								sourceIdentifier: ref.externalId,
								entitySchemaSlug: ref.entitySchemaSlug,
							}).pipe(Effect.mapError(toWorkflowError)),
						});
					}
				}

				if (groupFailed) {
					writeFailures += 1;
				} else {
					importedItems += 1;
				}

				yield* reportWriteProgress(i + 1);
			}

			const failedItems = adapterFailureCount + resolveFailures + populateFailures + writeFailures;
			const processedItems = adapterFailureCount + groups;

			const finishedAt = yield* DateTime.nowAsDate;
			yield* Activity.make({
				error: ImportRunError,
				name: "finalize-import-run",
				execute: runWithDb(
					repository.updateRun({
						finishedAt,
						failedItems,
						progress: 100,
						importedItems,
						processedItems,
						status: "completed",
						runId: payload.runId,
					}),
				).pipe(Effect.mapError(toWorkflowError)),
			});

			yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", cleanupPaths);
		});

		yield* processWorkflow.pipe(
			Effect.catchAllCause((cause) =>
				failRunAndCleanup({
					failureName: "fail-import-run-unexpected",
					message: unknownToMessage(Cause.squash(cause)),
					cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
					cleanupPaths: cleanupPaths.length > 0 ? cleanupPaths : initialCleanupPaths,
				}),
			),
		);
	});
