import { unknownToMessage } from "@ryot-app/contract/errors";
import {
	LifecycleCommand,
	type AutomationWarning as AutomationWarningValue,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import {
	IngestionSummary,
	type IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunFailureStage } from "@ryot-app/contract/modules/imports/types";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	genericImportChunkOperationIds,
	genericImportItemIntents,
	genericImportChunkSchema,
	genericImportApplyResultSchema,
	type GenericImportWriteItem,
} from "@ryot-app/sandbox-sdk/imports";
import { providerResolveResultSchema } from "@ryot-app/sandbox-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	mapCommittedResult,
	runLifecycleWriteStep,
	type LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { slugify } from "#lib/shared/slug";
import { AddEntityToCollectionWorkflow } from "#modules/collections/add-entity-to-collection-workflow";
import { CollectionEntityResult, CollectionsService } from "#modules/collections/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { DefinitionSnapshot, definitionLookup } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService, PendingEntityMutation } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	EntityImportWorkflow,
	type EntityImportError,
} from "#modules/provider-entities/entity-import-workflow";
import { EntityImportWorkflowOperations } from "#modules/provider-entities/operations-workflow";
import {
	PendingRelationshipMutations,
	RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";
import { RelationshipsService } from "#modules/relationships/service";

import {
	genericIngestionBatchResult,
	genericIngestionFailureOperation,
	genericIngestionOperations,
	reconcileGenericIngestionBatch,
	type IngestionOperation,
} from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { ingestionOperationCommand } from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

export const ProcessGenericImportChunksPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	ordinal: Schema.Finite,
	command: LifecycleCommand,
	executionId: Schema.String,
	batchId: Schema.NonEmptyString,
	captureId: Schema.NonEmptyString,
	artifactOwnerExecutionId: Schema.String,
	inputFingerprint: Schema.NonEmptyString,
	artifactReferenceExecutionId: Schema.String,
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

export const ProcessGenericImportChunksWorkflow = Workflow.make(
	"ProcessGenericImportChunksWorkflow",
	{
		error: ImportRunError satisfies DurableSchema,
		idempotencyKey: ({ executionId }) => executionId,
		success: genericImportApplyResultSchema satisfies DurableSchema,
		payload: ProcessGenericImportChunksPayload satisfies DurableSchema,
	},
);

export const GenericImportEntity = Schema.Struct({
	entityId: EntityId,
	result: Schema.Literals(["created", "unchanged"]),
});

const GenericImportProvider = Schema.Struct({
	id: SandboxProviderId,
	pluginScope: Schema.Literals(["system", "user"]),
});

export class GenericImportProviderError extends Schema.TaggedError<GenericImportProviderError>()(
	"GenericImportProviderError",
	{ message: Schema.String, stage: Schema.Literals(["provider_resolution", "provider_details"]) },
) {}

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

export const prepareGenericImportEntity = Effect.fn("imports.prepareGenericImportEntity")(
	function* (
		intent: GenericImportWriteItem["entities"][number],
		userId: UserId,
		lifecycle: LifecycleCommand,
	) {
		const entities = yield* EntitiesService;
		const repository = yield* EntitiesRepository;
		const replay = yield* entities.replayCreateStep({
			userId,
			lifecycle,
			scope: "user",
			name: intent.name,
			properties: intent.properties,
			entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
		});
		if (replay) {
			return {
				...replay,
				result: { result: "created" as const, entityId: replay.result.entity.id },
			};
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
			const existing = scopedCandidates.find((candidate) => matchesImportIntent(candidate, intent));
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
		if (entityId) {
			const reference = yield* entities.prepareReferenceStep({ userId, entityId, lifecycle });
			return {
				...reference,
				result: { result: "unchanged" as const, entityId: reference.result.entity.id },
			};
		}
		const prepared = yield* entities.prepareCreateStep({
			userId,
			lifecycle,
			scope: "user",
			name: intent.name,
			properties: intent.properties,
			entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
		});
		return mapCommittedResult(prepared, ({ entity }) => ({
			entityId: entity.id,
			result: "created" as const,
		}));
	},
);

const resolveGenericImportProvider = (
	intent: GenericImportWriteItem["entities"][number],
	userId: UserId,
	executionId: string,
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
			const provider = yield* runtime.findProviderAvailableToUserBySlug(
				userId,
				descriptor.providerSlug,
			);
			if (!provider) {
				return yield* new ImportRunError({
					message: `Provider '${descriptor.providerSlug}' is unavailable`,
				});
			}
			if (provider.rootEntitySchemaSlug !== intent.entitySchemaSlug) {
				return yield* new ImportRunError({
					message: `Provider '${descriptor.providerSlug}' does not provide entity schema '${intent.entitySchemaSlug}'`,
				});
			}
			return { id: provider.id, pluginScope: provider.pluginScope };
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const resolveProviderEntity = Effect.fn("imports.resolveProviderEntity")(function* (
	intent: GenericImportWriteItem["entities"][number],
	userId: UserId,
	command: LifecycleCommand,
	executionId: string,
) {
	const descriptor = intent.providerResolution;
	if (!descriptor) {
		return undefined;
	}
	const provider = yield* resolveGenericImportProvider(intent, userId, executionId).pipe(
		Effect.mapError(
			(error) =>
				new GenericImportProviderError({ message: error.message, stage: "provider_resolution" }),
		),
	);
	const operations = yield* EntityImportWorkflowOperations;
	const resolved = yield* operations
		.processProviderResolve(
			{
				providerId: provider.id,
				value: descriptor.value,
				identifierType: descriptor.identifierType,
				accountGeneration: command.accountGeneration,
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
	const engine = yield* WorkflowEngine;
	const receipts = yield* MutationReceipts.make;
	const providerEntity = yield* dispatchAdmittedWorkflow(
		receipts,
		engine,
		EntityImportWorkflow,
		command.accountGeneration,
		{
			executionId,
			payload: {
				command,
				executionId,
				providerId: provider.id,
				externalId: resolved.externalId,
				entitySchemaSlug: EntitySchemaSlug.make(intent.entitySchemaSlug),
				entityScope: { userId, type: provider.pluginScope === "system" ? "global" : "user" },
			},
		},
		(admission) =>
			admission.pipe(
				Effect.mapError(
					(error) =>
						new GenericImportProviderError({ message: error.message, stage: "provider_details" }),
				),
			),
		(execution) =>
			execution.pipe(
				Effect.mapError(
					(error: EntityImportError) =>
						new GenericImportProviderError({ message: error.message, stage: "provider_details" }),
				),
			),
	);
	return matchesImportIntent(providerEntity, intent) ? providerEntity.id : undefined;
});

type GenericImportDefinitions = ReturnType<typeof definitionLookup>;

const validateGenericItem = (
	item: GenericImportWriteItem,
	userId: UserId,
	index: number,
	definitions: GenericImportDefinitions,
) =>
	makeActivity({
		error: ImportRunError,
		name: `validate-generic-import-item-${index}`,
		execute: Effect.gen(function* () {
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
			return undefined;
		}).pipe(Effect.mapError(toWorkflowError)),
	});

export const runImportWriteStep = <Result, Pending, E1, E2, E3, R1, R2, R3>(options: {
	readonly name: string;
	readonly result: Schema.Codec<Result, unknown>;
	readonly pending: Schema.Codec<Pending, unknown>;
	readonly prepare: Effect.Effect<LifecyclePreparedStep<Result, Pending>, E1, R1>;
	readonly applyPolicies: (pending: Pending) => Effect.Effect<Pending, E2, R2>;
	readonly commit: (
		pending: Pending,
	) => Effect.Effect<LifecyclePreparedStep<Result, Pending>, E3, R3>;
}) =>
	runLifecycleWriteStep({
		name: options.name,
		error: ImportRunError,
		result: options.result,
		pending: options.pending,
		prepare: options.prepare.pipe(Effect.mapError(toWorkflowError)),
		commit: (pending) => options.commit(pending).pipe(Effect.mapError(toWorkflowError)),
		applyPolicies: (pending) =>
			options.applyPolicies(pending).pipe(Effect.mapError(toWorkflowError)),
	});

const writeGenericItem = Effect.fn("imports.writeGenericItem")(function* (
	item: GenericImportWriteItem,
	userId: UserId,
	index: number,
	definitions: GenericImportDefinitions,
	command: LifecycleCommand,
) {
	const entities = yield* EntitiesService;
	const collections = yield* CollectionsService;
	const relationships = yield* RelationshipsService;
	const warnings: AutomationWarningValue[] = [];
	const writeItem = Effect.fnUntraced(function* () {
		yield* validateGenericItem(item, userId, index, definitions);
		const aliases = new Map<string, EntityId>();
		for (const [intentIndex, intent] of item.entities.entries()) {
			if (aliases.has(intent.alias)) {
				return yield* new ImportRunError({
					message: `Duplicate import entity alias '${intent.alias}'`,
				});
			}
			const providerExecutionId = stableStringify([
				command.causation.importRunId,
				"provider",
				intent.operationId,
			]);
			const providerEntityId = yield* resolveProviderEntity(
				intent,
				userId,
				ingestionOperationCommand(command, intent.operationId),
				providerExecutionId,
			);
			if (providerEntityId) {
				if (intent.outcome) {
					yield* entities.prepareReferenceStep({
						userId,
						entityId: providerEntityId,
						lifecycle: ingestionOperationCommand(command, intent.operationId),
					});
				}
				aliases.set(intent.alias, providerEntityId);
				continue;
			}
			const written = yield* runImportWriteStep({
				result: GenericImportEntity,
				pending: PendingEntityMutation,
				applyPolicies: entities.applyMutationPolicies,
				name: `generic-import-item-${index}-entity-${intentIndex}`,
				prepare: prepareGenericImportEntity(
					intent,
					userId,
					ingestionOperationCommand(command, intent.operationId),
				),
				commit: (pending) =>
					entities
						.commitMutation(pending)
						.pipe(
							Effect.map((step) => ({
								...step,
								result: { result: "created" as const, entityId: step.result.entity.id },
							})),
						),
			});
			warnings.push(...written.warnings);
			aliases.set(intent.alias, written.result.entityId);
		}
		for (const [relationshipIndex, intent] of item.relationships.entries()) {
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
				relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
				relationshipSchemaSlug: RelationshipSchemaSlug.make(intent.relationshipSchemaSlug),
			} as const;
			const relationshipCommand = ingestionOperationCommand(command, intent.operationId);
			const written = yield* runImportWriteStep({
				result: RelationshipSingleResult,
				commit: relationships.commitSingle,
				pending: PendingRelationshipMutations,
				applyPolicies: relationships.applyPolicies,
				name: `generic-import-item-${index}-relationship-${relationshipIndex}`,
				prepare:
					intent.propertiesMode === "merge"
						? relationships.prepareMergeUserProperties(input, relationshipCommand)
						: relationships.prepareCreate(input, relationshipCommand),
			});
			warnings.push(...written.warnings);
		}
		const events: CreateEventItem[] = [];
		const collectionMemberships: Array<{
			entityId: EntityId;
			collectionId: EntityId;
			operationId: string;
		}> = [];
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
		for (const [membershipIndex, membership] of (item.collectionMemberships ?? []).entries()) {
			const entityId = aliases.get(membership.entityAlias);
			if (!entityId) {
				return yield* new ImportRunError({
					message: "Import collection membership references an unknown entity alias",
				});
			}
			const collection = yield* runImportWriteStep({
				result: CollectionEntityResult,
				pending: PendingEntityMutation,
				commit: collections.commitCollection,
				applyPolicies: collections.applyCollectionPolicies,
				name: `generic-import-item-${index}-collection-${membershipIndex}`,
				prepare: collections.prepareGetOrCreateCollection(
					userId,
					membership.collectionName,
					ingestionOperationCommand(command, `${membership.operationId}:collection`),
				),
			});
			warnings.push(...collection.warnings);
			collectionMemberships.push({
				entityId,
				collectionId: collection.result.id,
				operationId: membership.operationId,
			});
		}
		return { events, warnings, collectionMemberships, _tag: "ready" as const };
	});
	return yield* writeItem().pipe(
		Effect.catch((error) =>
			Effect.succeed({
				warnings,
				_tag: "failed" as const,
				message: unknownToMessage(error),
				stage:
					error instanceof GenericImportProviderError ? error.stage : ("database_commit" as const),
			}),
		),
	);
});

const resolveGenericImportDefinitions = (userId: UserId) =>
	makeActivity({
		name: "resolve-generic-import-definitions",
		error: ImportRunError satisfies DurableSchema,
		success: DefinitionSnapshot satisfies DurableSchema,
		execute: Effect.flatMap(DefinitionRepository, (definitions) =>
			definitions.getUserSnapshot(userId, { listed: false }),
		).pipe(Effect.mapError(toWorkflowError)),
	});

export const runProcessGenericImportChunksWorkflow = Effect.fn(
	"ProcessGenericImportChunksWorkflow",
)(
	function* (payload: typeof ProcessGenericImportChunksPayload.Type, executionId: string) {
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			ProcessGenericImportChunksWorkflow,
			payload.command.accountGeneration,
			executionId,
		).pipe(Effect.mapError(toWorkflowError));
		if (!payload.command.accountGeneration) {
			return yield* new ImportRunError({ message: "Ingestion account generation is missing" });
		}
		const scope: IngestionScope = {
			runId: payload.runId,
			userId: payload.userId,
			accountGeneration: payload.command.accountGeneration,
		};
		const repository = yield* ImportsRepository;
		const database = yield* DatabaseSession;
		const captures = yield* IngestionCaptures;
		const batches = yield* repository.listBatches(scope);
		const previous = batches.find(({ data }) => data.id === payload.batchId)?.data;
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
						yield* repository.registerBatch(scope, batch, genericImportChunkOperationIds(chunk), {
							executionId,
							workflowName: ProcessGenericImportChunksWorkflow._tag,
						});
						yield* repository.advanceBatch(scope, batch.id, "preparing");
						yield* repository.advanceBatch(scope, batch.id, "applying");
					}),
				)
				.pipe(Effect.mapError(toWorkflowError)),
		});
		const operations = genericIngestionOperations(chunk, scope.runId);
		const record = Effect.fnUntraced(function* (
			operation: IngestionOperation,
			result: "skipped" | "unsuccessful",
			code: string,
		) {
			const outcome = {
				...operation,
				result,
				receiptId: null,
				reason: { code, key: null },
				inputFingerprint: payload.inputFingerprint,
			};
			const issue = {
				reason: outcome.reason,
				id: operation.operationId,
				severity: "error" as const,
				recordKind: operation.recordKind,
				operationId: operation.operationId,
				attribution: operation.attribution,
			};
			yield* makeActivity({
				error: ImportRunError,
				name: `record-ingestion-result:${operation.operationId}`,
				execute: database
					.transaction(
						Effect.gen(function* () {
							yield* repository.recordOutcome(scope, outcome);
							if (result === "unsuccessful") {
								yield* repository.recordIssue(scope, issue);
							}
						}),
					)
					.pipe(Effect.mapError(toWorkflowError)),
			});
		});
		const snapshot = yield* resolveGenericImportDefinitions(payload.userId);
		const definitions = definitionLookup(snapshot);
		for (const failure of chunk.failures) {
			const stage = failure.stage ?? "input_transformation";
			yield* record(
				genericIngestionFailureOperation(failure, scope.runId),
				"unsuccessful",
				failureReasonByStage[stage].code,
			);
		}
		for (const [index, item] of chunk.items.entries()) {
			const run = yield* repository.getIngestionRun(scope);
			if (run?.status !== "running") {
				break;
			}
			const outcome = yield* writeGenericItem(
				item,
				payload.userId,
				index,
				definitions,
				payload.command,
			);
			let message = outcome._tag === "failed" ? outcome.message : null;
			let failureCode: string | null =
				outcome._tag === "failed" ? failureReasonByStage[outcome.stage].code : null;
			const warnings = [...outcome.warnings];
			if (outcome._tag === "ready") {
				const engine = yield* WorkflowEngine;
				for (const membership of outcome.collectionMemberships) {
					const collectionExecutionId = stableStringify([
						scope.runId,
						"membership",
						membership.operationId,
					]);
					const collectionResult = yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						AddEntityToCollectionWorkflow,
						payload.command.accountGeneration,
						{
							executionId: collectionExecutionId,
							payload: {
								properties: {},
								userId: payload.userId,
								entityId: membership.entityId,
								executionId: collectionExecutionId,
								collectionId: membership.collectionId,
								command: ingestionOperationCommand(payload.command, membership.operationId),
							},
						},
						(admission) => admission.pipe(Effect.mapError(toWorkflowError)),
						(execution) => execution.pipe(Effect.result),
					);
					if (collectionResult._tag === "Failure" && !message) {
						message = unknownToMessage(collectionResult.failure);
						failureCode ??= "membership-event-failed";
						const operation = operations.find(
							(value) => value.operationId === membership.operationId,
						);
						if (operation) {
							yield* record(operation, "unsuccessful", "membership-event-failed");
						}
					} else if (collectionResult._tag === "Success") {
						warnings.push(...collectionResult.success.warnings);
					}
				}
				if (outcome.events.length > 0) {
					const events = yield* EventsService;
					const eventResult = yield* events
						.create(
							{
								userId: payload.userId,
								payload: outcome.events,
								itemIdentities: item.events.map(
									(intent) =>
										ingestionOperationCommand(payload.command, intent.operationId).itemIdentity,
								),
							},
							{
								...payload.command,
								itemIdentity: stableStringify([
									"ingestion-event-group",
									item.events.map((intent) => intent.operationId),
								]),
							},
						)
						.pipe(Effect.mapError(toWorkflowError));
					warnings.push(...eventResult.warnings);
					message ??= eventResult.failure?.reason.code ?? null;
					if (eventResult.failure) {
						failureCode = eventResult.failure.reason.code;
					}
					for (const event of eventResult.outcomes) {
						const intent = item.events[event.index];
						const operation =
							intent && operations.find((value) => value.operationId === intent.operationId);
						if (operation && event.status === "skipped_by_policy") {
							yield* record(operation, "skipped", event.reason);
						}
					}
				}
			}
			if (warnings.length > 0) {
				yield* Effect.logWarning("generic import item completed with automation warnings").pipe(
					Effect.annotateLogs({ warnings, runId: scope.runId, itemIndex: item.itemIndex }),
				);
			}
			if (
				failureCode !== null &&
				(yield* repository.getIngestionRun(scope))?.status === "running"
			) {
				const candidates = operations.filter((operation) =>
					genericImportItemIntents(item).some(
						(intent) => intent.operationId === operation.operationId,
					),
				);
				const committed = yield* receipts.getCommittedItems({
					userId: scope.userId,
					rootExecutionId: scope.runId,
					accountGeneration: scope.accountGeneration,
					itemIdentities: candidates.map((operation) => operation.itemIdentity),
				});
				for (const operation of candidates) {
					if (
						!committed.some((receipt) => receipt.itemIdentity === operation.itemIdentity) &&
						!(yield* repository.getOutcome(scope, operation.operationId))
					) {
						yield* record(operation, "unsuccessful", failureCode);
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
		return yield* genericIngestionBatchResult(scope, { ...batch, summary }, chunk);
	},
	(effect) => effect.pipe(Effect.mapError(toWorkflowError)),
);

export const ProcessGenericImportChunksWorkflowDefinitionsLive = implementWorkflow(
	ProcessGenericImportChunksWorkflow,
	runProcessGenericImportChunksWorkflow,
);
