import { mediaFlatRecipes, mediaNumberField } from "./media-recipes";

export const comicBookRecipes = mediaFlatRecipes({
	slug: "comic-book",
	alias: "comicBook",
	consumptionUnit: "pages",
	groupSlug: "comic-book-group",
	activityEventFields: () => ({}),
	extraOverviewQueries: () => ({}),
	summaryFields: (entity) => ({ pages: mediaNumberField(entity, "pages") }),
	presentationFields: (entity) => ({ pages: mediaNumberField(entity, "pages") }),
});
