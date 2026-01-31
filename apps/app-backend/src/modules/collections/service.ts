import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
} from "@ryot/contract/modules/collections/schemas";
import type { EntityId, EntitySchemaId, EventSchemaId, UserId } from "@ryot/contract/schema/brands";
import { decodeStoredAppSchema } from "@ryot/contract/schema/core";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema/property-schema-runtime";
import { requireText } from "#lib/shared/validation";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import { CollectionsRepository } from "./repository";
import {
	circularReferenceError,
	collectionNotFoundError,
	entityNotFoundError,
	invalidMembershipPropertiesError,
	invalidMembershipSchemaError,
	isPlainObject,
	toCollectionResponse,
} from "./service-support";

const requireBuiltinOrDie =
	<T>(message: string) =>
	(found: T | null | undefined): Effect.Effect<T> =>
		found != null ? Effect.succeed(found) : Effect.die(message);

export class CollectionsService extends Effect.Service<CollectionsService>()("CollectionsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const events = yield* EventsService;
		const entities = yield* EntitiesService;
		const repository = yield* CollectionsRepository;
		const relationships = yield* RelationshipsService;
		const runInTransaction = yield* TransactionRunner;
		const relationshipsRepository = yield* RelationshipsRepository;
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		const memberOfSchema = yield* Effect.cached(
			runWithDb(relationshipSchemasRepository.findBuiltinBySlug("member-of")).pipe(
				Effect.flatMap(requireBuiltinOrDie("member-of relationship schema not found in database")),
			),
		);

		const inLibrarySchema = yield* Effect.cached(
			runWithDb(relationshipSchemasRepository.findBuiltinBySlug("in-library")).pipe(
				Effect.flatMap(requireBuiltinOrDie("in-library relationship schema not found in database")),
			),
		);

		const collectionEntitySchema = yield* Effect.cached(
			runWithDb(repository.getBuiltinCollectionSchema()).pipe(
				Effect.flatMap(
					requireBuiltinOrDie("builtin collection entity schema not found in database"),
				),
			),
		);

		const getBuiltinCollectionEventSchema = Effect.fn(
			"CollectionsService.getBuiltinCollectionEventSchema",
		)(function* (slug: string) {
			const entitySchema = yield* collectionEntitySchema;
			return yield* runWithDb(
				repository.findBuiltinEventSchemaBySlug(entitySchema.entitySchemaId, slug),
			);
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
			readonly eventSchemaId: EventSchemaId;
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
							eventSchemaId: input.eventSchemaId,
						},
					],
				})
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logWarning("collection event enqueue failed", cause),
					),
				);

		const create = Effect.fn("CollectionsService.create")(function* (
			user: CurrentUserValue,
			payload: CreateCollectionBody,
		) {
			const name = yield* requireText(payload.name, "Collection name is required");

			if (payload.membershipPropertiesSchema !== undefined) {
				yield* parseLabeledPropertySchemaInput(
					payload.membershipPropertiesSchema,
					"membershipPropertiesSchema",
				).pipe(
					Effect.mapError((error) =>
						badRequest(`${invalidMembershipSchemaError}: ${error.message}`),
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
					entitySchemaId: entitySchema.entitySchemaId,
				})
				.pipe(Effect.catchTag("NotFound", (error) => Effect.die(error)));
			return toCollectionResponse(created);
		});

		const getOrCreateCollection = Effect.fn("CollectionsService.getOrCreateCollection")(function* (
			userId: UserId,
			name: string,
		) {
			const entitySchema = yield* collectionEntitySchema;
			const existing = yield* runWithDb(
				repository.findCollectionByNameForUser({
					name,
					userId,
					entitySchemaId: entitySchema.entitySchemaId,
				}),
			);
			if (existing) {
				return existing;
			}

			const created = yield* entities
				.create({
					name,
					userId,
					scope: "user",
					properties: {},
					entitySchemaId: entitySchema.entitySchemaId,
				})
				.pipe(Effect.catchTag("NotFound", (error) => Effect.die(error)));
			return toCollectionResponse(created);
		});

		const writeMembership = Effect.fn("CollectionsService.writeMembership")(function* (input: {
			userId: UserId;
			entityId: EntityId;
			collectionId: EntityId;
			properties?: unknown;
		}) {
			if (input.collectionId === input.entityId) {
				return yield* badRequest(circularReferenceError);
			}

			const collection = yield* runWithDb(
				repository.getCollectionById(input.collectionId, input.userId),
			);
			if (!collection) {
				return yield* notFound(collectionNotFoundError);
			}

			const entity = yield* runWithDb(
				repository.getEntityForMembership(input.entityId, input.userId),
			);
			if (!entity) {
				return yield* notFound(entityNotFoundError);
			}

			const collectionProps = isPlainObject(collection.properties) ? collection.properties : {};
			const rawMembershipSchema = collectionProps["membershipPropertiesSchema"];
			let validatedProperties: Record<string, unknown>;

			if (rawMembershipSchema !== undefined && rawMembershipSchema !== null) {
				const membershipSchema = yield* decodeStoredAppSchema(
					rawMembershipSchema,
					"Invalid membershipPropertiesSchema stored in collection",
				).pipe(Effect.orDie);

				validatedProperties = yield* parseAppSchemaProperties({
					kind: "Membership",
					propertiesSchema: membershipSchema,
					properties: input.properties ?? {},
				}).pipe(
					Effect.mapError((error) =>
						badRequest(`${invalidMembershipPropertiesError}: ${error.message}`),
					),
				);
			} else {
				validatedProperties = isPlainObject(input.properties) ? input.properties : {};
			}

			const addEvent = yield* addEventSchema;
			const inLibrary = yield* inLibrarySchema;
			const memberOfRelationshipSchema = yield* memberOfSchema;

			const membership = yield* runInTransaction(
				Effect.gen(function* () {
					if (entity.userId === null) {
						const libraryEntityId = yield* repository.getUserLibraryEntityId({
							userId: input.userId,
						});
						if (!libraryEntityId) {
							return yield* Effect.die("Library entity not found for user");
						}
						yield* relationships.create({
							scope: "user",
							properties: {},
							userId: input.userId,
							sourceEntityId: entity.id,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
							propertiesSchema: inLibrary.propertiesSchema,
						});
					}

					const membershipInput = {
						scope: "user",
						userId: input.userId,
						sourceEntityId: input.entityId,
						properties: validatedProperties,
						targetEntityId: input.collectionId,
						relationshipSchemaId: memberOfRelationshipSchema.id,
						propertiesSchema: memberOfRelationshipSchema.propertiesSchema,
					} as const;
					const created = yield* relationships.create(membershipInput);
					return created.wasInserted ? created : yield* relationships.update(membershipInput);
				}),
			);

			const occurredAt = yield* DateTime.nowAsDate;
			const { wasInserted, ...memberOf } = membership;
			return {
				memberOf,
				wasInserted,
				entityId: entity.id,
				addEventSchemaId: addEvent?.id ?? null,
				occurredAt: occurredAt.toISOString(),
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

		const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
			user: CurrentUserValue,
			payload: DeleteMembershipBody,
		) {
			const collection = yield* runWithDb(
				repository.getCollectionById(payload.collectionId, user.id),
			);
			if (!collection) {
				return yield* notFound(collectionNotFoundError);
			}

			const entity = yield* runWithDb(repository.getEntityForMembership(payload.entityId, user.id));
			if (!entity) {
				return yield* notFound(entityNotFoundError);
			}

			const memberOf = yield* memberOfSchema;
			const deleted = yield* relationships.delete({
				scope: "user",
				userId: user.id,
				sourceEntityId: payload.entityId,
				relationshipSchemaId: memberOf.id,
				targetEntityId: payload.collectionId,
			});

			if (!deleted) {
				return yield* notFound("Entity is not in collection");
			}

			const removeEvent = yield* removeEventSchema;
			if (removeEvent) {
				const now = yield* DateTime.nowAsDate;
				yield* queueCollectionEvent({
					userId: user.id,
					occurredAt: now.toISOString(),
					eventSchemaId: removeEvent.id,
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

		const ensureLibraryEntityForUser = Effect.fn("CollectionsService.ensureLibraryEntityForUser")(
			function* (userId: UserId, entitySchemaId: EntitySchemaId) {
				return yield* runWithDb(
					Effect.gen(function* () {
						const existing = yield* repository.findLibraryEntityForUser({
							userId,
							entitySchemaId,
						});
						if (existing) {
							return existing;
						}

						const created = yield* entities
							.create({
								userId,
								scope: "user",
								properties: {},
								entitySchemaId,
								name: "Library",
							})
							.pipe(Effect.catchTag("NotFound", (error) => Effect.die(error)));
						return { id: created.id };
					}),
				);
			},
		);

		const ensureEntityInLibrary = Effect.fn("CollectionsService.ensureEntityInLibrary")(function* (
			userId: UserId,
			entityId: EntityId,
		) {
			const libraryEntityId = yield* runWithDb(repository.getUserLibraryEntityId({ userId }));
			if (!libraryEntityId) {
				return yield* Effect.die("Library entity not found for user");
			}

			const inLibrary = yield* inLibrarySchema;
			yield* relationships
				.create({
					userId,
					scope: "user",
					properties: {},
					sourceEntityId: entityId,
					targetEntityId: libraryEntityId,
					relationshipSchemaId: inLibrary.id,
					propertiesSchema: inLibrary.propertiesSchema,
				})
				.pipe(Effect.catchTag("BadRequest", (e) => Effect.die(e)));
			return undefined;
		}, Effect.asVoid);

		const markEntityOwnedInLibrary = Effect.fn("CollectionsService.markEntityOwnedInLibrary")(
			function* (input: {
				userId: UserId;
				provider: string;
				syncedAt: string;
				entityId: EntityId;
			}) {
				const inLibrary = yield* inLibrarySchema;
				yield* runInTransaction(
					Effect.gen(function* () {
						const libraryEntityId = yield* repository.getUserLibraryEntityId({
							userId: input.userId,
						});
						if (!libraryEntityId) {
							return yield* Effect.die("Library entity not found for user");
						}

						const existing = yield* relationshipsRepository.findRelationshipProperties({
							userId: input.userId,
							sourceEntityId: input.entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
						});
						const buildOwnershipProperties = (properties: unknown) => {
							const existingProperties = isPlainObject(properties) ? properties : {};
							const currentSources = Array.isArray(existingProperties["ownershipSources"])
								? existingProperties["ownershipSources"].filter(
										(source): source is string => typeof source === "string",
									)
								: [];

							return {
								...existingProperties,
								owned: true,
								ownershipSyncedAt: input.syncedAt,
								ownershipSources: [...new Set([...currentSources, input.provider])],
							};
						};

						const buildInput = (properties: Record<string, unknown>) => ({
							scope: "user" as const,
							userId: input.userId,
							sourceEntityId: input.entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
							propertiesSchema: inLibrary.propertiesSchema,
							properties,
						});

						if (existing) {
							yield* relationships
								.update(buildInput(buildOwnershipProperties(existing)))
								.pipe(Effect.catchTag("BadRequest", (e) => Effect.die(e)));
							return undefined;
						}

						const created = yield* relationships
							.create(buildInput(buildOwnershipProperties({})))
							.pipe(Effect.catchTag("BadRequest", (e) => Effect.die(e)));
						if (!created.wasInserted) {
							const current = yield* relationshipsRepository.findRelationshipProperties({
								userId: input.userId,
								sourceEntityId: input.entityId,
								targetEntityId: libraryEntityId,
								relationshipSchemaId: inLibrary.id,
							});
							yield* relationships
								.update(buildInput(buildOwnershipProperties(current ?? created.properties)))
								.pipe(Effect.catchTag("BadRequest", (e) => Effect.die(e)));
						}
						return undefined;
					}),
				);
				return undefined;
			},
			Effect.asVoid,
		);

		return {
			create,
			writeMembership,
			addToCollection,
			removeFromCollection,
			getOrCreateCollection,
			ensureEntityInLibrary,
			markEntityOwnedInLibrary,
			ensureLibraryEntityForUser,
		};
	}),
}) {}
