import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
} from "@ryot/contract/modules/collections/schemas";
import type { EntityId, UserId } from "@ryot/contract/schema/brands";
import { decodeStoredAppSchema } from "@ryot/contract/schema/core";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	parseAppSchemaProperties,
	parseLabeledPropertySchemaInput,
} from "#lib/property-schema/property-schema-runtime";
import { requireText } from "#lib/shared/validation";
import { executeEntityCreate } from "#modules/entities/entity-create-workflow";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import { executeRemoveEntityFromCollection } from "./remove-entity-from-collection-workflow";
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
			const created = yield* executeEntityCreate(engine, {
				userId: user.id,
				origin: { kind: "api" },
				executionId: generateId(),
				body: { name, properties, entitySchemaId: entitySchema.entitySchemaId },
			}).pipe(Effect.catchTag("NotFound", (error) => Effect.die(error)));
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
				return { operation: "noop" as const, collection: existing };
			}

			const created = yield* entities.create(userId, {
				name,
				properties: {},
				entitySchemaId: entitySchema.entitySchemaId,
			});
			return {
				entity: created.entity,
				operation: created.operation,
				entitySchemaSlug: created.entitySchemaSlug,
				collection: toCollectionResponse(created.entity),
			};
		});

		const writeMembership = Effect.fn("CollectionsService.writeMembership")(function* (input: {
			userId: UserId;
			entityId: EntityId;
			properties?: unknown;
			collectionId: EntityId;
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

			const outcome = yield* runInTransaction(
				Effect.gen(function* () {
					if (entity.userId === null) {
						const libraryEntityId = yield* repository.getUserLibraryEntityId({
							userId: input.userId,
						});
						if (!libraryEntityId) {
							return yield* Effect.die("Library entity not found for user");
						}
						yield* relationships
							.save({
								scope: "user",
								properties: {},
								userId: input.userId,
								validation: "schema",
								sourceEntityId: entity.id,
								onConflict: "preserveExisting",
								targetEntityId: libraryEntityId,
								relationshipSchemaId: inLibrary.id,
								propertiesSchema: inLibrary.propertiesSchema,
							})
							.pipe(Effect.catchTag("BadRequest", (error) => Effect.die(error)));
					}

					return yield* relationships.save({
						scope: "user",
						userId: input.userId,
						validation: "prevalidated",
						sourceEntityId: input.entityId,
						properties: validatedProperties,
						onConflict: "replaceProperties",
						targetEntityId: input.collectionId,
						relationshipSchemaId: memberOfRelationshipSchema.id,
					});
				}),
			);

			const occurredAt = yield* DateTime.nowAsDate;
			const { wasInserted: _wasInserted, ...memberOf } = outcome.relationship;
			return {
				memberOf,
				entityId: entity.id,
				addEventSchemaId: addEvent?.id ?? null,
				occurredAt: occurredAt.toISOString(),
				wasInserted: outcome.operation === "create",
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

		const deleteMembership = Effect.fn("CollectionsService.deleteMembership")(function* (input: {
			userId: UserId;
			entityId: EntityId;
			collectionId: EntityId;
		}) {
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

			const memberOf = yield* memberOfSchema;
			const deleted = yield* relationships.deleteUserRelationship({
				userId: input.userId,
				sourceEntityId: input.entityId,
				relationshipSchemaId: memberOf.id,
				targetEntityId: input.collectionId,
			});

			if (!deleted) {
				return yield* notFound("Entity is not in collection");
			}

			const removeEvent = yield* removeEventSchema;
			const occurredAt = yield* DateTime.nowAsDate;
			return {
				memberOf: deleted,
				occurredAt: occurredAt.toISOString(),
				entitySchemaSlug: entity.entitySchemaSlug,
				removeEventSchemaId: removeEvent?.id ?? null,
			};
		});

		const removeFromCollection = Effect.fn("CollectionsService.removeFromCollection")(function* (
			user: CurrentUserValue,
			payload: DeleteMembershipBody,
		) {
			const executionId = generateId();
			return yield* executeRemoveEntityFromCollection(engine, {
				executionId,
				userId: user.id,
				entityId: payload.entityId,
				collectionId: payload.collectionId,
			});
		});

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
				.save({
					userId,
					scope: "user",
					properties: {},
					validation: "schema",
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
				const currentSources = Array.isArray(existingProperties["ownershipSources"])
					? existingProperties["ownershipSources"].filter(
							(source): source is string => typeof source === "string",
						)
					: [];

				yield* relationships
					.save({
						scope: "user",
						userId: input.userId,
						validation: "schema",
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
			writeMembership,
			deleteMembership,
			removeFromCollection,
			getOrCreateCollection,
			ensureEntityInLibrary,
			markEntityOwnedInLibrary,
		};
	}),
}) {}
