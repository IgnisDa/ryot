import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { automationOccurrenceRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import { getSeasonContext, isSpecialSeason } from "./season-context";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media Relationship Sync Detector",
	slug: "automation.media-relationship-sync",
	capabilities: ["executeRyotql", "emitSignal"],
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.source.kind !== "relationship") {
			return Effect.succeed(null);
		}
		return executeRyotqlRecipe(
			host.executeRyotql,
			automationOccurrenceRecipe(automation.occurrenceId),
		).pipe(
			Effect.flatMap((occurrence) => {
				const source = occurrence?.source;
				const population = occurrence?.population;
				const batch = population?.batch;
				const snapshot =
					source?.kind === "relationship" ? (source.after ?? source.before) : undefined;
				if (!snapshot || !population?.rootPreviouslyPopulated || !batch?.isLeader) {
					return Effect.succeed(null);
				}
				const season = getSeasonContext(population.parentEntity);

				const properties: Record<string, JsonValue> = {
					newCount: batch.afterCount,
					oldCount: batch.beforeCount,
					entityName: population.scopeEntity.name,
				};
				if (
					snapshot.relationshipSchemaSlug === "show-to-show-season" &&
					batch.beforeCount !== batch.afterCount
				) {
					return host.emitSignal({
						properties,
						discriminator: batch.id,
						schemaSlug: "media.season-count.changed",
						subjectEntityId: population.scopeEntity.id,
					});
				}
				if (
					(snapshot.relationshipSchemaSlug === "show-season-to-show-episode" ||
						snapshot.relationshipSchemaSlug === "podcast-to-podcast-episode") &&
					batch.createdCount > 0 &&
					!isSpecialSeason(season)
				) {
					const seasonNumber = season?.seasonNumber;
					return host.emitSignal({
						discriminator: batch.id,
						schemaSlug: "media.episode.discovered",
						subjectEntityId: population.scopeEntity.id,
						properties: {
							...properties,
							discoveredCount: batch.createdCount,
							...(seasonNumber === null || seasonNumber === undefined ? {} : { seasonNumber }),
						},
					});
				}
				return Effect.succeed(null);
			}),
		);
	},
});
