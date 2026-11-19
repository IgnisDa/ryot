import { defineGroupMediaSchema } from "../../../client/media/group-schema";
import { catalogMessage } from "../../../shared/messages.generated";
import { fixtureSchema } from "../flat-media/schema-fixture";
import { creditGroupFixtureRecipes, groupFixtureRecipes } from "./recipes";

const GROUP_FIXTURE = {
	aspect: "poster",
	kind: "movie_group",
	member: fixtureSchema,
	members: { unit: "book", verb: "watch" },
} as const;

export const groupFixtureSchema = defineGroupMediaSchema({
	...GROUP_FIXTURE,
	recipes: groupFixtureRecipes,
});

export const creditGroupFixtureSchema = defineGroupMediaSchema({
	...GROUP_FIXTURE,
	recipes: creditGroupFixtureRecipes,
	creditCopy: {
		people: catalogMessage("credits.artists"),
		companies: catalogMessage("credits.labels"),
		notice: catalogMessage("credits.notice.music-group"),
	},
});
