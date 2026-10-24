import { mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const comicBookRecipes = mediaFlatRecipes({
	slug: "comic-book",
	alias: "comicBook",
	consumptionUnit: "pages",
	groupSlug: "comic-book-group",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	summaryFields: mediaNumberSelection("pages"),
	presentationFields: mediaNumberSelection("pages"),
});
