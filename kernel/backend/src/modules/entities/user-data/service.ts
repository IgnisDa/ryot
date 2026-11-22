import { DbError } from "@ryot-app/contract/errors";
import {
	type ClearEntityUserDataResponse,
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
	type MergeEntityUserDataBody,
	type MergeEntityUserDataResponse,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import type { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	definitionOwner,
	definitionOwnerPluginId,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, type UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer } from "effect";

import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { type DomainLifecycleCommand, DomainWriteConflict } from "#modules/entities/write-context";
import type { EventMutation } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import type {
	acceptRelationshipPolicies,
	PreparedUserRelationship,
} from "#modules/relationships/prepared-mutations";
import {
	relationshipMutationLockKey,
	RelationshipsRepository,
} from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import type { WritePreparation, WriteTransaction } from "#platform/db/write-transaction";
import { trimToNull } from "#platform/validation";

import { EntityUserDataAttachments } from "./attachments";
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

const relationshipFailure =
	(operation: "clear" | "merge") => (error: RelationshipNotFound | RelationshipBadRequest) =>
		Effect.logWarning(`relationship ${operation} failed`, error).pipe(
			Effect.andThen(
				new EntityUserDataBadRequest({ reason: { code: "relationship-merge-failed" } }),
			),
		);

type MergeAuthority = null | EntitySchemaReference;
type Accept = ReturnType<typeof acceptRelationshipPolicies>;
type RelationshipRow = Effect.Success<
	ReturnType<RelationshipsRepository["Service"]["listUserRelationshipsForEntitiesWithProvenance"]>
>[number];

const relationshipKey = (
	relationship: Pick<
		RelationshipRow,
		| "key"
		| "sourceEntityId"
		| "targetEntityId"
		| "relationshipSchemaSlug"
		| "relationshipSchemaPluginId"
	>,
) =>
	stableStringify([
		relationship.relationshipSchemaPluginId,
		relationship.relationshipSchemaSlug,
		relationship.sourceEntityId,
		relationship.key === undefined ? relationship.targetEntityId : ["key", relationship.key],
	]);

const stateConflict = () => new EntityUserDataBadRequest({ reason: { code: "state-conflict" } });

const assertState = (before: unknown, after: unknown) =>
	stableStringify(before) === stableStringify(after) ? Effect.void : Effect.fail(stateConflict());

export class EntityUserDataService extends Context.Service<EntityUserDataService>()(
	"@ryot-app/kernel-backend/modules/entities/user-data/service/EntityUserDataService",
	{
		make: Effect.gen(function* () {
			const admission = yield* AccountAdmission.make;
			const planner = yield* LifecyclePlanner;
			const eventsRepository = yield* EventsRepository;
			const relationships = yield* RelationshipsService;
			const definitions = yield* DefinitionRepository;
			const entitiesRepository = yield* EntitiesRepository;
			const relationshipsRepository = yield* RelationshipsRepository;
			const graphRepository = yield* EntityUserDataGraphRepository;
			const attachments = yield* EntityUserDataAttachments;
			/** The selected user state, without the relationships `written` names, which the change set writes itself. */
			const state = Effect.fnUntraced(function* (
				input: {
					userId: UserId;
					entityId: EntityId;
					pluginId: null | string;
					policy: undefined | PluginEntityUserStatePolicy;
				},
				written: ReadonlySet<string>,
			) {
				const graph = yield* userStateGraph(graphRepository, input);
				const attached = yield* attachments.list({
					userId: input.userId,
					entityIds: graph.entityIds,
				});
				const eventReferences = yield* eventsRepository.listUserDataEventReferences({
					userId: input.userId,
					entityIds: graph.entityIds,
				});
				if ((input.policy?.children?.length ?? 0) > 0) {
					const schemas = yield* evidenceSchemas(definitions, input.userId, input.pluginId, graph);
					const references = new Set([
						...eventReferences.map(({ entityId }) => entityId),
						...attached.flatMap(({ entityId }) => (entityId === null ? [] : [entityId])),
					]);
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
						!written.has(
							relationshipMutationLockKey({ ...row, scope: "user", userId: input.userId }),
						) &&
						(input.policy?.relationships === undefined ||
							input.policy.relationships.some(
								(reference) =>
									reference.slug === row.relationshipSchemaSlug &&
									(reference.owner.kind === "kernel" ? null : input.pluginId) ===
										row.relationshipSchemaPluginId,
							)),
				);
				return {
					graph,
					attachments: attached,
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
			/**
			 * A clear or merge planned against captured user state: its event changes commit with the change
			 * set's events, its relationship changes take the change set's relationship policies, `lock` re-reads
			 * the state under locks before any write, and `write` persists the rest of it with each
			 * relationship change's accepted policy decision.
			 */
			const planned = <Result, E, R, WE, WR>(input: {
				userId: UserId;
				command: DomainLifecycleCommand;
				recheck: Effect.Effect<void, E, R>;
				events: ReadonlyArray<EventMutation>;
				relationships: ReadonlyArray<PreparedUserRelationship>;
				states: ReadonlyArray<Effect.Success<ReturnType<typeof state>>>;
				write: (
					transaction: WriteTransaction,
					batch: {
						readonly identity: ReadonlyArray<string>;
						readonly command: DomainLifecycleCommand;
					},
					accept: Accept,
				) => Effect.Effect<
					{ readonly result: Result; readonly dispatch: ReadonlyArray<LifecycleDispatchPlan> },
					WE,
					WR
				>;
			}) => {
				const entityIds = input.states.flatMap((value) => [
					...value.graph.entityIds,
					...value.graph.evidence.map(({ entityId }) => entityId),
					...value.relationships.flatMap(({ sourceEntityId, targetEntityId }) => [
						sourceEntityId,
						targetEntityId,
					]),
				]);
				const batch = {
					command: input.command,
					identity: ["relationships"],
					resource: "relationship" as const,
				};
				return Object.freeze({
					entityIds,
					events: input.events,
					relationships: input.relationships,
					lock: Effect.gen(function* () {
						if (input.command.accountUserId) {
							yield* admission.admitAccount(input.command.accountUserId);
						}
						yield* entitiesRepository.lockUserDataReferences(entityIds);
						yield* input.recheck;
					}),
					write: Effect.fnUntraced(function* (transaction: WriteTransaction, accept: Accept) {
						yield* planner.prepareBatch(transaction, { ...batch, scopes: [input.userId] });
						const written = yield* input.write(transaction, batch, accept);
						return {
							result: written.result,
							dispatch: [...written.dispatch, ...(yield* planner.planBatch(batch))],
						};
					}),
				});
			};

			const prepareRelationshipMove = Effect.fnUntraced(function* (input: {
				userId: UserId;
				preparation: WritePreparation;
				relationship: RelationshipRow;
				command: DomainLifecycleCommand;
				references: ReadonlyMap<EntityId, EntityId>;
				destinationRelationships: ReadonlyMap<string, RelationshipRow>;
			}) {
				const { userId, command, references, preparation, relationship } = input;
				const sourceEntityId =
					references.get(relationship.sourceEntityId) ?? relationship.sourceEntityId;
				const targetEntityId =
					references.get(relationship.targetEntityId) ?? relationship.targetEntityId;
				if (
					sourceEntityId === relationship.sourceEntityId &&
					targetEntityId === relationship.targetEntityId
				) {
					return { create: null, deletion: null, retarget: false };
				}
				const destination = input.destinationRelationships.get(
					relationshipKey({ ...relationship, sourceEntityId, targetEntityId }),
				);
				const retarget =
					relationship.key !== undefined &&
					sourceEntityId === relationship.sourceEntityId &&
					sourceEntityId !== targetEntityId;
				let create: null | PreparedUserRelationship = null;
				if (sourceEntityId !== targetEntityId) {
					create = yield* relationships
						.prepareUserWrite(
							preparation,
							{
								userId,
								scope: "user",
								...(relationship.key === undefined ? {} : { key: relationship.key }),
								sourceEntityId,
								targetEntityId,
								properties: { ...relationship.properties, ...destination?.properties },
								relationshipSchema: {
									slug: relationship.relationshipSchemaSlug,
									owner: definitionOwner(relationship.relationshipSchemaPluginId),
								},
							},
							itemCommand(command, `relationship:${relationship.id}:create`),
							"upsert",
							[],
							retarget ? relationship.targetEntityId : undefined,
						)
						.pipe(
							Effect.catchTags({
								RelationshipNotFound: relationshipFailure("merge"),
								RelationshipBadRequest: relationshipFailure("merge"),
							}),
						);
				}

				const deletion = retarget
					? null
					: yield* relationships
							.prepareUserDelete(
								preparation,
								{
									userId,
									scope: "user",
									...(relationship.key === undefined ? {} : { key: relationship.key }),
									sourceEntityId: relationship.sourceEntityId,
									targetEntityId: relationship.targetEntityId,
									relationshipSchema: {
										slug: relationship.relationshipSchemaSlug,
										owner: definitionOwner(relationship.relationshipSchemaPluginId),
									},
								},
								itemCommand(command, `relationship:${relationship.id}:delete`),
							)
							.pipe(
								Effect.catchTags({
									RelationshipNotFound: relationshipFailure("merge"),
									RelationshipBadRequest: relationshipFailure("merge"),
								}),
							);
				return { create, deletion, retarget };
			});

			/**
			 * Plans clearing the user's state for an entity of `entitySchema`, any schema when it is null,
			 * leaving the relationships `written` names to the change set that writes them.
			 */
			const prepareClear = Effect.fn("EntityUserDataService.prepareClear")(function* (
				preparation: WritePreparation,
				userId: UserId,
				input: { readonly entityId: EntityId; readonly entitySchema: MergeAuthority },
				command: DomainLifecycleCommand,
				written: ReadonlySet<string>,
			) {
				const authority = input.entitySchema;
				const trimmedEntityId = trimToNull(input.entityId);
				if (!trimmedEntityId) {
					return yield* new EntityUserDataBadRequest({
						reason: { field: "entityId", code: "required-field" },
					});
				}

				const entityId = EntityId.make(trimmedEntityId);
				const scope = yield* entitiesRepository.getEntityScopeForUser({ userId, entityId });
				if (!scope) {
					return yield* new EntityUserDataNotFound({
						reason: { entityIds: [entityId], code: "entity-not-found" },
					});
				}
				if (
					authority &&
					(scope.entitySchemaPluginId !== definitionOwnerPluginId(authority.owner) ||
						scope.entitySchemaSlug !== authority.slug)
				) {
					return yield* new EntityUserDataBadRequest({
						reason: { code: "entity-schema-mismatch" },
					});
				}

				const entitySchemaReference = {
					slug: scope.entitySchemaSlug,
					owner: definitionOwner(scope.entitySchemaPluginId),
				};
				const entitySchema = (yield* definitions
					.findUserEntitySchemas(userId, [entitySchemaReference], preparation)
					.pipe(Effect.orDie))[
					definitionKey("entity", entitySchemaReference.owner, entitySchemaReference.slug)
				];
				if (entitySchema?.userState?.deniedOperations.includes("clear")) {
					return yield* new EntityUserDataBadRequest({
						reason: { operation: "clear", code: "operation-denied" },
					});
				}

				const stateInput = {
					userId,
					entityId,
					policy: entitySchema?.userState,
					pluginId: scope.entitySchemaPluginId,
				};
				const captured = yield* state(stateInput, written);
				const events = captured.eventIds.map((eventId): EventMutation => ({
					eventId,
					kind: "delete",
					kernelCollection: true,
					itemIdentity: `event:${eventId}:delete`,
				}));
				const preparedRelationships: PreparedUserRelationship[] = [];
				for (const relationship of captured.relationships) {
					const prepared = yield* relationships
						.prepareUserDelete(
							preparation,
							{
								userId,
								scope: "user",
								...(relationship.key === undefined ? {} : { key: relationship.key }),
								sourceEntityId: relationship.sourceEntityId,
								targetEntityId: relationship.targetEntityId,
								relationshipSchema: {
									slug: relationship.relationshipSchemaSlug,
									owner: definitionOwner(relationship.relationshipSchemaPluginId),
								},
							},
							itemCommand(command, `relationship:${relationship.id}:delete`),
						)
						.pipe(
							Effect.catchTags({
								RelationshipNotFound: relationshipFailure("clear"),
								RelationshipBadRequest: relationshipFailure("clear"),
							}),
						);
					preparedRelationships.push(prepared);
				}

				return planned({
					events,
					userId,
					command,
					states: [captured],
					relationships: preparedRelationships,
					recheck: state(stateInput, written).pipe(
						Effect.flatMap((current) => assertState(captured, current)),
					),
					write: (transaction, batch, accept) =>
						Effect.gen(function* () {
							yield* attachments.clear({ userId, ids: captured.attachments.map(({ id }) => id) });
							const dispatch: LifecycleDispatchPlan[] = [];
							for (const [index, prepared] of preparedRelationships.entries()) {
								const work = yield* relationships
									.persistPrepared(transaction, yield* accept(prepared), { ...batch, index })
									.pipe(
										Effect.catchTags({
											RelationshipNotFound: relationshipFailure("clear"),
											RelationshipBadRequest: relationshipFailure("clear"),
										}),
									);
								dispatch.push(...work.dispatch);
							}
							const result: ClearEntityUserDataResponse = {
								entityId,
								deletedEventsCount: events.length,
								deletedRelationshipsCount: preparedRelationships.length,
							};
							return { result, dispatch };
						}),
				});
			});

			/**
			 * Plans merging one entity's user state into another of `entitySchema`, any schema when it is
			 * null, leaving the relationships `written` names to the change set that writes them.
			 */
			const prepareMerge = Effect.fn("EntityUserDataService.prepareMerge")(function* (
				preparation: WritePreparation,
				userId: UserId,
				payload: MergeEntityUserDataBody & { readonly entitySchema: MergeAuthority },
				command: DomainLifecycleCommand,
				written: ReadonlySet<string>,
			) {
				const authority = payload.entitySchema;
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
					if (
						fromScope.entitySchemaSlug !== authority.slug ||
						intoScope.entitySchemaSlug !== authority.slug
					) {
						return yield* new EntityUserDataBadRequest({
							reason: { code: "entity-schema-mismatch" },
						});
					}
					for (const scope of [fromScope, intoScope]) {
						if (scope.entitySchemaPluginId !== definitionOwnerPluginId(authority.owner)) {
							return yield* new DomainWriteConflict({
								message: "Entity merge belongs to another definition owner",
								reason: {
									code: "owner-mismatch",
									expected: authority.owner,
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
					.findUserEntitySchemas(
						userId,
						[fromEntitySchemaReference, intoEntitySchemaReference],
						preparation,
					)
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
				const sourceState = yield* state(sourceInput, written);
				const targetState = yield* state(targetInput, written);
				const sourceEntityIds = new Set(sourceState.graph.entityIds);
				const requiredIds = new Set<string>(
					[
						...sourceState.attachments.flatMap(({ entityId }) =>
							entityId === null ? [] : [entityId],
						),
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
						},
					});
				}
				const resetEvidence = [...sourceState.graph.evidence, ...targetState.graph.evidence].filter(
					({ declaration }) => declaration.transient,
				);
				const resetIds = new Set(resetEvidence.map(({ id }) => id));
				const eventIds = sourceState.eventIds.filter((id) => !resetIds.has(id));
				const moves: EventMutation[] = [];
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
					moves.push({
						eventId,
						mergeFrom,
						mergeInto,
						kind: "move",
						kernelCollection: true,
						itemIdentity: `event:${eventId}:update`,
						...(eventReferences.length > 0 ? { references: eventReferences } : {}),
						...(evidence && schema
							? { properties: rewriteEntityProperties(evidence.properties, schema, referenceMap) }
							: {}),
					});
				}
				const resets = [...resetIds].map((eventId): EventMutation => ({
					eventId,
					kind: "delete",
					kernelCollection: true,
					itemIdentity: `event:${eventId}:delete`,
				}));
				const relationshipRows = sourceState.relationships;
				const destinationRelationships = new Map(
					targetState.relationships.map((row) => [relationshipKey(row), row]),
				);
				const preparedRelationships: Array<{
					retarget: boolean;
					create: null | PreparedUserRelationship;
					deletion: null | PreparedUserRelationship;
				}> = [];
				for (const relationship of relationshipRows) {
					preparedRelationships.push(
						yield* prepareRelationshipMove({
							command,
							preparation,
							relationship,
							userId: userId,
							references: referenceMap,
							destinationRelationships,
						}),
					);
				}

				return planned({
					userId,
					command,
					events: [...resets, ...moves],
					states: [sourceState, targetState],
					relationships: preparedRelationships.flatMap(({ create, deletion }) =>
						[create, deletion].filter((prepared) => prepared !== null),
					),
					recheck: Effect.gen(function* () {
						yield* assertState(
							fromScope,
							yield* entitiesRepository.getEntityMergeScopeForUser({ userId, entityId: mergeFrom }),
						);
						yield* assertState(
							intoScope,
							yield* entitiesRepository.getEntityMergeScopeForUser({ userId, entityId: mergeInto }),
						);
						yield* assertState(sourceState, yield* state(sourceInput, written));
						yield* assertState(targetState, yield* state(targetInput, written));
					}),
					write: (transaction, batch, accept) =>
						Effect.gen(function* () {
							yield* eventsRepository.absorbFoldValues(transaction, {
								userId,
								references,
								ids: referenceMap,
							});
							yield* attachments.move({
								userId,
								references: referenceMap,
								ids: sourceState.attachments.map(({ id }) => id),
							});
							const dispatch: LifecycleDispatchPlan[] = [];
							let movedRelationshipsCount = 0;
							let index = 0;
							for (const prepared of preparedRelationships) {
								if (prepared.create) {
									const work = yield* relationships
										.persistPrepared(transaction, yield* accept(prepared.create), {
											...batch,
											index: index++,
										})
										.pipe(
											Effect.catchTags({
												RelationshipNotFound: relationshipFailure("merge"),
												RelationshipBadRequest: relationshipFailure("merge"),
											}),
										);
									dispatch.push(...work.dispatch);
									if (prepared.retarget) {
										movedRelationshipsCount += 1;
									}
								}
								if (prepared.deletion) {
									const work = yield* relationships
										.persistPrepared(transaction, yield* accept(prepared.deletion), {
											...batch,
											index: index++,
										})
										.pipe(
											Effect.catchTags({
												RelationshipNotFound: relationshipFailure("merge"),
												RelationshipBadRequest: relationshipFailure("merge"),
											}),
										);
									dispatch.push(...work.dispatch);
									movedRelationshipsCount += 1;
								}
							}
							const result: MergeEntityUserDataResponse = {
								mergeFrom,
								mergeInto,
								movedRelationshipsCount,
								movedEventsCount: moves.length,
							};
							return { result, dispatch };
						}),
				});
			});

			return { prepareClear, prepareMerge };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
