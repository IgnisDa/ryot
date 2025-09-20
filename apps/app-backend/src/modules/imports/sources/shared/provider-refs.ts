import type { ImportEntityRef } from "../../jobs";

type MovieOrShowEntitySchemaSlug = "movie" | "show";

const normalizeProviderId = (value: string | null | undefined): string | undefined => {
	const normalized = value?.trim();
	return normalized?.length ? normalized : undefined;
};

export const buildMovieOrShowImportRef = (input: {
	sourceLabel: string;
	entitySchemaSlug: MovieOrShowEntitySchemaSlug;
	providerIds: { imdb?: string | null; tmdb?: string | null; tvdb?: string | null };
}): ImportEntityRef | undefined => {
	const tmdbId = normalizeProviderId(input.providerIds.tmdb);
	if (tmdbId) {
		return {
			kind: "resolved",
			externalId: tmdbId,
			sourceLabel: input.sourceLabel,
			entitySchemaSlug: input.entitySchemaSlug,
			scriptSlug: `${input.entitySchemaSlug}.tmdb`,
		};
	}

	const imdbId = normalizeProviderId(input.providerIds.imdb);
	if (imdbId) {
		return {
			kind: "unresolved",
			identifierType: "imdb",
			identifierValue: imdbId,
			sourceLabel: input.sourceLabel,
			entitySchemaSlug: input.entitySchemaSlug,
		};
	}

	const tvdbId = normalizeProviderId(input.providerIds.tvdb);
	if (tvdbId) {
		return {
			kind: "resolved",
			externalId: tvdbId,
			sourceLabel: input.sourceLabel,
			entitySchemaSlug: input.entitySchemaSlug,
			scriptSlug: `${input.entitySchemaSlug}.tvdb`,
		};
	}

	return undefined;
};
