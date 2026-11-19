import {
	type ChangeSet,
	existingEntity,
	type ScriptHost,
	upsertedGlobalEntity,
} from "@ryot-app/plugin-backend-sdk/core";
import { DateTime, Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	trendingEntitySchemaSlugs,
	trendingLatestMediaRecipe,
} from "../../shared/discovery-recipes";

/**
 * Ranks `items` as the latest trending batch of `entitySchemaSlug`. The `media-trending` group is
 * replaced as a whole, so it carries every other schema's latest batch unchanged.
 */
export const trendingChanges = Effect.fn(function* (
	host: Pick<ScriptHost, "executeRyotql">,
	entitySchemaSlug: string,
	items: ReadonlyArray<{ readonly name: string; readonly externalId: string }>,
) {
	const fetchedAt = DateTime.formatIso(yield* DateTime.now);
	const relationships: Array<
		NonNullable<ChangeSet["globalRelationships"]>[number]["relationships"][number]
	> = items.map(({ externalId }, index) => {
		const entity = upsertedGlobalEntity(entitySchemaSlug, externalId);
		return { source: entity, target: entity, properties: { fetchedAt, rank: index + 1 } };
	});
	let after: string | undefined;
	let hasMore = true;
	while (hasMore) {
		const { pageInfo, items: carried } = yield* executeRyotqlRecipe(
			host.executeRyotql,
			trendingLatestMediaRecipe({ reference: { kind: "self" } }),
			{ entitySchemaSlugs: trendingEntitySchemaSlugs.filter((slug) => slug !== entitySchemaSlug) },
			{ pages: { trending: { after, limit: 100 } } },
		);
		for (const { id, rank, fetchedAt: carriedFetchedAt } of carried) {
			const entity = existingEntity(EntityId.make(id));
			relationships.push({
				source: entity,
				target: entity,
				properties: { rank, fetchedAt: carriedFetchedAt },
			});
		}
		after = pageInfo.nextCursor ?? undefined;
		hasMore = pageInfo.hasMore;
	}
	const changes: ChangeSet = {
		globalRelationships: [
			{ relationships, selector: { type: "self" }, relationshipSchemaSlug: "media-trending" },
		],
		globalEntities: items.map(({ name, externalId }) => ({
			name,
			externalId,
			properties: {},
			entitySchemaSlug,
			populatedAt: null,
		})),
	};
	return changes;
});
