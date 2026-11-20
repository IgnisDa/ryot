import { unknownToMessage } from "@ryot-app/contract/errors";
import { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import {
	type IngestionReason,
	type IngestionScope,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunFailureStage } from "@ryot-app/contract/modules/imports/types";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { definitionLookup, DefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import {
	genericImportChunkOperationIds,
	genericImportChunkSchema,
	genericImportItemIntents,
	type GenericImportWriteItem,
} from "@ryot-app/plugin-backend-sdk/imports";
import { providerResolveResultSchema } from "@ryot-app/plugin-backend-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Effect, Layer, Option, Ref, Schema, type Scope } from "effect";
import type { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { Changes } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import { keyedReceipt } from "#modules/changes/receipts";
import { ChangeSets, type CommitOptions } from "#modules/changes/service";
import { CollectionMembershipWritten, CollectionsService } from "#modules/collections/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { awaitEntityImport } from "#modules/entities/providers/entity-import-job";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	sameRevisionPin,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { slugify } from "#platform/slug";
import { forgetWorkflowSteps, inWorkflowStepScope, makeActivity } from "#platform/workflow/scope";

import {
	genericIngestionBatchResult,
	genericIngestionFailureOperation,
	genericIngestionOperations,
	type IngestionOperation,
	operationIssue,
	reconcileGenericIngestionBatch,
} from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { IntegrationEventWrites } from "./integration-event-writes";
import {
	genericImportOperationCommand,
	genericImportOperationIdentity,
	genericImportRecordCommand,
} from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

export const GenericImportChunkPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	ordinal: Schema.Finite,
	batchId: Schema.NonEmptyString,
	command: DomainLifecycleCommand,
	captureId: Schema.NonEmptyString,
	artifactOwnerExecutionId: Schema.String,
	inputFingerprint: Schema.NonEmptyString,
	integrationId: Schema.optional(IntegrationId),
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

export const failureReasonByStage = {
	event_policy: { code: "event-policy-failed" },
	source_fetch: { code: "source-fetch-failed" },
	database_commit: { code: "database-commit-failed" },
	provider_details: { code: "provider-details-failed" },
	provider_resolution: { code: "provider-resolution-failed" },
	input_transformation: { code: "input-transformation-failed" },
} as const satisfies Record<ImportRunFailureStage, ImportRunFailureReason>;

/** What an import item's commit wrote: its entities and relationships by item identity, and its events. */
const ImportItemCommitted = Schema.Struct({
	events: CreateEventsResponse,
	entities: Schema.Array(Schema.Struct({ entityId: EntityId, itemIdentity: Schema.String })),
	relationships: Schema.Array(
		Schema.Struct({ itemIdentity: Schema.String, relationshipId: Schema.NullOr(RelationshipId) }),
	),
});

/**
 * Commits one import item once: the account's idempotency key under the item's command identity holds
 * the result, so an activity retried after its commit replays it instead of writing again.
 */
export const commitImportItem = Effect.fn("imports.commitImportItem")(function* (
	changes: Changes & { readonly userId: UserId },
	command: DomainLifecycleCommand,
	options: CommitOptions,
) {
	const identity = idempotencyIdentity({
		request: changes,
		kind: "import-item",
		userId: changes.userId,
		key: command.itemIdentity,
	});
	return yield* (yield* ChangeSets).commitOnce(
		changes,
		command,
		keyedReceipt(yield* IdempotencyKeys.make, identity, ImportItemCommitted, (result) => ({
			events: toCreateEventsResponse(result.outcomes),
			entities: result.entities.map(({ entity, itemIdentity }) => ({
				itemIdentity,
				entityId: entity.id,
			})),
			relationships: result.relationships.map(({ itemIdentity, relationship }) => ({
				itemIdentity,
				relationshipId: relationship?.id ?? null,
			})),
		})),
		options,
	);
});

const GenericImportProvider = Schema.Struct({
	pluginId: PluginId,
	id: SandboxProviderId,
	pluginScope: Schema.Literals(["system", "user"]),
});

export class GenericImportProviderError extends Schema.TaggedError<
	GenericImportProviderError,
	{ readonly brand: unique symbol }
>()("GenericImportProviderError", {
	message: Schema.String,
	stage: Schema.Literals(["provider_resolution", "provider_details"]),
}) {}

const valuesMatch = (properties: Record<string, unknown>, expected: Record<string, unknown>) =>
	Object.entries(expected).every(
		([key, value]) => JSON.stringify(properties[key]) === JSON.stringify(value),
	);

const matchesImportIntent = (
	entity: { readonly name: string; readonly properties: unknown },
	intent: GenericImportWriteItem["entities"][number],
) => {
	if (!intent.match) {
		return true;
	}
	const expectedName =
		intent.match.nameNormalization === "slug" ? slugify(intent.match.name) : intent.match.name;
	const entityName = intent.match.nameNormalization === "slug" ? slugify(entity.name) : entity.name;
	return (
		entityName === expectedName &&
		isObjectRecord(entity.properties) &&
		valuesMatch(entity.properties, intent.match.properties)
	);
};

const resolveGenericImportProvider = (
	intent: GenericImportWriteItem["entities"][number],
	userId: UserId,
	executionId: string,
	owner: DefinitionOwner,
) =>
	makeActivity({
		error: ImportRunError,
		success: GenericImportProvider,
		name: `resolve-generic-import-provider-${executionId}`,
		execute: Effect.gen(function* () {
			const descriptor = intent.providerResolution;
			if (!descriptor) {
				return yield* new ImportRunError({ message: "Provider resolution descriptor is missing" });
			}
			const runtime = yield* PluginRuntimeResolver;
			const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
				owner,
				slug: descriptor.providerSlug,
			});
			if (!provider) {
				return yield* new ImportRunError({
					message: `Provider '${descriptor.providerSlug}' is unavailable`,
				});
			}
			if (
				owner.kind !== "plugin" ||
				provider.pluginId !== owner.pluginId ||
				provider.rootEntitySchemaSlug !== intent.entitySchemaSlug
			) {
				return yield* new ImportRunError({
					message: `Provider '${descriptor.providerSlug}' does not provide entity schema '${intent.entitySchemaSlug}'`,
				});
			}
			return {
				id: provider.id,
				pluginScope: provider.pluginScope,
				pluginId: PluginId.make(provider.pluginId),
			};
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const resolveProviderEntity = Effect.fn("imports.resolveProviderEntity")(function* (
	intent: GenericImportWriteItem["entities"][number],
	userId: UserId,
	command: DomainLifecycleCommand,
	executionId: string,
	owner: DefinitionOwner,
) {
	const descriptor = intent.providerResolution;
	if (!descriptor) {
		return undefined;
	}
	const provider = yield* resolveGenericImportProvider(intent, userId, executionId, owner).pipe(
		Effect.mapError(
			(error) =>
				new GenericImportProviderError({ message: error.message, stage: "provider_resolution" }),
		),
	);
	const operations = yield* EntityImportWorkflowOperations;
	const resolved = yield* operations
		.processProviderResolve(
			{
				accountUserId: userId,
				providerId: provider.id,
				value: descriptor.value,
				lane: command.causation.lane,
				writeContext: command.writeContext,
				identifierType: descriptor.identifierType,
				userId: provider.pluginScope === "user" ? userId : null,
			},
			`${executionId}-resolve`,
		)
		.pipe(
			Effect.flatMap((result) =>
				result.error
					? Effect.fail(
							new GenericImportProviderError({
								stage: "provider_resolution",
								message: result.error.message,
							}),
						)
					: Schema.decodeUnknownEffect(providerResolveResultSchema)(result.value).pipe(
							Effect.mapError(
								(error) =>
									new GenericImportProviderError({
										stage: "provider_resolution",
										message: `Invalid provider resolution result: ${error.message}`,
									}),
							),
						),
			),
			Effect.mapError((error) =>
				error instanceof GenericImportProviderError
					? error
					: new GenericImportProviderError({
							stage: "provider_resolution",
							message: unknownToMessage(error),
						}),
			),
		);
	if (resolved.externalId === null) {
		return undefined;
	}
	const importCommand =
		command.writeContext === null
			? {
					...command,
					writeContext: yield* operations
						.preRegisterProviderImport(
							{
								userId,
								accountUserId: userId,
								providerId: provider.id,
								pluginId: provider.pluginId,
							},
							executionId,
						)
						.pipe(
							Effect.mapError(
								(error) =>
									new GenericImportProviderError({
										message: error.message,
										stage: "provider_details",
									}),
							),
						),
				}
			: command;
	const providerEntity = yield* awaitEntityImport({
		executionId,
		command: importCommand,
		providerId: provider.id,
		pluginId: provider.pluginId,
		externalId: resolved.externalId,
		entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
		entityScope: { userId, type: provider.pluginScope === "system" ? "global" : "user" },
	}).pipe(
		Effect.mapError(
			(error) =>
				new GenericImportProviderError({ message: error.message, stage: "provider_details" }),
		),
	);
	return matchesImportIntent(providerEntity, intent) ? providerEntity.id : undefined;
});

type GenericImportDefinitions = ReturnType<typeof definitionLookup>;

/** Checks an item against its writer's authority and definitions, answering how its events commit. */
const validateGenericItem = Effect.fn("imports.validateGenericItem")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	definitions: GenericImportDefinitions,
	pluginRevision: ScriptPluginRevision,
) {
	const entitiesRepository = yield* EntitiesRepository;
	const scope = yield* (yield* SandboxRepository)
		.getSchemaScope(pluginRevision.revisionId)
		.pipe(Effect.mapError((error) => new ImportRunError({ message: error.message })));
	const owner = definitionOwner(pluginRevision.id);
	for (const entity of item.entities) {
		if (
			!scope.entitySchemaSlugs.includes(entity.entitySchemaSlug) ||
			(pluginRevision.scope === "user" && entity.scope === "global")
		) {
			return yield* new ImportRunError({
				message: "Import entity exceeds the invoking plugin's write authority",
			});
		}
	}
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
			definitions.validateEntityProperties(
				{ owner, slug: entity.entitySchemaSlug },
				entity.properties,
			),
		{ discard: true },
	);
	let grouped = false;
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
		if (subject && subject.entitySchemaPluginId !== pluginRevision.id) {
			return yield* new ImportRunError({
				message: "Import event subject belongs to another definition owner",
			});
		}
		const entitySchemaSlug =
			subject?.entitySchemaSlug ?? entitySchemasByAlias.get(event.entityAlias);
		if (!entitySchemaSlug) {
			return yield* new ImportRunError({
				message: "Import event references an unknown entity alias or subject",
			});
		}
		const entitySchema = definitions.getEntitySchema({
			owner,
			slug: EntitySchemaSlug.make(entitySchemaSlug),
		});
		grouped ||= Object.values(entitySchema?.eventSchemas ?? {}).some(
			(schema) =>
				schema.eventGroup !== undefined &&
				(schema.slug === event.eventSchemaSlug ||
					schema.eventGroup.dependents.some(
						(dependent) => dependent.eventSchemaSlug === event.eventSchemaSlug,
					)),
		);
		yield* definitions.validateEventProperties(
			{
				owner,
				slug: EventSchemaSlug.make(event.eventSchemaSlug),
				entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
			},
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
		const relationshipSchema = definitions.getRelationshipSchema({
			owner,
			slug: relationship.relationshipSchemaSlug,
		});
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
			{ owner, slug: relationship.relationshipSchemaSlug },
			relationship.properties,
		);
	}
	if (grouped && item.events.some((event) => event.coalescing !== undefined)) {
		return yield* new ImportRunError({ message: "Event-group imports cannot coalesce events" });
	}
	if (!grouped) {
		return "standalone" as const;
	}
	const subject = item.entities.find((intent) => intent.alias === item.subjectEntityAlias);
	if (!subject || subject.providerResolution || subject.scope === "global") {
		return yield* new ImportRunError({
			message: "An event-group import requires a user-owned subject entity",
		});
	}
	return "grouped" as const;
});

const unknownAlias = (alias: string) =>
	new ImportRunError({ message: `Import intent references an unknown entity alias '${alias}'` });

/**
 * The item as one change set: its entities by alias, relationships and events other than coalesced
 * ones. An entity resolved through its provider is referenced; any other is created unless its entity
 * ID or match finds one.
 */
const genericItemChanges = Effect.fnUntraced(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	command: DomainLifecycleCommand,
	owner: DefinitionOwner,
	resolved: ReadonlyMap<string, EntityId>,
) {
	const identity = (operationId: string) =>
		genericImportOperationIdentity(command.causation.importRunId, item, operationId);
	const aliases = new Set(item.entities.map(({ alias }) => alias));
	const keyed = (alias: string) =>
		aliases.has(alias)
			? Effect.succeed({ key: alias, kind: "keyed" as const })
			: Effect.fail(unknownAlias(alias));
	const entitySchema = (slug: string) => ({ owner, slug: EntitySchemaSlug.make(slug) });
	return {
		userId,
		relationships: {
			upserts: yield* Effect.forEach(item.relationships, (relationship) =>
				Effect.gen(function* () {
					return {
						properties: relationship.properties,
						source: yield* keyed(relationship.sourceAlias),
						target: yield* keyed(relationship.targetAlias),
						itemIdentity: identity(relationship.operationId),
						propertiesMode: relationship.propertiesMode === "merge" ? "merge" : "replace",
						relationshipSchema: {
							owner,
							slug: RelationshipSchemaSlug.make(relationship.relationshipSchemaSlug),
						},
					} as const;
				}),
			),
		},
		events: {
			changes: [],
			creates: yield* Effect.forEach(
				item.events.filter((event) => event.coalescing === undefined),
				(event) =>
					Effect.gen(function* () {
						return {
							occurredAt: event.occurredAt,
							properties: event.properties,
							eventSchemaSlug: event.eventSchemaSlug,
							itemIdentity: identity(event.operationId),
							entity:
								event.subjectEntityId === undefined
									? yield* keyed(event.entityAlias)
									: { kind: "existing" as const, entityId: EntityId.make(event.subjectEntityId) },
							...(event.sessionEntityAlias
								? { session: yield* keyed(event.sessionEntityAlias) }
								: {}),
						};
					}),
			),
		},
		entities: {
			references: item.entities.flatMap((intent) => {
				const entityId = resolved.get(intent.alias);
				return entityId === undefined
					? []
					: [
							{
								entityId,
								key: intent.alias,
								itemIdentity: identity(intent.operationId),
								entitySchema: entitySchema(intent.entitySchemaSlug),
							},
						];
			}),
			creates: item.entities.flatMap((intent) => {
				if (resolved.has(intent.alias)) {
					return [];
				}
				const scope = intent.scope ? { scope: intent.scope } : {};
				const required = intent.existingOnly === true;
				let match;
				if (intent.entityId) {
					match = { ...scope, required, entityId: EntityId.make(intent.entityId) };
				} else if (intent.match) {
					match = {
						...scope,
						required,
						name: intent.match.name,
						properties: intent.match.properties,
						nameNormalization: intent.match.nameNormalization ?? "exact",
					};
				}
				return [
					{
						name: intent.name,
						key: intent.alias,
						properties: intent.properties,
						itemIdentity: identity(intent.operationId),
						entitySchema: entitySchema(intent.entitySchemaSlug),
						...(match ? { match } : {}),
					},
				];
			}),
		},
	} satisfies Changes;
});

/**
 * Resolves the item's provider entities, then commits the item as one change set. An event-group
 * record commits atomically; a standalone record's events have their own outcomes.
 */
const writeGenericItem = Effect.fn("imports.writeGenericItem")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	index: number,
	definitions: GenericImportDefinitions,
	command: DomainLifecycleCommand,
	pluginRevision: ScriptPluginRevision,
) {
	const owner = definitionOwner(pluginRevision.id);
	const writeItem = Effect.fnUntraced(function* () {
		if (
			command.causation.integrationId === undefined &&
			item.events.some((event) => event.coalescing)
		) {
			return yield* new ImportRunError({
				message: "Only admitted integrations can coalesce import events",
			});
		}
		const aliases = new Set<string>();
		for (const intent of item.entities) {
			if (aliases.has(intent.alias)) {
				return yield* new ImportRunError({
					message: `Duplicate import entity alias '${intent.alias}'`,
				});
			}
			aliases.add(intent.alias);
			if (intent.existingOnly && !intent.entityId && !intent.match) {
				return yield* new ImportRunError({
					message: `Required import entity '${intent.alias}' was not found`,
				});
			}
		}
		for (const membership of item.collectionMemberships ?? []) {
			if (!aliases.has(membership.entityAlias)) {
				return yield* unknownAlias(membership.entityAlias);
			}
		}
		const providers = item.entities.filter((intent) => intent.providerResolution);
		if (providers.length > 0) {
			yield* makeActivity({
				error: ImportRunError,
				name: `validate-generic-import-item-${index}`,
				execute: validateGenericItem(item, userId, definitions, pluginRevision).pipe(
					Effect.asVoid,
					Effect.mapError(toWorkflowError),
				),
			});
		}
		const resolved = new Map<string, EntityId>();
		for (const intent of providers) {
			const entityId = yield* resolveProviderEntity(
				intent,
				userId,
				genericImportOperationCommand(command, item, intent.operationId),
				stableStringify([command.causation.importRunId, "provider", intent.operationId]),
				owner,
			);
			if (entityId) {
				resolved.set(intent.alias, entityId);
			}
		}
		const committed = yield* makeActivity({
			error: ImportRunError,
			success: ImportItemCommitted,
			name: `commit-generic-import-item-${index}`,
			execute: Effect.gen(function* () {
				const mode = yield* validateGenericItem(item, userId, definitions, pluginRevision);
				return yield* commitImportItem(
					yield* genericItemChanges(item, userId, command, owner, resolved),
					genericImportRecordCommand(command, item),
					{
						entities: { verbatimIdentities: true },
						relationships: { verbatimIdentities: true },
						events:
							mode === "grouped"
								? { verbatimIdentities: true }
								: { independent: true, verbatimIdentities: true },
					},
				);
			}).pipe(Effect.mapError(toWorkflowError)),
		});
		const entityIds = new Map(
			committed.entities.map(({ entityId, itemIdentity }) => [itemIdentity, entityId]),
		);
		const written = new Map(
			item.entities.flatMap((intent) => {
				const entityId = entityIds.get(
					genericImportOperationIdentity(command.causation.importRunId, item, intent.operationId),
				);
				return entityId === undefined ? [] : [[intent.alias, entityId] as const];
			}),
		);
		return { committed, aliases: written, _tag: "ready" as const };
	});
	return yield* writeItem().pipe(
		Effect.catch((error) =>
			Effect.succeed({
				_tag: "failed" as const,
				message: unknownToMessage(error),
				stage:
					error instanceof GenericImportProviderError ? error.stage : ("database_commit" as const),
			}),
		),
	);
});

const resolveGenericImportDefinitions = (userId: UserId, pluginRevision: ScriptPluginRevision) =>
	makeActivity({
		error: ImportRunError,
		success: DefinitionSnapshot,
		name: "resolve-generic-import-definitions",
		execute: Effect.flatMap(DefinitionRepository, (definitions) =>
			definitions.getSnapshotForContext(
				{ pluginId: pluginRevision.id, pluginRevisionId: pluginRevision.revisionId },
				userId,
			),
		).pipe(Effect.mapError(toWorkflowError)),
	});

export const runGenericImportChunk = Effect.fn("runGenericImportChunk")(
	function* (payload: typeof GenericImportChunkPayload.Type) {
		const keys = yield* IdempotencyKeys.make;
		if (!payload.command.accountUserId) {
			return yield* new ImportRunError({ message: "Ingestion account is missing" });
		}
		const scope: IngestionScope = { runId: payload.runId, userId: payload.userId };
		const repository = yield* ImportsRepository;
		const database = yield* DatabaseSession;
		const captures = yield* IngestionCaptures;
		const previous = yield* repository.getBatch(scope, payload.batchId);
		if (
			previous &&
			(previous.captureId !== payload.captureId ||
				previous.ordinal !== payload.ordinal ||
				previous.inputFingerprint !== payload.inputFingerprint)
		) {
			return yield* new ImportRunError({ message: "Ingestion batch identity changed" });
		}
		const capture = yield* repository.getCapture(scope, payload.captureId);
		if (capture?.payload?.checksum !== payload.inputFingerprint) {
			return yield* new ImportRunError({
				message: "Ingestion batch fingerprint does not match its capture",
			});
		}
		const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
			new TextDecoder().decode(yield* captures.read(scope, payload.captureId, 4 * 1024 * 1024)),
		).pipe(Effect.mapError(toWorkflowError));
		if (previous?.state === "applied") {
			return yield* genericIngestionBatchResult(scope, previous, chunk);
		}
		const batch = {
			summary: [],
			id: payload.batchId,
			ordinal: payload.ordinal,
			state: "pending" as const,
			captureId: payload.captureId,
			inputFingerprint: payload.inputFingerprint,
		};
		yield* makeActivity({
			error: ImportRunError,
			name: "register-ingestion-batch",
			execute: database
				.transaction(
					Effect.gen(function* () {
						yield* repository.registerBatch(scope, batch, genericImportChunkOperationIds(chunk));
						yield* repository.startBatch(scope, batch.id);
					}),
				)
				.pipe(Effect.mapError(toWorkflowError)),
		});
		const operations = genericIngestionOperations(chunk, scope.runId);
		const record = Effect.fnUntraced(function* (
			operation: IngestionOperation,
			result: "skipped" | "unsuccessful",
			reason: IngestionReason,
		) {
			const outcome = { ...operation, result, reason, inputFingerprint: payload.inputFingerprint };
			yield* makeActivity({
				error: ImportRunError,
				name: `record-ingestion-result:${operation.operationId}`,
				execute: database
					.transaction(
						Effect.gen(function* () {
							yield* repository.recordOutcome(scope, outcome);
							yield* repository.recordIssue(
								scope,
								operationIssue(operation, result === "unsuccessful" ? "error" : "warning", reason),
							);
						}),
					)
					.pipe(Effect.mapError(toWorkflowError)),
			});
		});
		const sourceState = yield* (yield* ImportSourceStateStore)
			.load(scope)
			.pipe(Effect.mapError(toWorkflowError));
		const admitted = yield* repository.getIngestionRunControl(scope);
		if (
			payload.command.writeContext?.pluginRevision?.id !== sourceState.pluginId ||
			!sameRevisionPin(payload.command.writeContext.pluginRevision, sourceState.pluginRevision)
		) {
			return yield* new ImportRunError({
				message: "Generic import requires the original trusted caller authority",
			});
		}
		if (
			!admitted?.pins ||
			admitted.pluginInstallationId !== sourceState.pluginInstallationId ||
			admitted.pins.executionId !== payload.artifactOwnerExecutionId ||
			admitted.pins.pluginRevisionId !== sourceState.pluginRevision.revisionId ||
			admitted.pins.pluginConfigRevisionId !== sourceState.pluginRevision.configRevisionId ||
			sourceState.pluginId !== sourceState.pluginRevision.id
		) {
			return yield* new ImportRunError({
				message: "Generic import caller does not match the admitted plugin pin",
			});
		}
		const runtime = yield* PluginRuntimeResolver;
		const active = yield* runtime.findPluginAvailableToUser(payload.userId, sourceState.pluginId);
		if (active?.installationId !== sourceState.pluginInstallationId) {
			return yield* new ImportRunError({ message: "Generic import installation is unavailable" });
		}
		const snapshot = yield* resolveGenericImportDefinitions(
			payload.userId,
			sourceState.pluginRevision,
		);
		const definitions = definitionLookup(snapshot);
		for (const failure of chunk.failures) {
			const stage = failure.stage ?? "input_transformation";
			yield* record(genericIngestionFailureOperation(failure, scope.runId), "unsuccessful", {
				key: null,
				code: failureReasonByStage[stage].code,
			});
		}
		for (const [index, item] of chunk.items.entries()) {
			const run = yield* repository.getIngestionRunControl(scope);
			if (run?.status !== "running") {
				break;
			}
			const outcome = yield* writeGenericItem(
				item,
				payload.userId,
				index,
				definitions,
				payload.command,
				sourceState.pluginRevision,
			);
			let message = outcome._tag === "failed" ? outcome.message : null;
			let failureCode: null | string =
				outcome._tag === "failed" ? failureReasonByStage[outcome.stage].code : null;
			if (outcome._tag === "ready") {
				const { aliases, committed } = outcome;
				const ids = item.events
					.filter((event) => event.coalescing === undefined)
					.map((event) => event.operationId);
				message ??= committed.events.failure?.reason.code ?? null;
				failureCode ??= committed.events.failure?.reason.code ?? null;
				for (const event of committed.events.outcomes) {
					const operation = operations.find((value) => value.operationId === ids[event.index]);
					if (operation && event.status === "skipped_by_policy") {
						yield* record(operation, "skipped", { message: event.reason, code: "policy-rejected" });
					}
				}
				const collections = yield* CollectionsService;
				for (const membership of item.collectionMemberships ?? []) {
					const entityId = aliases.get(membership.entityAlias);
					if (entityId === undefined) {
						continue;
					}
					const collectionResult = yield* makeActivity({
						error: ImportRunError,
						success: CollectionMembershipWritten,
						name: `write-collection-membership-${membership.operationId}`,
						execute: Effect.gen(function* () {
							const collection = yield* collections.getOrCreateCollection(
								payload.userId,
								membership.collectionName,
								genericImportOperationCommand(
									payload.command,
									item,
									`${membership.operationId}:collection`,
								),
							);
							return yield* collections.writeMembership({
								entityId,
								properties: {},
								operation: "add",
								userId: payload.userId,
								collectionId: collection.id,
								command: genericImportOperationCommand(
									payload.command,
									item,
									membership.operationId,
								),
							});
						}).pipe(Effect.mapError(toWorkflowError)),
					}).pipe(Effect.result);
					if (collectionResult._tag === "Failure" && !message) {
						message = unknownToMessage(collectionResult.failure);
						failureCode ??= "membership-event-failed";
						const operation = operations.find(
							(value) => value.operationId === membership.operationId,
						);
						if (operation) {
							yield* record(operation, "unsuccessful", {
								key: null,
								code: "membership-event-failed",
							});
						}
					}
				}
				for (const [groupIndex, intent] of item.events.entries()) {
					const { coalescing } = intent;
					if (!coalescing) {
						continue;
					}
					const integrationId = payload.integrationId;
					if (!integrationId) {
						return yield* new ImportRunError({ message: "Missing event stream integration" });
					}
					const entityId =
						intent.subjectEntityId === undefined
							? aliases.get(intent.entityAlias)
							: EntityId.make(intent.subjectEntityId);
					if (entityId === undefined) {
						continue;
					}
					const sessionEntityId = intent.sessionEntityAlias
						? aliases.get(intent.sessionEntityAlias)
						: undefined;
					const eventSchemaSlug = EventSchemaSlug.make(intent.eventSchemaSlug);
					const result = yield* makeActivity({
						error: ImportRunError,
						success: CreateEventsResponse,
						name: `create-import-events-${item.itemIndex}-${groupIndex}`,
						execute: (yield* IntegrationEventWrites)
							.apply({
								coalescing,
								key: { entityId, integrationId, eventSchemaSlug, userId: payload.userId },
								identity: genericImportOperationIdentity(scope.runId, item, intent.operationId),
								command: {
									...payload.command,
									itemIdentity: stableStringify(["ingestion-event-group", [intent.operationId]]),
								},
								event: {
									entityId,
									eventSchemaSlug,
									occurredAt: intent.occurredAt,
									properties: intent.properties,
									...(sessionEntityId ? { sessionEntityId } : {}),
								},
							})
							.pipe(Effect.mapError(toWorkflowError)),
					});
					message ??= result.failure?.reason.code ?? null;
					failureCode ??= result.failure?.reason.code ?? null;
					const operation = operations.find((value) => value.operationId === intent.operationId);
					const [first] = result.outcomes;
					if (operation && first?.status === "skipped_by_policy") {
						yield* record(operation, "skipped", { message: first.reason, code: "policy-rejected" });
					}
				}
			}
			if (
				failureCode !== null &&
				(yield* repository.getIngestionRunControl(scope))?.status === "running"
			) {
				const candidates = operations.filter((operation) =>
					genericImportItemIntents(item).some(
						(intent) => intent.operationId === operation.operationId,
					),
				);
				const committed = yield* keys.importItems({
					runId: scope.runId,
					userId: scope.userId,
					itemIdentities: candidates.map((operation) => operation.itemIdentity),
				});
				for (const operation of candidates) {
					if (
						!committed.some((value) => value.itemIdentity === operation.itemIdentity) &&
						!(yield* repository.getOutcome(scope, operation.operationId))
					) {
						yield* record(operation, "unsuccessful", { key: null, code: failureCode });
					}
				}
			}
		}
		const summary = yield* makeActivity({
			error: ImportRunError,
			success: IngestionSummary,
			name: "project-ingestion-batch",
			execute: reconcileGenericIngestionBatch(scope, batch).pipe(Effect.mapError(toWorkflowError)),
		});
		const result = yield* genericIngestionBatchResult(scope, { ...batch, summary }, chunk);
		yield* forgetWorkflowSteps(payload.batchId);
		return result;
	},
	(effect, payload) =>
		effect.pipe(inWorkflowStepScope(payload.batchId), Effect.mapError(toWorkflowError)),
);

type GenericImportChunkRun = (
	payload: typeof GenericImportChunkPayload.Type,
) => Effect.Effect<
	Effect.Success<ReturnType<typeof runGenericImportChunk>>,
	ImportRunError,
	WorkflowEngine | WorkflowInstance
>;

/**
 * Applies a chunk in the plugin script's workflow that sent it. Chunks write through services that themselves need
 * scripts, so the runtime installs this once those exist.
 */
export class GenericImportChunks extends Context.Service<
	GenericImportChunks,
	{
		readonly apply: GenericImportChunkRun;
		readonly install: (run: GenericImportChunkRun) => Effect.Effect<void, never, Scope.Scope>;
	}
>()("@ryot-app/kernel-backend/modules/imports/generic-import-workflow/GenericImportChunks") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const installed = yield* Ref.make(Option.none<GenericImportChunkRun>());
			return {
				install: (run) =>
					Effect.acquireRelease(Ref.set(installed, Option.some(run)), () =>
						Ref.set(installed, Option.none()),
					),
				apply: (payload) =>
					Effect.flatMap(Ref.get(installed), (run) =>
						Option.isNone(run) ? Effect.die("Import chunks are not installed") : run.value(payload),
					),
			};
		}),
	);
}

export const GenericImportChunksInstalledLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const services =
			yield* Effect.context<
				Exclude<
					Effect.Services<ReturnType<typeof runGenericImportChunk>>,
					WorkflowEngine | WorkflowInstance
				>
			>();
		yield* (yield* GenericImportChunks).install((payload) =>
			runGenericImportChunk(payload).pipe(Effect.provideContext(services)),
		);
	}),
);
