import { defineCreatorMediaSchema } from "../../../client/media/creator-schema";
import { catalogMessage } from "../../../shared/messages.generated";
import { creatorFixtureRecipes } from "./recipes";

export const creatorFixtureSchema = defineCreatorMediaSchema({
	kind: "person",
	artwork: { aspect: "poster" },
	recipes: creatorFixtureRecipes,
	links: () => [{ label: "Website", href: "https://creator.test" }],
	facts: () => [{ value: "7", icon: "hash", label: "Fixture fact" }],
	creditSections: [
		{ slug: "movie", aspect: "poster", title: catalogMessage("credits.section.movie") },
		{ aspect: "square", slug: "music-group", title: catalogMessage("credits.section.music-group") },
	],
});
