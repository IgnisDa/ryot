import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";

import { librarySummaryRequests, libraryTitleIds } from "../lib/library-summary-requests";
import { getSeasonContext, isSpecialSeason } from "./season-context";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
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
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const source = automation.payload;
			if (source.resource !== "relationship" || source.operation !== "batch") {
				return null;
			}
			const titleIds = yield* libraryTitleIds(
				host,
				new Set(
					source.items.map(
						(item) =>
							item.population?.scopeEntity.id ??
							(item.operation === "delete" ? item.before : item.after).sourceEntityId,
					),
				),
			);
			for (const request of librarySummaryRequests(titleIds)) {
				yield* host.requestRelationshipProjectionsForAllUsers(request);
			}
			// The leader carries the group's counts, and only one chunk of a split batch holds it.
			const leader = source.items.find((item) => item.population?.batch?.isLeader === true);
			const population = leader?.population;
			const batch = population?.batch;
			if (!leader || !population?.rootPreviouslyPopulated || !batch) {
				return null;
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
				return yield* host.emitSignal({
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
				return yield* host.emitSignal({
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
			return null;
		}),
});
