import type { SelectedRowsSource } from "@ryot-app/plugin-kit/ryotql";

import { animeRecipes } from "./anime-recipes";
import { audiobookGroupRecipes } from "./audiobook-group-recipes";
import { audiobookRecipes } from "./audiobook-recipes";
import { bookGroupRecipes } from "./book-group-recipes";
import { bookRecipes } from "./book-recipes";
import { comicBookGroupRecipes } from "./comic-book-group-recipes";
import { comicBookRecipes } from "./comic-book-recipes";
import { mediaEntityPresentationSource, mediaPresentationSource } from "./entity-presentations";
import { mangaRecipes } from "./manga-recipes";
import { movieGroupRecipes } from "./movie-group-recipes";
import { movieRecipes } from "./movie-recipes";
import { musicGroupRecipes } from "./music-group-recipes";
import { musicRecipes } from "./music-recipes";
import { podcastRecipes } from "./podcast-recipes";
import { showRecipes } from "./show-recipes";
import { videoGameGroupRecipes } from "./video-game-group-recipes";
import { videoGameRecipes } from "./video-game-recipes";
import { visualNovelRecipes } from "./visual-novel-recipes";

type PresentationProjection = Pick<SelectedRowsSource<unknown>, "fields" | "include">;

const schemaPresentationSources = new Map<string, PresentationProjection>([
	["book", bookRecipes.presentationSource],
	["show", showRecipes.presentationSource],
	["anime", animeRecipes.presentationSource],
	["manga", mangaRecipes.presentationSource],
	["movie", movieRecipes.presentationSource],
	["music", musicRecipes.presentationSource],
	["podcast", podcastRecipes.presentationSource],
	["audiobook", audiobookRecipes.presentationSource],
	["book-group", bookGroupRecipes.presentationSource],
	["comic-book", comicBookRecipes.presentationSource],
	["video-game", videoGameRecipes.presentationSource],
	["movie-group", movieGroupRecipes.presentationSource],
	["music-group", musicGroupRecipes.presentationSource],
	["visual-novel", visualNovelRecipes.presentationSource],
	["audiobook-group", audiobookGroupRecipes.presentationSource],
	["comic-book-group", comicBookGroupRecipes.presentationSource],
	["video-game-group", videoGameGroupRecipes.presentationSource],
]);

export const mediaPresentationProjection = (slug: string): PresentationProjection => {
	if (slug === "person" || slug === "company") {
		return mediaPresentationSource(slug);
	}
	const source = schemaPresentationSources.get(slug);
	if (source === undefined) {
		throw new Error(`Missing media presentation source: ${slug}`);
	}
	return source;
};

export const mediaPresentationDeclaration = (slug: string) => {
	const owner = mediaPresentationProjection(slug);
	return {
		owner: owner.fields,
		entity: mediaEntityPresentationSource(slug).fields,
		...(owner.include === undefined ? {} : { ownerIncludes: owner.include }),
	};
};
