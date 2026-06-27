import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest, type JsonValue } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Media Entity Updated Detector",
	slug: "automation.media-entity-updated",
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

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const canonicalJson = (value: JsonValue): string => {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (isJsonObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};

const imageSet = (value: JsonValue | undefined) =>
	new Set((Array.isArray(value) ? value : []).map(canonicalJson));

const sameImages = (before: JsonValue | undefined, after: JsonValue | undefined) => {
	const beforeSet = imageSet(before);
	const afterSet = imageSet(after);
	return beforeSet.size === afterSet.size && [...beforeSet].every((image) => afterSet.has(image));
};

const isSpecialSeason = (season: { name: string | null; number: number | null } | undefined) =>
	season?.number === 0 ||
	["special", "specials"].includes(season?.name?.trim().toLowerCase() ?? "");

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const source = automation.source;
		const population = automation.population;
		if (
			automation.operation !== "update" ||
			source.kind !== "entity" ||
			!source.before ||
			!source.after ||
			!population?.rootPreviouslyPopulated
		) {
			return Effect.succeed(null);
		}

		const before = source.before;
		const after = source.after;
		const scope = population.scopeEntity;
		const emissions: Array<ReturnType<typeof host.emitSignal>> = [];
		const emit = (
			schemaSlug: string,
			discriminator: string,
			properties: Record<string, JsonValue>,
		) =>
			emissions.push(
				host.emitSignal({
					properties,
					schemaSlug,
					discriminator,
					subjectEntityId: scope.id,
				}),
			);

		if (parentMediaSlugs.has(after.entitySchemaSlug)) {
			const oldStatus = stringValue(before.properties["productionStatus"]);
			const newStatus = stringValue(after.properties["productionStatus"]);
			if (oldStatus !== null && newStatus !== null && oldStatus !== newStatus) {
				emit("media.status.changed", `${after.id}:status`, {
					oldStatus,
					newStatus,
					entityName: scope.name,
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
			(after.entitySchemaSlug === "show-episode" || after.entitySchemaSlug === "podcast-episode") &&
			!isSpecialSeason(population.owningSeason)
		) {
			const episodeNumber =
				numberValue(after.properties["episodeNumber"]) ??
				numberValue(before.properties["episodeNumber"]);
			if (episodeNumber !== null && Number.isInteger(episodeNumber)) {
				const seasonNumber = population.owningSeason?.number;
				const episodeProperties = {
					entityName: scope.name,
					episodeNumber,
					...(seasonNumber === null || seasonNumber === undefined ? {} : { seasonNumber }),
				};
				if (before.name !== after.name) {
					emit("media.episode.name.changed", `${after.id}:name`, {
						...episodeProperties,
						oldName: before.name,
						newName: after.name,
					});
				}
				if (!sameImages(before.properties["images"], after.properties["images"])) {
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
	},
});
