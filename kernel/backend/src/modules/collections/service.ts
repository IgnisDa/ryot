import { PgClient } from "@effect/sql-pg";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	CollectionBadRequest,
	CollectionNotFound,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	AutomationExecutionId,
	EntityId,
	EventSchemaSlug,
	type RelationshipId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer, Schema, Struct } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { type LifecycleCommand, rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import type {
	LifecycleCommittedStep,
	LifecyclePreparedStep,
} from "#lib/infrastructure/lifecycle-workflow-step";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema/property-schema-runtime";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	EntitiesService,
	type EntitySaveResult,
	type PendingEntityMutation,
} from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import {
	PendingRelationshipMutations,
	type RelationshipSingleResult,
} from "#modules/relationships/mutation-pipeline";
import { RelationshipsService } from "#modules/relationships/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import { CollectionsRepository } from "./repository";
import { isPlainObject, toCollectionResponse } from "./service-support";

export const CollectionMembershipResult = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	entitySchemaSlug: Schema.String,
	memberOf: MembershipResponse.fields.memberOf,
	addEventSchemaSlug: Schema.NullOr(EventSchemaSlug),
});
export type CollectionMembershipResult = typeof CollectionMembershipResult.Type;

export const PendingCollectionMembership = Schema.Struct({
	mutations: PendingRelationshipMutations,
	membership: Schema.Struct(Struct.omit(CollectionMembershipResult.fields, ["memberOf"])),
});
export type PendingCollectionMembership = typeof PendingCollectionMembership.Type;

export const CollectionEntityResult = Schema.Struct(Struct.pick(ListedEntity.fields, ["id"]));
export type CollectionEntityResult = typeof CollectionEntityResult.Type;

const invalidMembership = (error: RelationshipBadRequest) =>
	new CollectionBadRequest({
		reason: {
			code: "invalid-membership-properties",
			paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
		},
	});

const collectionStep = (
	prepared: LifecyclePreparedStep<EntitySaveResult, PendingEntityMutation>,
): LifecyclePreparedStep<CollectionEntityResult, PendingEntityMutation> =>
	prepared._tag === "Committed"
		? { ...prepared, result: { id: prepared.result.entity.id } }
		: prepared;

const compensationFailed = () =>
	new CollectionBadRequest({ reason: { code: "membership-event-failed" } });

const requireBuiltinOrDie =
	<T>(message: string) =>
	(found: T | null | undefined): Effect.Effect<T> =>
		found != null ? Effect.succeed(found) : Effect.die(message);

const childCommand = (command: LifecycleCommand, itemIdentity: string): LifecycleCommand => ({
	...command,
	itemIdentity: stableStringify([command.itemIdentity, itemIdentity]),
});

const userCommand = Effect.fnUntraced(function* (
	userId: UserId,
	itemIdentity: string,
	source: "api" | "import" = "api",
	executionId = AutomationExecutionId.make(generateId()),
) {
	return rootLifecycleCommand({
		source,
		executionId,
		itemIdentity,
		initiator: { id: userId, kind: "user" },
		occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
	});
});

export class CollectionsService extends Context.Service<CollectionsService>()(
	"CollectionsService",
	{
		make: Effect.gen(function* () {
			const database = yield* Database;
			const sqlClient = yield* PgClient.PgClient;
			const planner = yield* LifecyclePlanner;
			const lifecycleExecution = yield* LifecycleExecution;
			const entitiesRepository = yield* EntitiesRepository;
			const events = yield* EventsService;
			const engine = yield* WorkflowEngine;
			const entities = yield* EntitiesService;
			const repository = yield* CollectionsRepository;
			const relationships = yield* RelationshipsService;
			const relationshipSchemasRepository = yield* RelationshipSchemasRepository;
			const provideMutation = <A, E>(
				effect: Effect.Effect<
					A,
					E,
					Database | EntitiesRepository | LifecycleExecution | LifecyclePlanner | PgClient.PgClient
				>,
			) =>
				effect.pipe(
					Effect.provideService(Database, database),
					Effect.provideService(PgClient.PgClient, sqlClient),
					Effect.provideService(LifecyclePlanner, planner),
					Effect.provideService(LifecycleExecution, lifecycleExecution),
					Effect.provideService(EntitiesRepository, entitiesRepository),
				);

			const memberOfSchema = yield* Effect.cached(
				relationshipSchemasRepository
					.findBuiltinBySlug("member-of")
					.pipe(
						Effect.provideService(Database, database),
						Effect.flatMap(
							requireBuiltinOrDie("member-of relationship schema not found in database"),
						),
					),
			);

			const collectionEntitySchema = yield* Effect.cached(
				repository
					.getBuiltinCollectionSchema()
					.pipe(
						Effect.flatMap(
							requireBuiltinOrDie("builtin collection entity schema not found in database"),
						),
					),
			);

			const getBuiltinCollectionEventSchema = Effect.fn(
				"CollectionsService.getBuiltinCollectionEventSchema",
			)(function* (slug: string) {
				const entitySchema = yield* collectionEntitySchema;
				return yield* repository.findBuiltinEventSchemaBySlug(entitySchema.entitySchemaSlug, slug);
			});

			const addEventSchema = yield* Effect.cached(
				getBuiltinCollectionEventSchema("add-entity-to-collection"),
			);

			const removeEventSchema = yield* Effect.cached(
				getBuiltinCollectionEventSchema("remove-entity-from-collection"),
			);

			const queueCollectionEvent = (input: {
				readonly userId: UserId;
				readonly entityId: EntityId;
				readonly command: LifecycleCommand;
				readonly eventSchemaSlug: EventSchemaSlug;
				readonly properties: Record<string, unknown>;
			}) =>
				events
					.create(
						{
							userId: input.userId,
							payload: [
								{
									entityId: input.entityId,
									properties: input.properties,
									occurredAt: input.command.occurredAt,
									eventSchemaSlug: input.eventSchemaSlug,
								},
							],
						},
						input.command,
					)
					.pipe(
						Effect.map(({ warnings }) => warnings),
						Effect.catchCause((cause) =>
							Effect.logWarning("collection event enqueue failed", cause).pipe(
								Effect.as([] as ReadonlyArray<AutomationWarning>),
							),
						),
					);

			const create = Effect.fn("CollectionsService.create")(function* (
				user: CurrentUserValue,
				payload: CreateCollectionBody,
			) {
				const name = trimToNull(payload.name);
				if (!name) {
					return yield* new CollectionBadRequest({
						reason: { field: "name", code: "name-required" },
					});
				}
				const lifecycle = yield* userCommand(user.id, "collection:create");

				if (payload.membershipPropertiesSchema !== undefined) {
					yield* parseLabeledPropertySchemaInput(
						payload.membershipPropertiesSchema,
						"membershipPropertiesSchema",
					).pipe(
						Effect.mapError(
							(error) =>
								new CollectionBadRequest({
									reason: {
										code: "invalid-membership-schema",
										field: "membershipPropertiesSchema",
										paths: error.issues.map(({ path }) => path),
									},
								}),
						),
					);
				}

				const properties: Record<string, unknown> = {};
				if (payload.description !== undefined) {
					properties["description"] = payload.description;
				}
				if (payload.membershipPropertiesSchema !== undefined) {
					properties["membershipPropertiesSchema"] = payload.membershipPropertiesSchema;
				}

				const entitySchema = yield* collectionEntitySchema;
				const created = yield* provideMutation(
					entities
						.create({
							name,
							lifecycle,
							properties,
							scope: "user",
							userId: user.id,
							entitySchemaSlug: entitySchema.entitySchemaSlug,
						})
						.pipe(
							Effect.catchTags({
								EntityNotFound: (error) => Effect.die(error),
								EntityBadRequest: (error) =>
									new CollectionBadRequest({
										reason: {
											code: "invalid-collection-properties",
											paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
										},
									}),
							}),
						),
				);
				return toCollectionResponse(created.entity, created.warnings);
			});

			const prepareGetOrCreateCollection = Effect.fn(
				"CollectionsService.prepareGetOrCreateCollection",
			)(function* (userId: UserId, name: string) {
				const entitySchema = yield* collectionEntitySchema;
				const existing = yield* repository.findCollectionByNameForUser({
					name,
					userId,
					entitySchemaSlug: entitySchema.entitySchemaSlug,
				});
				if (existing) {
					return {
						dispatch: [],
						_tag: "Committed",
						result: { id: existing.id },
					} satisfies LifecycleCommittedStep<CollectionEntityResult>;
				}
				const lifecycle = yield* userCommand(
					userId,
					stableStringify(["collection:get-or-create", name]),
					"import",
				);
				return yield* provideMutation(
					entities
						.prepareCreateStep({
							name,
							userId,
							lifecycle,
							scope: "user",
							properties: {},
							entitySchemaSlug: entitySchema.entitySchemaSlug,
						})
						.pipe(
							Effect.map(collectionStep),
							Effect.catchTags({
								EntityNotFound: (error) => Effect.die(error),
								EntityBadRequest: (error) => Effect.die(error),
							}),
						),
				);
			});

			const committedMembership = Effect.fnUntraced(function* (
				membership: PendingCollectionMembership["membership"],
				committed: LifecycleCommittedStep<RelationshipSingleResult>,
			) {
				if (!committed.result.relationship) {
					return yield* Effect.die("membership upsert returned no relationship");
				}
				const { wasInserted: _savedWasInserted, ...memberOf } = committed.result.relationship;
				return {
					...committed,
					result: { ...membership, memberOf },
				} satisfies LifecycleCommittedStep<CollectionMembershipResult>;
			});

			const applyMembershipPolicies = (pending: PendingCollectionMembership) =>
				provideMutation(
					relationships.applyPolicies(pending.mutations).pipe(
						Effect.map((mutations) => ({ ...pending, mutations })),
						Effect.catchTag("RelationshipBadRequest", invalidMembership),
					),
				);

			const commitMembership = (pending: PendingCollectionMembership) =>
				provideMutation(
					relationships.commitSingle(pending.mutations).pipe(
						Effect.catchTags({
							RelationshipBadRequest: invalidMembership,
							RelationshipNotFound: (error) => Effect.die(error),
						}),
						Effect.flatMap((committed) =>
							committed._tag === "Committed"
								? committedMembership(pending.membership, committed)
								: Effect.die("membership commit requires policies"),
						),
					),
				);

			const prepareMembership = Effect.fn("CollectionsService.prepareMembership")(
				function* (input: {
					userId: UserId;
					entityId: EntityId;
					command: LifecycleCommand;
					properties?: unknown;
					collectionId: EntityId;
				}) {
					if (input.collectionId === input.entityId) {
						return yield* new CollectionBadRequest({ reason: { code: "circular-membership" } });
					}

					const collection = yield* repository.getCollectionById(input.collectionId, input.userId);
					if (!collection) {
						return yield* new CollectionNotFound({
							reason: { code: "collection-not-found", collectionId: input.collectionId },
						});
					}

					const entity = yield* repository.getEntityForMembership(input.entityId, input.userId);
					if (!entity) {
						return yield* new CollectionNotFound({
							reason: { code: "entity-not-found", entityId: input.entityId },
						});
					}

					const collectionProps = isPlainObject(collection.properties) ? collection.properties : {};
					const rawMembershipSchema = collectionProps["membershipPropertiesSchema"];
					let validatedProperties: Record<string, unknown>;

					if (rawMembershipSchema !== undefined && rawMembershipSchema !== null) {
						const membershipSchema = yield* decodeStoredSchema(
							rawMembershipSchema,
							AppSchema,
							"Invalid membershipPropertiesSchema stored in collection",
						).pipe(Effect.orDie);

						validatedProperties = yield* parseAppSchemaProperties({
							kind: "Membership",
							propertiesSchema: membershipSchema,
							properties: input.properties ?? {},
						}).pipe(
							Effect.mapError(
								(error) =>
									new CollectionBadRequest({
										reason: {
											code: "invalid-membership-properties",
											paths: error.issues.map(({ path }) => path),
										},
									}),
							),
						);
					} else {
						validatedProperties = isPlainObject(input.properties) ? input.properties : {};
					}

					const addEvent = yield* addEventSchema;
					const memberOfRelationshipSchema = yield* memberOfSchema;
					const membershipInput = {
						scope: "user",
						userId: input.userId,
						sourceEntityId: input.entityId,
						properties: validatedProperties,
						targetEntityId: input.collectionId,
						relationshipSchemaSlug: memberOfRelationshipSchema.id,
						relationshipSchemaPluginId: memberOfRelationshipSchema.pluginId ?? null,
					} as const;
					const membership = {
						entityId: entity.id,
						occurredAt: input.command.occurredAt,
						addEventSchemaSlug: addEvent?.id ?? null,
						entitySchemaSlug: entity.entitySchemaSlug,
					};
					const prepared = yield* provideMutation(
						relationships
							.prepareCreate(membershipInput, input.command)
							.pipe(
								Effect.catchTags({
									RelationshipBadRequest: invalidMembership,
									RelationshipNotFound: (error) => Effect.die(error),
								}),
							),
					);
					if (prepared._tag === "PoliciesRequired") {
						return {
							_tag: "PoliciesRequired",
							pending: { membership, mutations: prepared.pending },
						} satisfies LifecyclePreparedStep<
							CollectionMembershipResult,
							PendingCollectionMembership
						>;
					}
					return yield* committedMembership(membership, prepared);
				},
			);

			const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
				user: CurrentUserValue,
				payload: CreateMembershipBody,
			) {
				const executionId = AutomationExecutionId.make(generateId());
				const command = yield* userCommand(
					user.id,
					"collection:add-membership",
					"api",
					executionId,
				);
				return yield* engine.execute(AddEntityToCollectionWorkflow, {
					executionId,
					payload: {
						command,
						executionId,
						userId: user.id,
						entityId: payload.entityId,
						properties: payload.properties,
						collectionId: payload.collectionId,
					},
				});
			});

			const prepareCompensation = (
				userId: UserId,
				relationshipId: RelationshipId,
				command: LifecycleCommand,
			) =>
				provideMutation(
					relationships
						.prepareDeleteUserRelationshipById(userId, relationshipId, command)
						.pipe(
							Effect.catchTags({
								RelationshipNotFound: Effect.die,
								RelationshipBadRequest: compensationFailed,
							}),
						),
				);

			const applyCompensationPolicies = (pending: PendingRelationshipMutations) =>
				provideMutation(
					relationships
						.applyPolicies(pending)
						.pipe(Effect.catchTag("RelationshipBadRequest", compensationFailed)),
				);

			const commitCompensation = (pending: PendingRelationshipMutations) =>
				provideMutation(
					relationships
						.commitSingle(pending)
						.pipe(
							Effect.catchTags({
								RelationshipNotFound: Effect.die,
								RelationshipBadRequest: compensationFailed,
							}),
						),
				);

			const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
				user: CurrentUserValue,
				payload: DeleteMembershipBody,
			) {
				const command = yield* userCommand(user.id, "collection:remove-membership");
				const collection = yield* repository.getCollectionById(payload.collectionId, user.id);
				if (!collection) {
					return yield* new CollectionNotFound({
						reason: { code: "collection-not-found", collectionId: payload.collectionId },
					});
				}

				const entity = yield* repository.getEntityForMembership(payload.entityId, user.id);
				if (!entity) {
					return yield* new CollectionNotFound({
						reason: { code: "entity-not-found", entityId: payload.entityId },
					});
				}

				const membershipSchema = yield* memberOfSchema;
				const result = yield* provideMutation(
					relationships
						.delete(
							{
								scope: "user",
								userId: user.id,
								sourceEntityId: payload.entityId,
								targetEntityId: payload.collectionId,
								relationshipSchemaSlug: membershipSchema.id,
								relationshipSchemaPluginId: membershipSchema.pluginId ?? null,
							},
							command,
						)
						.pipe(
							Effect.catchTags({
								RelationshipNotFound: Effect.die,
								RelationshipBadRequest: (error) =>
									new CollectionBadRequest({
										reason: {
											code: "invalid-membership-properties",
											paths: error.reason.code === "invalid-properties" ? error.reason.paths : [],
										},
									}),
							}),
						),
				);
				const deleted = result.relationship;

				if (!deleted) {
					return yield* new CollectionNotFound({
						reason: {
							entityId: payload.entityId,
							code: "membership-not-found",
							collectionId: payload.collectionId,
						},
					});
				}

				const removeEvent = yield* removeEventSchema;
				if (removeEvent) {
					const eventWarnings = yield* queueCollectionEvent({
						userId: user.id,
						entityId: payload.collectionId,
						eventSchemaSlug: removeEvent.id,
						command: childCommand(command, `event:${deleted.id}`),
						properties: {
							entityId: entity.id,
							relationshipId: deleted.id,
							entitySchemaSlug: entity.entitySchemaSlug,
							relationshipProperties: deleted.properties,
						},
					});
					const { wasInserted: _wasInserted, ...memberOf } = deleted;
					return { memberOf, warnings: [...result.warnings, ...eventWarnings] };
				}

				const { wasInserted: _wasInserted, ...memberOf } = deleted;
				return { memberOf, warnings: result.warnings };
			});

			return {
				create,
				addToCollection,
				commitMembership,
				prepareMembership,
				commitCompensation,
				prepareCompensation,
				removeFromCollection,
				applyMembershipPolicies,
				applyCompensationPolicies,
				prepareGetOrCreateCollection,
				applyCollectionPolicies: (pending: PendingEntityMutation) =>
					provideMutation(
						entities
							.applyMutationPolicies(pending)
							.pipe(Effect.catchTag("EntityBadRequest", (error) => Effect.die(error))),
					),
				commitCollection: (pending: PendingEntityMutation) =>
					provideMutation(
						entities
							.commitMutation(pending)
							.pipe(
								Effect.map(collectionStep),
								Effect.catchTags({
									EntityNotFound: (error) => Effect.die(error),
									EntityBadRequest: (error) => Effect.die(error),
								}),
							),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
