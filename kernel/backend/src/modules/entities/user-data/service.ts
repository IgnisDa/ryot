import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
	type MergeEntityUserDataBody,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import type { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, type EntitySchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	type LifecyclePersistenceError,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { type DomainLifecycleCommand, DomainWriteConflict } from "#modules/entities/write-context";
import { EventsRepository } from "#modules/events/repository";
import {
	EventsService,
	type PreparedEventDelete,
	type PreparedEventMoveReferences,
} from "#modules/events/service";
import {
	mutationReceiptIdentity,
	MutationReceiptIdentityConflict,
	MutationReceipts,
} from "#modules/mutations/receipts";
import type {
	PreparedUserRelationshipCreate,
	PreparedUserRelationshipDelete,
} from "#modules/relationships/prepared-mutations";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";
import { trimToNull } from "#platform/validation";

import { EntityUserDataGraphRepository } from "./graph-repository";
import {
	embeddedEntityReferences,
	evidenceSchemas,
	mergeChildReferences,
	rewriteEntityProperties,
	userStateEvidence,
	userStateGraph,
} from "./planning";

const itemCommand = (
	command: DomainLifecycleCommand,
	identity: string,
): DomainLifecycleCommand => ({ ...command, itemIdentity: `${command.itemIdentity}:${identity}` });

const lifecyclePersistenceFailure = (error: LifecyclePersistenceError) =>
	new DbError({ message: `User-state lifecycle persistence failed: ${error.code}` });
const relationshipFailure =
	(operation: "clear" | "merge") => (error: RelationshipNotFound | RelationshipBadRequest) =>
		Effect.logWarning(`relationship ${operation} failed`, error).pipe(
			Effect.andThen(
				new EntityUserDataBadRequest({ reason: { code: "relationship-merge-failed" } }),
			),
		);

type MergeAuthority = { readonly entitySchemaSlug: EntitySchemaSlug };
type RelationshipRow = Effect.Success<
	ReturnType<RelationshipsRepository["Service"]["listUserRelationshipsForEntitiesWithProvenance"]>
>[number];

const relationshipKey = (
	relationship: Pick<
		RelationshipRow,
		"sourceEntityId" | "targetEntityId" | "relationshipSchemaSlug" | "relationshipSchemaPluginId"
	>,
) =>
	stableStringify([
		relationship.relationshipSchemaPluginId,
		relationship.relationshipSchemaSlug,
		relationship.sourceEntityId,
		relationship.targetEntityId,
	]);

const stateConflict = () =>
	new EntityUserDataBadRequest({
		reason: {
			code: "state-conflict",
			message:
				"Your data or the entity inventory changed. Refresh this page and try again. No data was changed.",
		},
	});

const assertState = (before: unknown, after: unknown) =>
	stableStringify(before) === stableStringify(after) ? Effect.void : Effect.fail(stateConflict());

export class EntityUserDataService extends Context.Service<EntityUserDataService>()(
	"EntityUserDataService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
				database.transaction(work).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const planner = yield* LifecyclePlanner;
			const receipts = yield* MutationReceipts;
			const ClearResult = Schema.Struct({
				entityId: EntityId,
				deletedEventsCount: Schema.Finite,
				deletedRelationshipsCount: Schema.Finite,
			});
			const MergeResult = Schema.Struct({
				mergeFrom: EntityId,
				mergeInto: EntityId,
				movedEventsCount: Schema.Finite,
				movedRelationshipsCount: Schema.Finite,
			});
			const lookup = <Result>(
				identity: ReturnType<typeof mutationReceiptIdentity>,
				result: Schema.Codec<Result, unknown>,
				lock = true,
			) =>
				(lock ? receipts.lookup(identity, result) : receipts.peek(identity, result)).pipe(
					Effect.mapError((error) =>
						error instanceof MutationReceiptIdentityConflict
							? new EntityUserDataBadRequest({ reason: { code: "command-identity-conflict" } })
							: error,
					),
				);
			const lifecycleExecution = yield* LifecycleExecution;
			const eventsRepository = yield* EventsRepository;
			const events = yield* EventsService;
			const relationships = yield* RelationshipsService;
			const definitions = yield* DefinitionRepository;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			const graphRepository = yield* EntityUserDataGraphRepository;
			const state = Effect.fnUntraced(function* (input: {
				userId: UserId;
				entityId: EntityId;
				pluginId: null | string;
				policy: undefined | PluginEntityUserStatePolicy;
			}) {
				const graph = yield* userStateGraph(graphRepository, input);
				const eventReferences = yield* eventsRepository.listUserDataEventReferences({
					userId: input.userId,
					entityIds: graph.entityIds,
				});
				if ((input.policy?.children?.length ?? 0) > 0) {
					const schemas = yield* evidenceSchemas(definitions, input.userId, input.pluginId, graph);
					const references = new Set(eventReferences.map(({ entityId }) => entityId));
					for (const evidence of graph.evidence) {
						const schema = schemas.get(evidence.id);
						if (schema) {
							for (const id of embeddedEntityReferences(evidence.properties, schema)) {
								references.add(EntityId.make(id));
							}
						}
					}
					const missing = [...references].filter((id) => !graph.entityIds.includes(id));
					if (missing.length > 0) {
						const retained = yield* entitiesRepository.getByIdsForUser({
							entityIds: missing,
							userId: input.userId,
						});
						for (const entity of retained.values()) {
							const group = graph.children.find(
								({ declaration }) => declaration.entitySchemaSlug === entity.entitySchemaSlug,
							);
							if (group && entity.entitySchemaPluginId === input.pluginId) {
								group.items.push({
									id: entity.id,
									name: entity.name,
									updatedAt: entity.updatedAt,
									properties: entity.properties,
								});
								graph.entityIds.push(entity.id);
							}
						}
					}
				}
				const currentIds = new Set(graph.currentEntityIds);
				const retainedIds = graph.entityIds.filter((id) => !currentIds.has(id));
				if (retainedIds.length > 0) {
					graph.evidence.push(
						...(yield* userStateEvidence(graphRepository, { ...input, entityIds: retainedIds })),
					);
					eventReferences.push(
						...(yield* eventsRepository.listUserDataEventReferences({
							userId: input.userId,
							entityIds: retainedIds,
						})),
					);
				}
				const rows = yield* relationshipsRepository.listUserRelationshipsForEntitiesWithProvenance({
					userId: input.userId,
					entityIds: graph.entityIds,
				});
				const selectedRelationships = rows.filter(
					(row) =>
						input.policy?.relationships === undefined ||
						input.policy.relationships.some(
							(reference) =>
								reference.slug === row.relationshipSchemaSlug &&
								(reference.owner.kind === "kernel" ? null : input.pluginId) ===
									row.relationshipSchemaPluginId,
						),
				);
				return {
					graph,
					relationships: selectedRelationships.sort((left, right) =>
						left.id.localeCompare(right.id),
					),
					eventIds: [
						...new Set([
							...eventReferences.map(({ id }) => id),
							...graph.evidence.map(({ id }) => id),
						]),
					].sort(),
					eventReferences: [
						...new Map(eventReferences.map((event) => [event.id, event])).values(),
					].sort((left, right) => left.id.localeCompare(right.id)),
				};
			});
			const lockState = Effect.fnUntraced(function* (
				states: ReadonlyArray<Effect.Success<ReturnType<typeof state>>>,
			) {
				yield* entitiesRepository.lockUserDataReferences(
					states.flatMap((value) => [
						...value.graph.entityIds,
						...value.graph.evidence.map(({ entityId }) => entityId),
						...value.relationships.flatMap(({ sourceEntityId, targetEntityId }) => [
							sourceEntityId,
							targetEntityId,
						]),
					]),
				);
			});
			const commit = Effect.fnUntraced(function* <Result extends object, E, R>(input: {
				command: DomainLifecycleCommand;
				recheck: Effect.Effect<void, E, R>;
				schema: Schema.Codec<Result, unknown>;
				identity: ReturnType<typeof mutationReceiptIdentity>;
				states: ReadonlyArray<Effect.Success<ReturnType<typeof state>>>;
				write: Effect.Effect<
					{
						result: Result;
						eventDispatch: ReadonlyArray<LifecycleDispatchPlan>;
						relationshipDispatch: ReadonlyArray<LifecycleDispatchPlan>;
					},
					E,
					R
				>;
			}) {
				const committed = yield* transaction(
					Effect.gen(function* () {
						const prior = yield* lookup(input.identity, input.schema);
						if (prior) {
							return { result: prior.result, dispatch: prior.dispatch };
						}
						yield* lockState(input.states);
						yield* input.recheck;
						for (const resource of ["event", "relationship"] as const) {
							yield* planner.prepareBatch({
								resource,
								command: input.command,
								scopes: [input.identity.scopeUserId],
								identity: [resource === "event" ? "events" : "relationships"],
							});
						}
						const written = yield* input.write;
						const dispatch = [
							...written.eventDispatch,
							...written.relationshipDispatch,
							...(yield* planner.planBatch({
								resource: "event",
								identity: ["events"],
								command: input.command,
							})),
							...(yield* planner.planBatch({
								command: input.command,
								resource: "relationship",
								identity: ["relationships"],
							})),
						];
						yield* receipts.insert({ dispatch, result: written.result, identity: input.identity });
						return { dispatch, result: written.result };
					}),
				);
				return {
					...committed.result,
					warnings: yield* lifecycleExecution.dispatch(committed.dispatch),
				};
			});

			const prepareRelationshipMove = Effect.fnUntraced(function* (input: {
				relationship: RelationshipRow;
				userId: CurrentUserValue["id"];
				command: DomainLifecycleCommand;
				references: ReadonlyMap<EntityId, EntityId>;
				destinationRelationships: ReadonlyMap<string, RelationshipRow>;
			}) {
				const { userId, command, references, relationship } = input;
				const sourceEntityId =
					references.get(relationship.sourceEntityId) ?? relationship.sourceEntityId;
				const targetEntityId =
					references.get(relationship.targetEntityId) ?? relationship.targetEntityId;
				if (
					sourceEntityId === relationship.sourceEntityId &&
					targetEntityId === relationship.targetEntityId
				) {
					return { create: null, deletion: null };
				}
				const destination = input.destinationRelationships.get(
					relationshipKey({ ...relationship, sourceEntityId, targetEntityId }),
				);
				let create: null | PreparedUserRelationshipCreate = null;
				if (sourceEntityId !== targetEntityId) {
					create = yield* relationships
						.prepareUserCreate(
							{
								userId,
								scope: "user",
								sourceEntityId,
								targetEntityId,
								properties: { ...relationship.properties, ...destination?.properties },
								relationshipSchema: {
									slug: relationship.relationshipSchemaSlug,
									owner: definitionOwner(relationship.relationshipSchemaPluginId),
								},
							},
							itemCommand(command, `relationship:${relationship.id}:create`),
						)
						.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("merge") }));
				}

				const deletion = yield* relationships
					.prepareUserDelete(
						{
							userId,
							scope: "user",
							sourceEntityId: relationship.sourceEntityId,
							targetEntityId: relationship.targetEntityId,
							relationshipSchema: {
								slug: relationship.relationshipSchemaSlug,
								owner: definitionOwner(relationship.relationshipSchemaPluginId),
							},
						},
						itemCommand(command, `relationship:${relationship.id}:delete`),
					)
					.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("merge") }));
				return { create, deletion };
			});

			const clearEntityUserData = Effect.fn("EntityUserDataService.clearEntityUserData")(function* (
				user: Pick<CurrentUserValue, "id">,
				entityIdInput: EntityId,
				command: DomainLifecycleCommand,
				authority?: MergeAuthority,
			) {
				const trimmedEntityId = trimToNull(entityIdInput);
				if (!trimmedEntityId) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "entityId", code: "required-field" },
					});
				}

				const entityId = EntityId.make(trimmedEntityId);
				const identity = mutationReceiptIdentity({
					command,
					input: { entityId },
					ownerUserId: user.id,
					scopeUserId: user.id,
					commandKind: "entity-user-data:clear",
				});
				const replay = yield* lookup(identity, ClearResult, false);
				if (replay) {
					return {
						...replay.result,
						warnings: yield* lifecycleExecution.dispatch(replay.dispatch),
					};
				}
				const scope = yield* entitiesRepository.getEntityScopeForUser({
					entityId,
					userId: user.id,
				});
				if (!scope) {
					return yield* new EntityUserDataNotFound({
						reason: { entityIds: [entityId], code: "entity-not-found" },
					});
				}
				if (authority) {
					const plugin = command.writeContext?.pluginRevision;
					if (
						!plugin ||
						scope.entitySchemaPluginId !== plugin.id ||
						scope.entitySchemaSlug !== authority.entitySchemaSlug
					) {
						return yield* new EntityUserDataBadRequest({
							reason: { code: "entity-schema-mismatch" },
						});
					}
				}

				const entitySchemaReference = {
					slug: scope.entitySchemaSlug,
					owner: definitionOwner(scope.entitySchemaPluginId),
				};
				const entitySchema = (yield* definitions
					.findUserEntitySchemas(user.id, [entitySchemaReference])
					.pipe(Effect.orDie))[
					definitionKey("entity", entitySchemaReference.owner, entitySchemaReference.slug)
				];
				if (entitySchema?.userState?.deniedOperations.includes("clear")) {
					return yield* new EntityUserDataBadRequest({
						reason: { operation: "clear", code: "operation-denied" },
					});
				}

				const stateInput = {
					entityId,
					userId: user.id,
					policy: entitySchema?.userState,
					pluginId: scope.entitySchemaPluginId,
				};
				const captured = yield* state(stateInput);
				const eventIds = captured.eventIds;
				const preparedEvents: PreparedEventDelete[] = [];
				for (const eventId of eventIds) {
					const prepared = yield* events.prepareDelete(
						{ eventId, userId: user.id },
						itemCommand(command, `event:${eventId}:delete`),
					);
					if (prepared) {
						preparedEvents.push(prepared);
					}
				}
				const relationshipRows = captured.relationships;
				const preparedRelationships: PreparedUserRelationshipDelete[] = [];
				for (const relationship of relationshipRows) {
					const prepared = yield* relationships
						.prepareUserDelete(
							{
								scope: "user",
								userId: user.id,
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								relationshipSchema: {
									slug: relationship.relationshipSchemaSlug,
									owner: definitionOwner(relationship.relationshipSchemaPluginId),
								},
							},
							itemCommand(command, `relationship:${relationship.id}:delete`),
						)
						.pipe(Effect.catchTags({ RelationshipBadRequest: relationshipFailure("clear") }));
					if (prepared) {
						preparedRelationships.push(prepared);
					}
				}

				return yield* commit({
					command,
					identity,
					states: [captured],
					schema: ClearResult,
					recheck: state(stateInput).pipe(
						Effect.flatMap((current) => assertState(captured, current)),
					),
					write: Effect.gen(function* () {
						const eventDispatch: LifecycleDispatchPlan[] = [];
						for (const [index, prepared] of preparedEvents.entries()) {
							eventDispatch.push(
								...(yield* events.persistPreparedDelete(prepared, {
									index,
									command,
									identity: ["events"],
								})).dispatch,
							);
						}
						const relationshipDispatch: LifecycleDispatchPlan[] = [];
						for (const [index, prepared] of preparedRelationships.entries()) {
							const work = yield* relationships
								.persistPreparedUserDelete(prepared, {
									index,
									command,
									identity: ["relationships"],
								})
								.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("clear")));
							relationshipDispatch.push(...work.dispatch);
						}
						const result = {
							entityId,
							deletedEventsCount: preparedEvents.length,
							deletedRelationshipsCount: preparedRelationships.length,
						};
						return { result, eventDispatch, relationshipDispatch };
					}),
				});
			});

			const mergeEntityUserData = Effect.fn("EntityUserDataService.mergeEntityUserData")(function* (
				userId: UserId,
				payload: MergeEntityUserDataBody,
				command: DomainLifecycleCommand,
				authority?: MergeAuthority,
			) {
				const trimmedMergeFrom = trimToNull(payload.mergeFrom);
				const trimmedMergeInto = trimToNull(payload.mergeInto);

				if (!trimmedMergeFrom) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "mergeFrom", code: "required-field" },
					});
				}
				if (!trimmedMergeInto) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "mergeInto", code: "required-field" },
					});
				}
				if (trimmedMergeFrom === trimmedMergeInto) {
					return yield* new EntityUserDataBadRequest({ reason: { code: "same-entity-merge" } });
				}

				const mergeFrom = EntityId.make(trimmedMergeFrom);
				const mergeInto = EntityId.make(trimmedMergeInto);
				const identity = mutationReceiptIdentity({
					command,
					ownerUserId: userId,
					scopeUserId: userId,
					input: { mergeFrom, mergeInto },
					commandKind: "entity-user-data:merge",
				});
				const replay = yield* lookup(identity, MergeResult, false);
				if (replay) {
					return {
						...replay.result,
						warnings: yield* lifecycleExecution.dispatch(replay.dispatch),
					};
				}

				const [fromScope, intoScope] = yield* Effect.all([
					entitiesRepository.getEntityMergeScopeForUser({ userId: userId, entityId: mergeFrom }),
					entitiesRepository.getEntityMergeScopeForUser({ userId: userId, entityId: mergeInto }),
				]);
				if (!fromScope || !intoScope) {
					return yield* new EntityUserDataNotFound({
						reason: { code: "entity-not-found", entityIds: [mergeFrom, mergeInto] },
					});
				}
				if (authority) {
					const plugin = command.writeContext?.pluginRevision;
					if (!plugin) {
						return yield* new DbError({ message: "Entity merge requires a pinned plugin" });
					}
					if (
						fromScope.entitySchemaSlug !== authority.entitySchemaSlug ||
						intoScope.entitySchemaSlug !== authority.entitySchemaSlug
					) {
						return yield* new EntityUserDataBadRequest({
							reason: { code: "entity-schema-mismatch" },
						});
					}
					for (const scope of [fromScope, intoScope]) {
						if (scope.entitySchemaPluginId !== plugin.id) {
							return yield* new DomainWriteConflict({
								message: "Entity merge belongs to another definition owner",
								reason: {
									code: "owner-mismatch",
									expected: definitionOwner(plugin.id),
									actual: definitionOwner(scope.entitySchemaPluginId),
								},
							});
						}
					}
				}
				const fromEntitySchemaReference = {
					slug: fromScope.entitySchemaSlug,
					owner: definitionOwner(fromScope.entitySchemaPluginId),
				};
				const intoEntitySchemaReference = {
					slug: intoScope.entitySchemaSlug,
					owner: definitionOwner(intoScope.entitySchemaPluginId),
				};
				const entitySchemas = yield* definitions
					.findUserEntitySchemas(userId, [fromEntitySchemaReference, intoEntitySchemaReference])
					.pipe(Effect.orDie);
				const fromEntitySchema =
					entitySchemas[
						definitionKey("entity", fromEntitySchemaReference.owner, fromEntitySchemaReference.slug)
					];
				const intoEntitySchema =
					entitySchemas[
						definitionKey("entity", intoEntitySchemaReference.owner, intoEntitySchemaReference.slug)
					];
				if (
					fromEntitySchema?.userState?.deniedOperations.includes("merge") ||
					intoEntitySchema?.userState?.deniedOperations.includes("merge")
				) {
					return yield* new EntityUserDataBadRequest({
						reason: { operation: "merge", code: "operation-denied" },
					});
				}
				if (
					fromScope.entitySchemaSlug !== intoScope.entitySchemaSlug ||
					fromScope.entitySchemaPluginId !== intoScope.entitySchemaPluginId
				) {
					return yield* new EntityUserDataBadRequest({
						reason: { code: "entity-schema-mismatch" },
					});
				}
				if (!fromEntitySchema) {
					return yield* Effect.die("Entity schema not found during entity merge");
				}
				for (const property of fromEntitySchema.mergeIdentityProperties) {
					if (!Bun.deepEquals(fromScope.properties[property], intoScope.properties[property])) {
						return yield* new EntityUserDataBadRequest({
							reason: { property, code: "identity-property-mismatch" },
						});
					}
				}
				const sourceInput = {
					userId,
					entityId: mergeFrom,
					policy: fromEntitySchema.userState,
					pluginId: fromScope.entitySchemaPluginId,
				};
				const targetInput = { ...sourceInput, entityId: mergeInto };
				const sourceState = yield* state(sourceInput);
				const targetState = yield* state(targetInput);
				const sourceEntityIds = new Set(sourceState.graph.entityIds);
				const requiredIds = new Set<string>(
					[
						...sourceState.eventReferences.flatMap(({ entityId, sessionEntityId }) =>
							sessionEntityId === null ? [entityId] : [entityId, sessionEntityId],
						),
						...sourceState.relationships.flatMap(({ sourceEntityId, targetEntityId }) => [
							sourceEntityId,
							targetEntityId,
						]),
					].filter((id) => sourceEntityIds.has(id)),
				);
				const schemas = yield* evidenceSchemas(
					definitions,
					userId,
					fromScope.entitySchemaPluginId,
					sourceState.graph,
				);
				for (const evidence of sourceState.graph.evidence) {
					const schema = schemas.get(evidence.id);
					if (schema) {
						for (const id of embeddedEntityReferences(evidence.properties, schema)) {
							requiredIds.add(id);
						}
					}
				}
				const childReferences = yield* mergeChildReferences(
					sourceState.graph,
					targetState.graph,
					requiredIds,
				);
				const references = [{ from: mergeFrom, into: mergeInto }, ...childReferences];
				const referenceMap = new Map(references.map(({ from, into }) => [from, into]));
				const missingReferences = [...requiredIds].filter(
					(id) => !referenceMap.has(EntityId.make(id)),
				);
				if (missingReferences.length > 0) {
					return yield* new EntityUserDataBadRequest({
						reason: {
							code: "child-mapping-conflict",
							entityIds: missingReferences.slice(0, 10).map((id) => EntityId.make(id)),
							message: `Cannot merge retained history with ${missingReferences.length} unavailable referenced item(s). Refresh source data or correct the custom inventory, or remove the affected history, then try again. No data was moved.`,
						},
					});
				}
				const resetEvidence = [...sourceState.graph.evidence, ...targetState.graph.evidence].filter(
					({ declaration }) => declaration.resetOnMerge,
				);
				const resetIds = new Set(resetEvidence.map(({ id }) => id));
				const eventIds = sourceState.eventIds.filter((id) => !resetIds.has(id));
				const preparedEvents: PreparedEventMoveReferences[] = [];
				const evidenceById = new Map(sourceState.graph.evidence.map((item) => [item.id, item]));
				const childReferenceById = new Map(childReferences.map((item) => [item.from, item]));
				const eventReferenceById = new Map(
					sourceState.eventReferences.map((event) => [event.id, event]),
				);
				for (const eventId of eventIds) {
					const evidence = evidenceById.get(eventId);
					const schema = schemas.get(eventId);
					const event = eventReferenceById.get(eventId);
					const eventReferences =
						event === undefined
							? []
							: [
									childReferenceById.get(event.entityId),
									...(event.sessionEntityId === null
										? []
										: [childReferenceById.get(event.sessionEntityId)]),
								].filter((item) => item !== undefined);
					if (evidence && !schema) {
						return yield* new DbError({ message: "User-state evidence schema is unavailable" });
					}
					const prepared = yield* events.prepareMoveReferences(
						{
							userId,
							eventId,
							mergeFrom,
							mergeInto,
							...(eventReferences.length > 0 ? { references: eventReferences } : {}),
							...(evidence && schema
								? { properties: rewriteEntityProperties(evidence.properties, schema, referenceMap) }
								: {}),
						},
						itemCommand(command, `event:${eventId}:update`),
					);
					if (prepared) {
						preparedEvents.push(prepared);
					}
				}
				const preparedResets: PreparedEventDelete[] = [];
				for (const eventId of resetIds) {
					const prepared = yield* events.prepareDelete(
						{ userId, eventId },
						itemCommand(command, `event:${eventId}:delete`),
					);
					if (prepared) {
						preparedResets.push(prepared);
					}
				}
				const relationshipRows = sourceState.relationships;
				const destinationRelationships = new Map(
					targetState.relationships.map((row) => [relationshipKey(row), row]),
				);
				const preparedRelationships: Array<{
					create: null | PreparedUserRelationshipCreate;
					deletion: null | PreparedUserRelationshipDelete;
				}> = [];
				for (const relationship of relationshipRows) {
					preparedRelationships.push(
						yield* prepareRelationshipMove({
							command,
							relationship,
							userId: userId,
							references: referenceMap,
							destinationRelationships,
						}),
					);
				}

				return yield* commit({
					command,
					identity,
					schema: MergeResult,
					states: [sourceState, targetState],
					recheck: Effect.gen(function* () {
						yield* assertState(
							fromScope,
							yield* entitiesRepository.getEntityMergeScopeForUser({ userId, entityId: mergeFrom }),
						);
						yield* assertState(
							intoScope,
							yield* entitiesRepository.getEntityMergeScopeForUser({ userId, entityId: mergeInto }),
						);
						yield* assertState(sourceState, yield* state(sourceInput));
						yield* assertState(targetState, yield* state(targetInput));
					}),
					write: Effect.gen(function* () {
						const eventDispatch: LifecycleDispatchPlan[] = [];
						for (const [index, prepared] of preparedResets.entries()) {
							eventDispatch.push(
								...(yield* events.persistPreparedDelete(prepared, {
									index,
									command,
									identity: ["events"],
								})).dispatch,
							);
						}
						for (const [index, prepared] of preparedEvents.entries()) {
							eventDispatch.push(
								...(yield* events.persistPreparedMoveReferences(prepared, {
									command,
									identity: ["events"],
									index: index + preparedResets.length,
								})).dispatch,
							);
						}
						const relationshipDispatch: LifecycleDispatchPlan[] = [];
						let movedRelationshipsCount = 0;
						let relationshipIndex = 0;
						for (const prepared of preparedRelationships) {
							if (prepared.create) {
								const work = yield* relationships
									.persistPreparedUserCreate(prepared.create, {
										command,
										index: relationshipIndex++,
										identity: ["relationships"],
									})
									.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("merge")));
								relationshipDispatch.push(...work.dispatch);
							}
							if (prepared.deletion) {
								const work = yield* relationships
									.persistPreparedUserDelete(prepared.deletion, {
										command,
										index: relationshipIndex++,
										identity: ["relationships"],
									})
									.pipe(Effect.catchTag("RelationshipBadRequest", relationshipFailure("merge")));
								relationshipDispatch.push(...work.dispatch);
								movedRelationshipsCount += 1;
							}
						}

						const result = {
							mergeFrom,
							mergeInto,
							movedRelationshipsCount,
							movedEventsCount: preparedEvents.length,
						};
						return { result, eventDispatch, relationshipDispatch };
					}),
				});
			});

			return {
				clearEntityUserData: (
					user: CurrentUserValue,
					entityId: EntityId,
					command: LifecycleCommand,
				) =>
					clearEntityUserData(user, entityId, { ...command, writeContext: null }).pipe(
						Effect.catchTags({
							EventStale: stateConflict,
							LifecyclePersistenceError: lifecyclePersistenceFailure,
						}),
					),
				mergeEntityUserData: (
					user: CurrentUserValue,
					payload: MergeEntityUserDataBody,
					command: LifecycleCommand,
				) =>
					mergeEntityUserData(user.id, payload, { ...command, writeContext: null }).pipe(
						Effect.catchTags({
							EventStale: stateConflict,
							LifecyclePersistenceError: lifecyclePersistenceFailure,
						}),
					),
				clearEntityUserDataForCommand: (
					userId: UserId,
					payload: MergeAuthority & { readonly entityId: EntityId },
					command: DomainLifecycleCommand,
				) =>
					clearEntityUserData({ id: userId }, payload.entityId, command, {
						entitySchemaSlug: payload.entitySchemaSlug,
					}).pipe(
						Effect.catchTags({
							EventStale: stateConflict,
							LifecyclePersistenceError: lifecyclePersistenceFailure,
						}),
					),
				mergeEntityUserDataForCommand: (
					userId: UserId,
					payload: MergeAuthority & MergeEntityUserDataBody,
					command: DomainLifecycleCommand,
				) =>
					mergeEntityUserData(
						userId,
						{ mergeFrom: payload.mergeFrom, mergeInto: payload.mergeInto },
						command,
						{ entitySchemaSlug: payload.entitySchemaSlug },
					).pipe(
						Effect.catchTags({
							EventStale: stateConflict,
							LifecyclePersistenceError: lifecyclePersistenceFailure,
						}),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
