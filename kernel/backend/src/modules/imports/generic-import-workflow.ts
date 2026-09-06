import { unknownToMessage } from "@ryot-app/contract/errors";
import {
	AutomationWarning,
	type AutomationWarning as AutomationWarningValue,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunFailureStage } from "@ryot-app/contract/modules/imports/types";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	genericImportChunkSchema,
	genericImportWorkflowResultSchema,
	type GenericImportWriteItem,
} from "@ryot-app/sandbox-sdk/imports";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Cause, DateTime, Effect, FileSystem, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { slugify } from "#lib/shared/slug";
import { AddEntityToCollectionWorkflow } from "#modules/collections/add-entity-to-collection-workflow";
import { CollectionsService } from "#modules/collections/service";
import {
	DefinitionSnapshot,
	definitionSourceFromSnapshot,
	makeDefinitionRegistry,
} from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsService } from "#modules/relationships/service";

import { PROGRESS_UPDATE_INTERVAL, recordImportRunFailure } from "./runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { ImportsService, type UpdateImportRunInput } from "./service";

export const ProcessGenericImportChunksPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	command: LifecycleCommand,
	executionId: Schema.String,
	artifactOwnerExecutionId: Schema.String,
	failRun: Schema.optional(Schema.Boolean),
	chunkHandles: Schema.Array(Schema.String),
	artifactReferenceExecutionId: Schema.String,
	integrationId: Schema.optional(IntegrationId),
	totalItems: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	failureCount: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	writeItemCount: Schema.Finite.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(value) =>
				(value.command.causation.importRunId === value.runId &&
					(value.integrationId === undefined
						? value.command.causation.source === "import" &&
							value.command.causation.integrationId === undefined
						: value.command.causation.source === "integration" &&
							value.command.causation.integrationId === value.integrationId)) ||
				"Generic import command does not match its trusted integration subject",
		),
	),
);

const failureReasonByStage = {
	event_policy: { code: "event-policy-failed" },
	source_fetch: { code: "source-fetch-failed" },
	database_commit: { code: "database-commit-failed" },
	provider_details: { code: "provider-details-failed" },
	provider_resolution: { code: "provider-resolution-failed" },
	input_transformation: { code: "input-transformation-failed" },
} as const satisfies Record<ImportRunFailureStage, ImportRunFailureReason>;

export const ProcessGenericImportChunksWorkflow = Workflow.make(
	"ProcessGenericImportChunksWorkflow",
	{
		error: ImportRunError satisfies DurableSchema,
		idempotencyKey: ({ executionId }) => executionId,
		success: genericImportWorkflowResultSchema satisfies DurableSchema,
		payload: ProcessGenericImportChunksPayload satisfies DurableSchema,
	},
);

const ItemWriteOutcome = Schema.Union([
	Schema.TaggedStruct("failed", {
		message: Schema.String,
		warnings: Schema.Array(AutomationWarning),
	}),
	Schema.TaggedStruct("ready", {
		events: Schema.Array(CreateEventItem),
		warnings: Schema.Array(AutomationWarning),
		collectionMemberships: Schema.Array(
			Schema.Struct({ entityId: EntityId, collectionId: EntityId }),
		),
	}),
]);

const valuesMatch = (properties: Record<string, unknown>, expected: Record<string, unknown>) =>
	Object.entries(expected).every(
		([key, value]) => JSON.stringify(properties[key]) === JSON.stringify(value),
	);

const itemCommand = (
	command: LifecycleCommand,
	itemIndex: number,
	phase: "collection" | "entity" | "event" | "relationship",
	identity: number | string,
): LifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, "item", itemIndex, phase, identity]),
});

const resolveEntityIntents = Effect.fn("imports.resolveGenericEntityIntents")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	itemIndex: number,
	command: LifecycleCommand,
) {
	const entities = yield* EntitiesService;
	const aliases = new Map<string, EntityId>();
	const warnings: AutomationWarningValue[] = [];
	const repository = yield* EntitiesRepository;

	for (const [intentIndex, intent] of item.entities.entries()) {
		if (aliases.has(intent.alias)) {
			return yield* new ImportRunError({
				message: `Duplicate import entity alias '${intent.alias}'`,
			});
		}
		let entityId: EntityId | undefined;
		if (intent.entityId) {
			const existing = yield* repository.getByIdForUser({
				userId,
				entityId: EntityId.make(intent.entityId),
			});
			if (!existing || existing.entitySchemaSlug !== intent.entitySchemaSlug) {
				return yield* new ImportRunError({
					message: "Import entity id is unavailable or has the wrong schema",
				});
			}
			entityId = existing.id;
		} else if (intent.match) {
			const candidates = yield* repository.listMatchCandidatesBySchema({
				userId,
				entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
			});
			const scopedCandidates = intent.scope
				? yield* Effect.forEach(candidates, (candidate) =>
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
					).pipe(Effect.map((groups) => groups.flat()))
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
			const scope = yield* repository.getEntityScopeForUser({ userId, entityId });
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
		if (!entityId) {
			const created = yield* entities.create({
				userId,
				scope: "user",
				name: intent.name,
				properties: intent.properties,
				entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
				lifecycle: itemCommand(command, itemIndex, "entity", intentIndex),
			});
			entityId = created.entity.id;
			warnings.push(...created.warnings);
		}
		aliases.set(intent.alias, entityId);
	}
	return { aliases, warnings };
});

type GenericImportDefinitions = ReturnType<typeof makeDefinitionRegistry>;

const writeGenericItem = (
	item: GenericImportWriteItem,
	userId: UserId,
	index: number,
	definitions: GenericImportDefinitions,
	command: LifecycleCommand,
) =>
	Activity.make({
		success: ItemWriteOutcome,
		name: `write-generic-import-item-${index}`,
		execute: Effect.gen(function* () {
			const warnings: AutomationWarningValue[] = [];
			return yield* Effect.gen(function* () {
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
				yield* Effect.forEach(
					item.entities,
					(entity) =>
						definitions.validateEntityProperties(entity.entitySchemaSlug, entity.properties),
					{ discard: true },
				);
				for (const event of item.events) {
					const subject =
						event.subjectEntityId !== undefined
							? yield* entitiesRepository.getByIdForUser({
									userId,
									entityId: EntityId.make(event.subjectEntityId),
								})
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
				const resolved = yield* resolveEntityIntents(item, userId, index, command);
				warnings.push(...resolved.warnings);
				const { aliases } = resolved;
				for (const [relationshipIndex, intent] of item.relationships.entries()) {
					const sourceEntityId = aliases.get(intent.sourceAlias);
					const targetEntityId = aliases.get(intent.targetAlias);
					if (!sourceEntityId || !targetEntityId) {
						return yield* new ImportRunError({
							message: "Import relationship references an unknown entity alias",
						});
					}
					const relationshipSchema = definitions.getRelationshipSchema(
						intent.relationshipSchemaSlug,
					);
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
						relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
						relationshipSchemaSlug: RelationshipSchemaSlug.make(intent.relationshipSchemaSlug),
					} as const;
					const result = yield* intent.propertiesMode === "merge"
						? relationships.mergeUserProperties(
								input,
								itemCommand(command, index, "relationship", relationshipIndex),
							)
						: relationships.create(
								input,
								itemCommand(command, index, "relationship", relationshipIndex),
							);
					warnings.push(...result.warnings);
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
				return { events, warnings, collectionMemberships, _tag: "ready" as const };
			}).pipe(
				Effect.catch((error) =>
					Effect.succeed({ warnings, _tag: "failed" as const, message: unknownToMessage(error) }),
				),
			);
		}),
	});

const readChunk = (ownerExecutionId: string, handle: string, index: number) =>
	Activity.make({
		error: ImportRunError,
		success: genericImportChunkSchema,
		name: `read-generic-import-chunk-${index}`,
		execute: Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const artifacts = yield* SandboxArtifactStore;
			const [path] = yield* artifacts.resolveOutputs(ownerExecutionId, [handle]);
			if (!path) {
				return yield* new ImportRunError({ message: "Import chunk handle was not resolved" });
			}
			const text = yield* fs.readFileString(path);
			return yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(text);
		}).pipe(Effect.mapError(toWorkflowError)),
	});

const artifactReference = (
	operation: "release" | "retain",
	ownerExecutionId: string,
	referenceExecutionId: string,
) =>
	Activity.make({
		error: ImportRunError,
		name: `${operation}-generic-import-artifacts`,
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts[operation](ownerExecutionId, referenceExecutionId);
		}).pipe(Effect.mapError(toWorkflowError)),
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

const resolveGenericImportDefinitions = (userId: UserId) =>
	Activity.make({
		name: "resolve-generic-import-definitions",
		error: ImportRunError satisfies DurableSchema,
		success: DefinitionSnapshot satisfies DurableSchema,
		execute: Effect.flatMap(PluginRuntimeResolver, (runtime) =>
			runtime.getEffectiveDefinitions(userId),
		).pipe(Effect.mapError(toWorkflowError)),
	});

export const runProcessGenericImportChunksWorkflow = Effect.fn(
	"ProcessGenericImportChunksWorkflow",
)(function* (payload: typeof ProcessGenericImportChunksPayload.Type, executionId: string) {
	let failedItems = 0;
	let importedItems = 0;
	let processedItems = 0;
	let observedFailureCount = 0;
	let observedWriteItemCount = 0;
	let failureReason: ImportRunFailureReason | undefined;
	const runId = ImportRunId.make(payload.runId);
	const snapshot = yield* resolveGenericImportDefinitions(payload.userId);
	const definitions = makeDefinitionRegistry(definitionSourceFromSnapshot(snapshot));

	const process = Effect.gen(function* () {
		yield* updateRun("record-generic-import-total", { runId, totalItems: payload.totalItems });
		for (let chunkIndex = 0; chunkIndex < payload.chunkHandles.length; chunkIndex += 1) {
			const handle = payload.chunkHandles[chunkIndex];
			if (!handle) {
				continue;
			}
			const chunk = yield* readChunk(payload.artifactOwnerExecutionId, handle, chunkIndex);
			for (const failure of chunk.failures) {
				const stage = failure.stage ?? "input_transformation";
				observedFailureCount += 1;
				failureReason ??= failureReasonByStage[stage];
				yield* Effect.logWarning("plugin import item failed", failure.message).pipe(
					Effect.annotateLogs({ runId, stage, itemIndex: failure.itemIndex }),
				);
				yield* Activity.make({
					error: ImportRunError,
					name: `record-generic-import-failure-${processedItems}`,
					execute: recordImportRunFailure({
						runId,
						stage,
						itemIndex: failure.itemIndex,
						sourceLabel: failure.sourceLabel,
						reason: failureReasonByStage[stage],
						sourceIdentifier: failure.sourceIdentifier,
						entitySchemaSlug: failure.entitySchemaSlug,
					}).pipe(Effect.mapError(toWorkflowError)),
				});
				failedItems += 1;
				processedItems += 1;
			}
			for (const item of chunk.items) {
				observedWriteItemCount += 1;
				const outcome = yield* writeGenericItem(
					item,
					payload.userId,
					processedItems,
					definitions,
					payload.command,
				);
				let message = outcome._tag === "failed" ? outcome.message : null;
				const warnings = [...outcome.warnings];
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
									command: itemCommand(
										payload.command,
										processedItems,
										"collection",
										membershipIndex,
									),
								},
							})
							.pipe(Effect.result);
						if (collectionResult._tag === "Failure" && !message) {
							message = unknownToMessage(collectionResult.failure);
						} else if (collectionResult._tag === "Success") {
							warnings.push(...collectionResult.success.warnings);
						}
					}
					if (outcome.events.length > 0) {
						const events = yield* EventsService;
						const eventResult = yield* events
							.create(
								{ userId: payload.userId, payload: outcome.events },
								itemCommand(payload.command, processedItems, "event", "batch"),
							)
							.pipe(Effect.mapError(toWorkflowError));
						warnings.push(...eventResult.warnings);
						message ??= eventResult.failure?.reason.code ?? null;
					}
				}
				if (warnings.length > 0) {
					yield* Effect.logWarning("generic import item completed with automation warnings").pipe(
						Effect.annotateLogs({ runId, warnings, itemIndex: item.itemIndex }),
					);
				}
				if (message) {
					failedItems += 1;
					failureReason ??= { code: "database-commit-failed" };
					yield* Effect.logError("generic import item write failed", message).pipe(
						Effect.annotateLogs({ runId, itemIndex: item.itemIndex }),
					);
					yield* Activity.make({
						error: ImportRunError,
						name: `record-generic-write-failure-${processedItems}`,
						execute: recordImportRunFailure({
							runId,
							stage: "database_commit",
							itemIndex: item.itemIndex,
							sourceLabel: item.sourceLabel,
							sourceIdentifier: item.sourceIdentifier,
							reason: { code: "database-commit-failed" },
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

	const retain = artifactReference(
		"retain",
		payload.artifactOwnerExecutionId,
		payload.artifactReferenceExecutionId,
	);
	const release = artifactReference(
		"release",
		payload.artifactOwnerExecutionId,
		payload.artifactReferenceExecutionId,
	);
	return yield* Effect.gen(function* () {
		yield* retain;
		yield* process;
		const finishedAt = yield* DateTime.nowAsDate;
		yield* updateRun("finalize-generic-import", {
			runId,
			finishedAt,
			failedItems,
			importedItems,
			progress: 100,
			processedItems,
			status: payload.failRun ? "failed" : "completed",
			...(payload.failRun && failureReason ? { failureReason } : {}),
		});
		return { failedItems, importedItems, processedItems };
	}).pipe(
		Effect.matchCauseEffect({
			onSuccess: (result) => release.pipe(Effect.as(result)),
			onFailure: (cause) =>
				Effect.flatMap(WorkflowInstance, (instance) =>
					instance.suspended && Cause.hasInterruptsOnly(cause)
						? Effect.failCause(cause)
						: release.pipe(Effect.andThen(Effect.failCause(cause))),
				),
		}),
	);
});

export const ProcessGenericImportChunksWorkflowDefinitionsLive =
	ProcessGenericImportChunksWorkflow.toLayer(runProcessGenericImportChunksWorkflow);
