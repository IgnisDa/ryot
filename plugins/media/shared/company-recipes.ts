import { mediaCreatorRecipes } from "./creator-recipes";
import { mediaNumberSelection, mediaTextSelection } from "./media-recipes";

export const companyRecipes = mediaCreatorRecipes({
	slug: "company",
	alias: "company",
	summaryFields: (entity) => ({
		...mediaNumberSelection("foundedYear")(entity),
		...mediaTextSelection("headquarters", "website", "sourceUrl")(entity),
	}),
});
