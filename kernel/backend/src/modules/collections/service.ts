import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type {
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	CollectionBadRequest,
	CollectionNotFound,
} from "@ryot-app/contract/modules/collections/schemas";
import type {
	EntityId,
	EventSchemaSlug,
	RelationshipId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema/property-schema-runtime";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import { CollectionsRepository } from "./repository";
import { isPlainObject, toCollectionResponse } from "./service-support";

const requireBuiltinOrDie =
	<T>(message: string) =>
	(found: T | null | undefined): Effect.Effect<T> =>
		found != null ? Effect.succeed(found) : Effect.die(message);

export class CollectionsService extends Context.Service<CollectionsService>()(
	"CollectionsService",
	{
		make: Effect.gen(function* () {
			const events = yield* EventsService;
			const engine = yield* WorkflowEngine;
			const entities = yield* EntitiesService;
			const repository = yield* CollectionsRepository;
			const relationships = yield* RelationshipsService;
			const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

			const memberOfSchema = yield* Effect.cached(
				relationshipSchemasRepository
					.findBuiltinBySlug("member-of")
					.pipe(
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
				readonly occurredAt: string;
				readonly executionId: string;
				readonly eventSchemaSlug: EventSchemaSlug;
				readonly properties: Record<string, unknown>;
			}) =>
				events
					.create({
						userId: input.userId,
						source: "collection",
						executionId: input.executionId,
						payload: [
							{
								entityId: input.entityId,
								occurredAt: input.occurredAt,
								properties: input.properties,
								eventSchemaSlug: input.eventSchemaSlug,
							},
						],
					})
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("collection event enqueue failed", cause),
						),
					);

			const create = Effect.fn("CollectionsService.create")(function* (
				user: CurrentUserValue,
				payload: CreateCollectionBody,
			) {
				const name = trimToNull(payload.name);
				if (!name) {
					return yield* new CollectionBadRequest({
						reason: { code: "name-required", field: "name" },
					});
				}

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
				const created = yield* entities
					.create({
						name,
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
					);
				return toCollectionResponse(created);
			});

			const getOrCreateCollection = Effect.fn("CollectionsService.getOrCreateCollection")(
				function* (userId: UserId, name: string) {
					const entitySchema = yield* collectionEntitySchema;
					const existing = yield* repository.findCollectionByNameForUser({
						name,
						userId,
						entitySchemaSlug: entitySchema.entitySchemaSlug,
					});
					if (existing) {
						return existing;
					}

					const created = yield* entities
						.create({
							name,
							userId,
							scope: "user",
							properties: {},
							entitySchemaSlug: entitySchema.entitySchemaSlug,
						})
						.pipe(
							Effect.catchTags({
								EntityNotFound: (error) => Effect.die(error),
								EntityBadRequest: (error) => Effect.die(error),
							}),
						);
					return toCollectionResponse(created);
				},
			);

			const writeMembership = Effect.fn("CollectionsService.writeMembership")(function* (input: {
				userId: UserId;
				entityId: EntityId;
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
				const database = yield* Database;

				const membership = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const membershipInput = {
								scope: "user",
								userId: input.userId,
								sourceEntityId: input.entityId,
								properties: validatedProperties,
								targetEntityId: input.collectionId,
								relationshipSchemaSlug: memberOfRelationshipSchema.id,
								relationshipSchemaPluginId: memberOfRelationshipSchema.pluginId ?? null,
								propertiesSchema: memberOfRelationshipSchema.propertiesSchema,
							} as const;
							const created = yield* relationships
								.create(membershipInput)
								.pipe(
									Effect.catchTag(
										"RelationshipBadRequest",
										(error) =>
											new CollectionBadRequest({
												reason: {
													code: "invalid-membership-properties",
													paths:
														error.reason.code === "invalid-properties" ? error.reason.paths : [],
												},
											}),
									),
								);
							return created.wasInserted
								? created
								: yield* relationships
										.update(membershipInput)
										.pipe(
											Effect.catchTags({
												RelationshipBadRequest: (error) =>
													new CollectionBadRequest({
														reason: {
															code: "invalid-membership-properties",
															paths:
																error.reason.code === "invalid-properties"
																	? error.reason.paths
																	: [],
														},
													}),
												RelationshipNotFound: (error) => Effect.die(error),
											}),
										);
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);

				const occurredAt = yield* DateTime.nowAsDate;
				const { wasInserted: _savedWasInserted, ...memberOf } = membership;
				return {
					memberOf,
					entityId: entity.id,
					occurredAt: occurredAt.toISOString(),
					addEventSchemaSlug: addEvent?.id ?? null,
					entitySchemaSlug: entity.entitySchemaSlug,
				};
			});

			const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
				user: CurrentUserValue,
				payload: CreateMembershipBody,
			) {
				const executionId = generateId();
				return yield* engine.execute(AddEntityToCollectionWorkflow, {
					executionId,
					payload: {
						executionId,
						userId: user.id,
						entityId: payload.entityId,
						properties: payload.properties,
						collectionId: payload.collectionId,
					},
				});
			});

			const compensateMembership = Effect.fn("CollectionsService.compensateMembership")(function* (
				userId: UserId,
				relationshipId: RelationshipId,
			) {
				return yield* relationships.deleteUserRelationshipById(userId, relationshipId);
			});

			const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
				user: CurrentUserValue,
				payload: DeleteMembershipBody,
			) {
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

				const memberOf = yield* memberOfSchema;
				const deleted = yield* relationships.delete({
					scope: "user",
					userId: user.id,
					sourceEntityId: payload.entityId,
					relationshipSchemaSlug: memberOf.id,
					relationshipSchemaPluginId: memberOf.pluginId ?? null,
					targetEntityId: payload.collectionId,
				});

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
					const now = yield* DateTime.nowAsDate;
					yield* queueCollectionEvent({
						userId: user.id,
						occurredAt: now.toISOString(),
						eventSchemaSlug: removeEvent.id,
						entityId: payload.collectionId,
						executionId: `collection-membership-removed-${deleted.id}`,
						properties: {
							entityId: entity.id,
							relationshipId: deleted.id,
							entitySchemaSlug: entity.entitySchemaSlug,
							relationshipProperties: deleted.properties,
						},
					});
				}

				return { memberOf: deleted };
			});

			return {
				create,
				writeMembership,
				addToCollection,
				compensateMembership,
				removeFromCollection,
				getOrCreateCollection,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
