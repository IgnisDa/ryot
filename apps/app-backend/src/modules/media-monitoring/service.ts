import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { isMediaMonitorableEntity } from "./monitorable";
import { MediaMonitoringRepository } from "./repository";

export class MediaMonitoringService extends Effect.Service<MediaMonitoringService>()(
	"MediaMonitoringService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const entities = yield* EntitiesRepository;
			const collections = yield* CollectionsService;
			const relationships = yield* RelationshipsRepository;
			const relationshipsService = yield* RelationshipsService;
			const collectionsRepository = yield* CollectionsRepository;
			const relationshipSchemas = yield* RelationshipSchemasRepository;
			const mediaMonitoringRepository = yield* MediaMonitoringRepository;

			const get = Effect.fn("MediaMonitoringService.get")(function* (
				user: CurrentUserValue,
				entityId: EntityId,
			) {
				const scope = yield* runWithDb(
					entities.getEntityScopeForUser({ entityId, userId: user.id }),
				);
				const provenance = scope
					? yield* runWithDb(mediaMonitoringRepository.getProviderProvenance(entityId))
					: null;
				if (!scope || !isMediaMonitorableEntity({ ...scope, provenance })) {
					return yield* notFound("Entity not found");
				}
				const isMediaMonitored = yield* runWithDb(
					mediaMonitoringRepository.isMonitoredByUser({
						userId: user.id,
						entityId: scope.entityId,
					}),
				);
				return { entityId: scope.entityId, isMediaMonitored };
			});

			const enable = Effect.fn("MediaMonitoringService.enable")(function* (
				user: CurrentUserValue,
				entityId: EntityId,
			) {
				const target = yield* get(user, entityId);
				yield* collections.ensureEntityInLibrary(user.id, target.entityId);
				const mediaMonitoring = yield* runWithDb(
					relationshipSchemas.findBuiltinBySlug("media-monitoring"),
				);
				if (!mediaMonitoring) {
					return yield* Effect.die("media-monitoring relationship schema not found");
				}
				const libraryEntityId = yield* runWithDb(
					collectionsRepository.getUserLibraryEntityId({ userId: user.id }),
				);
				if (!libraryEntityId) {
					return yield* Effect.die("Library entity not found for user");
				}
				yield* relationshipsService.create({
					scope: "user",
					properties: {},
					userId: user.id,
					onConflict: "preserveExisting",
					sourceEntityId: target.entityId,
					targetEntityId: libraryEntityId,
					relationshipSchemaId: mediaMonitoring.id,
					propertiesSchema: mediaMonitoring.propertiesSchema,
				});
				return { entityId: target.entityId, isMediaMonitored: true };
			});

			const disable = Effect.fn("MediaMonitoringService.disable")(function* (
				user: CurrentUserValue,
				entityId: EntityId,
			) {
				const target = yield* get(user, entityId);
				const mediaMonitoring = yield* runWithDb(
					relationshipSchemas.findBuiltinBySlug("media-monitoring"),
				);
				if (!mediaMonitoring) {
					return yield* Effect.die("media-monitoring relationship schema not found");
				}
				const libraryEntityId = yield* runWithDb(
					collectionsRepository.getUserLibraryEntityId({ userId: user.id }),
				);
				if (libraryEntityId) {
					yield* runWithDb(
						relationships.deleteUserRelationship({
							userId: user.id,
							sourceEntityId: target.entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: mediaMonitoring.id,
						}),
					);
				}
				return { entityId: target.entityId, isMediaMonitored: false };
			});

			return { disable, enable, get };
		}),
	},
) {}
