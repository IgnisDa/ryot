import type { EntityId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

export const syncGlobalRelationshipsWithProperties = Effect.fn(
	"RelationshipsRepository.syncGlobalRelationshipsWithProperties",
)(function* (input: {
	anchorEntityId: EntityId;
	direction: "incoming" | "outgoing";
	relationshipSchemaId: RelationshipSchemaId;
	synchronization: "authoritative" | "additive";
	entries: ReadonlyArray<{ entityId: EntityId; properties: Record<string, unknown> }>;
}) {
	const db = yield* CurrentDb;
	const entries = [...new Map(input.entries.map((entry) => [entry.entityId, entry])).values()];
	const entityIds = entries.map((entry) => entry.entityId);
	const isOutgoing = input.direction === "outgoing";
	const relationshipValues = entries.map((entry) => ({
		userId: null,
		properties: entry.properties,
		relationshipSchemaId: input.relationshipSchemaId,
		targetEntityId: isOutgoing ? entry.entityId : input.anchorEntityId,
		sourceEntityId: isOutgoing ? input.anchorEntityId : entry.entityId,
	}));
	const anchorWhere = and(
		isNull(schema.relationship.userId),
		eq(
			isOutgoing ? schema.relationship.sourceEntityId : schema.relationship.targetEntityId,
			input.anchorEntityId,
		),
		eq(schema.relationship.relationshipSchemaId, input.relationshipSchemaId),
	);
	const relatedEntityColumn = isOutgoing
		? schema.relationship.targetEntityId
		: schema.relationship.sourceEntityId;

	yield* dbEffect(() =>
		db.transaction((tx) => {
			if (input.synchronization === "additive") {
				const insert =
					entries.length > 0
						? tx
								.insert(schema.relationship)
								.values(relationshipValues)
								.onConflictDoNothing({
									where: isNull(schema.relationship.userId),
									target: [
										schema.relationship.sourceEntityId,
										schema.relationship.targetEntityId,
										schema.relationship.relationshipSchemaId,
									],
								})
						: Promise.resolve();
				return insert.then(() => undefined);
			}

			const upsert =
				entries.length > 0
					? tx
							.insert(schema.relationship)
							.values(relationshipValues)
							.onConflictDoUpdate({
								set: { properties: sql.raw('excluded."properties"') },
								targetWhere: isNull(schema.relationship.userId),
								target: [
									schema.relationship.sourceEntityId,
									schema.relationship.targetEntityId,
									schema.relationship.relationshipSchemaId,
								],
							})
					: Promise.resolve();

			return upsert.then(() =>
				entityIds.length === 0
					? tx.delete(schema.relationship).where(anchorWhere)
					: tx
							.delete(schema.relationship)
							.where(and(anchorWhere, notInArray(relatedEntityColumn, entityIds))),
			);
		}),
	);
});
