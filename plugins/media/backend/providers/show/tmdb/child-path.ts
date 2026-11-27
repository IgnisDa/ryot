import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { stringValue } from "../../../lib/records";

const nonNegativeInteger = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

export const tmdbShowChildPath = (input: {
	readonly properties: unknown;
	readonly entitySchemaSlug: string;
}) => {
	const properties = asRecord(input.properties);
	if (!properties) {
		throw new Error("properties must be an object for a TMDB show child");
	}
	const parentShowExternalId = stringValue(properties["parentShowExternalId"]);
	const seasonNumber = nonNegativeInteger(properties["seasonNumber"]);
	if (seasonNumber === null) {
		throw new Error("seasonNumber is required for a TMDB show child");
	}
	if (!parentShowExternalId || !/^\d+$/.test(parentShowExternalId)) {
		throw new Error("parentShowExternalId must be a numeric TMDB show ID");
	}
	const seasonPath = `/tv/${parentShowExternalId}/season/${seasonNumber}`;
	if (input.entitySchemaSlug === "show-season") {
		return seasonPath;
	}
	if (input.entitySchemaSlug === "show-episode") {
		const episodeNumber = nonNegativeInteger(properties["episodeNumber"]);
		if (episodeNumber === null) {
			throw new Error("episodeNumber is required for a TMDB show episode");
		}
		return `${seasonPath}/episode/${episodeNumber}`;
	}
	throw new Error("TMDB show children are only show-season and show-episode");
};
