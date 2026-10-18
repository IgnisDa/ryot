import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { RELATIONSHIP_PROJECTION_LIMITS } from "@ryot-app/plugin-backend-sdk/relationship-projections";
import {
	and,
	ascending,
	column,
	defineRecipe,
	executeRyotqlRecipe,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

export const LIBRARY_RELATIONSHIP_SCHEMA_SLUG = "in-media-library";

export const librarySummaryRequests = (sourceEntityIds: ReadonlySet<string>) => {
	const ids = [...sourceEntityIds];
	const requests = [];
	for (let index = 0; index < ids.length; index += RELATIONSHIP_PROJECTION_LIMITS.sourceEntities) {
		requests.push({
			relationshipSchemaSlug: LIBRARY_RELATIONSHIP_SCHEMA_SLUG,
			sourceEntityIds: ids.slice(index, index + RELATIONSHIP_PROJECTION_LIMITS.sourceEntities),
		});
	}
	return requests;
};

const containmentSlugs = [
	"show-to-show-season",
	"show-season-to-show-episode",
	"podcast-to-podcast-episode",
];

const containersRecipe = defineRecipe((entityIds: readonly string[]) => {
	const relationship = table("relationship", "containment");
	return {
		map: ({ containers }) => Result.succeed(containers.items),
		queries: {
			containers: selectedRows(relationship, {
				limit: entityIds.length,
				orderBy: [ascending(column(relationship, "id"))],
				selection: {
					childId: selectedField(column(relationship, "targetEntityId"), Schema.String),
					containerId: selectedField(column(relationship, "sourceEntityId"), Schema.String),
				},
				where: and(
					inArray(
						column(relationship, "targetEntityId"),
						entityIds.map((id) => literal(id)),
					),
					inArray(
						column(relationship, "relationshipSchemaSlug"),
						containmentSlugs.map((slug) => literal(slug)),
					),
				),
			}),
		},
	};
});

/** Library titles of `entityIds`, walking seasons and episodes up to their show or podcast. */
export const libraryTitleIds = Effect.fn(function* (
	host: Pick<ScriptHost, "executeRyotql">,
	entityIds: ReadonlySet<string>,
) {
	const titles = new Set<string>();
	let pending = [...entityIds];
	while (pending.length > 0) {
		const containers = new Map<string, string>();
		for (let index = 0; index < pending.length; index += 100) {
			for (const { childId, containerId } of yield* executeRyotqlRecipe(
				host.executeRyotql,
				containersRecipe(pending.slice(index, index + 100)),
			)) {
				containers.set(childId, containerId);
			}
		}
		for (const id of pending) {
			if (!containers.has(id)) {
				titles.add(id);
			}
		}
		pending = [...new Set(containers.values())];
	}
	return titles;
});
