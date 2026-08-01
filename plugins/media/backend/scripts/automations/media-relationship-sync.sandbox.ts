import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import { getSeasonContext, isSpecialSeason } from "./season-context";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Media Relationship Sync Detector",
	slug: "automation.media-relationship-sync",
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const source = automation.source;
		const population = automation.population;
		const batch = population?.batch;
		const snapshot = source.kind === "relationship" ? (source.after ?? source.before) : undefined;
		if (!snapshot || !population?.rootPreviouslyPopulated || !batch?.isLeader) {
			return Effect.succeed(null);
		}
		const season = getSeasonContext(population.parentEntity);

		const properties: Record<string, JsonValue> = {
			oldCount: batch.beforeCount,
			newCount: batch.afterCount,
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
	},
});
