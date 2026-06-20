import type { AutomationInput } from "@ryot/sandbox-sdk/automation";

type Population = NonNullable<AutomationInput["automation"]["population"]>;

export const getSeasonContext = (parentEntity: Population["parentEntity"]) => {
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
