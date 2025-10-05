import { DateTime, Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner, TransactionRunner } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";
import { badRequest, notFound } from "#lib/errors";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema-runtime";
import { decodeStoredAppSchema } from "#lib/schema";
import { requireText } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { CollectionsRepository } from "./repository";
import type {
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
	MembershipResponse,
} from "./schemas";

const entityNotFoundError = "Entity not found";
const collectionNotFoundError = "Collection not found";
const circularReferenceError = "Cannot add a collection to itself";
const invalidMembershipPropertiesError = "Membership properties validation failed";
const invalidMembershipSchemaError = "membershipPropertiesSchema must be a valid AppSchema";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

type CollectionsServiceShape = {
	readonly create: (
		user: CurrentUserValue,
		payload: CreateCollectionBody,
	) => Effect.Effect<CollectionResponse, BadRequest | DbError | NotFound>;
	readonly getOrCreateCollection: (
		userId: string,
		name: string,
	) => Effect.Effect<CollectionResponse, DbError>;
	readonly addToCollection: (
		user: CurrentUserValue,
		payload: CreateMembershipBody,
	) => Effect.Effect<MembershipResponse, BadRequest | DbError | NotFound>;
	readonly removeFromCollection: (
		user: CurrentUserValue,
		payload: DeleteMembershipBody,
	) => Effect.Effect<MembershipResponse, BadRequest | DbError | NotFound>;
	readonly ensureLibraryEntityForUser: (
		userId: string,
		entitySchemaId: string,
	) => Effect.Effect<{ id: string }, DbError>;
	readonly ensureEntityInLibrary: (
		userId: string,
		entityId: string,
	) => Effect.Effect<void, DbError>;
	readonly markEntityOwnedInLibrary: (input: {
		userId: string;
		entityId: string;
		provider: string;
		syncedAt: string;
	}) => Effect.Effect<void, DbError>;
};

export class CollectionsService extends Effect.Service<CollectionsService>()("CollectionsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* CollectionsRepository;
		const eventsRepository = yield* EventsRepository;
		const runInTransaction = yield* TransactionRunner;
		const entitiesRepository = yield* EntitiesRepository;
		const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

		const memberOfSchema = yield* Effect.cached(
			runWithDb(relationshipSchemasRepository.findBuiltinBySlug("member-of")).pipe(
				Effect.flatMap((found) =>
					found
						? Effect.succeed(found)
						: Effect.die("member-of relationship schema not found in database"),
				),
			),
		);

		const inLibrarySchema = yield* Effect.cached(
			runWithDb(relationshipSchemasRepository.findBuiltinBySlug("in-library")).pipe(
				Effect.flatMap((found) =>
					found
						? Effect.succeed(found)
						: Effect.die("in-library relationship schema not found in database"),
				),
			),
		);

		const collectionEntitySchema = yield* Effect.cached(
			runWithDb(repository.getBuiltinCollectionSchema()).pipe(
				Effect.flatMap((found) =>
					found
						? Effect.succeed(found)
						: Effect.die("builtin collection entity schema not found in database"),
				),
			),
		);

		const collectionPropertiesSchema = yield* Effect.cached(
			Effect.gen(function* () {
				const entitySchema = yield* collectionEntitySchema;
				return yield* decodeStoredAppSchema(
					entitySchema.propertiesSchema,
					"Invalid collection entity schema in database",
				).pipe(Effect.orDie);
			}),
		);

		const addEventSchema = yield* Effect.cached(
			Effect.gen(function* () {
				const entitySchema = yield* collectionEntitySchema;
				return yield* runWithDb(
					repository.findBuiltinEventSchemaBySlug(
						entitySchema.entitySchemaId,
						"add-entity-to-collection",
					),
				);
			}),
		);

		const removeEventSchema = yield* Effect.cached(
			Effect.gen(function* () {
				const entitySchema = yield* collectionEntitySchema;
				return yield* runWithDb(
					repository.findBuiltinEventSchemaBySlug(
						entitySchema.entitySchemaId,
						"remove-entity-from-collection",
					),
				);
			}),
		);

		return {
			create: (user: CurrentUserValue, payload: CreateCollectionBody) =>
				Effect.gen(function* () {
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
						properties.description = payload.description;
					}
					if (payload.membershipPropertiesSchema !== undefined) {
						properties.membershipPropertiesSchema = payload.membershipPropertiesSchema;
					}

					const propertiesSchema = yield* collectionPropertiesSchema;
					const collectionProperties = yield* parseAppSchemaProperties({
						properties,
						propertiesSchema,
						kind: "Collection",
					}).pipe(Effect.mapError((error) => badRequest(error.message)));

					const entitySchema = yield* collectionEntitySchema;
					return yield* runWithDb(
						repository.createCollectionForUser({
							name,
							userId: user.id,
							properties: collectionProperties,
							entitySchemaId: entitySchema.entitySchemaId,
						}),
					);
				}),

			getOrCreateCollection: (userId: string, name: string) =>
				Effect.gen(function* () {
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

					return yield* runWithDb(
						repository.createCollectionForUser({
							name,
							userId,
							properties: {},
							entitySchemaId: entitySchema.entitySchemaId,
						}),
					);
				}),

			addToCollection: (user: CurrentUserValue, payload: CreateMembershipBody) =>
				Effect.gen(function* () {
					if (payload.collectionId === payload.entityId) {
						return yield* badRequest(circularReferenceError);
					}

					const collection = yield* runWithDb(
						repository.getCollectionById(payload.collectionId, user.id),
					);
					if (!collection) {
						return yield* notFound(collectionNotFoundError);
					}

					const entity = yield* runWithDb(
						repository.getEntityForMembership(payload.entityId, user.id),
					);
					if (!entity) {
						return yield* notFound(entityNotFoundError);
					}

					const collectionProps = isPlainObject(collection.properties) ? collection.properties : {};
					const rawMembershipSchema = collectionProps.membershipPropertiesSchema;
					let validatedProperties: Record<string, unknown>;

					if (rawMembershipSchema !== undefined && rawMembershipSchema !== null) {
						const membershipSchema = yield* decodeStoredAppSchema(
							rawMembershipSchema,
							"Invalid membershipPropertiesSchema stored in collection",
						).pipe(Effect.orDie);

						validatedProperties = yield* parseAppSchemaProperties({
							kind: "Membership",
							propertiesSchema: membershipSchema,
							properties: payload.properties ?? {},
						}).pipe(
							Effect.mapError((error) =>
								badRequest(`${invalidMembershipPropertiesError}: ${error.message}`),
							),
						);
					} else {
						const rawProperties = payload.properties;
						validatedProperties = isPlainObject(rawProperties) ? rawProperties : {};
					}

					const now = yield* DateTime.nowAsDate;
					const addEvent = yield* addEventSchema;
					const inLibrary = yield* inLibrarySchema;
					const memberOfRelationshipSchema = yield* memberOfSchema;

					const membership = yield* runInTransaction(
						Effect.gen(function* () {
							if (entity.userId === null) {
								const libraryEntityId = yield* repository.getUserLibraryEntityId({
									userId: user.id,
								});
								if (!libraryEntityId) {
									return yield* Effect.die("Library entity not found for user");
								}
								yield* entitiesRepository.insertRelationship({
									properties: {},
									userId: user.id,
									sourceEntityId: entity.id,
									targetEntityId: libraryEntityId,
									relationshipSchemaId: inLibrary.id,
								});
							}

							const result = yield* repository.upsertMembership({
								userId: user.id,
								entityId: payload.entityId,
								properties: validatedProperties,
								collectionId: payload.collectionId,
								relationshipSchemaId: memberOfRelationshipSchema.id,
							});

							if (result.wasInserted && addEvent) {
								yield* eventsRepository.createEvent({
									userId: user.id,
									occurredAt: now,
									eventSchemaId: addEvent.id,
									entityId: payload.collectionId,
									eventSchemaName: addEvent.name,
									eventSchemaSlug: addEvent.slug,
									properties: {
										entityId: entity.id,
										relationshipId: result.id,
										entitySchemaSlug: entity.entitySchemaSlug,
										relationshipProperties: result.properties,
									},
								});
							}

							return result;
						}),
					);

					const { wasInserted: _, ...memberOf } = membership;
					return { memberOf };
				}),

			removeFromCollection: (user: CurrentUserValue, payload: DeleteMembershipBody) =>
				Effect.gen(function* () {
					const collection = yield* runWithDb(
						repository.getCollectionById(payload.collectionId, user.id),
					);
					if (!collection) {
						return yield* notFound(collectionNotFoundError);
					}

					const entity = yield* runWithDb(
						repository.getEntityForMembership(payload.entityId, user.id),
					);
					if (!entity) {
						return yield* notFound(entityNotFoundError);
					}

					const memberOf = yield* memberOfSchema;
					const deleted = yield* runWithDb(
						repository.deleteMembership({
							userId: user.id,
							entityId: payload.entityId,
							relationshipSchemaId: memberOf.id,
							collectionId: payload.collectionId,
						}),
					);

					if (!deleted) {
						return yield* notFound("Entity is not in collection");
					}

					const removeEvent = yield* removeEventSchema;
					if (removeEvent) {
						const now = yield* DateTime.nowAsDate;
						yield* runWithDb(
							eventsRepository.createEvent({
								userId: user.id,
								occurredAt: now,
								eventSchemaId: removeEvent.id,
								entityId: payload.collectionId,
								eventSchemaName: removeEvent.name,
								eventSchemaSlug: removeEvent.slug,
								properties: {
									entityId: entity.id,
									relationshipId: deleted.id,
									entitySchemaSlug: entity.entitySchemaSlug,
									relationshipProperties: deleted.properties,
								},
							}),
						);
					}

					return { memberOf: deleted };
				}),

			ensureLibraryEntityForUser: (userId: string, entitySchemaId: string) =>
				runWithDb(repository.createLibraryEntityForUser({ userId, entitySchemaId })),

			ensureEntityInLibrary: (userId: string, entityId: string) =>
				Effect.gen(function* () {
					const libraryEntityId = yield* runWithDb(repository.getUserLibraryEntityId({ userId }));
					if (!libraryEntityId) {
						return yield* Effect.die("Library entity not found for user");
					}

					const inLibrary = yield* inLibrarySchema;
					yield* runWithDb(
						entitiesRepository.insertRelationship({
							userId,
							properties: {},
							sourceEntityId: entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
						}),
					);
					return undefined;
				}).pipe(Effect.asVoid),

			markEntityOwnedInLibrary: (input) =>
				Effect.gen(function* () {
					const libraryEntityId = yield* runWithDb(
						repository.getUserLibraryEntityId({ userId: input.userId }),
					);
					if (!libraryEntityId) {
						return yield* Effect.die("Library entity not found for user");
					}

					const inLibrary = yield* inLibrarySchema;
					const existing = yield* runWithDb(
						entitiesRepository.findRelationshipProperties({
							userId: input.userId,
							sourceEntityId: input.entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
						}),
					);
					const existingProperties = isPlainObject(existing) ? existing : {};
					const currentSources = Array.isArray(existingProperties.ownershipSources)
						? existingProperties.ownershipSources.filter(
								(source): source is string => typeof source === "string",
							)
						: [];

					yield* runWithDb(
						entitiesRepository.upsertRelationship({
							userId: input.userId,
							sourceEntityId: input.entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
							properties: {
								...existingProperties,
								owned: true,
								ownershipSyncedAt: input.syncedAt,
								ownershipSources: [...new Set([...currentSources, input.provider])],
							},
						}),
					);
					return undefined;
				}).pipe(Effect.asVoid),
		} satisfies CollectionsServiceShape;
	}),
}) {}
