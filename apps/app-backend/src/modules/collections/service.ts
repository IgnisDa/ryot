import { Cause, DateTime, Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner, TransactionRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import type { EntityId, EntitySchemaId, EventSchemaId, UserId } from "#lib/schema/brands";
import { decodeStoredAppSchema } from "#lib/schema/core";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/schema/property-schema-runtime";
import { requireText } from "#lib/validation";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { CollectionsRepository } from "./repository";
import type { CreateCollectionBody, CreateMembershipBody, DeleteMembershipBody } from "./schemas";
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

		const queueCollectionEvent = (input: {
			readonly userId: UserId;
			readonly entityId: EntityId;
			readonly occurredAt: string;
			readonly eventSchemaId: EventSchemaId;
			readonly properties: Record<string, unknown>;
		}) =>
			events
				.create({
					userId: input.userId,
					source: "collection",
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
						Effect.logWarning(`Failed to queue collection event: ${String(Cause.squash(cause))}`),
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
				properties.description = payload.description;
			}
			if (payload.membershipPropertiesSchema !== undefined) {
				properties.membershipPropertiesSchema = payload.membershipPropertiesSchema;
			}

			const entitySchema = yield* collectionEntitySchema;
			const created = yield* entities
				.save({
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
				.save({
					name,
					userId,
					scope: "user",
					properties: {},
					entitySchemaId: entitySchema.entitySchemaId,
				})
				.pipe(Effect.catchTag("NotFound", (error) => Effect.die(error)));
			return toCollectionResponse(created);
		});

		const addToCollection = Effect.fn("CollectionsService.addToCollection")(function* (
			user: CurrentUserValue,
			payload: CreateMembershipBody,
		) {
			if (payload.collectionId === payload.entityId) {
				return yield* badRequest(circularReferenceError);
			}

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
						yield* relationshipsRepository.saveRelationship({
							scope: "user",
							properties: {},
							userId: user.id,
							sourceEntityId: entity.id,
							onConflict: "preserveExisting",
							targetEntityId: libraryEntityId,
							relationshipSchemaId: inLibrary.id,
						});
					}

					return yield* relationshipsRepository.saveRelationship({
						scope: "user",
						userId: user.id,
						properties: validatedProperties,
						onConflict: "replaceProperties",
						sourceEntityId: payload.entityId,
						targetEntityId: payload.collectionId,
						relationshipSchemaId: memberOfRelationshipSchema.id,
					});
				}),
			);

			if (membership.wasInserted && addEvent) {
				const now = yield* DateTime.nowAsDate;
				yield* queueCollectionEvent({
					userId: user.id,
					eventSchemaId: addEvent.id,
					occurredAt: now.toISOString(),
					entityId: payload.collectionId,
					properties: {
						entityId: entity.id,
						relationshipId: membership.id,
						entitySchemaSlug: entity.entitySchemaSlug,
						relationshipProperties: membership.properties,
					},
				});
			}

			const { wasInserted: _, ...memberOf } = membership;
			return { memberOf };
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
			const deleted = yield* runWithDb(
				relationshipsRepository.deleteUserRelationship({
					userId: user.id,
					sourceEntityId: payload.entityId,
					relationshipSchemaId: memberOf.id,
					targetEntityId: payload.collectionId,
				}),
			);

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
							.save({
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
					onConflict: "preserveExisting",
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
				const libraryEntityId = yield* runWithDb(
					repository.getUserLibraryEntityId({ userId: input.userId }),
				);
				if (!libraryEntityId) {
					return yield* Effect.die("Library entity not found for user");
				}

				const inLibrary = yield* inLibrarySchema;
				const existing = yield* runWithDb(
					relationshipsRepository.findRelationshipProperties({
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

				yield* relationships
					.create({
						scope: "user",
						userId: input.userId,
						sourceEntityId: input.entityId,
						onConflict: "replaceProperties",
						targetEntityId: libraryEntityId,
						relationshipSchemaId: inLibrary.id,
						propertiesSchema: inLibrary.propertiesSchema,
						properties: {
							...existingProperties,
							owned: true,
							ownershipSyncedAt: input.syncedAt,
							ownershipSources: [...new Set([...currentSources, input.provider])],
						},
					})
					.pipe(Effect.catchTag("BadRequest", (e) => Effect.die(e)));
				return undefined;
			},
			Effect.asVoid,
		);

		return {
			create,
			addToCollection,
			removeFromCollection,
			getOrCreateCollection,
			ensureEntityInLibrary,
			markEntityOwnedInLibrary,
			ensureLibraryEntityForUser,
		};
	}),
}) {}
