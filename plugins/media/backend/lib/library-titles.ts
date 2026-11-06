import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FOLD_LIMITS } from "@ryot-app/plugin-backend-sdk/folds";
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
import { EntityId } from "@ryot-app/plugin-kit/schema";

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

/** Refolds the library titles of `entityIds` for every user, so their summaries follow provider changes. */
export const refoldLibraryTitles = Effect.fn(function* (
	host: Pick<ScriptHost, "executeRyotql" | "requestFoldsForAllUsers">,
	entityIds: ReadonlySet<string>,
) {
	const titles = [...(yield* libraryTitleIds(host, entityIds))];
	for (let index = 0; index < titles.length; index += FOLD_LIMITS.requestEntities) {
		yield* host.requestFoldsForAllUsers({
			entityIds: titles
				.slice(index, index + FOLD_LIMITS.requestEntities)
				.map((id) => EntityId.make(id)),
		});
	}
});
