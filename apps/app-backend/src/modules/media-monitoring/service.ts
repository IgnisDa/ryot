import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { notFound } from "@ryot/contract/errors";
import type { IncludedRowsValue, RowValue } from "@ryot/contract/modules/query-engine/language";
import { EntityId } from "@ryot/contract/schema/brands";
import { buildMediaMonitoringStatusQueryDocument } from "@ryot/query-engine";
import { generateId } from "better-auth";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { requireRowsResponse, requireStringField } from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";

import { executeDisableMediaMonitoring } from "./disable-media-monitoring-workflow";
import { executeEnableMediaMonitoring } from "./enable-media-monitoring-workflow";
import { isMediaMonitorableEntity } from "./monitorable";
import { MediaMonitoringRepository } from "./repository";

const isIncludedRows = (value: RowValue | undefined): value is IncludedRowsValue =>
	value !== undefined && "items" in value;

export class MediaMonitoringService extends Effect.Service<MediaMonitoringService>()(
	"MediaMonitoringService",
	{
		effect: Effect.gen(function* () {
			const engine = yield* WorkflowEngine;
			const runWithDb = yield* DbRunner;
			const entities = yield* EntitiesRepository;
			const queryEngine = yield* QueryEngineService;
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
				return yield* executeEnableMediaMonitoring(engine, {
					userId: user.id,
					executionId: generateId(),
					entityId: target.entityId,
				});
			});

			const disable = Effect.fn("MediaMonitoringService.disable")(function* (
				user: CurrentUserValue,
				entityId: EntityId,
			) {
				const target = yield* get(user, entityId);
				return yield* executeDisableMediaMonitoring(engine, {
					userId: user.id,
					executionId: generateId(),
					entityId: target.entityId,
				});
			});

			return { disable, enable, get };
		}),
	},
) {}
