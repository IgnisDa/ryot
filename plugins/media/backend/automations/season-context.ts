import type { AutomationOccurrencePopulation } from "@ryot-app/sandbox-sdk/automation";

export const getSeasonContext = (parentEntity: AutomationOccurrencePopulation["parentEntity"]) => {
	if (parentEntity?.entitySchemaSlug !== "show-season") {
		return null;
	}
	const value = parentEntity.properties["seasonNumber"];
	return {
		name: parentEntity.name,
		seasonNumber: typeof value === "number" && Number.isFinite(value) ? value : null,
	};
};

export const isSpecialSeason = (season: ReturnType<typeof getSeasonContext>) =>
	season?.seasonNumber === 0 || season?.name.toLowerCase().includes("special") === true;
