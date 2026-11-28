import {
	type ChangeSet,
	type GlobalRelationship,
	upsertedGlobalEntity,
} from "@ryot-app/plugin-backend-sdk/core";
import { DateTime, Effect } from "@ryot-app/plugin-backend-sdk/effect";

/**
 * Ranks `items` as the latest trending batch of `entitySchemaSlug`, replacing only that schema's
 * `media-trending` relationships.
 */
export const trendingChanges = Effect.fn(function* (
	entitySchemaSlug: string,
	items: ReadonlyArray<{ readonly name: string; readonly externalId: string }>,
) {
	const fetchedAt = DateTime.formatIso(yield* DateTime.now);
	const relationships = items.map(({ externalId }, index): GlobalRelationship => {
		const entity = upsertedGlobalEntity(entitySchemaSlug, externalId);
		return { source: entity, target: entity, properties: { fetchedAt, rank: index + 1 } };
	});
	const changes: ChangeSet = {
		globalEntities: items.map(({ name, externalId }) => ({
			name,
			externalId,
			properties: {},
			entitySchemaSlug,
			populatedAt: null,
		})),
		globalRelationships: [
			{
				relationships,
				relationshipSchemaSlug: "media-trending",
				selector: { type: "self", entitySchemaSlug },
			},
		],
	};
	return changes;
});
