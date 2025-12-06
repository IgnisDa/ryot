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

import { isMonitorAbleEntity } from "./monitor-able";
import { MonitoringRepository } from "./repository";

const entityAlias = "entity";

const entityIdRef: Expr = {
	type: "ref",
	sourceAlias: entityAlias,
	field: { name: "id", type: "system" },
};

const monitoringStatusDocument = (entityId: EntityId, entitySchemaSlug: string) =>
	({
		output: {
			type: "rows",
			pagination: { limit: 1, page: 1 },
			fields: [{ key: "id", expr: entityIdRef }],
			orderBy: [{ expr: entityIdRef, order: "asc" }],
			include: [
				{
					limit: 1,
					key: "monitoring",
					fields: [{ key: "id", expr: { ...entityIdRef, sourceAlias: "monitoringEntity" } }],
					orderBy: [{ order: "asc", expr: { ...entityIdRef, sourceAlias: "monitoringEntity" } }],
					source: {
						where: null,
						type: "entities",
						schemas: ["library"],
						alias: "monitoringEntity",
						via: {
							schema: "monitoring",
							direction: "outgoing",
							entityRef: entityAlias,
							alias: "monitoringEdge",
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

export class MonitoringService extends Effect.Service<MonitoringService>()("MonitoringService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entities = yield* EntitiesRepository;
		const collections = yield* CollectionsService;
		const queryEngine = yield* QueryEngineService;
		const relationships = yield* RelationshipsRepository;
		const monitoringRepository = yield* MonitoringRepository;
		const relationshipsService = yield* RelationshipsService;
		const relationshipSchemas = yield* RelationshipSchemasRepository;

		const getTarget = Effect.fn("MonitoringService.getTarget")(function* (
			user: CurrentUserValue,
			entityId: EntityId,
		) {
			const scope = yield* runWithDb(entities.getEntityScopeForUser({ entityId, userId: user.id }));
			const provenance = scope
				? yield* runWithDb(monitoringRepository.getProviderProvenance(entityId))
				: null;
			if (!scope || !isMonitorAbleEntity({ ...scope, provenance })) {
				return yield* notFound("Entity not found");
			}
			const response = yield* queryEngine.execute(
				user,
				monitoringStatusDocument(entityId, scope.entitySchemaSlug),
			);
			const rows = yield* requireRowsResponse(response);
			const row = rows.data.items[0];
			if (!row) {
				return yield* notFound("Entity not found");
			}
			const id = EntityId.make(yield* requireStringField(row, "id"));
			const monitoring = row.monitoring;
			return {
				entityId: id,
				isMonitored: isIncludedRows(monitoring) && monitoring.items.length > 0,
			};
		});

		const get = Effect.fn("MonitoringService.get")(function* (
			user: CurrentUserValue,
			entityId: EntityId,
		) {
			const target = yield* getTarget(user, entityId);
			return { entityId: target.entityId, isMonitored: target.isMonitored };
		});

		const enable = Effect.fn("MonitoringService.enable")(function* (
			user: CurrentUserValue,
			entityId: EntityId,
		) {
			const target = yield* getTarget(user, entityId);
			yield* collections.ensureEntityInLibrary(user.id, target.entityId);
			const monitoring = yield* runWithDb(relationshipSchemas.findBuiltinBySlug("monitoring"));
			if (!monitoring) {
				return yield* Effect.die("monitoring relationship schema not found");
			}
			const libraryEntityId = yield* runWithDb(monitoringRepository.getLibraryEntityId(user.id));
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
				relationshipSchemaId: monitoring.id,
				propertiesSchema: monitoring.propertiesSchema,
			});
			return { entityId: target.entityId, isMonitored: true };
		});

		const disable = Effect.fn("MonitoringService.disable")(function* (
			user: CurrentUserValue,
			entityId: EntityId,
		) {
			const target = yield* getTarget(user, entityId);
			const monitoring = yield* runWithDb(relationshipSchemas.findBuiltinBySlug("monitoring"));
			if (!monitoring) {
				return yield* Effect.die("monitoring relationship schema not found");
			}
			const libraryEntityId = yield* runWithDb(monitoringRepository.getLibraryEntityId(user.id));
			if (libraryEntityId) {
				yield* runWithDb(
					relationships.deleteUserRelationship({
						userId: user.id,
						sourceEntityId: target.entityId,
						targetEntityId: libraryEntityId,
						relationshipSchemaId: monitoring.id,
					}),
				);
			}
			return { entityId: target.entityId, isMonitored: false };
		});

		return { disable, enable, get };
	}),
}) {}
