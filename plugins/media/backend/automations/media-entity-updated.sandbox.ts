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
	name: "Media Entity Updated Detector",
	slug: "automation.media-entity-updated",
	inputProjection: {
		entity: {
			parentEntityProperties: ["seasonNumber"],
			compareProperties: [{ property: "images", equality: "unordered-array" }],
			properties: [
				"productionStatus",
				"publishYear",
				"episodes",
				"chapters",
				"episodeNumber",
				"publishDate",
			],
		},
	},
});

const parentMediaSlugs = new Set([
	"anime",
	"audiobook",
	"book",
	"comic-book",
	"manga",
	"movie",
	"music",
	"podcast",
	"show",
	"video-game",
	"visual-novel",
]);

const stringValue = (value: JsonValue | undefined) => (typeof value === "string" ? value : null);
const numberValue = (value: JsonValue | undefined) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		return Effect.suspend(() => {
			const source = automation.payload;
			if (
				source.resource !== "entity" ||
				source.operation !== "update" ||
				!source.population?.rootPreviouslyPopulated
			) {
				return Effect.succeed(null);
			}
			const population = source.population;

			const before = source.before;
			const after = source.after;
			const scope = population.scopeEntity;
			const season = getSeasonContext(population.parentEntity);
			const emissions: Array<ReturnType<typeof host.emitSignal>> = [];
			const emit = (
				schemaSlug: string,
				discriminator: string,
				properties: Record<string, JsonValue>,
			) =>
				emissions.push(
					host.emitSignal({ properties, schemaSlug, discriminator, subjectEntityId: scope.id }),
				);

			if (parentMediaSlugs.has(after.entitySchemaSlug)) {
				const oldStatus = stringValue(before.properties["productionStatus"]);
				const newStatus = stringValue(after.properties["productionStatus"]);
				if (oldStatus !== null && newStatus !== null && oldStatus !== newStatus) {
					emit("media.status.changed", `${after.id}:status`, {
						oldStatus,
						newStatus,
						entityName: scope.name,
						entitySchemaSlug: after.entitySchemaSlug,
					});
				}

				const oldYear = numberValue(before.properties["publishYear"]);
				const newYear = numberValue(after.properties["publishYear"]);
				if (
					oldYear !== null &&
					newYear !== null &&
					Number.isInteger(oldYear) &&
					Number.isInteger(newYear) &&
					oldYear !== newYear
				) {
					emit("media.release-date.changed", `${after.id}:publish-year`, {
						oldYear,
						newYear,
						entityName: scope.name,
						changeKind: "publish_year",
					});
				}
			}

			const contentKey = after.entitySchemaSlug === "anime" ? "episodes" : "chapters";
			if (after.entitySchemaSlug === "anime" || after.entitySchemaSlug === "manga") {
				const oldCount = numberValue(before.properties[contentKey]);
				const newCount = numberValue(after.properties[contentKey]);
				if (oldCount !== null && newCount !== null && oldCount !== newCount) {
					emit("media.content-count.changed", `${after.id}:content-count`, {
						oldCount,
						newCount,
						entityName: scope.name,
						contentType: after.entitySchemaSlug === "anime" ? "episodes" : "chapters",
					});
				}
			}

			if (
				(after.entitySchemaSlug === "show-episode" ||
					after.entitySchemaSlug === "podcast-episode") &&
				!isSpecialSeason(season)
			) {
				const episodeNumber =
					numberValue(after.properties["episodeNumber"]) ??
					numberValue(before.properties["episodeNumber"]);
				if (episodeNumber !== null && Number.isInteger(episodeNumber)) {
					const seasonNumber = season?.seasonNumber;
					const episodeProperties = {
						episodeNumber,
						entityName: scope.name,
						...(seasonNumber === null || seasonNumber === undefined ? {} : { seasonNumber }),
					};
					if (before.name !== after.name) {
						emit("media.episode.name.changed", `${after.id}:name`, {
							...episodeProperties,
							newName: after.name,
							oldName: before.name,
						});
					}
					if (source.changedProperties.includes("images")) {
						emit("media.episode.images.changed", `${after.id}:images`, episodeProperties);
					}
					if (after.entitySchemaSlug === "show-episode") {
						const oldDate = stringValue(before.properties["publishDate"]);
						const newDate = stringValue(after.properties["publishDate"]);
						if (oldDate !== null && newDate !== null && oldDate !== newDate) {
							emit("media.release-date.changed", `${after.id}:episode-date`, {
								oldDate,
								newDate,
								...episodeProperties,
								changeKind: "episode_date",
							});
						}
					}
				}
			}

			return emissions.length === 0
				? Effect.succeed(null)
				: Effect.all(emissions, { concurrency: "unbounded" });
		});
	},
});
