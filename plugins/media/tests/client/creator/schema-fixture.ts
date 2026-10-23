import { defineCreatorMediaSchema } from "../../../client/media/creator-schema";
import { MEDIA_ART_HEIGHT } from "../../../client/media/hero";
import { creatorFixtureRecipes } from "./recipes";

export const creatorFixtureSchema = defineCreatorMediaSchema({
	recipes: creatorFixtureRecipes,
	heroHeight: () => MEDIA_ART_HEIGHT,
	artwork: { aspect: "poster", purpose: "profile" },
	links: () => [{ label: "Website", href: "https://creator.test" }],
	facts: () => [{ value: "7", icon: "hash", label: "Fixture fact" }],
	nouns: { title: "Creator", plural: "creators", singular: "creator" },
	creditSections: [
		{ slug: "movie", title: "Films", aspect: "poster" },
		{ title: "Records", aspect: "square", slug: "music-group" },
	],
});
