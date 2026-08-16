import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import { getSeasonContext, isSpecialSeason } from "./season-context";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Media Relationship Sync Detector",
	slug: "automation.media-relationship-sync",
	inputProjection: {
		relationship: {
			properties: [],
			compareProperties: [],
			parentEntityProperties: ["seasonNumber"],
		},
	},
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		return Effect.suspend(() => {
			const source = automation.payload;
			if (source.resource !== "relationship" || source.operation !== "batch") {
				return Effect.succeed(null);
			}
			// The leader carries the group's counts, and only one chunk of a split batch holds it.
			const leader = source.items.find((item) => item.population?.batch?.isLeader === true);
			const population = leader?.population;
			const batch = population?.batch;
			if (!leader || !population?.rootPreviouslyPopulated || !batch) {
				return Effect.succeed(null);
			}
			const snapshot = leader.operation === "delete" ? leader.before : leader.after;
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
		});
	},
});
