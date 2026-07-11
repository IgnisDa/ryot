import type { ImportEntityRef, MediaImportAdapterFailure } from "./schemas";

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
		return {
			kind: "resolved",
			externalId: tmdb,
			sourceLabel: input.sourceLabel,
			entitySchemaSlug: input.entitySchemaSlug,
			providerSlug: `${input.entitySchemaSlug}.tmdb`,
		};
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
	return tvdb
		? {
				kind: "resolved",
				externalId: tvdb,
				sourceLabel: input.sourceLabel,
				entitySchemaSlug: input.entitySchemaSlug,
				providerSlug: `${input.entitySchemaSlug}.tvdb`,
			}
		: null;
};

export const sourceFetchFailure = (input: {
	host: string;
	message: string;
	itemIndex: number;
	sourceLabel?: string | undefined;
	sourceIdentifier?: string | undefined;
}): MediaImportAdapterFailure => ({
	context: { host: input.host },
	stage: "source_fetch",
	message: input.message,
	itemIndex: input.itemIndex,
	...(input.sourceLabel === undefined ? {} : { sourceLabel: input.sourceLabel }),
	...(input.sourceIdentifier === undefined ? {} : { sourceIdentifier: input.sourceIdentifier }),
});
