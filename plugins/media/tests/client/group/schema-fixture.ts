import { defineGroupMediaSchema } from "../../../client/media/group-schema";
import { fixtureSchema } from "../flat-media/schema-fixture";
import { creditGroupFixtureRecipes, groupFixtureRecipes } from "./recipes";

const GROUP_FIXTURE = {
	aspect: "poster",
	member: fixtureSchema,
	members: { verb: "done", noun: "item", tab: "Items" },
	nouns: { title: "Group", plural: "groups", singular: "group" },
} as const;

export const groupFixtureSchema = defineGroupMediaSchema({
	...GROUP_FIXTURE,
	recipes: groupFixtureRecipes,
});

export const creditGroupFixtureSchema = defineGroupMediaSchema({
	...GROUP_FIXTURE,
	recipes: creditGroupFixtureRecipes,
	creditCopy: { people: "Artists", companies: "Labels", notice: "Artists and labels" },
});
