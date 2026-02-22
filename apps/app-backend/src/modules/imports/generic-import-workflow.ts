import { unknownToMessage } from "@ryot/contract/errors";
import { CreateEventItem } from "@ryot/contract/modules/events/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import {
	genericImportChunkSchema,
	genericImportWorkflowResultSchema,
	type GenericImportWriteItem,
} from "@ryot/sandbox-sdk/imports";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { DateTime, Effect, Schema, FileSystem, Path } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import { sandboxHarvestPathError } from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import { type DurableSchema, withoutWorkflowParent } from "#lib/infrastructure/workflow";
import { slugify } from "#lib/shared/slug";
import { AddEntityToCollectionWorkflow } from "#modules/collections/add-entity-to-collection-workflow";
import { CollectionsService } from "#modules/collections/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventCreateWorkflow } from "#modules/events/event-create-workflow";
import { RelationshipsService } from "#modules/relationships/service";

import { PROGRESS_UPDATE_INTERVAL, recordImportRunFailure } from "./runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { ImportsService, type UpdateImportRunInput } from "./service";

export const ProcessGenericImportChunksPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	executionId: Schema.String,
	chunkFiles: Schema.Array(Schema.String),
	expectedHarvestDirectoryPrefix: Schema.String,
	failRun: Schema.optional(Schema.Boolean),
	integrationId: Schema.optional(IntegrationId),
	failureCount: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	totalItems: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	writeItemCount: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});

export const ProcessGenericImportChunksWorkflow = Workflow.make(
	"ProcessGenericImportChunksWorkflow",
	{
		error: ImportRunError satisfies DurableSchema,
		success: genericImportWorkflowResultSchema satisfies DurableSchema,
		payload: ProcessGenericImportChunksPayload satisfies DurableSchema,
		idempotencyKey: ({ executionId }) => executionId,
	},
);

const ItemWriteOutcome = Schema.Union([
	Schema.TaggedStruct("failed", { message: Schema.String }),
	Schema.TaggedStruct("ready", {
		events: Schema.Array(CreateEventItem),
		collectionMemberships: Schema.Array(
			Schema.Struct({ entityId: EntityId, collectionId: EntityId }),
		),
	}),
]);

export const requireHarvestedChunkPath = Effect.fn("imports.requireHarvestedChunkPath")(function* (
	filePath: string,
	expectedDirectoryPrefix: string,
) {
	const path = yield* Path.Path;
	const pathError = sandboxHarvestPathError(path, filePath, expectedDirectoryPrefix);
	if (pathError) {
		return yield* new ImportRunError({ message: pathError });
	}
	const directory = path.dirname(filePath);
	return { directory, filePath };
});

const valuesMatch = (properties: Record<string, unknown>, expected: Record<string, unknown>) =>
	Object.entries(expected).every(
		([key, value]) => JSON.stringify(properties[key]) === JSON.stringify(value),
	);

const resolveEntityIntents = Effect.fn("imports.resolveGenericEntityIntents")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
) {
	const runWithDb = yield* DbRunner;
	const entities = yield* EntitiesService;
	const aliases = new Map<string, EntityId>();
	const repository = yield* EntitiesRepository;

	for (const intent of item.entities) {
		if (aliases.has(intent.alias)) {
			return yield* new ImportRunError({
				message: `Duplicate import entity alias '${intent.alias}'`,
			});
		}
		let entityId: EntityId | undefined;
		if (intent.entityId) {
			const existing = yield* runWithDb(
				repository.getByIdForUser({ userId, entityId: EntityId.make(intent.entityId) }),
			);
			if (!existing || existing.entitySchemaSlug !== intent.entitySchemaSlug) {
				return yield* new ImportRunError({
					message: "Import entity id is unavailable or has the wrong schema",
				});
			}
			entityId = existing.id;
		} else if (intent.match) {
			const candidates = yield* runWithDb(
				repository.listMatchCandidatesBySchema({
					userId,
					entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
				}),
			);
			const scopedCandidates = intent.scope
				? yield* runWithDb(
						Effect.forEach(candidates, (candidate) =>
							repository
								.getEntityScopeForUser({ userId, entityId: candidate.id })
								.pipe(
									Effect.map((scope) =>
										(
											intent.scope === "user"
												? scope?.entityUserId === userId
												: scope?.entityUserId === null
										)
											? [candidate]
											: [],
									),
								),
						).pipe(Effect.map((groups) => groups.flat())),
					)
				: candidates;
			const expectedName =
				intent.match.nameNormalization === "slug" ? slugify(intent.match.name) : intent.match.name;
			const existing = scopedCandidates.find((candidate) => {
				const candidateName =
					intent.match?.nameNormalization === "slug" ? slugify(candidate.name) : candidate.name;
				return (
					candidateName === expectedName &&
					isObjectRecord(candidate.properties) &&
					valuesMatch(candidate.properties, intent.match?.properties ?? {})
				);
			});
			entityId = existing?.id;
		}
		if (entityId && intent.scope && intent.entityId) {
			const scope = yield* runWithDb(repository.getEntityScopeForUser({ userId, entityId }));
			const matchesScope =
				intent.scope === "user" ? scope?.entityUserId === userId : scope?.entityUserId === null;
			if (!matchesScope) {
				entityId = undefined;
			}
		}
		if (!entityId && intent.existingOnly) {
			return yield* new ImportRunError({
				message: `Required import entity '${intent.alias}' was not found`,
			});
		}
		entityId ??= (yield* entities.create({
			userId,
			scope: "user",
			name: intent.name,
			properties: intent.properties,
			entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
		})).id;
		aliases.set(intent.alias, entityId);
	}
	return aliases;
});

const writeGenericItem = (item: GenericImportWriteItem, userId: UserId, index: number) =>
	Activity.make({
		name: `write-generic-import-item-${index}`,
		success: ItemWriteOutcome,
		execute: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const definitions = yield* DefinitionRegistry;
			const collections = yield* CollectionsService;
			const relationships = yield* RelationshipsService;
			const entitiesRepository = yield* EntitiesRepository;
			const entitySchemasByAlias = new Map(
				item.entities.map(({ alias, entitySchemaSlug }) => [alias, entitySchemaSlug]),
			);
			if (!entitySchemasByAlias.has(item.subjectEntityAlias)) {
				return yield* new ImportRunError({
					message: "Import subject references an unknown entity alias",
				});
			}
			for (const event of item.events) {
				const subject =
					event.subjectEntityId !== undefined
						? yield* runWithDb(
								entitiesRepository.getByIdForUser({
									userId,
									entityId: EntityId.make(event.subjectEntityId),
								}),
							)
						: null;
				if (event.subjectEntityId !== undefined && !subject) {
					return yield* new ImportRunError({
						message: "Import event references an unknown subject entity",
					});
				}
				const entitySchemaSlug =
					subject?.entitySchemaSlug ?? entitySchemasByAlias.get(event.entityAlias);
				if (!entitySchemaSlug) {
					return yield* new ImportRunError({
						message: "Import event references an unknown entity alias or subject",
					});
				}
				yield* definitions.validateEventProperties(
					entitySchemaSlug,
					event.eventSchemaSlug,
					event.properties,
				);
			}
			for (const relationship of item.relationships) {
				const sourceEntitySchemaSlug = entitySchemasByAlias.get(relationship.sourceAlias);
				const targetEntitySchemaSlug = entitySchemasByAlias.get(relationship.targetAlias);
				if (!sourceEntitySchemaSlug || !targetEntitySchemaSlug) {
					return yield* new ImportRunError({
						message: "Import relationship references an unknown entity alias",
					});
				}
				const relationshipSchema = definitions.getRelationshipSchema(
					relationship.relationshipSchemaSlug,
				);
				if (!relationshipSchema) {
					return yield* new ImportRunError({
						message: `Relationship schema '${relationship.relationshipSchemaSlug}' not found`,
					});
				}
				if (
					relationshipSchema.sourceEntitySchemaSlug !== null &&
					relationshipSchema.sourceEntitySchemaSlug !== sourceEntitySchemaSlug
				) {
					return yield* new ImportRunError({
						message: "Import relationship source entity schema does not match",
					});
				}
				if (
					relationshipSchema.targetEntitySchemaSlug !== null &&
					relationshipSchema.targetEntitySchemaSlug !== targetEntitySchemaSlug
				) {
					return yield* new ImportRunError({
						message: "Import relationship target entity schema does not match",
					});
				}
				yield* definitions.validateRelationshipProperties(
					relationship.relationshipSchemaSlug,
					relationship.properties,
				);
			}
			const aliases = yield* resolveEntityIntents(item, userId);
			for (const intent of item.relationships) {
				const sourceEntityId = aliases.get(intent.sourceAlias);
				const targetEntityId = aliases.get(intent.targetAlias);
				if (!sourceEntityId || !targetEntityId) {
					return yield* new ImportRunError({
						message: "Import relationship references an unknown entity alias",
					});
				}
				const relationshipSchema = definitions.getRelationshipSchema(intent.relationshipSchemaSlug);
				if (!relationshipSchema) {
					return yield* new ImportRunError({
						message: `Relationship schema '${intent.relationshipSchemaSlug}' not found`,
					});
				}
				const input = {
					userId,
					scope: "user",
					sourceEntityId,
					targetEntityId,
					properties: intent.properties,
					propertiesSchema: relationshipSchema.propertiesSchema,
					relationshipSchemaSlug: RelationshipSchemaSlug.make(intent.relationshipSchemaSlug),
				} as const;
				yield* intent.propertiesMode === "merge"
					? relationships.mergeUserProperties(input)
					: relationships.create(input);
			}
			const events: CreateEventItem[] = [];
			const collectionMemberships: Array<{ entityId: EntityId; collectionId: EntityId }> = [];
			for (const intent of item.events) {
				const entityId =
					intent.subjectEntityId !== undefined
						? EntityId.make(intent.subjectEntityId)
						: aliases.get(intent.entityAlias);
				const sessionEntityId = intent.sessionEntityAlias
					? aliases.get(intent.sessionEntityAlias)
					: undefined;
				if (!entityId || (intent.sessionEntityAlias && !sessionEntityId)) {
					return yield* new ImportRunError({
						message: "Import event references an unknown entity alias",
					});
				}
				events.push({
					entityId,
					properties: intent.properties,
					occurredAt: intent.occurredAt,
					eventSchemaSlug: EventSchemaSlug.make(intent.eventSchemaSlug),
					...(sessionEntityId ? { sessionEntityId } : {}),
				});
			}
			for (const membership of item.collectionMemberships ?? []) {
				const entityId = aliases.get(membership.entityAlias);
				if (!entityId) {
					return yield* new ImportRunError({
						message: "Import collection membership references an unknown entity alias",
					});
				}
				const collection = yield* collections.getOrCreateCollection(
					userId,
					membership.collectionName,
				);
				collectionMemberships.push({ entityId, collectionId: collection.id });
			}
			return { _tag: "ready" as const, events, collectionMemberships };
		}).pipe(
			Effect.catch((error) =>
				Effect.succeed({ _tag: "failed" as const, message: unknownToMessage(error) }),
			),
		),
	});

const readChunk = (path: string, expectedDirectoryPrefix: string, index: number) =>
	Activity.make({
		error: ImportRunError,
		success: genericImportChunkSchema,
		name: `read-generic-import-chunk-${index}`,
		execute: Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const safePath = yield* requireHarvestedChunkPath(path, expectedDirectoryPrefix);
			const text = yield* fs.readFileString(safePath.filePath);
			return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(genericImportChunkSchema))(
				text,
			);
		}).pipe(Effect.mapError(toWorkflowError)),
	});

const removeChunks = (paths: ReadonlyArray<string>, expectedDirectoryPrefix: string) =>
	Activity.make({
		name: "remove-consumed-generic-import-chunks",
		execute: Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const directories = yield* Effect.forEach(paths, (path) =>
				requireHarvestedChunkPath(path, expectedDirectoryPrefix).pipe(
					Effect.map((safePath) => safePath.directory),
					Effect.option,
				),
			);
			yield* Effect.forEach(
				new Set(
					directories.flatMap((directory) => (directory._tag === "Some" ? [directory.value] : [])),
				),
				(path) => fs.remove(path, { force: true, recursive: true }).pipe(Effect.ignore),
				{ discard: true },
			);
		}),
	});

const updateRun = (name: string, input: UpdateImportRunInput) =>
	Activity.make({
		name,
		error: ImportRunError,
		execute: Effect.gen(function* () {
			const imports = yield* ImportsService;
			yield* imports.update(input);
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const runProcessGenericImportChunksWorkflow = Effect.fn(
	"ProcessGenericImportChunksWorkflow",
)(function* (payload: typeof ProcessGenericImportChunksPayload.Type, executionId: string) {
	let failedItems = 0;
	let importedItems = 0;
	let processedItems = 0;
	let observedFailureCount = 0;
	let observedWriteItemCount = 0;
	let errorSummary: string | undefined;
	const runId = ImportRunId.make(payload.runId);

	const process = Effect.gen(function* () {
		yield* updateRun("record-generic-import-total", { runId, totalItems: payload.totalItems });
		for (let chunkIndex = 0; chunkIndex < payload.chunkFiles.length; chunkIndex += 1) {
			const path = payload.chunkFiles[chunkIndex];
			if (!path) {
				continue;
			}
			const chunk = yield* readChunk(path, payload.expectedHarvestDirectoryPrefix, chunkIndex);
			for (const failure of chunk.failures) {
				observedFailureCount += 1;
				errorSummary ??= failure.message;
				yield* Activity.make({
					error: ImportRunError,
					name: `record-generic-import-failure-${processedItems}`,
					execute: recordImportRunFailure({
						...failure,
						runId,
						stage: failure.stage ?? "input_transformation",
					}).pipe(Effect.mapError(toWorkflowError)),
				});
				failedItems += 1;
				processedItems += 1;
			}
			for (const item of chunk.items) {
				observedWriteItemCount += 1;
				const outcome = yield* writeGenericItem(item, payload.userId, processedItems);
				let message = outcome._tag === "failed" ? outcome.message : null;
				if (outcome._tag === "ready") {
					const engine = yield* WorkflowEngine;
					for (const [membershipIndex, membership] of outcome.collectionMemberships.entries()) {
						const collectionExecutionId = `${executionId}-item-${processedItems}-collection-${membershipIndex}`;
						const collectionResult = yield* engine
							.execute(AddEntityToCollectionWorkflow, {
								executionId: collectionExecutionId,
								payload: {
									properties: {},
									userId: payload.userId,
									entityId: membership.entityId,
									executionId: collectionExecutionId,
									collectionId: membership.collectionId,
								},
							})
							.pipe(Effect.result);
						if (collectionResult._tag === "Failure" && !message) {
							message = unknownToMessage(collectionResult.failure);
						}
					}
					if (outcome.events.length > 0) {
						const integrationId = payload.integrationId;
						const eventResult = yield* engine
							.execute(EventCreateWorkflow, {
								executionId: `${executionId}-item-${processedItems}-events`,
								payload: {
									importRunId: runId,
									userId: payload.userId,
									payload: outcome.events,
									...(integrationId ? { integrationId } : {}),
									origin: integrationId ? "integration" : "import",
									executionId: `${executionId}-item-${processedItems}-events`,
									lifecycleOrigin: integrationId
										? { kind: "integration", importRunId: runId, integrationId }
										: { kind: "import", importRunId: runId },
								},
							})
							.pipe(withoutWorkflowParent, Effect.mapError(toWorkflowError));
						message ??= eventResult.failure?.reason.message ?? null;
					}
				}
				if (message) {
					failedItems += 1;
					errorSummary ??= message;
					yield* Activity.make({
						error: ImportRunError,
						name: `record-generic-write-failure-${processedItems}`,
						execute: recordImportRunFailure({
							runId,
							message,
							stage: "database_commit",
							itemIndex: item.itemIndex,
							sourceLabel: item.sourceLabel,
							sourceIdentifier: item.sourceIdentifier,
							entitySchemaSlug:
								item.entities.find(({ alias }) => alias === item.subjectEntityAlias)
									?.entitySchemaSlug ?? null,
						}).pipe(Effect.mapError(toWorkflowError)),
					});
				} else {
					importedItems += 1;
				}
				processedItems += 1;
				if (
					processedItems % PROGRESS_UPDATE_INTERVAL === 0 ||
					processedItems === payload.totalItems
				) {
					yield* updateRun(`report-generic-import-progress-${processedItems}`, {
						runId,
						failedItems,
						importedItems,
						processedItems,
						progress:
							payload.totalItems > 0
								? Math.round((processedItems / payload.totalItems) * 100)
								: 100,
					});
				}
			}
		}
		if (
			observedFailureCount !== payload.failureCount ||
			observedWriteItemCount !== payload.writeItemCount ||
			processedItems !== payload.totalItems
		) {
			return yield* new ImportRunError({ message: "Import chunk manifest counts do not match" });
		}
		return undefined;
	});

	yield* process.pipe(
		Effect.ensuring(removeChunks(payload.chunkFiles, payload.expectedHarvestDirectoryPrefix)),
	);
	const finishedAt = yield* DateTime.nowAsDate;
	yield* updateRun("finalize-generic-import", {
		runId,
		finishedAt,
		failedItems,
		importedItems,
		progress: 100,
		processedItems,
		status: payload.failRun ? "failed" : "completed",
		...(payload.failRun && errorSummary ? { errorSummary } : {}),
	});
	return { failedItems, importedItems, processedItems };
});

export const ProcessGenericImportChunksWorkflowDefinitionsLive =
	ProcessGenericImportChunksWorkflow.toLayer(runProcessGenericImportChunksWorkflow);
