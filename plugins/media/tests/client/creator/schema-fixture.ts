import { defineCreatorMediaSchema } from "../../../client/media/creator-schema";
import { creatorFixtureRecipes } from "./recipes";

export const creatorFixtureSchema = defineCreatorMediaSchema({
	recipes: creatorFixtureRecipes,
	artwork: { aspect: "poster", purpose: "profile" },
	links: () => [{ label: "Website", href: "https://creator.test" }],
	facts: () => [{ value: "7", icon: "hash", label: "Fixture fact" }],
	nouns: { title: "Creator", plural: "creators", singular: "creator" },
	creditSections: [
		{ slug: "movie", title: "Films", aspect: "poster" },
		{ title: "Records", aspect: "square", slug: "music-group" },
	],
});
