import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const comicBookRecipes = mediaFlatRecipes({
	slug: "comic-book",
	alias: "comicBook",
	groupSlug: "comic-book-group",
	measure: mediaEntityCountMeasure("pages"),
	summaryFields: mediaNumberSelection("pages"),
	presentationFields: mediaNumberSelection("pages"),
});
