import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import { mediaMonitorableEntitySchemaSlugs } from "./monitorable";

export type MediaMonitoringTarget = {
	entityId: EntityId;
	externalId: string;
	entitySchemaSlug: EntitySchemaSlug;
	providerId: SandboxProviderId;
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
								providerId: schema.entity.providerId,
							})
							.from(schema.entity)
							.where(and(eq(schema.entity.id, entityId), isNull(schema.entity.userId)))
							.limit(1),
					);
					return row?.externalId && row.providerId
						? { externalId: row.externalId, providerId: row.providerId }
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
							providerId: schema.entity.providerId,
						})
						.from(schema.relationship)
						.innerJoin(schema.entity, eq(schema.relationship.sourceEntityId, schema.entity.id))
						.where(
							and(
								eq(schema.relationship.relationshipSchemaSlug, "media-monitoring"),
								isNotNull(schema.relationship.userId),
								isNull(schema.entity.userId),
								isNotNull(schema.entity.externalId),
								isNotNull(schema.entity.providerId),
								inArray(schema.entity.entitySchemaSlug, mediaMonitorableEntitySchemaSlugs),
							),
						)
						.orderBy(asc(schema.entity.id)),
				);

				return rows.flatMap((row) =>
					row.externalId && row.providerId
						? [
								{
									externalId: row.externalId,
									entityId: EntityId.make(row.entityId),
									entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
									providerId: SandboxProviderId.make(row.providerId),
								} satisfies MediaMonitoringTarget,
							]
						: [],
				);
			});

			return { listTargets, getProviderProvenance };
		},
	},
) {}
