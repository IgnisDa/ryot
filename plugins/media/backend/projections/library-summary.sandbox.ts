import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	RelationshipProjectionStepInput,
	RelationshipProjectionStepOutput,
} from "@ryot-app/plugin-backend-sdk/relationship-projections";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	type LibrarySummaryKind,
	librarySummaryKind,
	librarySummaryProperties,
	librarySummarySourceRecipe,
	type LibrarySummarySourceRow,
} from "../../shared/library-summary";

export const manifest = defineManifest({
	kind: "script",
	slug: "projection.library-summary",
	name: "Compute media library summary",
});

export default defineScript({
	manifest,
	input: RelationshipProjectionStepInput,
	output: RelationshipProjectionStepOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [firstId, ...otherIds] = new Set(
				input.relationships.map(({ sourceEntityId }) => sourceEntityId),
			);
			const rows = new Map<string, LibrarySummarySourceRow>();
			if (firstId !== undefined) {
				const { items: entities } = yield* executeRyotqlRecipe(
					host.executeRyotql,
					entityReadRecipe({ entityIds: [firstId, ...otherIds] }),
				);
				const idsByKind = new Map<LibrarySummaryKind, [string, ...string[]]>();
				for (const { id, entitySchemaSlug } of entities) {
					const kind = librarySummaryKind(entitySchemaSlug);
					const ids = idsByKind.get(kind);
					if (ids) {
						ids.push(id);
					} else {
						idsByKind.set(kind, [id]);
					}
				}
				for (const [kind, entityIds] of idsByKind) {
					const computed = yield* executeRyotqlRecipe(
						host.executeRyotql,
						librarySummarySourceRecipe({ kind, entityIds }),
					);
					for (const row of computed) {
						rows.set(row.id, row);
					}
				}
			}
			return {
				updates: input.relationships.map(({ relationshipId, sourceEntityId }) => {
					const row = rows.get(sourceEntityId);
					return {
						relationshipId,
						properties: row
							? librarySummaryProperties(row)
							: { timesCompleted: 0, lifecycleState: "untracked" },
					};
				}),
			};
		}),
});
