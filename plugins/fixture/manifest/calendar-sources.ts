import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { castText, column, entitySchemaPredicate, field, jsonPath, table } from "@ryot-app/ryotql";

import { catalogMessage, catalogRowText } from "../shared/messages.generated";

const entity = table("entity", "entity");

export const fixtureCalendarSources = [
	{
		icon: "sparkles",
		startAt: "addedAt",
		precision: "instant",
		slug: "pokemon-added",
		name: catalogMessage("calendar-source.pokemon-added.name"),
		caption: catalogRowText("calendar-source.pokemon-added.caption", { source: "source" }),
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
