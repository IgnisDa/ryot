import type { ImportEntityRef, MediaImportAdapterFailure } from "./schemas";

export const resolvedMediaRef = (
	entitySchemaSlug: "movie" | "show",
	provider: "tmdb" | "tvdb",
	externalId: string,
	sourceLabel: string,
): ImportEntityRef => ({
	kind: "resolved",
	externalId,
	sourceLabel,
	entitySchemaSlug,
	providerSlug: `${entitySchemaSlug}.${provider}`,
});

export const movieOrShowImportRef = (input: {
	sourceLabel: string;
	entitySchemaSlug: "movie" | "show";
	providerIds: {
		imdb?: string | undefined;
		tmdb?: string | undefined;
		tvdb?: string | undefined;
	};
}): ImportEntityRef | null => {
	const tmdb = input.providerIds.tmdb?.trim();
	if (tmdb) {
		return resolvedMediaRef(input.entitySchemaSlug, "tmdb", tmdb, input.sourceLabel);
	}
	const imdb = input.providerIds.imdb?.trim();
	if (imdb) {
		return {
			kind: "unresolved",
			identifierType: "imdb",
			identifierValue: imdb,
			sourceLabel: input.sourceLabel,
			entitySchemaSlug: input.entitySchemaSlug,
		};
	}
	const tvdb = input.providerIds.tvdb?.trim();
	return tvdb ? resolvedMediaRef(input.entitySchemaSlug, "tvdb", tvdb, input.sourceLabel) : null;
};

export const sourceFetchFailure = (input: {
	message: string;
	itemIndex: number;
	host?: string | undefined;
	sourceLabel?: string | undefined;
	sourceIdentifier?: string | undefined;
}): MediaImportAdapterFailure => ({
	stage: "source_fetch",
	message: input.message,
	itemIndex: input.itemIndex,
	...(input.host === undefined ? {} : { context: { host: input.host } }),
	...(input.sourceLabel === undefined ? {} : { sourceLabel: input.sourceLabel }),
	...(input.sourceIdentifier === undefined ? {} : { sourceIdentifier: input.sourceIdentifier }),
});
