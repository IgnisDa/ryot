import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { castText, column, entitySchemaPredicate, field, jsonPath, table } from "@ryot-app/ryotql";

const entity = table("entity", "entity");

export const fixtureCalendarSources = [
	{
		icon: "sparkles",
		caption: "source",
		startAt: "addedAt",
		precision: "instant",
		slug: "pokemon-added",
		name: "Pokemon added",
		subject: {
			entityAlias: "entity",
			schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("pokemon") }],
		},
		query: {
			from: entity,
			where: entitySchemaPredicate(entity, "pokemon", { kind: "self" }),
			output: {
				type: "rows",
				fields: [
					field("addedAt", column(entity, "createdAt")),
					field("source", castText(jsonPath(column(entity, "properties"), "sourceUrl"))),
				],
			},
		},
	},
] satisfies PluginCalendarSource[];
