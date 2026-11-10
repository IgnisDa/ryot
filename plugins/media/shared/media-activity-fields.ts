import { reviewPropertyKeys } from "@ryot-app/plugin-kit/schema";

import { builtinMediaEntitySchemaSlugs, isPositional } from "./media-schema-slugs";

export const mediaActivityEventSchemaSlugs = [
	"complete",
	"item-complete",
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

const DATE_FIELDS = ["startedOn", "dateUnknown", "calendarDate"] as const;
const DETAIL_FIELDS = ["consumedOn", "timeSpent"] as const;

/** Every property an activity edit can set or clear, for the absent-property precondition. */
export const mediaActivityPatchableKeys = [
	...DATE_FIELDS,
	...DETAIL_FIELDS,
	"progressPercent",
	"progressPages",
	"consumptionBasis",
	"sourceRun",
	"sourceProgress",
	"position",
] as const;

const progressFields = (entitySchemaSlug: string): readonly string[] => {
	if (entitySchemaSlug === "book" || entitySchemaSlug === "comic-book") {
		return ["consumedOn", "progressPercent", "progressPages"];
	}
	return isPositional(entitySchemaSlug)
		? ["consumedOn", "progressPercent", "position"]
		: ["consumedOn", "progressPercent"];
};

/** The properties the manifest declares for an activity event, or `undefined` when it has none. */
export const mediaActivityDeclaredProperties = (
	entitySchemaSlug: string,
	eventSchemaSlug: string,
): undefined | readonly string[] => {
	if (!activityEntities.has(entitySchemaSlug)) {
		return undefined;
	}
	const episode = episodeEntities.has(entitySchemaSlug);
	const parent = episodicParents.has(entitySchemaSlug);
	switch (eventSchemaSlug) {
		case "dropped":
		case "on_hold":
			if (episode) {
				return undefined;
			}
			return [
				...DATE_FIELDS,
				"consumptionBasis",
				"sourceRun",
				"sourceProgress",
				"timeSpent",
				...(parent ? ["consumedOn"] : progressFields(entitySchemaSlug)),
			];
		case "backlog":
			return episode ? undefined : [];
		case "complete":
			return [
				"sourceProgress",
				"sourceRun",
				"consumptionBasis",
				"calendarDate",
				"consumedOn",
				"timeSpent",
				"startedOn",
				"dateUnknown",
				"completionKey",
				"completionSilent",
			];
		case "progress":
			return parent
				? undefined
				: [
						...progressFields(entitySchemaSlug),
						...DATE_FIELDS,
						"timeSpent",
						"consumptionBasis",
						"sourceRun",
						"sourceProgress",
					];
		case "item-complete":
			return isPositional(entitySchemaSlug)
				? [
						...DATE_FIELDS,
						...DETAIL_FIELDS,
						"position",
						"consumptionBasis",
						"sourceRun",
						"sourceProgress",
					]
				: undefined;
		default:
			return undefined;
	}
};

/** Progress is a cumulative position on positional media and a percent everywhere else. */
export const mediaProgressRuleError = (
	entitySchemaSlug: string,
	progress: { readonly percent: boolean; readonly position: boolean },
	requirePosition: boolean,
) => {
	const positional = isPositional(entitySchemaSlug);
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
	const progress = isPositional(entitySchemaSlug) ? "position" : "progressPercent";
	return (mediaActivityDeclaredProperties(entitySchemaSlug, eventSchemaSlug) ?? []).filter(
		(key) =>
			key === progress ||
			key === "progressPages" ||
			[...DATE_FIELDS, ...DETAIL_FIELDS].some((field) => field === key),
	);
};

export const mediaReviewDeclaredProperties = (entitySchemaSlug: string): readonly string[] =>
	isPositional(entitySchemaSlug)
		? [...reviewPropertyKeys, "consumptionEventId", "position"]
		: [...reviewPropertyKeys, "consumptionEventId"];
