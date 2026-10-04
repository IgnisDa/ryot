import type { ProviderDetailsRelatedEntityGroup } from "@ryot-app/plugin-backend-sdk/provider";

import { mediaGenre, mediaGenreProviderSlug } from "../../shared/media-genres";

export const mediaGenreGroups = (
	slug: string,
	values: readonly string[] | null,
): ProviderDetailsRelatedEntityGroup[] => {
	if (values === null) {
		return [];
	}
	const genres = new Map(
		values.flatMap((value) => {
			const genre = mediaGenre(value);
			return genre === null ? [] : [[genre.externalId, genre] as const];
		}),
	);
	return [
		{
			direction: "outgoing",
			synchronization: "authoritative",
			relationshipSchemaSlug: `${slug}-to-genre`,
			entities: [...genres.values()].map((genre) =>
				Object.assign(genre, { providerSlug: mediaGenreProviderSlug }),
			),
		},
	];
};
