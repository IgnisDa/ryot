import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type {
	Expr,
	IncludedRowsValue,
	QueryDocument,
	RowValue,
} from "@ryot/contract/modules/query-engine/language";
import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { requireRowsResponse, requireStringField } from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { isMediaMonitorableEntity } from "./monitorable";
import { MediaMonitoringRepository } from "./repository";

const entityAlias = "entity";

const entityIdRef: Expr = {
	type: "ref",
	sourceAlias: entityAlias,
	field: { name: "id", type: "system" },
};

const mediaMonitoringStatusDocument = (entityId: EntityId, entitySchemaSlug: string) =>
	({
		output: {
			type: "rows",
			pagination: { limit: 1, page: 1 },
			fields: [{ key: "id", expr: entityIdRef }],
			orderBy: [{ expr: entityIdRef, order: "asc" }],
			include: [
				{
					limit: 1,
					key: "mediaMonitoring",
					fields: [{ key: "id", expr: { ...entityIdRef, sourceAlias: "mediaMonitoringEntity" } }],
					orderBy: [
						{ order: "asc", expr: { ...entityIdRef, sourceAlias: "mediaMonitoringEntity" } },
					],
					source: {
						where: null,
						type: "entities",
						schemas: ["library"],
						alias: "mediaMonitoringEntity",
						via: {
							schema: "media-monitoring",
							direction: "outgoing",
							entityRef: entityAlias,
							alias: "mediaMonitoringEdge",
						},
					},
				},
			],
		},
		source: {
			type: "entities",
			alias: entityAlias,
			schemas: [entitySchemaSlug],
			where: {
				operator: "eq",
				left: entityIdRef,
				type: "comparison",
				right: { type: "literal", value: entityId },
			},
		},
	}) satisfies QueryDocument;

const isIncludedRows = (value: RowValue | undefined): value is IncludedRowsValue =>
	value !== undefined && "items" in value;

export class MediaMonitoringService extends Effect.Service<MediaMonitoringService>()(
	"MediaMonitoringService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const entities = yield* EntitiesRepository;
			const collections = yield* CollectionsService;
			const queryEngine = yield* QueryEngineService;
			const relationships = yield* RelationshipsRepository;
			const mediaMonitoringRepository = yield* MediaMonitoringRepository;
			const relationshipsService = yield* RelationshipsService;
			const relationshipSchemas = yield* RelationshipSchemasRepository;

			const getTarget = Effect.fn("MediaMonitoringService.getTarget")(function* (
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
					mediaMonitoringStatusDocument(entityId, scope.entitySchemaSlug),
				);
				const rows = yield* requireRowsResponse(response);
				const row = rows.data.items[0];
				if (!row) {
					return yield* notFound("Entity not found");
				}
				const id = EntityId.make(yield* requireStringField(row, "id"));
				const mediaMonitoring = row.mediaMonitoring;
				return {
					entityId: id,
					isMediaMonitored: isIncludedRows(mediaMonitoring) && mediaMonitoring.items.length > 0,
				};
			});

			const get = Effect.fn("MediaMonitoringService.get")(function* (
				user: CurrentUserValue,
				entityId: EntityId,
			) {
				const target = yield* getTarget(user, entityId);
				return { entityId: target.entityId, isMediaMonitored: target.isMediaMonitored };
			});

			const enable = Effect.fn("MediaMonitoringService.enable")(function* (
				user: CurrentUserValue,
				entityId: EntityId,
			) {
				const target = yield* getTarget(user, entityId);
				yield* collections.ensureEntityInLibrary(user.id, target.entityId);
				const mediaMonitoring = yield* runWithDb(
					relationshipSchemas.findBuiltinBySlug("media-monitoring"),
				);
				if (!mediaMonitoring) {
					return yield* Effect.die("media-monitoring relationship schema not found");
				}
				const libraryEntityId = yield* runWithDb(
					mediaMonitoringRepository.getLibraryEntityId(user.id),
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
				const target = yield* getTarget(user, entityId);
				const mediaMonitoring = yield* runWithDb(
					relationshipSchemas.findBuiltinBySlug("media-monitoring"),
				);
				if (!mediaMonitoring) {
					return yield* Effect.die("media-monitoring relationship schema not found");
				}
				const libraryEntityId = yield* runWithDb(
					mediaMonitoringRepository.getLibraryEntityId(user.id),
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
