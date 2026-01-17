import { EntityId, EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import { mediaMonitorableEntitySchemaSlugs } from "./monitorable";

export type MediaMonitoringTarget = {
	entityId: EntityId;
	externalId: string;
	entitySchemaSlug: EntitySchemaSlug;
	sandboxScriptId: SandboxScriptId;
};

export class MediaMonitoringRepository extends Effect.Service<MediaMonitoringRepository>()(
	"MediaMonitoringRepository",
	{
		sync: () => {
			const getProviderProvenance = Effect.fn("MediaMonitoringRepository.getProviderProvenance")(
				function* (entityId: EntityId) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({
								externalId: schema.entity.externalId,
								sandboxScriptId: schema.entity.sandboxScriptId,
							})
							.from(schema.entity)
							.where(and(eq(schema.entity.id, entityId), isNull(schema.entity.userId)))
							.limit(1),
					);
					return row?.externalId && row.sandboxScriptId
						? { externalId: row.externalId, sandboxScriptId: row.sandboxScriptId }
						: null;
				},
			);

			const listTargets = Effect.fn("MediaMonitoringRepository.listTargets")(function* () {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.selectDistinct({
							entityId: schema.entity.id,
							externalId: schema.entity.externalId,
							entitySchemaSlug: schema.entity.entitySchemaSlug,
							sandboxScriptId: schema.entity.sandboxScriptId,
						})
						.from(schema.relationship)
						.innerJoin(schema.entity, eq(schema.relationship.sourceEntityId, schema.entity.id))
						.where(
							and(
								eq(schema.relationship.relationshipSchemaSlug, "media-monitoring"),
								isNotNull(schema.relationship.userId),
								isNull(schema.entity.userId),
								isNotNull(schema.entity.externalId),
								isNotNull(schema.entity.sandboxScriptId),
								inArray(schema.entity.entitySchemaSlug, mediaMonitorableEntitySchemaSlugs),
							),
						)
						.orderBy(asc(schema.entity.id)),
				);

				return rows.flatMap((row) =>
					row.externalId && row.sandboxScriptId
						? [
								{
									externalId: row.externalId,
									entityId: EntityId.make(row.entityId),
									entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
									sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
								} satisfies MediaMonitoringTarget,
							]
						: [],
				);
			});

			return { listTargets, getProviderProvenance };
		},
	},
) {}
