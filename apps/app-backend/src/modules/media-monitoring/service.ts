import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type { IncludedRowsValue, RowValue } from "@ryot/contract/modules/query-engine/language";
import { EntityId } from "@ryot/contract/schema/brands";
import { buildMediaMonitoringStatusQueryDocument } from "@ryot/query-engine";
import { Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { requireRowsResponse, requireStringField } from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { isMediaMonitorableEntity } from "./monitorable";
import { MediaMonitoringRepository } from "./repository";

const isIncludedRows = (value: RowValue | undefined): value is IncludedRowsValue =>
	value !== undefined && "items" in value;

export class MediaMonitoringService extends Effect.Service<MediaMonitoringService>()(
	"MediaMonitoringService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const runInTransaction = yield* TransactionRunner;
			const entities = yield* EntitiesRepository;
			const collections = yield* CollectionsService;
			const queryEngine = yield* QueryEngineService;
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
				const response = yield* queryEngine.execute(
					user,
					buildMediaMonitoringStatusQueryDocument({
						entityId,
						entitySchemaSlug: scope.entitySchemaSlug,
					}),
				);
				const rows = yield* requireRowsResponse(response);
				const row = rows.data.items[0];
				if (!row) {
					return yield* notFound("Entity not found");
				}
				const id = EntityId.make(yield* requireStringField(row, "id"));
				const mediaMonitoring = row["libraries"];
				return {
					entityId: id,
					isMediaMonitored: isIncludedRows(mediaMonitoring) && mediaMonitoring.items.length > 0,
				};
			});

			const enable = Effect.fn("MediaMonitoringService.enable")(function* (
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
				yield* runInTransaction(
					Effect.gen(function* () {
						yield* collections.ensureEntityInLibrary(user.id, target.entityId);
						const libraryEntityId = yield* collectionsRepository.getUserLibraryEntityId({
							userId: user.id,
						});
						if (!libraryEntityId) {
							return yield* Effect.die("Library entity not found for user");
						}
						yield* relationshipsService.create({
							scope: "user",
							properties: {},
							userId: user.id,
							sourceEntityId: target.entityId,
							targetEntityId: libraryEntityId,
							relationshipSchemaId: mediaMonitoring.id,
							propertiesSchema: mediaMonitoring.propertiesSchema,
						});
						return undefined;
					}),
				);
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
					yield* relationshipsService.delete({
						scope: "user",
						userId: user.id,
						sourceEntityId: target.entityId,
						targetEntityId: libraryEntityId,
						relationshipSchemaId: mediaMonitoring.id,
					});
				}
				return { entityId: target.entityId, isMediaMonitored: false };
			});

			return { disable, enable, get };
		}),
	},
) {}
