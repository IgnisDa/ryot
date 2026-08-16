import type { MediaImage, ShowDetails, ShowRecipeResult } from "./show-recipe";

export type ShowState =
	| { readonly kind: "ready"; readonly show: ShowDetails }
	| { readonly kind: "missing" }
	| { readonly kind: "wrong-schema"; readonly entitySchemaSlug: string };

export const classifyShow = (result: ShowRecipeResult): ShowState => {
	if (result.show !== null) {
		return { kind: "ready", show: result.show };
	}
	if (result.entitySchemaSlug !== null && result.entitySchemaSlug !== "show") {
		return { kind: "wrong-schema", entitySchemaSlug: result.entitySchemaSlug };
	}
	return { kind: "missing" };
};

export const remoteShowCover = (
	show: ShowDetails,
): Extract<MediaImage, { type: "remote" }> | undefined =>
	show.images?.find(
		(image): image is Extract<MediaImage, { type: "remote" }> =>
			image.type === "remote" && image.purpose === "cover",
	);

export const showIdentityLabel = (show: ShowDetails) =>
	["TV Show", show.providerName ?? undefined, show.publishYear?.toString()]
		.filter((part) => part !== undefined)
		.join(" · ");

const countLabel = (count: number | null, singular: string) =>
	count === null ? undefined : `${count} ${count === 1 ? singular : `${singular}s`}`;

export const showSeasonCountLabel = (show: ShowDetails) => countLabel(show.totalSeasons, "season");

export const showEpisodeCountLabel = (show: ShowDetails) =>
	countLabel(show.totalEpisodes, "episode");
