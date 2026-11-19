import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type {
	ProviderDetailsInput,
	ProviderResolveInput,
	ProviderSearchInput,
} from "@ryot-app/plugin-backend-sdk/provider";

import { mediaGenre, mediaGenreCatalog } from "../../../../shared/media-genres";
import { MediaSandboxError } from "../../../lib/failures";

export const genreDetails = (input: ProviderDetailsInput) => {
	const genre = mediaGenre(input.externalId);
	return genre === null || genre.externalId !== input.externalId
		? Effect.fail(new MediaSandboxError({ message: "Invalid genre identity" }))
		: Effect.succeed({ properties: {}, name: genre.name });
};

export const genreSearch = (input: ProviderSearchInput) => {
	const query = mediaGenre(input.query)?.externalId ?? "";
	const entries = mediaGenreCatalog.filter(
		({ name, externalId }) => externalId.includes(query) || name.toLowerCase().includes(query),
	);
	const start = (input.page - 1) * input.pageSize;
	return Effect.succeed({
		items: entries
			.slice(start, start + input.pageSize)
			.map(({ name, externalId }) => ({ externalId, title: name })),
		details: {
			totalItems: entries.length,
			nextPage: start + input.pageSize < entries.length ? input.page + 1 : null,
		},
	});
};

export const genreResolve = (input: ProviderResolveInput) =>
	Effect.succeed({
		externalId:
			input.identifierType === "name" || input.identifierType === "external-id"
				? (mediaGenre(input.value)?.externalId ?? null)
				: null,
	});
