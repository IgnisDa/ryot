import type { ChangeSet, ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	executeRyotqlRecipe,
	inArray,
	literal,
	parameters,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { catalogMessage } from "../../shared/messages.generated";

const containmentSlugs = [
	"show-to-show-season",
	"show-season-to-show-episode",
	"podcast-to-podcast-episode",
];
const containersRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			entityIds: {
				type: "array",
				validation: { required: true },
				description: "entityIds to read",
				label: catalogMessage("query-parameter.entities"),
				items: {
					type: "string",
					description: "Selected ID",
					label: catalogMessage("query-parameter.id"),
				},
			},
		},
	});
	const relationship = table("relationship", "containment");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ containers }) => Result.succeed(containers.items),
		queries: {
			containers: selectedRows(relationship, {
				limit: 100,
				orderBy: [ascending(column(relationship, "id"))],
				selection: {
					childId: selectedField(column(relationship, "targetEntityId"), Schema.String),
					containerId: selectedField(column(relationship, "sourceEntityId"), Schema.String),
				},
				where: and(
					inArray(column(relationship, "targetEntityId"), inputParameters.list("entityIds")),
					inArray(
						column(relationship, "relationshipSchemaSlug"),
						containmentSlugs.map((slug) => literal(slug)),
					),
				),
			}),
		},
	});
})();
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
				containersRecipe,
				{ entityIds: pending.slice(index, index + 100) },
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

/**
 * Refreshes the library summaries of the titles of `entityIds` for every user, without replaying their
 * history, so the summaries follow provider changes to the episodes they read.
 */
export const libraryTitleFolds = Effect.fn(function* (
	host: Pick<ScriptHost, "executeRyotql">,
	entityIds: ReadonlySet<string>,
) {
	const titles = [...(yield* libraryTitleIds(host, entityIds))].map((id) => EntityId.make(id));
	const changes: ChangeSet =
		titles.length === 0 ? {} : { folds: { entityIds: titles, scope: "all-users" } };
	return changes;
});
