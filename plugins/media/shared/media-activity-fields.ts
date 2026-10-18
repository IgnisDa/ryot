import {
	builtinMediaEntitySchemaSlugs,
	isPositional,
	positionalProperties,
} from "./media-schema-slugs";

export const mediaActivityEventSchemaSlugs = [
	"complete",
	"progress",
	"dropped",
	"on_hold",
	"backlog",
] as const;

export const mediaActivityEntitySchemaSlugs = [
	...builtinMediaEntitySchemaSlugs,
	"show-episode",
	"podcast-episode",
] as const;

const activityEntities = new Set<string>(mediaActivityEntitySchemaSlugs);
const episodeEntities = new Set(["show-episode", "podcast-episode"]);
const episodicParents = new Set(["show", "podcast"]);

const DATE_FIELDS = ["startedOn", "dateUnknown"] as const;
const DETAIL_FIELDS = ["consumedOn", "timeSpent"] as const;

/** Every property an activity edit can set or clear, for the absent-property precondition. */
export const mediaActivityPatchableKeys = [
	...DATE_FIELDS,
	...DETAIL_FIELDS,
	"progressPercent",
	positionalProperties.anime.position,
	positionalProperties.manga.position,
] as const;

const progressFields = (entitySchemaSlug: string): readonly string[] => {
	if (entitySchemaSlug === "anime") {
		return ["consumedOn", "progressPercent", "animeEpisode"];
	}
	if (entitySchemaSlug === "manga") {
		return ["consumedOn", "progressPercent", "mangaVolume", "mangaChapter"];
	}
	return ["consumedOn", "progressPercent"];
};

/** The properties the manifest declares for an activity event, or `undefined` when it has none. */
export const mediaActivityDeclaredProperties = (
	entitySchemaSlug: string,
	eventSchemaSlug: string,
): readonly string[] | undefined => {
	if (!activityEntities.has(entitySchemaSlug)) {
		return undefined;
	}
	const episode = episodeEntities.has(entitySchemaSlug);
	const parent = episodicParents.has(entitySchemaSlug);
	switch (eventSchemaSlug) {
		case "complete":
			return ["consumedOn", "timeSpent", "startedOn", "dateUnknown"];
		case "progress":
			return parent ? undefined : progressFields(entitySchemaSlug);
		case "dropped":
		case "on_hold":
			if (episode) {
				return undefined;
			}
			return [
				"startedOn",
				"timeSpent",
				...(parent ? ["consumedOn"] : progressFields(entitySchemaSlug)),
			];
		case "backlog":
			return episode ? undefined : [];
		default:
			return undefined;
	}
};

export const mediaProgressPositionProperty = (entitySchemaSlug: string) =>
	isPositional(entitySchemaSlug) ? positionalProperties[entitySchemaSlug].position : undefined;

/** Progress is a cumulative position on positional media and a percent everywhere else. */
export const mediaProgressRuleError = (
	entitySchemaSlug: string,
	progress: { readonly position: boolean; readonly percent: boolean },
	requirePosition: boolean,
) => {
	const positional = mediaProgressPositionProperty(entitySchemaSlug) !== undefined;
	if (!positional && progress.position) {
		return "This media type tracks progress as a percent";
	}
	if (positional && (progress.percent || (requirePosition && !progress.position))) {
		return "This media type tracks progress as a position";
	}
	return undefined;
};

/** The declared properties an activity edit may change on this event. */
export const mediaActivityPatchableProperties = (
	entitySchemaSlug: string,
	eventSchemaSlug: string,
): readonly string[] => {
	const position = mediaProgressPositionProperty(entitySchemaSlug);
	const progress = position ?? "progressPercent";
	return (mediaActivityDeclaredProperties(entitySchemaSlug, eventSchemaSlug) ?? []).filter(
		(key) => key === progress || [...DATE_FIELDS, ...DETAIL_FIELDS].some((field) => field === key),
	);
};

export const mediaReviewPatchableKeys = ["text", "isSpoiler", "rating"] as const;

export const mediaReviewDeclaredProperties = (entitySchemaSlug: string): readonly string[] => {
	if (entitySchemaSlug === "anime") {
		return [...mediaReviewPatchableKeys, "animeEpisode"];
	}
	if (entitySchemaSlug === "manga") {
		return [...mediaReviewPatchableKeys, "mangaVolume", "mangaChapter"];
	}
	return mediaReviewPatchableKeys;
};
